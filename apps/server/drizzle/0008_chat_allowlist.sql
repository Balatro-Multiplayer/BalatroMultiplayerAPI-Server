-- Pre-approved chat messages that bypass Paxmod moderation.
-- Stored in normalized form (lowercase, trimmed, trailing single punctuation
-- stripped where applicable — pure-punctuation entries like "?" stored as-is).
CREATE TABLE "chat_allowlist" (
	"message" varchar(200) PRIMARY KEY
);
