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
