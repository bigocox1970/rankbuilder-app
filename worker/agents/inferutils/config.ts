import { 
    AgentActionKey, 
    AgentConfig, 
    AgentConstraintConfig, 
    AIModels,
    AllModels,
    LiteModels,
    RegularModels,
} from "./config.types";
import { env } from 'cloudflare:workers';

// Common configs - these are good defaults
const COMMON_AGENT_CONFIGS = {
    screenshotAnalysis: {
        name: AIModels.DISABLED,
        reasoning_effort: 'medium' as const,
        max_tokens: 8000,
        temperature: 1,
        fallbackModel: AIModels.OPENROUTER_DEEPSEEK_V4_FLASH,
    },
    realtimeCodeFixer: {
        // DeepSeek V4 Flash — fast, cheap, non-thinking, on OpenRouter (tracked).
        name: AIModels.OPENROUTER_DEEPSEEK_V4_FLASH,
        reasoning_effort: 'low' as const,
        max_tokens: 32000,
        temperature: 0.2,
        fallbackModel: AIModels.OPENROUTER_DEEPSEEK_V4_PRO,
    },
    fastCodeFixer: {
        name: AIModels.DISABLED,
        reasoning_effort: undefined,
        max_tokens: 64000,
        temperature: 0.0,
        fallbackModel: AIModels.OPENROUTER_DEEPSEEK_V4_PRO,
    },
    templateSelection: {
        name: AIModels.OPENROUTER_DEEPSEEK_V4_FLASH,
        max_tokens: 2000,
        fallbackModel: AIModels.OPENROUTER_DEEPSEEK_V4_FLASH,
        temperature: 1,
    },
} as const;

const SHARED_IMPLEMENTATION_CONFIG = {
    reasoning_effort: 'low' as const,
    max_tokens: 48000,
    temperature: 1,
    fallbackModel: AIModels.OPENROUTER_DEEPSEEK_V4_FLASH,
};

//======================================================================================
// ATTENTION! Platform config requires specific API keys and Cloudflare AI Gateway setup.
//======================================================================================
/* 
These are the configs used at build.cloudflare.dev 
You may need to provide API keys for these models in your environment or use 
Cloudflare AI Gateway unified billing for seamless model access without managing multiple keys.
*/
const PLATFORM_AGENT_CONFIG: AgentConfig = {
    ...COMMON_AGENT_CONFIGS,
    blueprint: {
        name: AIModels.GEMINI_3_PRO_PREVIEW,
        reasoning_effort: 'high',
        max_tokens: 20000,
        fallbackModel: AIModels.GEMINI_2_5_FLASH,
        temperature: 1.0,
    },
    projectSetup: {
        name: AIModels.GROK_4_1_FAST,
        reasoning_effort: 'medium',
        max_tokens: 8000,
        temperature: 1,
        fallbackModel: AIModels.GEMINI_2_5_PRO,
    },
    phaseGeneration: {
        name: AIModels.GEMINI_3_FLASH_PREVIEW,
        reasoning_effort: 'medium',
        max_tokens: 8000,
        temperature: 1,
        fallbackModel: AIModels.OPENAI_5_MINI,
    },
    firstPhaseImplementation: {
        name: AIModels.GEMINI_3_FLASH_PREVIEW,
        ...SHARED_IMPLEMENTATION_CONFIG,
    },
    phaseImplementation: {
        name: AIModels.GEMINI_3_FLASH_PREVIEW,
        ...SHARED_IMPLEMENTATION_CONFIG,
    },
    conversationalResponse: {
        name: AIModels.GROK_4_1_FAST,
        reasoning_effort: 'low',
        max_tokens: 4000,
        temperature: 1,
        fallbackModel: AIModels.GEMINI_2_5_FLASH,
    },
    deepDebugger: {
        name: AIModels.GROK_4_1_FAST,
        reasoning_effort: 'high',
        max_tokens: 8000,
        temperature: 1,
        fallbackModel: AIModels.GEMINI_2_5_PRO,
    },
    fileRegeneration: {
        name: AIModels.GROK_4_1_FAST_NON_REASONING,
        reasoning_effort: 'low',
        max_tokens: 16000,
        temperature: 0.0,
        fallbackModel: AIModels.GROK_CODE_FAST_1,
    },
    agenticProjectBuilder: {
        name: AIModels.GEMINI_3_FLASH_PREVIEW,
        reasoning_effort: 'medium',
        max_tokens: 8000,
        temperature: 1,
        fallbackModel: AIModels.GEMINI_2_5_PRO,
    },
};

