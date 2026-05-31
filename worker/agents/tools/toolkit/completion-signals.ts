import { tool, t, ToolDefinition } from '../types';
import { StructuredLogger } from '../../../logger';
import { ICodingAgent } from 'worker/agents/services/interfaces/ICodingAgent';

type CompletionResult = {
	acknowledged: boolean;
	message: string;
};

/**
 * Per-agent count of times mark_generation_complete has been blocked by a
 * non-compiling web bundle. Keyed on the agent (DO) instance so it survives the
 * tool being re-instantiated across build attempts within one session, and is
 * naturally discarded when the DO is evicted. Bounds the gate so a bundle the
 * agent genuinely cannot fix can never trap the build loop in an infinite,
 * credit-burning cycle.
 */
const bundleGateBlocks = new WeakMap<ICodingAgent, number>();
const MAX_BUNDLE_GATE_BLOCKS = 3;

export function createMarkGenerationCompleteTool(
    agent: ICodingAgent,
	logger: StructuredLogger
): ToolDefinition<{ summary: string; filesGenerated: number }, CompletionResult> {
	return tool({
		name: 'mark_generation_complete',
		description: `Signal that initial project generation is complete and ready for the user to review and get feedback. After calling this tool, control would be handed over to the user.`,
		args: {
			summary: t.string().describe('Brief summary of what was built (2-3 sentences max). Describe the key features and functionality implemented.'),
			filesGenerated: t.number().describe('Total count of files generated during this build session'),
		},
		run: async ({ summary, filesGenerated }) => {
			// Bundle-health gate: an Expo web bundle that fails to compile returns
			// HTTP 500 and renders a silent blank white screen — the JS never runs,
			// so monitor-cli captures no runtime error and the agent would otherwise
			// "complete" on a broken preview (the exact white-screen failure mode).
			// probeExpoBundleError (in getInstanceErrors) surfaces it as a level-60
			// fatal; if one is present, refuse completion and hand the compile error
			// back so the agent fixes it first. Self-gating: only Expo 500s this path,
			// so non-Expo builds and healthy bundles never trip the gate. Capped via
			// bundleGateBlocks so an unfixable bundle can't loop the build forever.
			const blocks = bundleGateBlocks.get(agent) ?? 0;
			if (blocks < MAX_BUNDLE_GATE_BLOCKS) {
				try {
					const errors = await agent.fetchRuntimeErrors(false);
					// Block on BOTH failure modes that leave the user on a blank screen:
					//   (a) compile error — Metro 500, surfaced by probeExpoBundleError as
					//       "Web bundle failed to compile" (level 60).
					//   (b) runtime crash — bundle compiles (200) but the app throws on
					//       render (e.g. reading a prop off undefined). The _devErrorOverlay
					//       reports these to the console tagged "[CLIENT ERROR]", which the
					//       sandbox monitor captures, so they show up here once the page has
					//       rendered (the build's screenshot step triggers that render).
					const bundleError = errors.find((e) => {
						const text = `${e.message ?? ''}\n${e.rawOutput ?? ''}`;
						return (
							(e.level >= 60 && /Web bundle failed to compile/.test(text)) ||
							/\[CLIENT ERROR\]/.test(text) ||
							// Infinite render loop: pegs the CPU and freezes the tab. React logs
							// this via console.error (not always tagged [CLIENT ERROR]), so match
							// it explicitly — completing on this ships a browser-locking app.
							/Maximum update depth exceeded/.test(text)
						);
					});
					if (bundleError) {
						bundleGateBlocks.set(agent, blocks + 1);
						logger.warn('mark_generation_complete blocked: web bundle is not compiling', {
							attempt: blocks + 1,
							error: bundleError.message
						});
						return {
							acknowledged: false,
							message: `Cannot mark generation complete yet: the app is showing a blank white screen for the user — either the web bundle failed to compile or it crashed at runtime on render. You MUST fix this before completing.\n\n${bundleError.rawOutput || bundleError.message}\n\nFix the file(s) named in the error above, then verify with get_runtime_errors (the error must be gone) before calling mark_generation_complete again.`,
						};
					}
				} catch (error) {
					// Never let a probe failure block a legitimate completion.
					logger.warn('mark_generation_complete bundle-health check failed (allowing completion)', {
						error: error instanceof Error ? error.message : 'unknown'
					});
				}
			} else {
				logger.warn('mark_generation_complete bundle gate exhausted; allowing completion despite possible bundle error', {
					blocks
				});
			}

			logger.info('Generation marked complete', {
				summary,
				filesGenerated,
				timestamp: new Date().toISOString()
			});

            agent.setMVPGenerated();

			return {
				acknowledged: true,
				message: `Generation completion acknowledged. Successfully built project with ${filesGenerated} files. ${summary}`,
			};
		},
	});
}

export function createMarkDebuggingCompleteTool(
	logger: StructuredLogger
): ToolDefinition<{ summary: string; issuesFixed: number }, CompletionResult> {
	return tool({
		name: 'mark_debugging_complete',
		description: `Signal that debugging task is complete. Use this when:
- All reported issues have been fixed
- Verification confirms fixes work (run_analysis passes, get_runtime_errors shows no errors)
- No new errors were introduced by your changes
- All task requirements have been met

DO NOT call this tool if you are still investigating issues or in the process of fixing them.

Once you call this tool, make NO further tool calls. The system will stop immediately.`,
		args: {
			summary: t.string().describe('Brief summary of what was fixed (2-3 sentences max). Describe the issues resolved and verification performed.'),
			issuesFixed: t.number().describe('Count of issues successfully resolved'),
		},
		run: async ({ summary, issuesFixed }) => {
			logger.info('Debugging marked complete', {
				summary,
				issuesFixed,
				timestamp: new Date().toISOString()
			});

			const result: CompletionResult = {
				acknowledged: true,
				message: `Debugging completion acknowledged. Successfully fixed ${issuesFixed} issue(s). ${summary}`,
			};
			return result;
		},
	});
}
