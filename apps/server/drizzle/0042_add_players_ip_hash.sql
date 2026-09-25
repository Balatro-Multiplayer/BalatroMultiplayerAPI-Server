-- Salted hash of the IP address seen at last Steam login, for ban
-- enforcement/evasion detection. See hashIp() in shared/utils/hash.ts.
ALTER TABLE "players" ADD COLUMN "ip_hash" text;
