CREATE TABLE `market_calendar` (
	`id` text PRIMARY KEY NOT NULL,
	`market` text NOT NULL,
	`date` text NOT NULL,
	`is_open` integer NOT NULL,
	`source` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_market_calendar_market_date` ON `market_calendar` (`market`,`date`);