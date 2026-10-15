
import { useEffect, useRef, useState } from "react";
import "./App.css";

const API_URL = "http://localhost:5000/api";

function App() {
  const [languages, setLanguages] = useState([]);
  const [languageId, setLanguageId] = useState("");
  const [inputText, setInputText] = useState("");
  const [message, setMessage] = useState("Loading languages...");
  const [isGenerating, setIsGenerating] = useState(false);
  const [audioUrl, setAudioUrl] = useState("");
  const audioRef = useRef(null);

  useEffect(() => {
    let active = true;

    fetch(`${API_URL}/languages`)
      .then((response) => {
        if (!response.ok) {
          throw new Error("Could not load languages.");
        }
        return response.json();
      })
      .then((data) => {
        if (!active) return;

        setLanguages(data.languages || []);
        setMessage("Choose a language and enter your text.");
      })
      .catch(() => {
        if (active) {
          setMessage(
            "Cannot connect to the backend. Make sure it is running."
          );
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  async function handleSubmit(event) {
    event.preventDefault();

    if (!inputText.trim()) {
      setMessage("Please enter some text.");
      return;
    }

    if (!languageId) {
      setMessage("Please select an available language.");
      return;
    }

    setIsGenerating(true);
    setMessage("Generating your speech... Please wait.");

    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl("");
    }

    try {
      const response = await fetch(`${API_URL}/tts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text: inputText.trim(),
          languageId: Number(languageId)
        })
      });

      if (!response.ok) {
        let errorMessage = "Speech generation failed.";

        try {
          const errorData = await response.json();
          errorMessage = errorData.message || errorMessage;
        } catch {
          // Keep the default error message if the response is not JSON.
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

      setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.load();
        }
      }, 0);
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
        <span className="topbar-label">MULTILINGUAL TEXT-TO-SPEECH</span>
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
            value={languageId}
            onChange={(event) => {
              setLanguageId(event.target.value);
              setMessage("Ready to generate speech.");
              if (audioUrl) {
                URL.revokeObjectURL(audioUrl);
                setAudioUrl("");
              }
            }}
            required
          >
            <option value="">Select a language</option>
            {languages.map((language) => (
              <option
                key={language.id}
                value={language.id}
                disabled={!language.is_enabled}
              >
                {language.name}
                {!language.is_enabled ? " — Coming soon" : ""}
              </option>
            ))}
          </select>

          <label htmlFor="inputText">Your text</label>
          <textarea
            id="inputText"
            rows={7}
            maxLength={5000}
            value={inputText}
            onChange={(event) => setInputText(event.target.value)}
            placeholder="Type or paste your text here..."
            required
          />

          <p className="character-count">
            {inputText.length} / 5000 characters
          </p>

          <button type="submit" disabled={isGenerating}>
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
            <audio
              ref={audioRef}
              controls
              src={audioUrl}
              preload="metadata"
            >
              Your browser does not support audio playback.
            </audio>
            <a href={audioUrl} download="multivoice-speech.mp3">
              Download audio
            </a>
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
