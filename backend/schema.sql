
CREATE TABLE IF NOT EXISTS languages (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    language_code VARCHAR(10) NOT NULL UNIQUE,
    is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO languages (name, language_code, is_enabled)
VALUES
    ('English', 'en', FALSE),
    ('Hausa', 'ha', FALSE),
    ('Igbo', 'ig', FALSE),
    ('Yoruba', 'yo', FALSE),
    ('French', 'fr', FALSE)
ON CONFLICT (language_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS tts_requests (
    id BIGSERIAL PRIMARY KEY,
    input_text TEXT NOT NULL,
    language_id INTEGER NOT NULL
        REFERENCES languages(id),
    provider VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    audio_url TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tts_requests_created_at
    ON tts_requests (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tts_requests_status
    ON tts_requests (status);
