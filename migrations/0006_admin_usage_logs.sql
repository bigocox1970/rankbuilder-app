CREATE TABLE `ai_usage_logs` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text REFERENCES `users`(`id`) ON DELETE SET NULL,
  `model` text NOT NULL,
  `agent_action` text,
  `credit_cost` real NOT NULL,
  `created_at` integer DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX `ai_usage_logs_user_id_idx` ON `ai_usage_logs` (`user_id`);
CREATE INDEX `ai_usage_logs_model_idx` ON `ai_usage_logs` (`model`);
CREATE INDEX `ai_usage_logs_created_at_idx` ON `ai_usage_logs` (`created_at`);
CREATE INDEX `ai_usage_logs_user_created_idx` ON `ai_usage_logs` (`user_id`, `created_at`);
