-- Singleton row (id always = 1) persisting the weekly cocktail composition.
-- No row is seeded here -- the app defaults to the in-code SEED
-- (weekly-cocktail.ts) until the first admin rotation writes through.
CREATE TABLE "weekly_cocktail" (
	"id" integer PRIMARY KEY DEFAULT 1,
	"name" varchar(40) NOT NULL,
	"decks" text[] NOT NULL,
	"updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
