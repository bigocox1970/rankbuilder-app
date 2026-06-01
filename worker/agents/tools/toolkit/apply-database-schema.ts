import { tool, t } from '../types';
import { StructuredLogger } from '../../../logger';
import { ICodingAgent } from 'worker/agents/services/interfaces/ICodingAgent';
import { SupabaseConnectionService } from '../../../services/supabase/SupabaseConnectionService';

/**
 * Lets the agent apply database schema (tables, RLS policies, functions, triggers) to the
 * Supabase project linked to this app, by running SQL through the Management API. This is
 * how the builder owns the whole DB lifecycle: the user never copies SQL into the Supabase
 * dashboard. Works identically for every app type (Expo, React web, static website) because
 * it targets the database directly, independent of the frontend.
 *
 * The SQL must be idempotent so re-running on schema changes is safe.
 */
export function createApplyDatabaseSchemaTool(
	agent: ICodingAgent,
	logger: StructuredLogger,
) {
	return tool({
		name: 'apply_database_schema',
		description: [
			'Apply SQL schema to the linked Supabase database (creates/updates tables, RLS policies, functions, triggers).',
			'Use this INSTEAD of writing a schema.sql file for the user to run manually — the builder runs it for them.',
			'The SQL MUST be idempotent: use CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS before CREATE POLICY, CREATE OR REPLACE FUNCTION, etc., so it is safe to re-run when the schema evolves.',
			'Enable Row Level Security and add policies for any table holding user data. Never write destructive statements (DROP TABLE, DELETE, TRUNCATE) — only additive/idempotent changes.',
			'If it returns an error, read it, fix the SQL, and call again.',
		].join(' '),
		args: {
			sql: t.string().describe('A single SQL script (statements separated by semicolons) to apply to the database. Must be idempotent.'),
		},
		run: async ({ sql }) => {
			const { env, agentId } = agent.getOperationOptions();
			logger.info('Applying database schema to linked Supabase project', { agentId, sqlLength: sql.length });

			const result = await new SupabaseConnectionService(env).runSqlForAgent(agentId, sql);

			if (!result.success) {
				logger.warn('apply_database_schema failed', { agentId, error: result.error });
				return {
					success: false,
					error: result.error ?? 'Unknown error applying schema.',
				};
			}
			return {
				success: true,
				message: 'Schema applied to the linked Supabase database.',
			};
		},
	});
}
