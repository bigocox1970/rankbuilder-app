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
    framework: 'vite-react' | 'tanstack-start' = 'vite-react',
): ScaffoldResult {
    const map = new Map<string, string>();
    for (const f of files) {
        map.set(f.filePath, f.fileContents);
    }

    const added: string[] = [];
    const isTanStack = framework === 'tanstack-start';

    // The SPA scaffold (static-asset worker + cloudflare vite config) is only correct
    // for a classic Vite + React SPA. TanStack Start is SSR and runs its own server via
    // its Vite plugins, so we skip these — the sandbox preview below runs `vite dev` with
    // the project's own config, and TanStack deploys via wrangler's auto-detection.
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
