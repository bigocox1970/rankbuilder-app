/**
 * One-off generator: creates theme + font CSS files for all 12 design packs.
 * Outputs to both templates/definitions and templates/build so both are in sync.
 * Run with: bun scripts/generate-design-pack-css.ts
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Colour data (mirrors shared/constants/designPacks.ts — keep in sync)
// ---------------------------------------------------------------------------

interface ColorVariant { background: string; surface: string; primary: string; foreground: string; }
interface ColorPack { id: string; name: string; brand: string; rationale: string; light: ColorVariant; dark: ColorVariant; }
interface FontFace { family: string; weights: number[]; }
interface FontPack { id: string; name: string; rationale: string; heading: FontFace; body: FontFace; }

const COLOR_PACKS: ColorPack[] = [
	{ id: 'ledger', name: 'Ledger', brand: 'Jaguar / Harrods', rationale: 'Pine-green + ivory reads established and trustworthy — accountants, law, finance.',
	  light: { background: '#F7F6F1', surface: '#FFFFFF', primary: '#1E5C4F', foreground: '#14201C' },
	  dark:  { background: '#0E1A16', surface: '#16241F', primary: '#4FA88E', foreground: '#E7EFEA' } },
	{ id: 'espresso', name: 'Espresso', brand: 'Starbucks', rationale: 'Roasted browns with a crema highlight — cafés, bakeries, roasteries.',
	  light: { background: '#F4ECE2', surface: '#FBF6EF', primary: '#8A4B2B', foreground: '#2B1C12' },
	  dark:  { background: '#1C140E', surface: '#2A1E15', primary: '#D98E5A', foreground: '#F0E4D6' } },
	{ id: 'atelier', name: 'Atelier', brand: 'Anthropic', rationale: 'Gallery neutrals with one vermilion accent — magazine and design-studio confidence.',
	  light: { background: '#F2EFE9', surface: '#FCFBF8', primary: '#B23A2E', foreground: '#16130F' },
	  dark:  { background: '#121110', surface: '#1D1B19', primary: '#E0654F', foreground: '#ECE7DF' } },
	{ id: 'neon-terminal', name: 'Neon Terminal', brand: 'Android', rationale: 'Phosphor-green on near-black — SaaS, dev tools, anything that wants to feel engineered.',
	  light: { background: '#ECF1EE', surface: '#FFFFFF', primary: '#0F9D58', foreground: '#0B130F' },
	  dark:  { background: '#0A0E0C', surface: '#111714', primary: '#3DDC84', foreground: '#D6F5E4' } },
	{ id: 'cobalt-civic', name: 'Cobalt Civic', brand: 'BMW', rationale: 'A deep, serious cobalt — fintech, legal, B2B — confident, not the default tab-blue.',
	  light: { background: '#F5F7FA', surface: '#FFFFFF', primary: '#1B3A8B', foreground: '#0F1830' },
	  dark:  { background: '#0B1326', surface: '#131F3A', primary: '#5B85F0', foreground: '#E6ECF8' } },
	{ id: 'sandstone', name: 'Sandstone', brand: 'Airbnb', rationale: 'Desert clay and sand — yoga, wellness, ceramics, slow living.',
	  light: { background: '#F3EDE3', surface: '#FBF7F0', primary: '#A8763F', foreground: '#3A2E22' },
	  dark:  { background: '#1A1612', surface: '#261F18', primary: '#D89A5B', foreground: '#EFE6D8' } },
	{ id: 'orchard', name: 'Orchard', brand: 'Chipotle', rationale: 'Persimmon-red on cream stimulates appetite — restaurants, markets, food trucks.',
	  light: { background: '#FBF6EC', surface: '#FFFFFF', primary: '#E0533B', foreground: '#2A1E1A' },
	  dark:  { background: '#1E1512', surface: '#2B1F1A', primary: '#FF7A5C', foreground: '#F3E7DF' } },
	{ id: 'velvet', name: 'Velvet', brand: 'Spotify', rationale: 'Wine-plum and orchid — beauty, nightlife, premium and indulgent brands.',
	  light: { background: '#F6F1F4', surface: '#FFFFFF', primary: '#7A1F4F', foreground: '#1E1018' },
	  dark:  { background: '#160A12', surface: '#23121C', primary: '#C84A86', foreground: '#F2E2EC' } },
	{ id: 'slate-brut', name: 'Slate Brut', brand: 'Vercel', rationale: 'Concrete greys + safety-orange — raw, loud, portfolio and agency energy.',
	  light: { background: '#EDEDEA', surface: '#F8F8F6', primary: '#FF4D00', foreground: '#121212' },
	  dark:  { background: '#0C0C0C', surface: '#161616', primary: '#FF5A1A', foreground: '#EDEDED' } },
	{ id: 'bloom', name: 'Bloom', brand: 'Glossier', rationale: 'Blush and rose — florists, boutiques, family and kids — soft without being saccharine.',
	  light: { background: '#FBF4F6', surface: '#FFFFFF', primary: '#E06C8B', foreground: '#3A2630' },
	  dark:  { background: '#1A1117', surface: '#261820', primary: '#F58CA8', foreground: '#F3E4EA' } },
	{ id: 'harbor', name: 'Harbor', brand: 'Stripe', rationale: 'Deep sea-teal — clinics, travel, coastal hospitality; clean and reassuring.',
	  light: { background: '#EEF3F3', surface: '#FFFFFF', primary: '#0E6E72', foreground: '#102325' },
	  dark:  { background: '#08191A', surface: '#102829', primary: '#3FB6BA', foreground: '#DFEFEF' } },
	{ id: 'midnight-gold', name: 'Midnight Gold', brand: 'Rolls-Royce', rationale: 'Black and antique gold — law, fine dining, luxury; quietly expensive.',
	  light: { background: '#F6F3EC', surface: '#FFFFFF', primary: '#9C7A2E', foreground: '#1A1710' },
	  dark:  { background: '#0F0E0B', surface: '#1A1813', primary: '#D4AF52', foreground: '#EDE7D7' } },
];

const FONT_PACKS: FontPack[] = [
	{ id: 'courthouse', name: 'Courthouse', rationale: 'Authoritative Caslon display over neutral grotesque — establishment credibility.',
	  heading: { family: 'Libre Caslon Display', weights: [400] }, body: { family: 'Public Sans', weights: [400, 500, 600] } },
	{ id: 'roast', name: 'Roast', rationale: 'Soft modern serif + rounded humanist sans — approachable and hand-made.',
	  heading: { family: 'Fraunces', weights: [500, 600] }, body: { family: 'Nunito Sans', weights: [400, 600] } },
	{ id: 'gallery', name: 'Gallery', rationale: 'High-contrast didone headline over clean geometric sans — magazine elegance.',
	  heading: { family: 'Playfair Display', weights: [500, 700] }, body: { family: 'Spline Sans', weights: [400, 500] } },
	{ id: 'console', name: 'Console', rationale: 'Monospace display + IBM Plex body — engineered, precise, terminal energy.',
	  heading: { family: 'Space Mono', weights: [400, 700] }, body: { family: 'IBM Plex Sans', weights: [400, 500] } },
	{ id: 'civic', name: 'Civic', rationale: 'Sturdy Franklin gothic + Plex — institutional, legible, no-nonsense.',
	  heading: { family: 'Libre Franklin', weights: [600, 700] }, body: { family: 'IBM Plex Sans', weights: [400, 500] } },
	{ id: 'loam', name: 'Loam', rationale: 'Literary Newsreader serif + warm humanist grotesque — calm and grounded.',
	  heading: { family: 'Newsreader', weights: [400, 500] }, body: { family: 'Hanken Grotesk', weights: [400, 500] } },
	{ id: 'market', name: 'Market', rationale: 'Quirky Bricolage grotesque + Work Sans — lively, characterful, appetising.',
	  heading: { family: 'Bricolage Grotesque', weights: [600, 700] }, body: { family: 'Work Sans', weights: [400, 500] } },
	{ id: 'boudoir', name: 'Boudoir', rationale: 'Dramatic Bodoni didone + clean Albert sans — sensual, high-fashion contrast.',
	  heading: { family: 'Bodoni Moda', weights: [500, 700] }, body: { family: 'Albert Sans', weights: [400, 500] } },
	{ id: 'concrete', name: 'Concrete', rationale: 'Heavy Archivo Black headline over Archivo body — loud, structural, unapologetic.',
	  heading: { family: 'Archivo Black', weights: [400] }, body: { family: 'Archivo', weights: [400, 500] } },
	{ id: 'petal', name: 'Petal', rationale: 'Soft Gloock display serif + light Mulish — delicate, boutique, welcoming.',
	  heading: { family: 'Gloock', weights: [400] }, body: { family: 'Mulish', weights: [400, 600] } },
	{ id: 'tide', name: 'Tide', rationale: 'Fresh Schibsted grotesque + Karla — clean, modern, reassuring.',
	  heading: { family: 'Schibsted Grotesk', weights: [500, 700] }, body: { family: 'Karla', weights: [400, 500] } },
	{ id: 'regalia', name: 'Regalia', rationale: 'Elegant Cormorant Garamond + modern Be Vietnam sans — timeless and expensive.',
	  heading: { family: 'Cormorant Garamond', weights: [500, 600] }, body: { family: 'Be Vietnam Pro', weights: [400, 500] } },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
	const h = hex.replace('#', '');
	return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
	return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

function darken(hex: string, amt: number): string {
	const [r, g, b] = hexToRgb(hex);
	return rgbToHex(r - amt, g - amt, b - amt);
}

function lighten(hex: string, amt: number): string {
	const [r, g, b] = hexToRgb(hex);
	return rgbToHex(r + amt, g + amt, b + amt);
}

function blend(hexA: string, hexB: string, t: number): string {
	const [ar, ag, ab] = hexToRgb(hexA);
	const [br, bg, bb] = hexToRgb(hexB);
	return rgbToHex(ar * t + br * (1 - t), ag * t + bg * (1 - t), ab * t + bb * (1 - t));
}

function rgba(hex: string, alpha: number): string {
	const [r, g, b] = hexToRgb(hex);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---------------------------------------------------------------------------
// Theme CSS
// ---------------------------------------------------------------------------

function generateThemeCss(pack: ColorPack): string {
	const d = pack.dark;
	const l = pack.light;

	// dark accent-text: use background only if primary is bright enough to read bg on it.
	// For most dark primaries this is fine; keep it simple.
	const dAccentText = blend(d.background, d.foreground, 0.2); // near-bg, slight warmth
	// light accent-text: white works for most saturated primaries; use foreground as fallback
	// We just use #ffffff for simplicity — all our light primaries are saturated/dark enough.

	return `/* ${pack.name} — inspired by ${pack.brand}. ${pack.rationale} */
