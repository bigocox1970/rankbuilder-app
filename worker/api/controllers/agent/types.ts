import type { PreviewType } from "../../../services/sandbox/sandboxTypes";
import type { ImageAttachment } from '../../../types/image-attachment';
import type { BehaviorType, ProjectType } from '../../../agents/core/types';
import type { CredentialsPayload } from '../../../agents/inferutils/config.types';

export const MAX_AGENT_QUERY_LENGTH = 20_000;

export interface SiteServicePlan {
    title: string;
    description: string;
    imagePrompt: string;
}

export interface SiteContentPlan {
    tagline: string;
    tone: string;
    hero: {
        headline: string;
        subheadline: string;
        cta: string;
        imagePrompt: string;
    };
    about: {
        title: string;
        body: string;
        imagePrompt: string;
    };
    services: SiteServicePlan[];
}

export interface CodeGenArgs {
    query: string;
    language?: string;
    frameworks?: string[];
    selectedTemplate?: string;
    behaviorType?: BehaviorType;
    projectType?: ProjectType;
    images?: ImageAttachment[];
    imageGenerationEnabled?: boolean;
    sitePlan?: SiteContentPlan;

    /** Optional ephemeral credentials (BYOK / gateway override) for sdk */
    credentials?: CredentialsPayload;
}

/**
 * Data structure for connectToExistingAgent response
 */
export interface AgentConnectionData {
    websocketUrl: string;
    agentId: string;
}

export type AgentPreviewResponse = PreviewType;
