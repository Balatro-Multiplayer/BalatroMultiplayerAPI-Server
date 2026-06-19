ALTER TABLE "season_snapshots" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;
WITH ordered AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "season_id"
      ORDER BY "id"
    ) - 1 AS "sort_order"
  FROM "season_snapshots"
)
UPDATE "season_snapshots"
SET "sort_order" = ordered."sort_order"
FROM ordered
WHERE "season_snapshots"."id" = ordered."id";
