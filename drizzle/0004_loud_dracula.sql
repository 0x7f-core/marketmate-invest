ALTER TABLE `users` ADD `role` text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `is_active` integer DEFAULT true NOT NULL;--> statement-breakpoint
INSERT INTO `users` (`id`,`email`,`nickname`,`nickname_normalized`,`pin_hash`,`pin_salt`,`role`,`is_active`,`failed_login_count`,`locked_until`,`created_at`,`updated_at`)
VALUES ('marketmate-superadmin','admin@marketmate.local','관리자','관리자','n7ohkio4ZJBXONgdBkkOlVbe7IlraL8OYBvPzFUiW48','kNTD8dM-Hp7WdbJHpPrr6Q','admin',1,0,0,1789344000000,1789344000000)
ON CONFLICT(`nickname_normalized`) DO UPDATE SET `role`='admin',`is_active`=1,`pin_hash`=excluded.`pin_hash`,`pin_salt`=excluded.`pin_salt`,`updated_at`=excluded.`updated_at`;
