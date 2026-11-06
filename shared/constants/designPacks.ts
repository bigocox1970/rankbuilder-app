/**
 * Design packs for the website (HTML) flow — the composable replacement for website templates.
 *
 * Three orthogonal axes the user flicks through at the planning stage (SitePlanner), or the AI
 * picks from intent ("an accountant's website" → matching tags):
 *   - COLOR_PACKS   (this file)         — 12 themes, light + dark, 4 fixed token roles
 *   - FONT_PACKS    (this file)         — 12 heading+body pairings
 *   - WIREFRAMES    (wireframes.ts, TODO) — 12 ordered block compositions
 *
 * A resolved DesignSpec = one color + one font + one wireframe; generation consumes it to emit
 * CSS tokens, font imports, and the starting block scaffold against a single clean base.
 *
 * Generated via the frontend-design skill (distinctive, non-generic). Keep the 4 colour roles
 * fixed so they map mechanically to CSS variables / Tailwind tokens.
 */

export type ColorRole = 'background' | 'surface' | 'primary' | 'foreground';

export interface ColorVariant {
	/** page background */
	background: string;
	/** raised surfaces: cards, nav, inputs */
	surface: string;
	/** brand / accent: buttons, links, highlights (text on it = background) */
	primary: string;
	/** body + heading text (high contrast on background and surface) */
	foreground: string;
}

export interface ColorPack {
	id: string;
	name: string;
	/** Real brand(s) this palette draws inspiration from (shown in the picker UI) */
	brand: string;
	tags: string[];
	rationale: string;
	light: ColorVariant;
	dark: ColorVariant;
}

export interface FontFace {
	family: string;
	weights: number[];
	/** where the family is loaded from; 'google' = Google Fonts */
	source: 'google';
}

export interface FontPack {
	id: string;
	name: string;
	tags: string[];
	rationale: string;
	heading: FontFace;
	body: FontFace;
}

