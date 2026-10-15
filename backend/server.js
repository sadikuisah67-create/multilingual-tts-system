
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const https = require("https");
const dns = require("dns").promises;
const net = require("net");
const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: "100kb" }));

const LANGA_URL = "https://langa.julimer.com/v1/audio/speech";
const TTS_AI_BASE_URL = "https://api.tts.ai/v1";

const LANGA_LANGUAGES = new Set(["en", "ha", "ig", "yo"]);
const FRENCH_VOICE = process.env.FRENCH_TTS_VOICE || "ff_siwis";
const FRENCH_MODEL = process.env.FRENCH_TTS_MODEL || "kokoro";

/* -------------------------------------------------------
   HTTPS REQUEST HELPER
------------------------------------------------------- */

function requestBuffer(url, options = {}, redirects = 3) {
  return new Promise((resolve, reject) => {
    let parsed;

    try {
      parsed = new URL(url);
    } catch {
      reject(new Error("Invalid request URL."));
      return;
    }

    if (parsed.protocol !== "https:") {
      reject(new Error("Only HTTPS requests are accepted."));
      return;
    }

    const request = https.request(
      parsed,
      {
        method: options.method || "GET",
        headers: options.headers || {},
        timeout: options.timeout || 60000
      },
      (response) => {
        const status = response.statusCode || 0;

        if ([301, 302, 303, 307, 308].includes(status)) {
          const location = response.headers.location;
          response.resume();

          if (!location || redirects <= 0) {
            reject(new Error("Invalid or excessive redirects."));
            return;
          }

          let nextUrl;

          try {
            nextUrl = new URL(location, parsed).toString();
          } catch {
            reject(new Error("Invalid redirect URL."));
            return;
          }

          requestBuffer(nextUrl, options, redirects - 1)
            .then(resolve)
            .catch(reject);

          return;
        }

        const chunks = [];

        response.on("data", (chunk) => chunks.push(chunk));

        response.on("end", () => {
          const body = Buffer.concat(chunks);

          if (status < 200 || status >= 300) {
            reject(
              new Error(
                `External service returned HTTP ${status}: ${
                  body.toString("utf8").slice(0, 500)
                }`
              )
            );
            return;
          }

          resolve({
            body,
            headers: response.headers,
            status
          });
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(new Error("External service request timed out."));
    });

    request.on("error", reject);

    if (options.body) {
      request.write(options.body);
    }

    request.end();
  });
}

/* -------------------------------------------------------
   AUDIO URL VALIDATION
------------------------------------------------------- */

function isPrivateIPv4(address) {
  const parts = address.split(".").map(Number);

  if (
    parts.length !== 4 ||
    parts.some(
      (number) =>
        !Number.isInteger(number) ||
        number < 0 ||
        number > 255
    )
  ) {
    return true;
  }

  const [a, b] = parts;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

async function validateAudioUrl(value) {
  let url;

  try {
    url = new URL(value);
  } catch {
    throw new Error("French speech service returned an invalid audio URL.");
  }

  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("French speech service returned an invalid audio URL.");
  }

  const hostname = url.hostname.toLowerCase();

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname === "metadata.google.internal" ||
    net.isIP(hostname) !== 0
  ) {
    throw new Error("French speech service returned an invalid audio URL.");
  }

  const addresses = await dns
    .lookup(hostname, { all: true })
    .catch(() => []);

  if (!addresses.length) {
    throw new Error("French audio URL hostname could not be resolved.");
  }

  for (const item of addresses) {
    if (item.family === 4 && isPrivateIPv4(item.address)) {
      throw new Error("French speech service returned an invalid audio URL.");
    }

    if (
      item.family === 6 &&
      (
        item.address === "::1" ||
        item.address.startsWith("fc") ||
        item.address.startsWith("fd") ||
        item.address.startsWith("fe80:")
      )
    ) {
      throw new Error("French speech service returned an invalid audio URL.");
    }
  }

  return url.toString();
}

/* -------------------------------------------------------
   LANGA: ENGLISH, HAUSA, IGBO AND YORUBA
------------------------------------------------------- */

async function generateWithLanga(text, languageCode) {
  const response = await requestBuffer(LANGA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
      ...(process.env.LANGA_API_KEY
        ? {
            Authorization: `Bearer ${process.env.LANGA_API_KEY}`
          }
        : {})
    },
    body: JSON.stringify({
      model: "n-atlas-tts",
      voice: languageCode,
      input: text,
      response_format: "mp3"
    }),
    timeout: 90000
  });

  const contentType = String(
    response.headers["content-type"] || ""
  );

  if (
    response.body.length === 0 ||
    contentType.includes("application/json") ||
    contentType.includes("text/html")
  ) {
    throw new Error("Langa did not return an MP3 audio response.");
  }

  return response.body;
}

