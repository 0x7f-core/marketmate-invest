ALTER TABLE `fills` ADD `fx_rate_micros` integer DEFAULT 1000000 NOT NULL;--> statement-breakpoint
ALTER TABLE `quote_snapshots` ADD `fx_rate_micros` integer DEFAULT 1000000 NOT NULL;