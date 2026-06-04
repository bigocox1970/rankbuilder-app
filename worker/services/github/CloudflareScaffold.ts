/**
 * CloudflareScaffold — additively injects Cloudflare Workers boilerplate into
 * a vanilla React+Vite project so it can run in the vibesdk sandbox and
 * deploy to Cloudflare.
 *
 * Design constraints:
 * - **Additive only.** We create new files (wrangler.jsonc, worker/index.ts,
 *   vite.config.cloudflare.ts) and add scripts/deps to package.json.
 * - **Never touch their build pipeline.** `package.json` `build` script is
 *   left alone so Netlify/Vercel/Lovable's existing deploys keep working.
 *   We only overwrite the `dev` script (Netlify doesn't run it), keeping
 *   the original as `dev:original` for reference.
 * - **Never overwrite if already present.** A project that already has a
 *   wrangler.jsonc or worker/ keeps its own.
 */

import type { TemplateFile } from '../sandbox/sandboxTypes';

const PORT_PLACEHOLDER = '${PORT:-3000}';

interface ScaffoldArgs {
    projectName: string;
    repoFullName: string;
}

interface ScaffoldResult {
    files: TemplateFile[];
    addedPaths: string[];
}

/**
 * Apply the scaffold to a file list. Returns the merged file list plus a
 * record of which paths were added/modified (so the import flow can extend
 * the dontTouch set to protect them from the LLM).
 */
export function scaffoldCloudflareImport(
    files: TemplateFile[],
    args: ScaffoldArgs,
    framework: 'vite-react' | 'tanstack-start' | 'expo' = 'vite-react',
): ScaffoldResult {
    const map = new Map<string, string>();
    for (const f of files) {
        map.set(f.filePath, f.fileContents);
    }

    // Expo / React Native gets an entirely different profile: it runs via Metro in the
    // sandbox (no Vite, no Workers static-asset shell), so none of the Cloudflare SPA
    // scaffold applies. Instead we normalise it to the platform's known-good SDK 54
    // baseline so it matches the native-preview recipe. Handled separately and returned.
    if (framework === 'expo') {
        return scaffoldExpoImport(map);
    }

    const added: string[] = [];
    const isTanStack = framework === 'tanstack-start';

    // The SPA scaffold (static-asset worker + cloudflare vite config) is only correct
    // for a classic Vite + React SPA. TanStack Start is SSR — it gets its own Cloudflare
    // deploy profile below (CF vite plugin emits the Worker bundle the deploy pipeline
    // uploads). The sandbox preview (vite.config.sandbox.ts) is shared and unchanged.
    if (!isTanStack) {
        if (!map.has('wrangler.jsonc') && !map.has('wrangler.toml')) {
            map.set('wrangler.jsonc', buildWranglerJsonc(args.projectName));
            added.push('wrangler.jsonc');
        }

        if (!map.has('worker/index.ts') && !map.has('worker/index.js')) {
            map.set('worker/index.ts', buildWorkerIndex());
            added.push('worker/index.ts');
        }

        if (!map.has('vite.config.cloudflare.ts') && !map.has('vite.config.cloudflare.js')) {
            map.set('vite.config.cloudflare.ts', buildCloudflareViteConfig(map));
            added.push('vite.config.cloudflare.ts');
        }
    } else {
        // TanStack Start deploy profile. The project's OWN build (via
        // @lovable.dev/vite-tanstack-config) already targets Cloudflare and emits the
        // Worker at dist/server/server.js + assets at dist/client, so we add NO vite
        // config (a second config would duplicate its plugins and break the build).
        // wrangler.jsonc only supplies the deploy metadata (name, compat, assets), and
        // is read from KV during setup.
        if (!map.has('wrangler.jsonc') && !map.has('wrangler.toml')) {
            map.set('wrangler.jsonc', buildTanStackWranglerJsonc(args.projectName));
            added.push('wrangler.jsonc');
        }
    }

    // Sandbox preview config — applies to both frameworks. Wraps the project's own
    // vite config (inheriting its plugins, incl. TanStack Start) and only overrides
    // host/port + disables HMR for the proxied preview.
    if (!map.has('vite.config.sandbox.ts') && !map.has('vite.config.sandbox.js')) {
        map.set('vite.config.sandbox.ts', buildSandboxViteConfig(map));
        added.push('vite.config.sandbox.ts');
    }

    if (map.has('package.json')) {
        const patched = patchPackageJson(map.get('package.json')!, isTanStack);
        if (patched) {
            map.set('package.json', patched);
            added.push('package.json');
        }
    }

    const merged: TemplateFile[] = Array.from(map.entries()).map(([filePath, fileContents]) => ({
        filePath,
        fileContents,
    }));

    return { files: merged, addedPaths: added };
}

