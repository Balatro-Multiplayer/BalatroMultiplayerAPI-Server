ALTER TABLE "log_files" ADD COLUMN "file_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "log_files_file_hash_unique" ON "log_files" USING btree ("file_hash");