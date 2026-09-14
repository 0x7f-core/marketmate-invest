CREATE TABLE `cash_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`participant_id` text NOT NULL,
	`type` text NOT NULL,
	`amount_krw` integer NOT NULL,
	`reference_id` text,
	`balance_after_krw` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_cash_ledger_participant_created` ON `cash_ledger` (`participant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `competitions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`invite_code` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`initial_cash_krw` integer NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_competitions_invite_code` ON `competitions` (`invite_code`);--> statement-breakpoint
CREATE INDEX `idx_competitions_owner_status` ON `competitions` (`owner_user_id`,`status`);--> statement-breakpoint
CREATE TABLE `fills` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`instrument_id` text NOT NULL,
	`side` text NOT NULL,
	`quantity_micros` integer NOT NULL,
	`price_micros` integer NOT NULL,
	`fee_krw` integer DEFAULT 0 NOT NULL,
	`executed_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_fills_participant_executed` ON `fills` (`participant_id`,`executed_at`);--> statement-breakpoint
CREATE TABLE `instruments` (
	`id` text PRIMARY KEY NOT NULL,
	`market` text NOT NULL,
	`symbol` text NOT NULL,
	`name` text NOT NULL,
	`currency` text NOT NULL,
	`exchange` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_instruments_market_symbol` ON `instruments` (`market`,`symbol`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`client_order_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`instrument_id` text NOT NULL,
	`side` text NOT NULL,
	`order_type` text NOT NULL,
	`quantity_micros` integer NOT NULL,
	`limit_price_micros` integer,
	`filled_quantity_micros` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`rejection_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_orders_participant_client_order` ON `orders` (`participant_id`,`client_order_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_participant_created` ON `orders` (`participant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_orders_instrument_status` ON `orders` (`instrument_id`,`status`);--> statement-breakpoint
CREATE TABLE `participants` (
	`id` text PRIMARY KEY NOT NULL,
	`competition_id` text NOT NULL,
	`user_id` text NOT NULL,
	`cash_krw` integer NOT NULL,
	`realized_pnl_krw` integer DEFAULT 0 NOT NULL,
	`joined_at` integer NOT NULL,
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_participants_competition_user` ON `participants` (`competition_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_participants_competition` ON `participants` (`competition_id`);--> statement-breakpoint
CREATE TABLE `positions` (
	`id` text PRIMARY KEY NOT NULL,
	`participant_id` text NOT NULL,
	`instrument_id` text NOT NULL,
	`quantity_micros` integer NOT NULL,
	`average_price_micros` integer NOT NULL,
	`realized_pnl_krw` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_positions_participant_instrument` ON `positions` (`participant_id`,`instrument_id`);--> statement-breakpoint
CREATE TABLE `quote_snapshots` (
	`instrument_id` text PRIMARY KEY NOT NULL,
	`price_micros` integer NOT NULL,
	`change_micros` integer NOT NULL,
	`change_rate_ppm` integer NOT NULL,
	`source` text NOT NULL,
	`source_timestamp` integer NOT NULL,
	`received_at` integer NOT NULL,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`nickname` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_email` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `watchlist_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`instrument_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_watchlist_user_instrument` ON `watchlist_items` (`user_id`,`instrument_id`);
--> statement-breakpoint
PRAGMA optimize;
