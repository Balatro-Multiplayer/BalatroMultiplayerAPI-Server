INSERT INTO "players" ("steam_id", "steam_name", "privileges", "preferred_joker")
VALUES
  ('76561198146557552', 'Virtualized', '{virtualized}', 'j_perkeo'),
  ('76561198866555857', 'Vagabond', '{vagabond}', 'j_vagabond'),
  ('76561198797557816', 'Bean', '{bean}', 'j_turtle_bean'),
  ('76561198450903850', 'Sizaak', '{sizaak}', 'j_dusk')
ON CONFLICT ("steam_id") WHERE steam_id IS NOT NULL DO UPDATE SET
  "privileges" = EXCLUDED."privileges",
  "preferred_joker" = EXCLUDED."preferred_joker",
  "updated_at" = NOW();