/**
 * Whole-stack model-provider presets, shared by the admin panel (client-side apply) and the
 * per-user chat-pane toggle (server-side apply via /api/model-configs/my-provider).
 *
 * Each preset maps an agentActionName -> model id. Model ids are string literals that MUST
 * match the AIModels values in worker/agents/inferutils/config.types.ts. The disabled-locked
 * fixers (fastCodeFixer) and the vision-only screenshotAnalysis are intentionally omitted —
 * they can't honour a text-model override; flipping a model onto them would switch on an
 * off-by-default subsystem.
 */

export type ModelProvider = 'deepseek' | 'minimax';

export interface ProviderPreset {
	label: string;
	fallbackModel: string;
	/** agentActionName -> model id */
	agents: Record<string, string>;
}

const MINIMAX_M3 = 'minimax/MiniMax-M3';
const DEEPSEEK_PRO = 'openrouter/deepseek/deepseek-v4-pro';
const DEEPSEEK_FLASH = 'openrouter/deepseek/deepseek-v4-flash';

export const MODEL_PROVIDER_PRESETS: Record<ModelProvider, ProviderPreset> = {
	// Latest MiniMax coder model, called DIRECTLY via MINIMAX_API_KEY (subscription) — does NOT
	// route through OpenRouter / the Cloudflare AI Gateway. One capable model across the stack.
	minimax: {
		label: 'MiniMax M3',
		fallbackModel: DEEPSEEK_FLASH,
		agents: {
			blueprint: MINIMAX_M3,
			projectSetup: MINIMAX_M3,
			phaseGeneration: MINIMAX_M3,
			firstPhaseImplementation: MINIMAX_M3,
			phaseImplementation: MINIMAX_M3,
			agenticProjectBuilder: MINIMAX_M3,
			fileRegeneration: MINIMAX_M3,
			realtimeCodeFixer: MINIMAX_M3,
			templateSelection: MINIMAX_M3,
			conversationalResponse: MINIMAX_M3,
			userSuggestionProcessor: MINIMAX_M3,
			codeReview: MINIMAX_M3,
			deepDebugger: MINIMAX_M3,
		},
	},
	// DeepSeek V4 via OpenRouter (the platform default): Pro for heavy generation/reasoning,
	// Flash for light/high-frequency steps. All spend tracks in the AI Gateway dashboards.
	deepseek: {
		label: 'DeepSeek',
		fallbackModel: DEEPSEEK_FLASH,
		agents: {
			blueprint: DEEPSEEK_PRO,
			firstPhaseImplementation: DEEPSEEK_PRO,
			phaseImplementation: DEEPSEEK_PRO,
			agenticProjectBuilder: DEEPSEEK_PRO,
			fileRegeneration: DEEPSEEK_PRO,
			codeReview: DEEPSEEK_PRO,
			deepDebugger: DEEPSEEK_PRO,
			projectSetup: DEEPSEEK_FLASH,
			phaseGeneration: DEEPSEEK_FLASH,
			conversationalResponse: DEEPSEEK_FLASH,
			templateSelection: DEEPSEEK_FLASH,
			realtimeCodeFixer: DEEPSEEK_FLASH,
			userSuggestionProcessor: DEEPSEEK_FLASH,
		},
	},
};

/**
 * Agent used to probe which provider a user is currently on (it's set by both presets).
 */
export const PROVIDER_PROBE_AGENT = 'agenticProjectBuilder';

/**
 * Map a stored model id back to its provider for display. Anything that isn't the MiniMax
 * model (including no override / the default) is treated as DeepSeek — the default stack.
 */
export function providerFromModelName(modelName: string | null | undefined): ModelProvider {
	return modelName === MINIMAX_M3 ? 'minimax' : 'deepseek';
}
