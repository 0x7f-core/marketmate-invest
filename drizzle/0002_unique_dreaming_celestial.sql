CREATE TABLE `provider_tokens` (
	`provider` text PRIMARY KEY NOT NULL,
	`ciphertext` text DEFAULT '' NOT NULL,
	`iv` text DEFAULT '' NOT NULL,
	`expires_at` integer DEFAULT 0 NOT NULL,
	`refresh_started_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
