// One-shot reload when a previously-hashed JS chunk fails to load. This happens
// to users who have an old index.html cached when a fresh deploy ships new
// chunk hashes (Vite emits hashed chunk filenames, the old ones are removed
// from R2). Monaco's lazy-imported language modes are the most common trigger
// on this app, but the same pattern catches any code-split chunk.

const RELOAD_FLAG = 'vibesdk:chunkReloadedAt';
const RELOAD_COOLDOWN_MS = 30_000;

const CHUNK_ERROR_PATTERNS = [
	'Failed to fetch dynamically imported module',
	'Importing a module script failed',
	'error loading dynamically imported module',
	'ChunkLoadError',
];

function looksLikeChunkLoadError(value: unknown): boolean {
	const text =
		typeof value === 'string'
			? value
			: value instanceof Error
				? `${value.name}: ${value.message}`
				: '';
	if (!text) return false;
	return CHUNK_ERROR_PATTERNS.some((p) => text.includes(p));
}

function shouldReload(): boolean {
	try {
		const last = sessionStorage.getItem(RELOAD_FLAG);
		if (!last) return true;
		return Date.now() - Number(last) > RELOAD_COOLDOWN_MS;
	} catch {
		return true;
	}
}

function markReloaded() {
	try {
		sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
	} catch {
		// sessionStorage can throw in private mode; fall through and reload anyway.
	}
}

export function installChunkReloadGuard() {
	const trigger = (source: unknown) => {
		if (!looksLikeChunkLoadError(source)) return;
		if (!shouldReload()) return;
		markReloaded();
		window.location.reload();
	};

	window.addEventListener('error', (event) => {
		trigger(event.message ?? event.error);
	});

	window.addEventListener('unhandledrejection', (event) => {
		trigger(event.reason);
	});
}