export const COLOR_PACKS: ColorPack[] = [
	{
		id: 'ledger', name: 'Ledger', brand: 'Jaguar / Harrods', tags: ['professional', 'corporate', 'trust', 'calm'],
		rationale: 'Pine-green + ivory reads established and trustworthy — accountants, law, finance — without the cliché corporate blue.',
		light: { background: '#F7F6F1', surface: '#FFFFFF', primary: '#1E5C4F', foreground: '#14201C' },
		dark: { background: '#0E1A16', surface: '#16241F', primary: '#4FA88E', foreground: '#E7EFEA' },
	},
	{
		id: 'espresso', name: 'Espresso', brand: 'Starbucks', tags: ['warm', 'coffee', 'cozy', 'artisan'],
		rationale: 'Roasted browns with a crema highlight — cafés, bakeries, roasteries.',
		light: { background: '#F4ECE2', surface: '#FBF6EF', primary: '#8A4B2B', foreground: '#2B1C12' },
		dark: { background: '#1C140E', surface: '#2A1E15', primary: '#D98E5A', foreground: '#F0E4D6' },
	},
	{
		id: 'atelier', name: 'Atelier', brand: 'Anthropic', tags: ['editorial', 'luxe', 'studio', 'refined'],
		rationale: 'Gallery neutrals with one vermilion accent — magazine and design-studio confidence.',
		light: { background: '#F2EFE9', surface: '#FCFBF8', primary: '#B23A2E', foreground: '#16130F' },
		dark: { background: '#121110', surface: '#1D1B19', primary: '#E0654F', foreground: '#ECE7DF' },
	},
	{
		id: 'neon-terminal', name: 'Neon Terminal', brand: 'Android', tags: ['technical', 'bold', 'dev', 'futuristic'],
		rationale: 'Phosphor-green on near-black — SaaS, dev tools, anything that wants to feel engineered.',
		light: { background: '#ECF1EE', surface: '#FFFFFF', primary: '#0F9D58', foreground: '#0B130F' },
		dark: { background: '#0A0E0C', surface: '#111714', primary: '#3DDC84', foreground: '#D6F5E4' },
	},
	{
		id: 'cobalt-civic', name: 'Cobalt Civic', brand: 'BMW', tags: ['fintech', 'trust', 'technical', 'professional'],
		rationale: 'A deep, serious cobalt — fintech, legal, B2B — confident, not the default tab-blue.',
		light: { background: '#F5F7FA', surface: '#FFFFFF', primary: '#1B3A8B', foreground: '#0F1830' },
		dark: { background: '#0B1326', surface: '#131F3A', primary: '#5B85F0', foreground: '#E6ECF8' },
	},
	{
		id: 'sandstone', name: 'Sandstone', brand: 'Airbnb', tags: ['organic', 'natural', 'wellness', 'calm'],
		rationale: 'Desert clay and sand — yoga, wellness, ceramics, slow living.',
		light: { background: '#F3EDE3', surface: '#FBF7F0', primary: '#A8763F', foreground: '#3A2E22' },
		dark: { background: '#1A1612', surface: '#261F18', primary: '#D89A5B', foreground: '#EFE6D8' },
	},
	{
		id: 'orchard', name: 'Orchard', brand: 'Chipotle', tags: ['food', 'appetite', 'playful', 'friendly'],
		rationale: 'Persimmon-red on cream stimulates appetite — restaurants, markets, food trucks.',
		light: { background: '#FBF6EC', surface: '#FFFFFF', primary: '#E0533B', foreground: '#2A1E1A' },
		dark: { background: '#1E1512', surface: '#2B1F1A', primary: '#FF7A5C', foreground: '#F3E7DF' },
	},
	{
		id: 'velvet', name: 'Velvet', brand: 'Spotify', tags: ['luxe', 'bold', 'nightlife', 'premium'],
		rationale: 'Wine-plum and orchid — beauty, nightlife, premium and indulgent brands.',
		light: { background: '#F6F1F4', surface: '#FFFFFF', primary: '#7A1F4F', foreground: '#1E1018' },
		dark: { background: '#160A12', surface: '#23121C', primary: '#C84A86', foreground: '#F2E2EC' },
	},
	{
		id: 'slate-brut', name: 'Slate Brut', brand: 'Vercel', tags: ['brutalist', 'mono', 'raw', 'agency'],
		rationale: 'Concrete greys + safety-orange — raw, loud, portfolio and agency energy.',
		light: { background: '#EDEDEA', surface: '#F8F8F6', primary: '#FF4D00', foreground: '#121212' },
		dark: { background: '#0C0C0C', surface: '#161616', primary: '#FF5A1A', foreground: '#EDEDED' },
	},
	{
		id: 'bloom', name: 'Bloom', brand: 'Glossier', tags: ['soft', 'pastel', 'friendly', 'boutique'],
		rationale: 'Blush and rose — florists, boutiques, family and kids — soft without being saccharine.',
		light: { background: '#FBF4F6', surface: '#FFFFFF', primary: '#E06C8B', foreground: '#3A2630' },
		dark: { background: '#1A1117', surface: '#261820', primary: '#F58CA8', foreground: '#F3E4EA' },
	},
	{
		id: 'harbor', name: 'Harbor', brand: 'Stripe', tags: ['calm', 'coastal', 'fresh', 'clinical'],
		rationale: 'Deep sea-teal — clinics, travel, coastal hospitality; clean and reassuring.',
		light: { background: '#EEF3F3', surface: '#FFFFFF', primary: '#0E6E72', foreground: '#102325' },
		dark: { background: '#08191A', surface: '#102829', primary: '#3FB6BA', foreground: '#DFEFEF' },
	},
	{
		id: 'midnight-gold', name: 'Midnight Gold', brand: 'Rolls-Royce', tags: ['luxe', 'editorial', 'premium', 'refined'],
		rationale: 'Black and antique gold — law, fine dining, luxury; quietly expensive.',
		light: { background: '#F6F3EC', surface: '#FFFFFF', primary: '#9C7A2E', foreground: '#1A1710' },
		dark: { background: '#0F0E0B', surface: '#1A1813', primary: '#D4AF52', foreground: '#EDE7D7' },
	},
];

