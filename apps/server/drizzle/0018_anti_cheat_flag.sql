-- Phase 8 anti-cheat: records why a match_run_logs row was flagged
-- (hash mismatch against the client's self-reported carbon_hash, or the
-- elapsed-time plausibility gate) at ranked result resolution. A non-null
-- value means expires_at was forced to null (indefinite retention) by the
-- same resolution step -- see matchmaking.service.ts's evaluateAntiCheat.
ALTER TABLE "match_run_logs" ADD COLUMN IF NOT EXISTS "flag_reason" varchar(32);
