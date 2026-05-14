import { tool, t } from '../types';
import { StructuredLogger } from '../../../logger';
import { ICodingAgent } from 'worker/agents/services/interfaces/ICodingAgent';
import { ExecuteCommandsResponse } from 'worker/services/sandbox/sandboxTypes';

export type ExecCommandsResult = ExecuteCommandsResponse | { error: string };

// Strip version specifier from a bun/npm add command for retry.
// e.g. "bun add react-parallax@^10.0.0" -> "bun add react-parallax"
function stripVersionFromAddCommand(cmd: string): string | null {
	const match = cmd.match(/^(bun add|npm install|npm i)\s+(.+)$/);
	if (!match) return null;
	const stripped = match[2]
		.split(/\s+/)
		.map((pkg) => pkg.replace(/@[\^~]?[\d].*$/, ''))
		.join(' ');
	return stripped !== match[2] ? `${match[1]} ${stripped}` : null;
}

export function createExecCommandsTool(
	agent: ICodingAgent,
	logger: StructuredLogger
) {
	return tool({
		name: 'exec_commands',
		description:
			'Execute shell commands in the sandbox. CRITICAL shouldSave rules: (1) Set shouldSave=true ONLY for package management with specific packages (e.g., "bun add react", "npm install lodash"). (2) Set shouldSave=false for: file operations (rm, mv, cp), plain installs ("bun install"), run commands ("bun run dev"), and temporary operations. Invalid commands in shouldSave=true will be automatically filtered out. Always use bun for package management.',
		args: {
			commands: t.commands().describe('Array of shell commands to execute'),
			shouldSave: t.boolean().default(true).describe('Whether to save package management commands to blueprint'),
			timeout: t.number().default(30000).describe('Timeout in milliseconds'),
		},
		run: async ({ commands, shouldSave, timeout }) => {
			try {
				const shouldSaveValue = shouldSave ?? true;
				const timeoutValue = timeout ?? 30000;

				logger.info('Executing commands', {
					count: commands.length,
					commands,
					shouldSave: shouldSaveValue,
					timeout: timeoutValue,
				});
				let output = await agent.execCommands(commands, shouldSave, timeoutValue);

				// If a package install failed, retry each failing command without the version
				// specifier (handles hallucinated/non-existent package versions).
				if (output.results?.some((r) => !r.success)) {
					const retryCommands: string[] = [];
					const retriedIndices: number[] = [];

					output.results.forEach((r, i) => {
						if (!r.success) {
							const fallback = stripVersionFromAddCommand(commands[i]);
							if (fallback) {
								retryCommands.push(fallback);
								retriedIndices.push(i);
							}
						}
					});

					if (retryCommands.length > 0) {
						logger.warn('Package install failed, retrying without version specifiers', { retryCommands });
						const retryOutput = await agent.execCommands(retryCommands, shouldSaveValue, timeoutValue);
						retryOutput.results.forEach((r, idx) => {
							output.results[retriedIndices[idx]] = {
								...r,
								output: `[retried without version] ${r.output}`,
							};
						});
					}
				}

				// Truncate output to max 1000 characters per result
				const MAX_OUTPUT_LENGTH = 1000;
				const truncatedOutput = {
					...output,
					results: output.results.map((result) => ({
						...result,
						output:
							result.output.length > MAX_OUTPUT_LENGTH
								? result.output.substring(0, MAX_OUTPUT_LENGTH) + '\n[truncated to max 1000 characters]'
								: result.output,
					})),
				};
				return truncatedOutput;
			} catch (error) {
				return {
					error:
						error instanceof Error
							? `Failed to execute commands: ${error.message}`
							: 'Unknown error occurred while executing commands',
				};
			}
		},
	});
}