/**
 * Canonical SDK 54 dependency set — mirrors templates/definitions/expo-app/package.json.
 * On import we overwrite any of these that the repo already declares so a project pinned
 * to an older SDK (e.g. a git-export captured before its bootstrap upgraded it to 54)
 * lands on SDK 54, matching the native-preview recipe. Extra deps the repo declares that
 * are NOT in this set (datetimepicker, picker, etc.) are preserved at their own versions.
 */
const EXPO_SDK54_DEPS: Record<string, string> = {
    '@expo/metro-runtime': '~6.1.2',
    '@react-native-async-storage/async-storage': '2.2.0',
    'expo': '^54.0.0',
    'expo-constants': '~18.0.13',
    'expo-font': '~14.0.12',
    'expo-linking': '~8.0.12',
    'expo-router': '~6.0.24',
    'expo-splash-screen': '~31.0.13',
    'expo-status-bar': '~3.0.9',
    'expo-system-ui': '~6.0.9',
    'react': '19.1.0',
    'react-dom': '19.1.0',
    'react-native': '0.81.5',
    'react-native-safe-area-context': '~5.6.0',
    'react-native-screens': '~4.16.0',
    'react-native-web': '^0.21.0',
};

const EXPO_SDK54_DEV_DEPS: Record<string, string> = {
    '@babel/core': '^7.25.2',
    '@types/react': '~19.1.10',
    'babel-plugin-transform-import-meta': '^2.2.1',
    'typescript': '^5.3.3',
};

// Dev/start scripts the sandbox expects: Expo binds Metro to the allocated PORT and the
// LAN host so the multi-hop proxy and the native cloudflared tunnel can both reach it.
// The sandbox detects an app as Expo via /expo start/ in package.json, so these must
// stay `expo start ...`.
const EXPO_DEV_SCRIPT = 'expo start --web --port ${PORT:-8081} --host lan';
const EXPO_START_SCRIPT = 'expo start --port ${PORT:-8081} --host lan';
const EXPO_BUILD_SCRIPT = 'expo export --platform web';

/**
 * metro.config.js with the multi-hop-proxy host-header fix. Without this, Metro 0.83
 * (SDK 54) throws "Invalid URL" on the comma-joined X-Forwarded-* headers the preview
 * proxy sends and 500s the web bundle (blank preview). Backfilled only when the repo
 * has no metro.config.js of its own.
 */
