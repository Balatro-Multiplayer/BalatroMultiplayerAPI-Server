# Moderation eval harness

> **Status note (2026-07-31).** This describes a harness that was designed but
> never built, against a label taxonomy that has since been deleted. Every
> `src/eval/*` path below — `taxonomy.ts`, `datasets.ts`, `metrics.ts`,
> `data/red-team.jsonl` — was removed when Qwen3Guard became the only model,
> and the 13-label taxonomy it grades against no longer exists; the model's
> vocabulary today is `Safe | Unsafe | Controversial | unknown`
> (`src/pipeline/types.ts`). Read this as a specification, not a manual: the
> sampling strata, the rule-of-three clean-set bound, and above all the
> flip-to-enforcement checklist are still the right shape for deciding when
> `shadowMode` can go off, and nothing has replaced them. Translating the
> per-label recall bars onto the guard's four-level output is the open work.

Offline evaluation for the `decideModeration` pipeline (`src/pipeline/`)
against a product-specific label taxonomy (`src/eval/taxonomy.ts`). No
service, no new runtime dependencies — this is dev/CI tooling that grades the
pipeline against labeled data you collect over time.

Design source: `.claude/knowledge/chat-moderation/07-external-review-adjudication.md`,
item 9 (stratified shadow evaluation) and item 5 (banding scheme).

## The 7 dataset strata

Collect into separate JSONL files under `src/eval/data/` (one JSON object per
line — see "Dataset format" below). At ~27k messages/day, plan on 100-150
hand-labels/day; each stratum below notes how to source it at that cadence.

| Stratum (`source` field) | What it is | How to collect at ~27k msgs/day |
| --- | --- | --- |
| `random` | Uniform random sample of all chat, unfiltered | Reservoir-sample ~20-30/day from the raw log; label blind (no scores shown) so the sample stays representative of true prevalence — this is what backs the rule-of-three clean-set bound. |
| `would_be_enforcement` | Messages the pipeline's ML tier would have blocked in shadow mode (`wouldHaveBlocked: true` in the verdict) | Pull every `wouldHaveBlocked` row daily (typically small volume); label all of them — this is the highest-value set for tuning block thresholds. |
| `reports` | Messages a player reported | Pull all player reports daily; label all of them — ground truth for what players consider harmful, often broader than the policy's block bar. |
| `near_threshold` | ML scores within +/-0.05 of any configured block threshold | Query the verdict log for scores in that band; label ~10-20/day — these are exactly the cases threshold tuning is sensitive to. |
| `non_english` | Non-English or low-LID-confidence messages | Filter verdict log by LID output; label ~10-20/day, ideally by a speaker of the language — backs `unknown_language`/`needs_native_speaker` recall. |
| `red_team` | Adversarial examples authored by the team (evasion, ambiguity, hard negatives) | Not collected from traffic — authored directly. Starter set: `src/eval/data/red-team.jsonl` (~65 rows). Add new evasion patterns as they're discovered in the wild. |
| `holdout` | Frozen regression set, never used to tune thresholds | Freeze a labeled snapshot (e.g. a `random` + `would_be_enforcement` pull from a specific week); only add to it, never remove; re-run every policy change to catch regressions before they ship. |

Minimum sizes before a flip-to-enforcement decision (see below): >=300 severe
positives total (across strata) and >=3000 clean (`pass`-expected) labels,
spanning at least 2-4 weeks including a weekend and, if possible, a
high-traffic event.

## Labeling instructions per taxonomy label

Label the taxonomy category the message actually belongs to (`src/eval/taxonomy.ts`
is the source of truth for the full list + one-line descriptions). Key
distinctions labelers get wrong most often:

- **`self_harm_encouragement` vs `self_directed_distress`** — the difference
  is *who the harm is directed at*. "kys" aimed AT another player is
  `self_harm_encouragement` (must block). A player saying "i wanna kms after
  that hand" about THEMSELVES is `self_directed_distress` (must publish +
  queue for a human; never auto-punish someone in crisis).