//======================================================================================
// Default Gemini-only config (most likely used in your deployment)
//======================================================================================
/* These are the default out-of-the box gemini-only models used when PLATFORM_MODEL_PROVIDERS is not set */
// All-DeepSeek, all-OpenRouter so every call is billed and tracked in one place
// (the OpenRouter dashboard). Light/high-frequency steps → V4 Flash (fast, ~$0.10/$0.20).
// Heavy generation/debug/edit steps → V4 Pro (strong, ~$0.44/$0.87). No GPT, no Gemini.
const DEFAULT_AGENT_CONFIG: AgentConfig = {
    ...COMMON_AGENT_CONFIGS,
    templateSelection: {
        name: AIModels.OPENROUTER_DEEPSEEK_V4_FLASH,
        max_tokens: 2000,
        fallbackModel: AIModels.OPENROUTER_DEEPSEEK_V4_FLASH,
        temperature: 0.6,
    },
    blueprint: {
        name: AIModels.OPENROUTER_DEEPSEEK_V4_PRO,
        reasoning_effort: 'medium',
        max_tokens: 20000,
        fallbackModel: AIModels.OPENROUTER_DEEPSEEK_V4_FLASH,
        temperature: 1,
    },
    projectSetup: {
        name: AIModels.OPENROUTER_DEEPSEEK_V4_FLASH,
        reasoning_effort: 'low',
        max_tokens: 8000,
        temperature: 1,
        fallbackModel: AIModels.OPENROUTER_DEEPSEEK_V4_FLASH,
    },
    phaseGeneration: {
        name: AIModels.OPENROUTER_DEEPSEEK_V4_FLASH,
        reasoning_effort: 'low',
        max_tokens: 8000,
        temperature: 1,
        fallbackModel: AIModels.OPENROUTER_DEEPSEEK_V4_PRO,
    },
    firstPhaseImplementation: {
        // Website/React build + edit step → DeepSeek V4 Pro for instruction-following.
        name: AIModels.OPENROUTER_DEEPSEEK_V4_PRO,
        ...SHARED_IMPLEMENTATION_CONFIG,
    },
    phaseImplementation: {
        name: AIModels.OPENROUTER_DEEPSEEK_V4_PRO,
        ...SHARED_IMPLEMENTATION_CONFIG,
    },
    conversationalResponse: {
        // Chat replies — fast DeepSeek V4 Flash, no thinking model needed for conversation.
        name: AIModels.OPENROUTER_DEEPSEEK_V4_FLASH,
        reasoning_effort: 'low',
        max_tokens: 4000,
        temperature: 1,
        fallbackModel: AIModels.OPENROUTER_DEEPSEEK_V4_FLASH,
    },
    deepDebugger: {
        name: AIModels.OPENROUTER_DEEPSEEK_V4_PRO,
        reasoning_effort: 'high',
        max_tokens: 8000,
        temperature: 1,
        fallbackModel: AIModels.OPENROUTER_DEEPSEEK_V4_FLASH,
    },
    fileRegeneration: {
        // Surgical file edits → DeepSeek V4 Pro. Low temp for deterministic diffs.
        name: AIModels.OPENROUTER_DEEPSEEK_V4_PRO,
        reasoning_effort: 'low',
        max_tokens: 32000,
        temperature: 0.2,
        fallbackModel: AIModels.OPENROUTER_DEEPSEEK_V4_FLASH,
    },
    agenticProjectBuilder: {
        // Drives the whole Expo build-and-edit tool loop → DeepSeek V4 Pro.
        name: AIModels.OPENROUTER_DEEPSEEK_V4_PRO,
        reasoning_effort: 'medium',
        max_tokens: 8000,
        temperature: 1,
        fallbackModel: AIModels.OPENROUTER_DEEPSEEK_V4_FLASH,
    },
};

export const AGENT_CONFIG: AgentConfig = env.PLATFORM_MODEL_PROVIDERS 
    ? PLATFORM_AGENT_CONFIG 
    : DEFAULT_AGENT_CONFIG;


export const AGENT_CONSTRAINTS: Map<AgentActionKey, AgentConstraintConfig> = new Map([
	['fastCodeFixer', {
		allowedModels: new Set([AIModels.DISABLED]),
		enabled: true,
	}],
	['realtimeCodeFixer', {
		allowedModels: new Set([AIModels.DISABLED]),
		enabled: true,
	}],
	['fileRegeneration', {
		allowedModels: new Set(AllModels),
		enabled: true,
	}],
	['phaseGeneration', {
		allowedModels: new Set(AllModels),
		enabled: true,
	}],
	['projectSetup', {
		allowedModels: new Set([...RegularModels, AIModels.GEMINI_2_5_PRO]),
		enabled: true,
	}],
	['conversationalResponse', {
		allowedModels: new Set(RegularModels),
		enabled: true,
	}],
	['templateSelection', {
		allowedModels: new Set(LiteModels),
		enabled: true,
	}],
]);