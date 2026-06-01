CREATE TABLE `supabase_project_links` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`project_ref` text NOT NULL,
	`project_name` text,
	`project_url` text,
	`anon_key` text,
	`encrypted_service_role_key` text,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP,
	`updated_at` integer DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `supabase_project_links_agent_id_unique` ON `supabase_project_links` (`agent_id`);