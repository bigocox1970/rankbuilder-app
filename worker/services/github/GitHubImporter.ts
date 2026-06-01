/**
 * GitHubImporter — fetches a GitHub repository as a zipball and extracts
 * it into the file format the agent expects. Supports public + private repos
 * via an OAuth access token (scope: `repo`).
 */

import { createLogger } from '../../logger';
import { createGitHubHeaders } from '../../utils/githubUtils';
import { ZipExtractor } from '../sandbox/zipExtractor';
import type { TemplateFile } from '../sandbox/sandboxTypes';

const logger = createLogger('GitHubImporter');

const MAX_ZIPBALL_BYTES = 100 * 1024 * 1024;
const MAX_FILES = 5000;
const MAX_PER_FILE_BYTES = 5 * 1024 * 1024;

// Cloudflare Durable Object state is stored as a single SQLite row, capped at
// ~2 MB per write. Imported files all land in `state.generatedFilesMap`, so we
// enforce a tight per-file cap and a budget for the post-filter total. Binary
// assets and lockfiles are dropped — they're not editable by the LLM and can
// be regenerated (lockfiles) or re-added later (assets).
const MAX_TEXT_FILE_BYTES_FOR_STATE = 100 * 1024;
const STATE_BUDGET_BYTES = 1_500_000;

const IGNORED_PREFIXES = [
    '.git/',
    'node_modules/',
    'dist/',
    'build/',
    '.next/',
    '.vite/',
    '.cache/',
    'coverage/',
    '.turbo/',
    '.vscode/',
    '.idea/',
];

const IGNORED_EXACT = new Set([
    'package-lock.json',
    'yarn.lock',
    'bun.lockb',
    'pnpm-lock.yaml',
    '.DS_Store',
]);

const IGNORED_SUFFIXES = ['.map'];

export interface GitHubRepoInfo {
    fullName: string;
    defaultBranch: string;
    isPrivate: boolean;
    description: string | null;
    htmlUrl: string;
}

export type ImportFailureReason =
    | 'repo_not_found'
    | 'access_denied'
    | 'branch_not_found_no_default'
    | 'too_large'
    | 'too_many_files'
    | 'file_too_large'
    | 'extract_failed'
    | 'unsupported_project_type'
    | 'github_error';

export interface ImportFailure {
    success: false;
    reason: ImportFailureReason;
    message: string;
}

export interface ImportSuccess {
    success: true;
    files: TemplateFile[];
    /** Binary files (images, fonts, etc.) extracted separately so they can be
     * uploaded to R2 instead of bloating DO state. */
    binaries: TemplateFile[];
    repoInfo: GitHubRepoInfo;
    effectiveBranch: string;
    branchFallback: boolean;
    packageJson: ParsedPackageJson;
}

export type ImportResult = ImportSuccess | ImportFailure;

export interface ParsedPackageJson {
    name?: string;
    description?: string;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    raw: string;
}

/**
 * Parse a GitHub URL or owner/repo string into { owner, repo }.
 * Returns null if the input isn't recognizable.
 */
export function parseGitHubRepoUrl(input: string): { owner: string; repo: string } | null {
    const trimmed = input.trim();
    if (!trimmed) return null;

    // Try full URL first
    const urlMatch = trimmed.match(/^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/#?].*)?$/i);
    if (urlMatch) {
        return { owner: urlMatch[1], repo: urlMatch[2] };
    }

    // Fall back to "owner/repo" shorthand
    const shortMatch = trimmed.match(/^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
    if (shortMatch) {
        return { owner: shortMatch[1], repo: shortMatch[2] };
    }

    return null;
}

/**
 * Fetch repository metadata (default branch, visibility, description).
 */
export async function getRepositoryInfo(
    owner: string,
    repo: string,
    token: string,
): Promise<GitHubRepoInfo | ImportFailure> {
    try {
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
            headers: createGitHubHeaders(token),
        });

        if (response.status === 404) {
            return { success: false, reason: 'repo_not_found', message: `Repository ${owner}/${repo} not found.` };
        }
        if (response.status === 401 || response.status === 403) {
            return { success: false, reason: 'access_denied', message: 'You do not have access to this repository.' };
        }
        if (!response.ok) {
            return { success: false, reason: 'github_error', message: `GitHub returned ${response.status}.` };
        }

        const data = (await response.json()) as {
            full_name: string;
            default_branch: string;
            private: boolean;
            description: string | null;
            html_url: string;
        };

        return {
            fullName: data.full_name,
            defaultBranch: data.default_branch,
            isPrivate: data.private,
            description: data.description,
            htmlUrl: data.html_url,
        };
    } catch (error) {
        logger.error('Failed to fetch repository info', { owner, repo, error });
        return { success: false, reason: 'github_error', message: 'Could not reach GitHub.' };
    }
}

