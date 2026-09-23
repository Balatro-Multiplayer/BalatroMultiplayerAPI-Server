-- Legal-liability-driven removal of hardware-fingerprint (HWID) collection
-- for Ranked anti-cheat: the server no longer receives, stores, or reads
-- per-machine hardware component hashes (see the removal of
-- upsertHardwareComponents/getHardwareFingerprintsForPlayer in
-- launcher-integrity.gateway.ts and the hwid-bound verification branch in
-- challenge-strategy.ts). Drops the table added in
-- 0025_player_hardware_fingerprints.sql.
DROP TABLE IF EXISTS "player_hardware_fingerprints";