export const FONT_PACKS: FontPack[] = [
	{
		id: 'courthouse', name: 'Courthouse', tags: ['professional', 'editorial', 'trust'],
		rationale: 'Authoritative Caslon display over a neutral grotesque — establishment credibility.',
		heading: { family: 'Libre Caslon Display', weights: [400], source: 'google' },
		body: { family: 'Public Sans', weights: [400, 500, 600], source: 'google' },
	},
	{
		id: 'roast', name: 'Roast', tags: ['warm', 'friendly', 'artisan'],
		rationale: 'Soft modern serif + rounded humanist sans — approachable and hand-made.',
		heading: { family: 'Fraunces', weights: [500, 600], source: 'google' },
		body: { family: 'Nunito Sans', weights: [400, 600], source: 'google' },
	},
	{
		id: 'gallery', name: 'Gallery', tags: ['editorial', 'luxe', 'refined'],
		rationale: 'High-contrast didone headline over a clean geometric sans — magazine elegance.',
		heading: { family: 'Playfair Display', weights: [500, 700], source: 'google' },
		body: { family: 'Spline Sans', weights: [400, 500], source: 'google' },
	},
	{
		id: 'console', name: 'Console', tags: ['technical', 'dev', 'bold'],
		rationale: 'Monospace display + IBM Plex body — engineered, precise, terminal energy.',
		heading: { family: 'Space Mono', weights: [400, 700], source: 'google' },
		body: { family: 'IBM Plex Sans', weights: [400, 500], source: 'google' },
	},
	{
		id: 'civic', name: 'Civic', tags: ['fintech', 'professional', 'technical'],
		rationale: 'Sturdy Franklin gothic + Plex — institutional, legible, no-nonsense.',
		heading: { family: 'Libre Franklin', weights: [600, 700], source: 'google' },
		body: { family: 'IBM Plex Sans', weights: [400, 500], source: 'google' },
	},
	{
		id: 'loam', name: 'Loam', tags: ['organic', 'wellness', 'calm'],
		rationale: 'Literary Newsreader serif + warm humanist grotesque — calm and grounded.',
		heading: { family: 'Newsreader', weights: [400, 500], source: 'google' },
		body: { family: 'Hanken Grotesk', weights: [400, 500], source: 'google' },
	},
	{
		id: 'market', name: 'Market', tags: ['food', 'playful', 'bold'],
		rationale: 'Quirky Bricolage grotesque + Work Sans — lively, characterful, appetising.',
		heading: { family: 'Bricolage Grotesque', weights: [600, 700], source: 'google' },
		body: { family: 'Work Sans', weights: [400, 500], source: 'google' },
	},
	{
		id: 'boudoir', name: 'Boudoir', tags: ['luxe', 'nightlife', 'premium'],
		rationale: 'Dramatic Bodoni didone + clean Albert sans — sensual, high-fashion contrast.',
		heading: { family: 'Bodoni Moda', weights: [500, 700], source: 'google' },
		body: { family: 'Albert Sans', weights: [400, 500], source: 'google' },
	},
	{
		id: 'concrete', name: 'Concrete', tags: ['brutalist', 'raw', 'bold'],
		rationale: 'Heavy Archivo Black headline over Archivo body — loud, structural, unapologetic.',
		heading: { family: 'Archivo Black', weights: [400], source: 'google' },
		body: { family: 'Archivo', weights: [400, 500], source: 'google' },
	},
	{
		id: 'petal', name: 'Petal', tags: ['soft', 'boutique', 'friendly'],
		rationale: 'Soft Gloock display serif + light Mulish — delicate, boutique, welcoming.',
		heading: { family: 'Gloock', weights: [400], source: 'google' },
		body: { family: 'Mulish', weights: [400, 600], source: 'google' },
	},
	{
		id: 'tide', name: 'Tide', tags: ['coastal', 'calm', 'clinical'],
		rationale: 'Fresh Schibsted grotesque + Karla — clean, modern, reassuring.',
		heading: { family: 'Schibsted Grotesk', weights: [500, 700], source: 'google' },
		body: { family: 'Karla', weights: [400, 500], source: 'google' },
	},
	{
		id: 'regalia', name: 'Regalia', tags: ['luxe', 'editorial', 'refined'],
		rationale: 'Elegant Cormorant Garamond + modern Be Vietnam sans — timeless and expensive.',
		heading: { family: 'Cormorant Garamond', weights: [500, 600], source: 'google' },
		body: { family: 'Be Vietnam Pro', weights: [400, 500], source: 'google' },
	},
];

