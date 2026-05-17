/**
 * R2-backed storage for binary files imported from a GitHub repo
 * (images, fonts, etc.). These never go into DO state because they would
 * blow past the 2MB cf_agents_state row limit. Instead they live in R2
 * under `imports/{agentId}/{path}` and are re-injected into the sandbox
 * file list at deploy time.
 */

import { createLogger } from '../../logger';
import type { TemplateFile } from '../sandbox/sandboxTypes';
import { ZipExtractor } from '../sandbox/zipExtractor';

const logger = createLogger('ImportedBinaries');

function r2Key(agentId: string, filePath: string): string {
    return `imports/${agentId}/${filePath}`;
}

/**
 * Upload a single imported binary to R2.
 * Accepts the agent's base64-prefixed content string (`base64:...`) as
 * produced by ZipExtractor.
 */
export async function uploadImportedBinary(args: {
    env: Env;
    agentId: string;
    filePath: string;
    base64Content: string;
}): Promise<void> {
    const { env, agentId, filePath, base64Content } = args;
    const bytes = ZipExtractor.decodeFileContents(base64Content);
    await env.TEMPLATES_BUCKET.put(r2Key(agentId, filePath), bytes);
}

/**
 * Upload all imported binaries for an agent in parallel.
 * Returns the list of stored paths.
 */
export async function uploadImportedBinaries(args: {
    env: Env;
    agentId: string;
    binaries: TemplateFile[];
}): Promise<string[]> {
    const { env, agentId, binaries } = args;
    if (binaries.length === 0) return [];

    const results = await Promise.allSettled(
        binaries.map(async (b) => {
            await uploadImportedBinary({ env, agentId, filePath: b.filePath, base64Content: b.fileContents });
            return b.filePath;
        }),
    );

    const stored: string[] = [];
    const failed: string[] = [];
    for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === 'fulfilled') {
            stored.push(r.value);
        } else {
            failed.push(binaries[i].filePath);
            logger.warn('Failed to upload imported binary', { agentId, path: binaries[i].filePath, error: r.reason });
        }
    }

    logger.info('Uploaded imported binaries to R2', { agentId, stored: stored.length, failed: failed.length });
    return stored;
}

/**
 * Fetch all stored binaries for an agent from R2.
 * Returned files use the same `base64:` prefix convention as ZipExtractor so
 * they can be passed straight to the sandbox's file ingestion path.
 */
export async function fetchImportedBinaries(args: {
    env: Env;
    agentId: string;
    paths: string[];
}): Promise<TemplateFile[]> {
    const { env, agentId, paths } = args;
    if (paths.length === 0) return [];

    const results = await Promise.allSettled(
        paths.map(async (path): Promise<TemplateFile | null> => {
            const obj = await env.TEMPLATES_BUCKET.get(r2Key(agentId, path));
            if (!obj) return null;
            const buffer = await obj.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            let binary = '';
            const chunkSize = 8192;
            for (let i = 0; i < bytes.length; i += chunkSize) {
                const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
                binary += String.fromCharCode(...chunk);
            }
            return { filePath: path, fileContents: `base64:${btoa(binary)}` };
        }),
    );

    const files: TemplateFile[] = [];
    for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === 'fulfilled' && r.value) {
            files.push(r.value);
        } else if (r.status === 'rejected') {
            logger.warn('Failed to fetch imported binary', { agentId, path: paths[i], error: r.reason });
        }
    }

    logger.info('Fetched imported binaries from R2', { agentId, requested: paths.length, fetched: files.length });
    return files;
}

/**
 * Delete all imported binaries for an agent. Use when an app is deleted.
 */
export async function deleteImportedBinaries(args: {
    env: Env;
    agentId: string;
    paths: string[];
}): Promise<void> {
    const { env, agentId, paths } = args;
    if (paths.length === 0) return;
    await Promise.allSettled(paths.map(p => env.TEMPLATES_BUCKET.delete(r2Key(agentId, p))));
}