:root {
  --bg:           ${d.background};
  --surface:      ${d.surface};
  --surface-alt:  ${darken(d.background, 7)};
  --border:       ${rgba(d.foreground, 0.12)};
  --shadow:       rgba(0, 0, 0, 0.65);

  --text:         ${d.foreground};
  --text-muted:   ${blend(d.primary, d.foreground, 0.4)};

  --accent:       ${d.primary};
  --accent-hover: ${lighten(d.primary, 16)};
  --accent-text:  ${dAccentText};
  --accent-subtle:${rgba(d.primary, 0.14)};

  --header-bg:    ${rgba(d.background, 0.96)};
  --footer-bg:    ${darken(d.background, 10)};
  --footer-text:  ${blend(d.primary, d.foreground, 0.5)};

  --hero-overlay: rgba(0, 0, 0, 0.55);
}

[data-theme="light"] {
  --bg:           ${l.background};
  --surface:      ${l.surface};
  --surface-alt:  ${darken(l.background, 6)};
  --border:       ${rgba(l.foreground, 0.12)};
  --shadow:       rgba(0, 0, 0, 0.10);

  --text:         ${l.foreground};
  --text-muted:   ${blend(l.primary, l.foreground, 0.45)};

  --accent:       ${l.primary};
  --accent-hover: ${darken(l.primary, 14)};
  --accent-text:  #ffffff;
  --accent-subtle:${rgba(l.primary, 0.08)};

  --header-bg:    ${rgba(l.background, 0.96)};
  --footer-bg:    ${l.foreground};
  --footer-text:  ${lighten(l.background, 20)};
}
`;
}

// ---------------------------------------------------------------------------
// Font CSS
// ---------------------------------------------------------------------------

const SERIF_STACKS = new Set(['Libre Caslon Display', 'Fraunces', 'Playfair Display', 'Newsreader', 'Bodoni Moda', 'Gloock', 'Cormorant Garamond']);
const MONO_STACKS = new Set(['Space Mono']);

function fontStack(family: string): string {
	if (MONO_STACKS.has(family)) return `'${family}', 'Courier New', monospace`;
	if (SERIF_STACKS.has(family)) return `'${family}', Georgia, 'Times New Roman', serif`;
	return `'${family}', system-ui, -apple-system, sans-serif`;
}

function buildGoogleFontsUrl(h: FontFace, b: FontFace): string {
	const encode = (f: FontFace) => {
		const name = f.family.replace(/ /g, '+');
		const wghts = f.weights.join(';');
		return `family=${name}:wght@${wghts}`;
	};
	if (h.family === b.family) {
		return `https://fonts.googleapis.com/css2?${encode(h)}&display=swap`;
	}
	return `https://fonts.googleapis.com/css2?${encode(h)}&${encode(b)}&display=swap`;
}

