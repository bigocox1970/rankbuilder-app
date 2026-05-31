import type { PreviewType } from "../../../services/sandbox/sandboxTypes";
import type { ImageAttachment } from '../../../types/image-attachment';
import type { BehaviorType, ProjectType } from '../../../agents/core/types';
import type { CredentialsPayload } from '../../../agents/inferutils/config.types';
import type { AppType } from 'shared/constants/templates';

export const MAX_AGENT_QUERY_LENGTH = 20_000;

export interface SiteServicePlan {
    title: string;
    description: string;
    imagePrompt: string;
}

export type SiteTheme = 'craftsman' | 'industrial' | 'luxury-green' | 'security' | 'agency' | 'parchment' | 'editorial' | 'ivory';
export type SiteFont = 'inter' | 'playfair' | 'lora' | 'montserrat' | 'cormorant';

export interface SiteContentPlan {
    tagline: string;
    tone: string;
    theme: SiteTheme;
    font: SiteFont;
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
    /** The stack the user picked on the home page (mobile/website/webapp). Constrains
     *  AI template selection to this category and is persisted on the app. */
    appType?: AppType;
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