const EXPO_METRO_CONFIG = `const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Resolve packages that ship an \`exports\` map. Default since SDK 53; explicit for clarity.
config.resolver.unstable_enablePackageExports = true;

// Behind a multi-hop proxy (preview host -> Cloudflare sandbox -> container), the
// X-Forwarded-* headers arrive comma-joined ("host-a, host-b" / "https, http"). Metro
// 0.83 (SDK 54) builds \`new URL(req.url, proto + "://" + host)\`, which throws
// "TypeError: Invalid URL" on a comma-joined authority/scheme and 500s the web bundle
// (blank preview). Collapse both headers to their first hop before Metro parses the
// request. The native (cloudflared) path sends single values and is unaffected.
const firstHop = (v) => (typeof v === 'string' && v.includes(',') ? v.split(',')[0].trim() : v);
const enhance = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, server) => {
  const fixForwardedHeaders = (req, res, next) => {
    if (req.headers['x-forwarded-host']) req.headers['x-forwarded-host'] = firstHop(req.headers['x-forwarded-host']);
    if (req.headers['x-forwarded-proto']) req.headers['x-forwarded-proto'] = firstHop(req.headers['x-forwarded-proto']);
    return middleware(req, res, next);
  };
  return enhance ? enhance(fixForwardedHeaders, server) : fixForwardedHeaders;
};

module.exports = config;
`;

/**
 * Dependency-free crypto.randomUUID polyfill. react-native-web provides
 * crypto.randomUUID in the web preview, but the native Hermes runtime in Expo Go does
 * NOT — calling it throws and crashes any handler that generates an ID (a silent
 * Unhandled Promise Rejection on device). Injected into imported Expo apps and wired in
 * first in app/_layout.tsx so crypto.randomUUID() works on web AND native, matching the
 * platform's expo-app template. Math.random based: fine for local IDs, not cryptographic.
 */
const EXPO_CRYPTO_POLYFILL = `/**
 * crypto.randomUUID polyfill for native (Hermes) — added by RankBuilder on import.
 * Expo Go's native runtime lacks crypto.randomUUID (the web preview has it), so any
 * code generating an ID crashes on device. This installs a dependency-free RFC4122 v4
 * generator so crypto.randomUUID() is safe on web AND native.
 */
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const scope = globalThis;
if (!scope.crypto) {
  scope.crypto = { randomUUID: uuidv4 };
} else if (typeof scope.crypto.randomUUID !== 'function') {
  scope.crypto.randomUUID = uuidv4;
}

export {};
`;

/**
 * Normalise an imported Expo project to the platform's SDK 54 baseline:
 * - strip the git-export bootstrap (`.bootstrap.js` + its `prepare` hook + marker) so the
 *   committed deps are authoritative and import never depends on a post-clone upgrade step;
 * - pin known Expo deps to SDK 54 (preserving any extra deps the project added);
 * - normalise dev/start/build scripts and force `main: expo-router/entry`;
 * - backfill metro.config.js (host-header fix) if absent;
 * - inject the crypto.randomUUID polyfill and wire it into app/_layout.tsx;
 * - drop template-authoring prompts/ docs that don't belong in a real app.
 * No Cloudflare Vite/Workers scaffold is added — Expo runs via Metro.
 */
function scaffoldExpoImport(map: Map<string, string>): ScaffoldResult {
    const added: string[] = [];

    // Drop the git-export bootstrap so it can't run on install and mutate package.json.
    map.delete('.bootstrap.js');
    map.delete('.bootstrap-complete');

    // Strip template-authoring metadata that leaks into git-exported apps (selection.md /
    // usage.md). They are not app code and are confusing/dead inside an imported project.
    for (const key of Array.from(map.keys())) {
        if (key === 'prompts/selection.md' || key === 'prompts/usage.md') map.delete(key);
    }

    if (!map.has('metro.config.js') && !map.has('metro.config.ts')) {
        map.set('metro.config.js', EXPO_METRO_CONFIG);
        added.push('metro.config.js');
    }

    // crypto.randomUUID polyfill — make IDs safe on native Hermes (Expo Go lacks it). Place
    // it next to the app's _layout and import it first so it runs before any route code.
    const layoutPath = [
        'app/_layout.tsx', 'app/_layout.jsx', 'app/_layout.ts', 'app/_layout.js',
        'src/app/_layout.tsx', 'src/app/_layout.jsx', 'src/app/_layout.ts', 'src/app/_layout.js',
    ].find(p => map.has(p));
    if (layoutPath) {
        const prefix = layoutPath.startsWith('src/') ? 'src/' : '';
        const polyfillPath = `${prefix}lib/crypto-polyfill.ts`;
        if (!map.has(polyfillPath) && !map.has(`${prefix}lib/crypto-polyfill.js`)) {
            map.set(polyfillPath, EXPO_CRYPTO_POLYFILL);
            added.push(polyfillPath);
        }
        const layout = map.get(layoutPath)!;
        if (!/crypto-polyfill/.test(layout)) {
            // _layout itself stays editable (NOT added to dontTouch) — users add screens here.
            map.set(layoutPath, `import '../lib/crypto-polyfill';\n${layout}`);
        }
    }

    if (map.has('package.json')) {
        const patched = patchExpoPackageJson(map.get('package.json')!);
        if (patched) {
            map.set('package.json', patched);
            added.push('package.json');
        }
    }

    const merged: TemplateFile[] = Array.from(map.entries()).map(([filePath, fileContents]) => ({
        filePath,
        fileContents,
    }));

    return { files: merged, addedPaths: added };
}