/**
 * Block vocabulary — the named sections a wireframe is composed from. A wireframe is just an
 * ordered list of these ids; it's a STARTING composition the user then edits conversationally
 * ("add a block between the carousel and the footer") via the existing chat-edit loop. The
 * description tells the generator what each block is so it can render real content into it.
 */
export const BLOCK_TYPES: Record<string, string> = {
	navbar: 'Top navigation: logo/brand + primary links + optional CTA button.',
	hero: 'Headline, supporting line, primary CTA; the above-the-fold statement.',
	'hero-carousel': 'Hero with a rotating set of image slides behind/beside the headline.',
	'hero-search': 'Hero centred on a prominent search/filter bar (listings, directories).',
	'hero-portrait': 'Hero split with a person/portrait image alongside headline + CTA.',
	'logo-cloud': 'Row of partner/client/press logos for credibility.',
	'trust-badges': 'Accreditations, guarantees, certifications, review-score badges.',
	'feature-grid': '3–6 feature cards with icon, title, short description.',
	'services-grid': 'Grid of service offerings with names + short blurbs.',
	'services-list': 'Vertical list of services with more descriptive detail each.',
	'how-it-works': 'Numbered/sequenced steps explaining the process.',
	'about-split': 'Two-column about section: copy on one side, image on the other.',
	'mission-statement': 'Large centred statement of purpose/values.',
	gallery: 'Image gallery / portfolio grid / lookbook.',
	'menu-highlights': 'Featured menu items or product highlights with prices.',
	'featured-products': 'Showcase of selected products with image + price + CTA.',
	'categories-grid': 'Grid of product/content categories to browse.',
	'impact-stats': 'Big-number stats row (clients served, years, funds raised).',
	testimonials: 'Customer quotes / reviews, optionally with avatars.',
	team: 'Team/staff grid with photos, names, roles.',
	pricing: 'Pricing tiers/plans with feature lists and CTAs.',
	faq: 'Accordion of frequently asked questions.',
	schedule: 'Timetable / class schedule / agenda.',
	'cta-banner': 'Full-width call-to-action band with a single strong action.',
	'contact-form': 'Contact form with fields + submit.',
	'booking-form': 'Appointment/booking request form.',
	'location-map': 'Address, hours, and an embedded map.',
	newsletter: 'Email capture / newsletter signup band.',
	footer: 'Footer: links, contact, social, legal.',
};

export interface Wireframe {
	id: string;
	name: string;
	tags: string[];
	rationale: string;
	/** ordered block ids (keys of BLOCK_TYPES) — the starting composition */
	blocks: string[];
}