/**
 * Fetch the repository archive (zip) for a given ref.
 * Returns the buffer or a failure result.
 */
export async function fetchZipball(
    owner: string,
    repo: string,
    ref: string,
    token: string,
): Promise<ArrayBuffer | ImportFailure> {
    try {
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/zipball/${encodeURIComponent(ref)}`, {
            headers: createGitHubHeaders(token),
            redirect: 'follow',
        });

        if (response.status === 404) {
            return { success: false, reason: 'branch_not_found_no_default', message: `Branch '${ref}' not found.` };
        }
        if (response.status === 401 || response.status === 403) {
            return { success: false, reason: 'access_denied', message: 'You do not have access to this repository.' };
        }
        if (!response.ok) {
            return { success: false, reason: 'github_error', message: `GitHub archive download failed (${response.status}).` };
        }

        const contentLength = response.headers.get('content-length');
        if (contentLength && Number(contentLength) > MAX_ZIPBALL_BYTES) {
            return {
                success: false,
                reason: 'too_large',
                message: `Repository archive is larger than ${Math.round(MAX_ZIPBALL_BYTES / 1024 / 1024)}MB.`,
            };
        }

        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > MAX_ZIPBALL_BYTES) {
            return {
                success: false,
                reason: 'too_large',
                message: `Repository archive is larger than ${Math.round(MAX_ZIPBALL_BYTES / 1024 / 1024)}MB.`,
            };
        }

        return buffer;
    } catch (error) {
        logger.error('Failed to fetch zipball', { owner, repo, ref, error });
        return { success: false, reason: 'github_error', message: 'Could not download the repository archive.' };
    }
}

/**
 * Extract a zipball into the agent's file format.
 * Strips the GitHub wrapper directory ({owner}-{repo}-{sha}/) and ignores
 * build artifacts.
 */
export function extractZipball(zipBuffer: ArrayBuffer): { files: TemplateFile[]; binaries: TemplateFile[] } | ImportFailure {
    let raw: TemplateFile[];
    try {
        raw = ZipExtractor.extractFiles(zipBuffer);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (message.toLowerCase().includes('exceeds')) {
            return { success: false, reason: 'too_large', message };
        }
        return { success: false, reason: 'extract_failed', message };
    }

    const wrapperPrefix = detectWrapperPrefix(raw);
    const files: TemplateFile[] = [];
    const binaries: TemplateFile[] = [];
    let totalBytes = 0;
    const dropped: { path: string; reason: string }[] = [];

    for (const file of raw) {
        const stripped = wrapperPrefix && file.filePath.startsWith(wrapperPrefix)
            ? file.filePath.slice(wrapperPrefix.length)
            : file.filePath;

        if (!stripped) continue;
        if (IGNORED_PREFIXES.some(prefix => stripped.startsWith(prefix))) continue;
        if (IGNORED_EXACT.has(stripped)) {
            dropped.push({ path: stripped, reason: 'lockfile/system' });
            continue;
        }
        if (IGNORED_SUFFIXES.some(suffix => stripped.endsWith(suffix))) {
            dropped.push({ path: stripped, reason: 'source-map' });
            continue;
        }

        const byteLength = estimateByteLength(file.fileContents);
        if (byteLength > MAX_PER_FILE_BYTES) {
            return {
                success: false,
                reason: 'file_too_large',
                message: `File '${stripped}' exceeds ${Math.round(MAX_PER_FILE_BYTES / 1024 / 1024)}MB.`,
            };
        }

        // Binary assets bypass DO state (they're stored in R2 and re-injected
        // into the sandbox at deploy time). We still need their paths so
        // imported components can resolve `import x from '@/assets/...'`.
        if (file.fileContents.startsWith('base64:')) {
            binaries.push({ filePath: stripped, fileContents: file.fileContents });
            continue;
        }
        if (byteLength > MAX_TEXT_FILE_BYTES_FOR_STATE) {
            dropped.push({ path: stripped, reason: `oversized (${Math.round(byteLength / 1024)}KB)` });
            continue;
        }
        if (totalBytes + byteLength > STATE_BUDGET_BYTES) {
            return {
                success: false,
                reason: 'too_large',
                message: `Imported source exceeds the ${Math.round(STATE_BUDGET_BYTES / 1024)}KB state budget after filtering. Try a smaller subset of the project.`,
            };
        }
        totalBytes += byteLength;

        files.push({ filePath: stripped, fileContents: file.fileContents });

        if (files.length > MAX_FILES) {
            return {
                success: false,
                reason: 'too_many_files',
                message: `Repository contains more than ${MAX_FILES} files.`,
            };
        }
    }

    if (dropped.length > 0) {
        logger.info('Dropped non-editable files during import', {
            dropped: dropped.length,
            sample: dropped.slice(0, 10),
            kept: files.length,
            keptBytes: totalBytes,
            binaries: binaries.length,
        });
    }

    return { files, binaries };
}

/**
 * Detect the GitHub wrapper directory by finding the longest common top-level
 * prefix across all entries. GitHub archives use {owner}-{repo}-{shortsha}/.
 */
function detectWrapperPrefix(files: TemplateFile[]): string | null {
    if (files.length === 0) return null;
    const first = files[0].filePath;
    const slashIdx = first.indexOf('/');
    if (slashIdx === -1) return null;

    const candidate = first.slice(0, slashIdx + 1);
    for (const file of files) {
        if (!file.filePath.startsWith(candidate)) return null;
    }
    return candidate;
}

function estimateByteLength(contents: string): number {
    if (contents.startsWith('base64:')) {
        return Math.floor(((contents.length - 7) * 3) / 4);
    }
    return contents.length;
}

/**
 * Confirm the imported project is a Vite + React app. Returns the parsed
 * package.json on success, or a failure result.
 */
export function detectViteReactProject(files: TemplateFile[]): ParsedPackageJson | ImportFailure {
    const pkgFile = files.find(f => f.filePath === 'package.json');
    if (!pkgFile) {
        return {
            success: false,
            reason: 'unsupported_project_type',
            message: 'No package.json found at the repository root.',
        };
    }

    let pkg: ParsedPackageJson;
    try {
        const parsed = JSON.parse(pkgFile.fileContents) as {
            name?: string;
            description?: string;
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
        };
        pkg = {
            name: parsed.name,
            description: parsed.description,
            dependencies: parsed.dependencies ?? {},
            devDependencies: parsed.devDependencies ?? {},
            raw: pkgFile.fileContents,
        };
    } catch (error) {
        return {
            success: false,
            reason: 'unsupported_project_type',
            message: 'Could not parse package.json.',
        };
    }

    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    const hasVite = 'vite' in allDeps;
    const hasReact = 'react' in allDeps || 'react-dom' in allDeps;
    if (!hasVite || !hasReact) {
        return {
            success: false,
            reason: 'unsupported_project_type',
            message: 'RankBuilder currently supports Vite + React projects only. We can add more frameworks if there is demand.',
        };
    }

    const hasIndexHtml = files.some(f => f.filePath === 'index.html');
    const hasMain = files.some(f => f.filePath === 'src/main.tsx' || f.filePath === 'src/main.jsx');
    if (!hasIndexHtml || !hasMain) {
        return {
            success: false,
            reason: 'unsupported_project_type',
            message: 'Expected a Vite project with index.html at the root and src/main.tsx (or src/main.jsx).',
        };
    }

    return pkg;
}

/**
 * Full import pipeline: repo info → branch fallback → zipball → extract → detect.
 */
export async function importRepository(args: {
    owner: string;
    repo: string;
    requestedBranch: string;
    token: string;
}): Promise<ImportResult> {
    const { owner, repo, requestedBranch, token } = args;

    const repoInfo = await getRepositoryInfo(owner, repo, token);
    if ('success' in repoInfo && repoInfo.success === false) {
        return repoInfo;
    }
    const info = repoInfo as GitHubRepoInfo;

    let effectiveBranch = requestedBranch;
    let branchFallback = false;

    let zipResult = await fetchZipball(owner, repo, effectiveBranch, token);
    if ('success' in zipResult && zipResult.success === false) {
        if (zipResult.reason === 'branch_not_found_no_default' && info.defaultBranch && info.defaultBranch !== effectiveBranch) {
            logger.info('Requested branch missing, falling back to default branch', {
                requested: effectiveBranch,
                fallback: info.defaultBranch,
            });
            effectiveBranch = info.defaultBranch;
            branchFallback = true;
            zipResult = await fetchZipball(owner, repo, effectiveBranch, token);
            if ('success' in zipResult && zipResult.success === false) {
                return zipResult;
            }
        } else {
            return zipResult;
        }
    }

    const buffer = zipResult as ArrayBuffer;
    const extractResult = extractZipball(buffer);
    if ('success' in extractResult && extractResult.success === false) {
        return extractResult;
    }
    const { files, binaries } = extractResult as { files: TemplateFile[]; binaries: TemplateFile[] };

    const detection = detectViteReactProject(files);
    if ('success' in detection && detection.success === false) {
        return detection;
    }
    const packageJson = detection as ParsedPackageJson;

    return {
        success: true,
        files,
        binaries,
        repoInfo: info,
        effectiveBranch,
        branchFallback,
        packageJson,
    };
}

// ===========================================================================
// Streaming import (per-file via Git Tree + Blobs API)
// ---------------------------------------------------------------------------
// Avoids holding the whole repo zip in memory. We list the tree, filter junk
// BEFORE downloading, then fetch each kept file individually: binary assets
// stream straight to R2 (never base64'd in memory), code/text stays in state.
// This removes the ~50MB zip ceiling so image-heavy repos import; memory stays
// bounded to a few files at a time regardless of total repo size.
// ===========================================================================

// Cap importable files to stay well under the Workers per-request subrequest
// limit (~1000): each binary costs a blob fetch + an R2 put, each text file a
// blob fetch. 450 leaves headroom for the metadata calls.
const MAX_IMPORT_FILES_STREAMING = 450;
const GITHUB_BLOB_CONCURRENCY = 5;

// GitHub's blob API always returns base64, so binary-vs-text is decided by
// extension first (with a UTF-8 decode fallback for anything unlisted).
const BINARY_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.bmp', '.avif',
    '.woff', '.woff2', '.ttf', '.otf', '.eot',
    '.zip', '.tar', '.gz', '.pdf',
    '.mp3', '.mp4', '.webm', '.ogg', '.wav', '.mov',
    '.bin', '.exe', '.dll', '.so',
]);

const utf8FatalDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

export interface ImportStreamSuccess {
    success: true;
    files: TemplateFile[];
    /** Paths of binary assets already uploaded to R2 (imports/{agentId}/{path}). */
    binaryPaths: string[];
    repoInfo: GitHubRepoInfo;
    effectiveBranch: string;
    branchFallback: boolean;
    packageJson: ParsedPackageJson;
}

export type ImportStreamResult = ImportStreamSuccess | ImportFailure;

interface GitTreeItem {
    path: string;
    type: string;
    sha: string;
    size?: number;
}

function isIgnoredPath(path: string): boolean {
    if (!path) return true;
    if (IGNORED_PREFIXES.some(prefix => path.startsWith(prefix))) return true;
    if (IGNORED_EXACT.has(path)) return true;
    if (IGNORED_SUFFIXES.some(suffix => path.endsWith(suffix))) return true;
    return false;
}

function isBinaryPath(path: string): boolean {
    const lastDot = path.lastIndexOf('.');
    if (lastDot === -1) return false;
    return BINARY_EXTENSIONS.has(path.slice(lastDot).toLowerCase());
}

function base64ToBytes(base64: string): Uint8Array {
    // GitHub wraps blob base64 at 60 chars with newlines — strip all whitespace.
    const clean = base64.replace(/\s/g, '');
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

async function fetchGitTree(
    owner: string,
    repo: string,
    ref: string,
    token: string,
): Promise<{ tree: GitTreeItem[]; truncated: boolean } | ImportFailure> {
    const resp = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
        { headers: createGitHubHeaders(token) },
    );
    if (resp.status === 404) return { success: false, reason: 'branch_not_found_no_default', message: `Branch '${ref}' not found.` };
    if (resp.status === 401 || resp.status === 403) return { success: false, reason: 'access_denied', message: 'You do not have access to this repository.' };
    if (!resp.ok) return { success: false, reason: 'github_error', message: `GitHub tree fetch failed (${resp.status}).` };
    const data = await resp.json() as { tree?: GitTreeItem[]; truncated?: boolean };
    return { tree: data.tree ?? [], truncated: !!data.truncated };
}

async function fetchBlobBytes(owner: string, repo: string, sha: string, token: string): Promise<Uint8Array | null> {
    const resp = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/blobs/${sha}`, {
        headers: createGitHubHeaders(token),
    });
    if (!resp.ok) return null;
    const data = await resp.json() as { content?: string; encoding?: string };
    if (!data.content || data.encoding !== 'base64') return null;
    return base64ToBytes(data.content);
}