/**
 * Patch an Expo package.json to the SDK 54 baseline. Overwrites the version of any known
 * Expo dep, preserves extras, removes the bootstrap `prepare` hook, normalises scripts and
 * the `main` entry. Returns null if package.json couldn't be parsed.
 */
function patchExpoPackageJson(raw: string): string | null {
    let pkg: Record<string, unknown>;
    try {
        pkg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
        return null;
    }

    pkg.main = 'expo-router/entry';

    const scripts = (pkg.scripts as Record<string, string> | undefined) ?? {};
    delete scripts.prepare;
    scripts.dev = EXPO_DEV_SCRIPT;
    scripts.start = EXPO_START_SCRIPT;
    scripts.build = EXPO_BUILD_SCRIPT;
    pkg.scripts = scripts;

    const deps = (pkg.dependencies as Record<string, string> | undefined) ?? {};
    for (const [name, version] of Object.entries(EXPO_SDK54_DEPS)) {
        if (name in deps) deps[name] = version;
    }
    // Ensure the non-negotiable runtime deps exist even if a hand-rolled repo omitted one.
    for (const name of ['expo', 'expo-router', 'react', 'react-native', 'react-native-web']) {
        if (!(name in deps)) deps[name] = EXPO_SDK54_DEPS[name];
    }
    pkg.dependencies = deps;

    const devDeps = (pkg.devDependencies as Record<string, string> | undefined) ?? {};
    for (const [name, version] of Object.entries(EXPO_SDK54_DEV_DEPS)) {
        if (name in devDeps) devDeps[name] = version;
    }
    pkg.devDependencies = devDeps;

    return JSON.stringify(pkg, null, 2) + '\n';
}

function buildWranglerJsonc(projectName: string): string {
    return `/**
 * Cloudflare Workers configuration — added by RankBuilder on import.
 * Safe to keep alongside your existing Netlify/Vercel deploy:
 * external static-site hosts ignore this file.
 */
{
\t"$schema": "node_modules/wrangler/config-schema.json",
\t"name": ${JSON.stringify(projectName)},
\t"main": "worker/index.ts",
\t"compatibility_date": "2025-04-24",
\t"assets": {
\t\t"not_found_handling": "single-page-application"
\t},
\t"observability": {
\t\t"enabled": true
\t}
}
`;
}

/**
 * wrangler.jsonc for a TanStack Start deploy. The project's own build (via
 * @lovable.dev/vite-tanstack-config) already targets Cloudflare and emits the
 * Worker at dist/server/server.js + static assets at dist/client — the deploy
 * pipeline reads those directly, so this file only supplies the deploy metadata:
 * the Worker name, compatibility settings, and that static assets are served with
 * the Worker handling everything that isn't a static file (SSR — no SPA fallback).
 * nodejs_compat is required by the TanStack server runtime on Workers.
 */