export const WIREFRAMES: Wireframe[] = [
	{
		id: 'service-local', name: 'Local Service', tags: ['accountant', 'tradesperson', 'agency', 'local-business'],
		rationale: 'Credibility-first layout for a local service business: prove trust, list services, drive enquiry.',
		blocks: ['navbar', 'hero', 'trust-badges', 'services-grid', 'about-split', 'testimonials', 'faq', 'cta-banner', 'contact-form', 'footer'],
	},
	{
		id: 'restaurant', name: 'Restaurant / Café', tags: ['food', 'cafe', 'restaurant', 'hospitality'],
		rationale: 'Atmosphere-led: lead with imagery, tease the menu, show the room, make location obvious.',
		blocks: ['navbar', 'hero-carousel', 'about-split', 'menu-highlights', 'gallery', 'testimonials', 'location-map', 'cta-banner', 'footer'],
	},
	{
		id: 'portfolio', name: 'Studio / Portfolio', tags: ['studio', 'designer', 'creative', 'agency'],
		rationale: 'Work-first: a bold statement then straight into the gallery; minimal selling.',
		blocks: ['navbar', 'hero', 'gallery', 'about-split', 'services-list', 'logo-cloud', 'cta-banner', 'footer'],
	},
	{
		id: 'saas-landing', name: 'SaaS Landing', tags: ['saas', 'tech', 'product', 'startup'],
		rationale: 'Classic conversion funnel: value prop, proof, features, how it works, pricing, FAQ.',
		blocks: ['navbar', 'hero', 'logo-cloud', 'feature-grid', 'how-it-works', 'testimonials', 'pricing', 'faq', 'cta-banner', 'footer'],
	},
	{
		id: 'shop-lite', name: 'Shop (Lite)', tags: ['shop', 'retail', 'product', 'ecommerce'],
		rationale: 'Merchandising-led: feature products and categories, reassure, capture email.',
		blocks: ['navbar', 'hero', 'featured-products', 'categories-grid', 'trust-badges', 'testimonials', 'newsletter', 'footer'],
	},
	{
		id: 'personal-brand', name: 'Personal Brand', tags: ['coach', 'consultant', 'author', 'speaker'],
		rationale: 'Person-forward: portrait hero, story, offers, social proof, booking.',
		blocks: ['navbar', 'hero-portrait', 'about-split', 'services-list', 'logo-cloud', 'testimonials', 'cta-banner', 'footer'],
	},
	{
		id: 'event', name: 'Event', tags: ['event', 'conference', 'wedding', 'launch'],
		rationale: 'Date-driven: hero with the what/when, agenda, speakers, gallery, register.',
		blocks: ['navbar', 'hero', 'mission-statement', 'schedule', 'team', 'gallery', 'location-map', 'cta-banner', 'footer'],
	},
	{
		id: 'clinic', name: 'Clinic / Wellness', tags: ['clinic', 'medical', 'dental', 'wellness'],
		rationale: 'Reassurance + booking: services, the team, trust signals, easy appointment request.',
		blocks: ['navbar', 'hero', 'services-grid', 'team', 'trust-badges', 'testimonials', 'booking-form', 'location-map', 'footer'],
	},
	{
		id: 'nonprofit', name: 'Nonprofit / Cause', tags: ['charity', 'nonprofit', 'cause', 'community'],
		rationale: 'Mission-led: state the cause, prove impact, show programs, drive donations.',
		blocks: ['navbar', 'hero', 'mission-statement', 'impact-stats', 'services-grid', 'testimonials', 'cta-banner', 'footer'],
	},
	{
		id: 'real-estate', name: 'Real Estate', tags: ['property', 'realestate', 'lettings'],
		rationale: 'Search-first: prominent listing search, featured properties, areas, agent trust.',
		blocks: ['navbar', 'hero-search', 'featured-products', 'categories-grid', 'about-split', 'testimonials', 'cta-banner', 'footer'],
	},
	{
		id: 'fitness', name: 'Fitness / Gym', tags: ['gym', 'fitness', 'studio', 'sport'],
		rationale: 'Energy + commitment: programs, timetable, trainers, pricing, join now.',
		blocks: ['navbar', 'hero', 'services-grid', 'schedule', 'team', 'pricing', 'testimonials', 'cta-banner', 'footer'],
	},
	{
		id: 'editorial', name: 'Editorial / Blog', tags: ['blog', 'magazine', 'content', 'media'],
		rationale: 'Content-forward: a featured story, latest posts, categories, newsletter.',
		blocks: ['navbar', 'hero', 'gallery', 'categories-grid', 'about-split', 'newsletter', 'footer'],
	},
];

export const COLOR_PACKS_BY_ID: Record<string, ColorPack> = Object.fromEntries(
	COLOR_PACKS.map((p) => [p.id, p]),
);
export const FONT_PACKS_BY_ID: Record<string, FontPack> = Object.fromEntries(
	FONT_PACKS.map((p) => [p.id, p]),
);
export const WIREFRAMES_BY_ID: Record<string, Wireframe> = Object.fromEntries(
	WIREFRAMES.map((p) => [p.id, p]),
);
