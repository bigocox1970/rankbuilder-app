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

export type SiteTheme = 'ledger' | 'espresso' | 'atelier' | 'neon-terminal' | 'cobalt-civic' | 'sandstone' | 'orchard' | 'velvet' | 'slate-brut' | 'bloom' | 'harbor' | 'midnight-gold';
export type SiteFont = 'courthouse' | 'roast' | 'gallery' | 'console' | 'civic' | 'loam' | 'market' | 'boudoir' | 'concrete' | 'petal' | 'tide' | 'regalia';

/** A real photo/logo supplied by the user (e.g. harvested from Checkatrade / socials). */
export interface RealImage {
    url: string;
    /** What the image shows — used for placement and alt text. */
    title?: string;
    role?: 'logo' | 'hero' | 'project' | 'gallery';
}

/** A real customer review supplied by the user. Must be reproduced verbatim on the site. */
export interface RealReview {
    /** e.g. "10/10" or "9.3/10" */
    score?: string;
    title?: string;
    text: string;
    /** e.g. "Verified Checkatrade review · Maidenhead (SL6)" */
    attribution?: string;
}

/** Verified business facts supplied by the user. Never invented, never embellished. */
export interface RealFacts {
    rating?: string;            // e.g. "9.92/10"
    reviewCount?: number;       // e.g. 40
    reviewSourceUrl?: string;   // e.g. Checkatrade profile URL
    phone?: string;
    email?: string;             // only if explicitly supplied — never invented
    serviceAreas?: string[];
    guarantee?: string;
    memberSince?: string;
    other?: string[];           // any other verbatim facts (accreditations, company number, ...)
}

/**
 * Structured real-world data extracted VERBATIM from the user's brief.
 * This is the "brand pack" channel: anything here must appear on the site
 * exactly as given, and takes priority over AI-generated equivalents.
 */
export interface RealBusinessData {
    images?: RealImage[];
    reviews?: RealReview[];
    facts?: RealFacts;
}

export interface SiteContentPlan {
    tagline: string;
    tone: string;
    theme: SiteTheme;
    font: SiteFont;
    wireframe?: string;
    pageStructure?: 'single' | 'multi';
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
    /** Verbatim real-world data extracted from the brief — images, reviews, facts. */
    realData?: RealBusinessData;
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
