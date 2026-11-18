CREATE TABLE `google_sign_in_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`client_challenge` text NOT NULL,
	`browser_challenge` text,
	`redirect_uri` text,
	`status` text NOT NULL,
	`identity_json` text,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `google_sign_in_expiry` ON `google_sign_in_attempts` (`expires_at`);--> statement-breakpoint
ALTER TABLE `users` ADD `google_subject` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_google_subject_unique` ON `users` (`google_subject`);