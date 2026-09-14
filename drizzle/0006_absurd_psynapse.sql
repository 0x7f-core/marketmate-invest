CREATE TABLE `news_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`items` text DEFAULT '[]' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_news_cache_updated_at` ON `news_cache` (`updated_at`);