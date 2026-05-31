/**
 * Expo (React Native) starter templates. These get the mobile-app treatment
 * everywhere `expo-app` used to be hardcoded: previewable without wrangler config,
 * iPhone preview frame, phone QR button, agentic codegen, and Metro restart on new
 * modules. Add new Expo templates here so they boot as first-class mobile apps.
 */
export const EXPO_TEMPLATE_NAMES = ['expo-app', 'tube-trainer', 'inr-tracker'] as const;

export function isExpoTemplate(name?: string | null): boolean {
	return !!name && (EXPO_TEMPLATE_NAMES as readonly string[]).includes(name);
}

/**
 * Static-HTML "website" templates (the SEO site builder). Rendered directly in the
 * browser (renderMode: browser), content-token only. Used to classify apps as
 * "website" vs a React "web app".
 */
export const WEBSITE_TEMPLATE_NAMES = ['tradesperson-sp'] as const;

export function isWebsiteTemplate(name?: string | null): boolean {
	return !!name && (WEBSITE_TEMPLATE_NAMES as readonly string[]).includes(name);
}

/** The three user-facing app categories used for filtering and card badges. */
export type AppType = 'mobile' | 'website' | 'webapp';

export const APP_TYPE_LABEL: Record<AppType, string> = {
	mobile: 'Mobile app',
	website: 'Website',
	webapp: 'Web app',
};

/**
 * Classify an app by the template it was built from:
 *  - Expo templates  → 'mobile'
 *  - HTML/SEO sites  → 'website'
 *  - everything else (React/Vite) → 'webapp'
 */
export function deriveAppType(templateName?: string | null): AppType {
	if (isExpoTemplate(templateName)) return 'mobile';
	if (isWebsiteTemplate(templateName)) return 'website';
	return 'webapp';
}

/**
 * Authoritative app type for a template/app: prefer the type the template self-declares
 * (definitions/*.yaml `appType`), falling back to the name heuristic for legacy templates
 * that predate the declared field. This is the single source of truth for both
 * stack-constraint filtering and the preview display mode.
 */
export function getAppType(source?: { appType?: AppType | null; name?: string | null } | null): AppType {
	return source?.appType ?? deriveAppType(source?.name);
}