function buildTanStackWranglerJsonc(projectName: string): string {
    return `/**
 * Cloudflare Workers configuration for TanStack Start — added by RankBuilder on import.
 * Safe to keep alongside your existing host's deploy.
 */
{
\t"$schema": "node_modules/wrangler/config-schema.json",
\t"name": ${JSON.stringify(projectName)},
\t"main": "dist/server/server.js",
\t"compatibility_date": "2025-04-24",
\t"compatibility_flags": ["nodejs_compat"],
\t"assets": {
\t\t"not_found_handling": "none"
\t},
\t"observability": {
\t\t"enabled": true
\t}
}
`;
}

function buildWorkerIndex(): string {
    return `/**
 * Cloudflare Workers entry — added by RankBuilder on import.
 * Serves the built React+Vite app as a static SPA. Safe to extend with
 * API routes (under /api/*) if you want server-side endpoints later.
 */
export interface Env {
\tASSETS: { fetch: (request: Request) => Promise<Response> };
}

export default {
\tasync fetch(request: Request, env: Env): Promise<Response> {
\t\treturn env.ASSETS.fetch(request);
\t},
};
`;
}

/**
 * Build a Cloudflare-flavoured Vite config. We always emit a standalone
 * config (with sensible React+Vite defaults) rather than trying to import
 * the user's existing vite.config — their config may have CommonJS quirks,
 * ESM/TS divergence, or plugins that don't merge cleanly. Standalone is
 * predictable and easy to override.
 */
/**
 * Wrap the user's existing vite.config.{ts,js} so HMR points at the proxied
 * RankBuilder hostname instead of localhost. Falls back to a standalone
 * react+vite config if their config can't be located.
 */
function buildSandboxViteConfig(filesMap: Map<string, string>): string {
    const userConfigPath = filesMap.has('vite.config.ts')
        ? './vite.config.ts'
        : filesMap.has('vite.config.js')
            ? './vite.config.js'
            : null;

    if (!userConfigPath) {
        return `/**
 * Sandbox-only Vite config — added by RankBuilder.
 * No user vite.config.{ts,js} was found, so this is a minimal React + Vite
 * config. HMR is disabled because the sandbox preview reaches Vite through
 * a multi-hop Cloudflare proxy that does not pass through Vite's websocket
 * upgrade; without disabling HMR the client polls for restart and reloads
 * the page constantly.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
\tplugins: [react()],
\tserver: {
\t\thost: '0.0.0.0',
\t\tport: Number(process.env.PORT) || 3000,
\t\thmr: false,
\t},
});
`;
    }

    return `/**
 * Sandbox-only Vite config — added by RankBuilder.
 * Imports your existing vite config and disables HMR so the page stops
 * reloading itself in the preview iframe (the sandbox proxy does not
 * pass through Vite's HMR websocket upgrade). Your original config is
 * untouched and still used for local dev outside the sandbox.
 */
import { defineConfig, mergeConfig } from 'vite';
import baseConfig from ${JSON.stringify(userConfigPath)};

export default defineConfig(async (env) => {
\tconst resolved = typeof baseConfig === 'function' ? await baseConfig(env) : baseConfig;
\treturn mergeConfig(resolved, {
\t\tserver: {
\t\t\thost: '0.0.0.0',
\t\t\tport: Number(process.env.PORT) || 3000,
\t\t\thmr: false,
\t\t},
\t});
});
`;
}