- **`allowed_banter`/`allowed_profanity`/`mild_toxic_allowed` vs
  `targeted_harassment`** — competitive trash talk and game-context language
  that sounds violent ("you killed my run", "campers should die") is banter,
  not a real threat or hate. Only label `targeted_harassment` when the
  hostility is sustained/severe and clearly aimed at a specific person.
- **`pii_contact` vs ordinary chat** — label any solicitation of an
  off-platform contact channel (Discord/Snapchat/phone/email/"what school do
  you go to") as `pii_contact`, including obfuscated forms (spelled-out
  digits, "dot"/"at" spelled out, unicode homoglyphs). This blocks even
  without hostility — it's a safety tier, not a toxicity tier.
- **`sexual_grooming_concern`** — label the grooming PATTERN (age probing,
  secrecy requests, isolation from parents, requests to move off-platform),
  not just sexual content. This is the highest-severity label; when in doubt,
  escalate rather than downgrade.
- **`spam_raid`** — repeated/near-identical content (URLs, invite links, slur
  families) consistent with coordinated posting, not a single off-topic
  message.
- **`unknown_language` vs `needs_native_speaker`** — `unknown_language` is for
  text the labeler (or LID) genuinely cannot classify at all (unclear script,
  too short, emoji-only). `needs_native_speaker` is for text that reads as
  probably-toxic in a language the labeler doesn't speak well enough to
  confirm — flag it for a fluent reviewer rather than guessing.

## Dataset format

JSONL, one object per line:

```json
{"message": "you suck lol", "label": "mild_toxic_allowed", "source": "red_team", "language": "en"}
```

`message` and `label` (a `TaxonomyLabel`) and `source` (a `DatasetSource`) are
required; `language` is optional (defaults to "unknown" in reports). Load with
`loadLabeledDataset(path)`, append with `appendLabeledMessage(path, row)`
(`src/eval/datasets.ts`).

## Flip-to-enforcement checklist

Before turning `shadowMode` off in `DEFAULT_POLICY` (`src/pipeline/policy.ts`),
`flipCriteria()` (`src/eval/metrics.ts`) must report `ready: true`:

- [ ] Block precision >= 0.99 (of messages the pipeline would reject, >=99%
      are truly `block`-expected)
- [ ] Recall >= 0.95 on every severe label: `identity_hate`, `violent_threat`,
      `self_harm_encouragement`, `sexual_grooming_concern`, `pii_contact`
- [ ] Recall >= 0.80 on every OTHER taxonomy label (no blind spot category)
- [ ] >=300 severe-positive labels and >=3000 clean labels collected
- [ ] Spans >=2-4 weeks of real traffic including a weekend/event
- [ ] Burst-replayed p95 latency <500ms and the queue stays sustainable (ws
      admission-control concern, tracked separately — not computed by this
      harness)

Any unmet criterion blocks the flip; `flipCriteria()` returns every failing
reason at once (not just the first) so they can be fixed in one pass.

## Running the harness

```sh
corepack pnpm exec tsc
node dist/eval/run.js src/eval/data/red-team.jsonl
```

This runs every labeled message through `decideModeration` under
`DEFAULT_POLICY` twice (shadow mode on, then off), with `ml: null` — i.e.
deterministic-tiers-only, since this package has no obscenity/blocklist
matcher wired up yet. Expect heavy under-enforcement in this mode: any message
whose expected outcome depends on the ML classifier (`identity_hate`,
`violent_threat`, etc.) will show as a false negative, because nothing today
computes `obscenityMatches` and no scorer runs. That's expected, not a bug in
the harness — it's exactly what `RUN_MODEL_EVAL=1` fixes:

```sh
RUN_MODEL_EVAL=1 node dist/eval/run.js src/eval/data/red-team.jsonl
```

With `RUN_MODEL_EVAL=1`, each message is scored by the real toxic-bert scorer
(`src/scorer/scorer.js`) and the ML tier is exercised for real. This is
slower (loads the ONNX model) and is meant for periodic runs, not every CI
build.

The report (markdown to stdout) has five sections: shadow-mode confusion,
enforce-mode confusion (precision/recall + per-label/per-language tables),
the rule-of-three upper bound on the clean-set false-positive rate, the
flip-criteria verdict, and the 20 worst misclassifications (severe-label false
negatives ranked first).