/* -------------------------------------------------------
   TTS.AI: FRENCH
------------------------------------------------------- */

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateFrenchWithTtsAi(text) {
  const createResponse = await requestBuffer(
    `${TTS_AI_BASE_URL}/tts/`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        model: FRENCH_MODEL,
        text,
        voice: FRENCH_VOICE,
        language: "fr",
        format: "mp3"
      }),
      timeout: 60000
    }
  );

  let job;

  try {
    job = JSON.parse(createResponse.body.toString("utf8"));
  } catch {
    throw new Error("TTS.ai returned an invalid job response.");
  }

  const jobId = job.uuid || job.job_id;

  if (!jobId) {
    throw new Error("TTS.ai did not return a job ID.");
  }

  let resultUrl = null;

  for (let attempt = 0; attempt < 45; attempt += 1) {
    if (attempt > 0) {
      await wait(1500);
    }

    const statusUrl =
      `${TTS_AI_BASE_URL}/speech/results/?uuid=${encodeURIComponent(jobId)}`;

    const statusResponse = await requestBuffer(statusUrl, {
      headers: { Accept: "application/json" },
      timeout: 30000
    });

    try {
      job = JSON.parse(statusResponse.body.toString("utf8"));
    } catch {
      throw new Error("TTS.ai returned an invalid status response.");
    }

    const status = String(job.status || "").toLowerCase();

    resultUrl =
      job.result_url ||
      job.audio_url ||
      (typeof job.result === "string" ? job.result : null);

    if (
      resultUrl &&
      (
        status === "completed" ||
        status === "success" ||
        status === "succeeded" ||
        !status
      )
    ) {
      break;
    }

    if (
      status === "failed" ||
      status === "error" ||
      status === "cancelled"
    ) {
      throw new Error(
        `TTS.ai speech generation failed: ${
          job.error || job.message || status
        }`
      );
    }

    resultUrl = null;
  }

  if (!resultUrl) {
    throw new Error(
      "TTS.ai did not provide a completed audio URL in time."
    );
  }

  const safeAudioUrl = await validateAudioUrl(resultUrl);

  const audioResponse = await requestBuffer(safeAudioUrl, {
    headers: {
      Accept: "audio/mpeg, audio/*, application/octet-stream"
    },
    timeout: 90000
  });

  if (!audioResponse.body.length) {
    throw new Error("TTS.ai returned an empty audio file.");
  }

  const contentType = String(
    audioResponse.headers["content-type"] || ""
  );

  if (
    contentType.includes("application/json") ||
    contentType.includes("text/html")
  ) {
    throw new Error("TTS.ai returned a webpage instead of audio.");
  }

  return audioResponse.body;
}

/* -------------------------------------------------------
   BASIC ROUTES
------------------------------------------------------- */

app.get("/", (req, res) => {
  res.send("Multilingual Text-to-Speech System Backend is running.");
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Backend API is working."
  });
});

/* -------------------------------------------------------
   DATABASE CONNECTION TEST
------------------------------------------------------- */

app.get("/api/db-test", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT current_database() AS database, NOW() AS server_time"
    );

    res.json({
      status: "ok",
      ...result.rows[0]
    });
  } catch (error) {
    console.error("Database test failed:", error);

    res.status(500).json({
      status: "error",
      message: "Database connection failed.",
      error: error.message
    });
  }
});

/* -------------------------------------------------------
   GET ENABLED LANGUAGES
   Database column: name
------------------------------------------------------- */

app.get("/api/languages", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, language_code, is_enabled
      FROM public.languages
      WHERE is_enabled = TRUE
      ORDER BY name ASC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Could not load languages:", error);

    res.status(500).json({
      message: "Could not load enabled languages.",
      error: error.message
    });
  }
});

/* -------------------------------------------------------
   GENERATE SPEECH
------------------------------------------------------- */

app.post("/api/tts", async (req, res) => {
  try {
    const text =
      typeof req.body?.text === "string"
        ? req.body.text.trim()
        : "";

    const languageCode =
      typeof req.body?.language === "string"
        ? req.body.language.trim().toLowerCase()
        : "";

    if (!text) {
      return res.status(400).json({
        message: "Enter text to convert to speech."
      });
    }

    if (text.length > 500) {
      return res.status(400).json({
        message: "Please keep the text within 500 characters."
      });
    }

    if (!languageCode) {
      return res.status(400).json({
        message: "Select a language."
      });
    }

    const languageResult = await pool.query(
      `SELECT language_code, name, is_enabled
       FROM public.languages
       WHERE LOWER(language_code) = $1
       LIMIT 1`,
      [languageCode]
    );

    if (
      languageResult.rows.length === 0 ||
      !languageResult.rows[0].is_enabled
    ) {
      return res.status(400).json({
        message: "This language is not enabled."
      });
    }

    let audio;

    if (LANGA_LANGUAGES.has(languageCode)) {
      audio = await generateWithLanga(text, languageCode);
    } else if (languageCode === "fr") {
      audio = await generateFrenchWithTtsAi(text);
    } else {
      return res.status(400).json({
        message: "No speech provider is configured for this language."
      });
    }

    res.set({
      "Content-Type": "audio/mpeg",
      "Content-Length": audio.length,
      "Content-Disposition": 'inline; filename="speech.mp3"',
      "Cache-Control": "no-store"
    });

    return res.send(audio);
  } catch (error) {
    console.error("Speech generation failed:", error);

    if (!res.headersSent) {
      return res.status(502).json({
        message: "The speech service could not generate audio. Please try again.",
        error: error.message
      });
    }
  }
});

/* -------------------------------------------------------
   START SERVER
------------------------------------------------------- */

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