function generateFontCss(pack: FontPack): string {
	const h = pack.heading;
	const b = pack.body;
	const isMono = MONO_STACKS.has(h.family);
	const isSerif = SERIF_STACKS.has(h.family);
	const lsH = isMono ? '0em' : isSerif ? '-0.01em' : '-0.025em';
	const lsHero = isMono ? '0em' : isSerif ? '0em' : '-0.035em';
	const lhH = isSerif ? '1.2' : '1.15';
	const wH = h.weights[h.weights.length - 1] ?? 700;

	return `/* ${pack.name} — ${pack.rationale} */
@import url('${buildGoogleFontsUrl(h, b)}');

:root {
  --font-heading: ${fontStack(h.family)};
  --font-body:    ${fontStack(b.family)};

  --font-weight-heading:      ${wH};
  --font-weight-heading-hero: ${wH};
  --font-weight-body:         400;
  --font-weight-medium:       500;
  --font-weight-semibold:     600;

  --letter-spacing-heading:   ${lsH};
  --letter-spacing-hero:      ${lsHero};
  --letter-spacing-label:     0.08em;
  --letter-spacing-body:      0;

  --line-height-heading: ${lhH};
  --line-height-body:    1.65;
}
`;
}

// ---------------------------------------------------------------------------
// Write files
// ---------------------------------------------------------------------------

const DIRS = [
	'templates/definitions/tradesperson-sp/public/themes',
	'templates/build/tradesperson-sp/public/themes',
	'templates/definitions/tradesperson-sp/public/fonts',
	'templates/build/tradesperson-sp/public/fonts',
];

for (const dir of DIRS) mkdirSync(dir, { recursive: true });

for (const pack of COLOR_PACKS) {
	const css = generateThemeCss(pack);
	for (const base of ['templates/definitions/tradesperson-sp/public/themes', 'templates/build/tradesperson-sp/public/themes']) {
		writeFileSync(join(base, `${pack.id}.css`), css);
	}
	console.log(`theme  ${pack.id}.css`);
}

for (const pack of FONT_PACKS) {
	const css = generateFontCss(pack);
	for (const base of ['templates/definitions/tradesperson-sp/public/fonts', 'templates/build/tradesperson-sp/public/fonts']) {
		writeFileSync(join(base, `${pack.id}.css`), css);
	}
	console.log(`font   ${pack.id}.css`);
}

console.log('\nDone — 12 theme + 12 font CSS files written to definitions/ and build/.');