function buildCloudflareViteConfig(filesMap: Map<string, string>): string {
    const hasAtAlias =
        filesMap.has('tsconfig.json') &&
        /["']paths["']\s*:\s*{[^}]*@\/\*/.test(filesMap.get('tsconfig.json')!);

    return `/**
 * Vite config for the Cloudflare Workers sandbox — added by RankBuilder.
 * Your original vite.config.ts is untouched. This file is only used when
 * running 'bun run dev:cloudflare' or 'wrangler deploy'.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
\tplugins: [react(), cloudflare()],
${hasAtAlias ? `\tresolve: {
\t\talias: { '@': path.resolve(__dirname, './src') },
\t},
` : ''}\tserver: {
\t\thost: '0.0.0.0',
\t\tport: Number(process.env.PORT) || 3000,
\t},
});
`;
}

/**
 * Patch package.json:
 * - Add 'dev:original' preserving the user's original dev script
 * - Overwrite 'dev' to the Cloudflare-flavoured one (sandbox needs this)
 * - Add 'dev:cloudflare' alias for clarity
 * - Add 'deploy:cloudflare' for `wrangler deploy`
 * - Add devDependencies: wrangler, @cloudflare/vite-plugin, @vitejs/plugin-react if missing
 *
 * Returns null if package.json couldn't be parsed.
 */
function patchPackageJson(raw: string, isTanStack: boolean = false): string | null {
    let pkg: Record<string, unknown>;
    try {
        pkg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
        return null;
    }

    const scripts = (pkg.scripts as Record<string, string> | undefined) ?? {};

    // TanStack Start: only override `dev` to run the sandbox-wrapped vite config (which
    // inherits the project's TanStack plugins). No cloudflare SPA scripts/deps — deploy
    // is handled later via wrangler's TanStack auto-detection.
    if (isTanStack) {
        if (scripts.dev && !scripts['dev:original']) {
            scripts['dev:original'] = scripts.dev;
        }
        scripts.dev = `vite --config vite.config.sandbox.ts --host 0.0.0.0 --port ${PORT_PLACEHOLDER}`;
        // No deploy build script is added: the project's own `build` already targets
        // Cloudflare (emits dist/server/server.js + dist/client) and the publish pipeline
        // reads those directly. Adding our own vite/CF plugins here would duplicate the
        // ones @lovable.dev/vite-tanstack-config already provides and break the build.
        pkg.scripts = scripts;
        return JSON.stringify(pkg, null, 2) + '\n';
    }
    // Sandbox dev uses a tiny wrapper config (vite.config.sandbox.ts) that
    // imports the user's own vite.config.ts and layers HMR settings pointing
    // at the rankbuilder.app proxy. Vite's default HMR config tries to talk
    // to localhost:PORT from the browser, which fails inside the sandboxed
    // preview iframe. The cloudflare-flavoured scripts below are for the
    // eventual `wrangler deploy` workflow, not the sandbox preview.
    const sandboxDev = `vite --config vite.config.sandbox.ts --host 0.0.0.0 --port ${PORT_PLACEHOLDER}`;

    if (scripts.dev && !scripts['dev:original']) {
        scripts['dev:original'] = scripts.dev;
    }
    scripts.dev = sandboxDev;
    scripts['dev:cloudflare'] = `vite --config vite.config.cloudflare.ts --host 0.0.0.0 --port ${PORT_PLACEHOLDER}`;
    if (!scripts['deploy:cloudflare']) {
        scripts['deploy:cloudflare'] = 'vite build --config vite.config.cloudflare.ts && wrangler deploy';
    }
    pkg.scripts = scripts;

    const devDeps = (pkg.devDependencies as Record<string, string> | undefined) ?? {};
    const deps = (pkg.dependencies as Record<string, string> | undefined) ?? {};
    const has = (name: string) => name in devDeps || name in deps;

    // Pin to the same versions the working vibesdk React template uses.
    // wrangler is intentionally NOT listed here — @cloudflare/vite-plugin
    // depends on it transitively. Pinning it explicitly risks peer-dep
    // conflicts.
    if (!has('@cloudflare/vite-plugin')) devDeps['@cloudflare/vite-plugin'] = '^1.17.1';
    if (!has('@vitejs/plugin-react')) devDeps['@vitejs/plugin-react'] = '^4.3.4';
    pkg.devDependencies = devDeps;

    return JSON.stringify(pkg, null, 2) + '\n';
}
