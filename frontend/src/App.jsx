
import { useEffect, useState } from "react";
import "./App.css";

const API_URL = "http://localhost:5000/api";
const MAX_CHARACTERS = 500;

function App() {
  const [languages, setLanguages] = useState([]);
  const [languageCode, setLanguageCode] = useState("");
  const [inputText, setInputText] = useState("");
  const [message, setMessage] = useState("Loading languages...");
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [audioUrl, setAudioUrl] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadLanguages() {
      try {
        const response = await fetch(`${API_URL}/languages`);

        if (!response.ok) {
          throw new Error("Could not load languages from the backend.");
        }

        const data = await response.json();

        if (!Array.isArray(data)) {
          throw new Error("The backend returned an unexpected language list.");
        }

        if (cancelled) return;

        const enabledLanguages = data.filter(
          (language) => language.is_enabled === true
        );

        setLanguages(enabledLanguages);
        setMessage(
          enabledLanguages.length > 0
            ? "Choose a language and enter your text."
            : "No languages are currently enabled."
        );
      } catch (error) {
        if (!cancelled) {
          setMessage(
            error.message || "Unable to connect to the backend."
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadLanguages();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  function clearAudio() {
    setAudioUrl((previousUrl) => {
      if (previousUrl) {
        URL.revokeObjectURL(previousUrl);
      }

      return "";
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!languageCode) {
      setMessage("Please select a language.");
      return;
    }

    const text = inputText.trim();

    if (!text) {
      setMessage("Please enter some text.");
      return;
    }

    if (text.length > MAX_CHARACTERS) {
      setMessage("Please keep your text within 500 characters.");
      return;
    }

    setIsGenerating(true);
    clearAudio();
    setMessage("Generating speech. Please wait...");

    try {
      const response = await fetch(`${API_URL}/tts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text,
          language: languageCode
        })
      });

      if (!response.ok) {
        let errorMessage = "Speech generation failed.";

        try {
          const data = await response.json();
          errorMessage = data.message || errorMessage;

          if (data.error) {
            console.error("Speech generation details:", data.error);
          }
        } catch {
          // Keep the default error message.
        }

        throw new Error(errorMessage);
      }

      const audioBlob = await response.blob();

      if (!audioBlob.size) {
        throw new Error("The speech service returned an empty audio file.");
      }

      const newAudioUrl = URL.createObjectURL(audioBlob);
      setAudioUrl(newAudioUrl);
      setMessage("Speech generated successfully. Press Play to listen.");
    } catch (error) {
      setMessage(error.message || "Unable to generate speech.");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">T</span>
          MultiVoice
        </div>

        <span className="topbar-label">
          MULTILINGUAL TEXT-TO-SPEECH
        </span>
      </header>

      <section className="hero">
        <p className="eyebrow">YOUR WORDS, YOUR LANGUAGE</p>

        <h1>
          Give your words
          <br />
          <span>a voice.</span>
        </h1>

        <p className="hero-description">
          Turn written text into speech in your selected language.
        </p>
      </section>

      <section className="workspace">
        <p className="eyebrow">SPEECH WORKSPACE</p>
        <h2>Prepare your text</h2>

        <form onSubmit={handleSubmit}>
          <label htmlFor="language">Choose a language</label>

          <select
            id="language"
            name="language"
            value={languageCode}
            onChange={(event) => {
              setLanguageCode(event.target.value);
              setMessage("Language selected. Enter your text.");
              clearAudio();
            }}
            disabled={isLoading || isGenerating || languages.length === 0}
            required
          >
            <option value="">
              {isLoading ? "Loading languages..." : "Select a language"}
            </option>

            {languages.map((language) => (
              <option
                key={language.id}
                value={language.language_code}
              >
                {language.name}
              </option>
            ))}
          </select>

          <label htmlFor="inputText">Your text</label>

          <textarea
            id="inputText"
            name="text"
            rows={7}
            maxLength={MAX_CHARACTERS}
            value={inputText}
            onChange={(event) => setInputText(event.target.value)}
            placeholder="Type or paste your text here..."
            disabled={isGenerating}
            required
          />

          <p className="character-count">
            {inputText.length} / {MAX_CHARACTERS} characters
          </p>

          <button
            type="submit"
            disabled={
              isLoading ||
              isGenerating ||
              languages.length === 0
            }
          >
            {isGenerating ? "Generating speech..." : "Generate speech"}
            {!isGenerating && <span aria-hidden="true"> →</span>}
          </button>
        </form>

        <p className="notice" role="status" aria-live="polite">
          {message}
        </p>

        {audioUrl && (
          <div className="audio-result">
            <h3>Your generated speech</h3>

            <audio controls src={audioUrl}>
              Your browser does not support audio playback.
            </audio>

            <p>
              <a href={audioUrl} download="multivoice-speech.mp3">
                Download audio
              </a>
            </p>
          </div>
        )}
      </section>

      <footer>
        <p>Multilingual Text-to-Speech System</p>
        <p>English · Hausa · Igbo · Yoruba · French</p>
      </footer>
    </main>
  );
}

export default App;
