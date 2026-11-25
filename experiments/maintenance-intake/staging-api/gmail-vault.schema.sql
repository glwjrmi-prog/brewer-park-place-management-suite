-- Isolated BPP maintenance staging Gmail authorization vault.
-- Ciphertext ONLY; AES-GCM secret key supplied as a Cloudflare Worker secret.
-- Never run against production Suite D1; never store OAuth client JSON here.
CREATE TABLE IF NOT EXISTS gmail_sender_vault (
 sender_email TEXT PRIMARY KEY CHECK(sender_email='board@bppcondos.org'),
 ciphertext TEXT NOT NULL,
 iv TEXT NOT NULL,
 key_version TEXT NOT NULL,
 authorized_at INTEGER NOT NULL,
 token_version INTEGER NOT NULL DEFAULT 1
);
