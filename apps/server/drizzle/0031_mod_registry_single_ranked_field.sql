-- Collapses ranked eligibility from two independent admin fields
-- (allowed_in_ranked bool + ranked_version, where null meant "any version")
-- into ranked_version alone: null = not ranked, non-null = ranked and
-- pinned to exactly that version. See setRankedVersion/mod-source-classifier
-- for the branch/release/custom rules now enforced at write time.

-- Data cleanup first: a stray double slash in this mod's stored download
-- URL made it misclassify as a "custom" (unverifiable) source even though
-- it's a real GitHub release asset -- fixed before the backfill below so it
-- gets pinned like any other release-type mod instead of being incorrectly
-- treated as un-rankable.
UPDATE mod_registry SET latest_download_url =
	'https://github.com/Haykira/balatro-expedition33-cards/releases/download/release/expedition33_deck.zip'
	WHERE id = 'Expedition33Deck';

-- Backfill: every mod that was allowed_in_ranked=true gets ranked_version
-- pinned to its current latest_version, except the two genuinely
-- custom-hosted ones (GitLab / raw.githubusercontent.com) which are
-- un-ranked instead -- confirmed by hand that every other allowed mod
-- already has a matching mod_registry_versions row for its latest_version,
-- so this backfill is internally consistent with the release-type
-- known-version rule enforced going forward.
UPDATE mod_registry SET ranked_version = latest_version, updated_at = now()
	WHERE allowed_in_ranked = true
		AND id NOT IN ('Friends-of-BalatrOwen', 'Jimbo''sMetrics');

ALTER TABLE mod_registry DROP COLUMN allowed_in_ranked;