/**
 * Streaming import pipeline: repo info → branch fallback → git tree → per-file
 * fetch (binaries to R2, text to state) → detect Vite/React.
 */
export async function importRepositoryStreaming(args: {
    owner: string;
    repo: string;
    requestedBranch: string;
    token: string;
    env: Env;
    agentId: string;
}): Promise<ImportStreamResult> {
    const { owner, repo, requestedBranch, token, env, agentId } = args;

    const repoInfo = await getRepositoryInfo(owner, repo, token);
    if ('success' in repoInfo && repoInfo.success === false) return repoInfo;
    const info = repoInfo as GitHubRepoInfo;

    let effectiveBranch = requestedBranch;
    let branchFallback = false;
    let treeResult = await fetchGitTree(owner, repo, effectiveBranch, token);
    if ('success' in treeResult && treeResult.success === false) {
        if (treeResult.reason === 'branch_not_found_no_default' && info.defaultBranch && info.defaultBranch !== effectiveBranch) {
            effectiveBranch = info.defaultBranch;
            branchFallback = true;
            treeResult = await fetchGitTree(owner, repo, effectiveBranch, token);
            if ('success' in treeResult && treeResult.success === false) return treeResult;
        } else {
            return treeResult;
        }
    }
    const { tree, truncated } = treeResult as { tree: GitTreeItem[]; truncated: boolean };
    if (truncated) {
        return { success: false, reason: 'too_many_files', message: 'Repository is too large to import (GitHub truncated the file listing).' };
    }

    const blobs = tree.filter(item => item.type === 'blob' && !isIgnoredPath(item.path));
    if (blobs.length > MAX_IMPORT_FILES_STREAMING) {
        return { success: false, reason: 'too_many_files', message: `Repository has more than ${MAX_IMPORT_FILES_STREAMING} importable files.` };
    }

    const files: TemplateFile[] = [];
    const binaryPaths: string[] = [];
    const dropped: { path: string; reason: string }[] = [];
    let textBytes = 0;
    let failure: ImportFailure | null = null;
    let cursor = 0;

    const processOne = async (item: GitTreeItem): Promise<void> => {
        const size = item.size ?? 0;
        if (size > MAX_PER_FILE_BYTES) {
            failure = { success: false, reason: 'file_too_large', message: `File '${item.path}' exceeds ${Math.round(MAX_PER_FILE_BYTES / 1024 / 1024)}MB.` };
            return;
        }
        const bytes = await fetchBlobBytes(owner, repo, item.sha, token);
        if (!bytes) { dropped.push({ path: item.path, reason: 'blob fetch failed' }); return; }

        // Decide text vs binary: extension first, UTF-8 fallback for anything else.
        let text: string | null = null;
        if (!isBinaryPath(item.path)) {
            try { text = utf8FatalDecoder.decode(bytes); } catch { text = null; }
        }

        if (text === null) {
            await env.TEMPLATES_BUCKET.put(`imports/${agentId}/${item.path}`, bytes);
            binaryPaths.push(item.path);
            return;
        }

        // Text/code path — bounded by the DO-state budget (synchronous section, no race).
        if (bytes.byteLength > MAX_TEXT_FILE_BYTES_FOR_STATE) {
            dropped.push({ path: item.path, reason: `oversized (${Math.round(bytes.byteLength / 1024)}KB)` });
            return;
        }
        if (textBytes + bytes.byteLength > STATE_BUDGET_BYTES) {
            failure = { success: false, reason: 'too_large', message: `Imported source exceeds the ${Math.round(STATE_BUDGET_BYTES / 1024)}KB state budget after filtering.` };
            return;
        }
        textBytes += bytes.byteLength;
        files.push({ filePath: item.path, fileContents: text });
    };

    const worker = async (): Promise<void> => {
        while (!failure) {
            const i = cursor++;
            if (i >= blobs.length) return;
            try {
                await processOne(blobs[i]);
            } catch (e) {
                dropped.push({ path: blobs[i].path, reason: e instanceof Error ? e.message : 'error' });
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(GITHUB_BLOB_CONCURRENCY, blobs.length) }, () => worker()));
    if (failure) return failure;

    const detection = detectViteReactProject(files);
    if ('success' in detection && detection.success === false) return detection;
    const packageJson = detection as ParsedPackageJson;

    logger.info('Streaming GitHub import complete', {
        agentId, owner, repo, branch: effectiveBranch,
        textFiles: files.length, binaries: binaryPaths.length, dropped: dropped.length, textKB: Math.round(textBytes / 1024),
    });

    return { success: true, files, binaryPaths, repoInfo: info, effectiveBranch, branchFallback, packageJson };
}
