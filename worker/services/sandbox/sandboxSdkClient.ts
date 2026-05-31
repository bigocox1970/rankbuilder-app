import { getSandbox, Sandbox, parseSSEStream, LogEvent, ExecResult } from '@cloudflare/sandbox';

import {
    BootstrapResponse,
    GetInstanceResponse,
    BootstrapStatusResponse,
    ShutdownResponse,
    WriteFilesRequest,
    WriteFilesResponse,
    GetFilesResponse,
    ExecuteCommandsResponse,
    RuntimeErrorResponse,
    ClearErrorsResponse,
    StaticAnalysisResponse,
    DeploymentResult,
    FileTreeNode,
    RuntimeError,
    CommandExecutionResult,
    CodeIssue,
    InstanceDetails,
    LintSeverity,
    GetLogsResponse,
    ListInstancesResponse,
    StoredError,
    TemplateFile,
    InstanceCreationRequest,
} from './sandboxTypes';

import { createObjectLogger } from '../../logger';
import { env } from 'cloudflare:workers'
import { BaseSandboxService } from './BaseSandboxService';

import { 
    buildDeploymentConfig, 
    parseWranglerConfig, 
    deployToDispatch, 
    deployWorker,
} from '../deployer/deploy';
import { 
    createAssetManifest 
} from '../deployer/utils/index';
import { generateId } from '../../utils/idGenerator';
import { ResourceProvisioner } from './resourceProvisioner';
import { TemplateParser } from './templateParser';
import { ResourceProvisioningResult } from './types';
import { getPreviewDomain, resolvePreviewUrl } from '../../utils/urls';
import { isDev } from 'worker/utils/envs'
import { FileTreeBuilder } from './fileTreeBuilder';
import { DeploymentTarget } from 'worker/agents/core/types';
// Export the Sandbox class in your Worker
export { Sandbox as UserAppSandboxService } from "@cloudflare/sandbox";


interface InstanceMetadata {
    projectName: string;
    startTime: string;
    webhookUrl?: string;
    previewURL?: string;
    tunnelURL?: string;
    processId?: string;
    allocatedPort?: number;
    donttouch_files: string[];
    redacted_files: string[];
}

type SandboxType = Sandbox;

type ExecutionSession = Awaited<ReturnType<Sandbox['createSession']>>;

/**
 * Streaming event for enhanced command execution
 */
export interface StreamEvent {
    type: 'stdout' | 'stderr' | 'exit' | 'error';
    data?: string;
    code?: number;
    error?: string;
    timestamp: Date;
}

export enum AllocationStrategy {
    MANY_TO_ONE = 'many_to_one',
    ONE_TO_ONE = 'one_to_one',
}
  
function getAutoAllocatedSandbox(sessionId: string): string {
    // Distribute sessions across available containers using consistent hashing
    // Convert session ID to hash for deterministic assignment
    let hash = 0;
    for (let i = 0; i < sessionId.length; i++) {
      const char = sessionId.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    hash = Math.abs(hash);

    const max_instances = env.MAX_SANDBOX_INSTANCES ? Number(env.MAX_SANDBOX_INSTANCES) : 10;
    const containerIndex = hash % max_instances;
    const containerId = `container-pool-${containerIndex}`;
    
    console.log(`Session mapped to container`, { sessionId, containerId, hash, containerIndex });
    return containerId;
}

export class SandboxSdkClient extends BaseSandboxService {
    private sandbox: SandboxType;
    private metadataCache = new Map<string, InstanceMetadata>();
    private sessionCache = new Map<string, ExecutionSession>();

    constructor(sandboxId: string, agentId: string) {
        if (env.ALLOCATION_STRATEGY === AllocationStrategy.MANY_TO_ONE) {
            sandboxId = getAutoAllocatedSandbox(sandboxId);
        }
        super(sandboxId);
        this.sandbox = this.getSandbox();
        
        this.logger = createObjectLogger(this, 'SandboxSdkClient');
        this.logger.setFields({
            sandboxId: this.sandboxId,
            agentId,
        });
        this.logger.info('SandboxSdkClient initialized', { sandboxId: this.sandboxId });
    }

    async initialize(): Promise<void> {
        // Initialize default session for sandbox operations
        await this.getDefaultSession();
        
        // Run a echo command to check if the sandbox is working
        const echoResult = await this.safeSandboxExec('echo "Hello World"');
        if (echoResult.exitCode !== 0) {
            throw new Error(`Failed to run echo command: ${echoResult.stderr}`);
        }
        this.logger.info('Sandbox initialization complete');
    }

    private getWranglerKVKey(instanceId: string): string {
        return `wrangler-${instanceId}`;
    }

    private getSandbox(): SandboxType {
        if (!this.sandbox) {
            this.sandbox = getSandbox(env.Sandbox, this.sandboxId);
        }
        return this.sandbox;
    }

    /**
     * Generic session getter with caching and automatic recovery
     * Properly handles existing sessions and ensures correct cwd
     */
    private async getOrCreateSession(sessionId: string, cwd: string): Promise<ExecutionSession> {
        try {
            // Try to create a new session with the specified cwd
            this.logger.info('Creating new session', { sessionId, cwd });
            const session = await this.getSandbox().createSession({ id: sessionId, cwd });
            return session;
        } catch (error) {
            // If session already exists, get it
            this.logger.info('Session already exists, retrieving it', { sessionId, cwd });
            const existingSession = await this.getSandbox().getSession(sessionId);
            
            // Verify the cwd matches what we expect
            const pwdResult = await existingSession.exec('pwd');
            const actualCwd = pwdResult.stdout.trim();
            
            if (actualCwd !== cwd) {
                this.logger.warn('Existing session has wrong cwd, attempting to change directory', { 
                    sessionId, 
                    expectedCwd: cwd, 
                    actualCwd 
                });
                // Try to cd to the correct directory
                await existingSession.exec(`cd ${cwd}`);
                const verifyResult = await existingSession.exec('pwd');
                if (verifyResult.stdout.trim() !== cwd) {
                    // throw new Error(`Failed to set working directory to ${cwd}, currently at ${verifyResult.stdout.trim()}`);
                    this.logger.error(`Failed to set working directory to ${cwd}, currently at ${verifyResult.stdout.trim()}`);
                }
                this.logger.info('Successfully changed directory for existing session', { sessionId, cwd });
            }
            
            return existingSession;
        }
    }

    /**
     * Get or create a session for an instance with automatic caching.
     * Environment variables should be set via .dev.vars file.
     */
    private async getInstanceSession(instanceId: string, cwd?: string): Promise<ExecutionSession> {
        if (!this.sessionCache.has(instanceId)) {
            if (instanceId === 'sandbox-default') {
                cwd = '/workspace';
            } else {
                cwd = cwd || `/workspace/${instanceId}`;
            }
            const session = await this.getOrCreateSession(instanceId, cwd);
            this.sessionCache.set(instanceId, session);
        }
        const session = this.sessionCache.get(instanceId);
        return session!;
    }

    /**
     * Get or create default session for anonymous sandbox operations
     */
    private async getDefaultSession(): Promise<ExecutionSession> {
        return await this.getInstanceSession('sandbox-default', '/workspace');
    }

    private async executeCommand(instanceId: string, command: string, options?: {timeout?: number}): Promise<ExecResult> {
        const session = await this.getInstanceSession(instanceId);
        return await session.exec(command, options);
    }

    /**
     * Safe wrapper for direct sandbox exec calls using default session
     */
    private async safeSandboxExec(command: string, options?: {timeout?: number}): Promise<ExecResult> {
        const session = await this.getDefaultSession();
        return await session.exec(command, options);
    }

    /**
     * Invalidate session cache (call when instance is destroyed)
     */
    private invalidateSessionCache(instanceId: string): void {
        if (this.sessionCache.has(instanceId)) {
            this.sessionCache.delete(instanceId);
            this.logger.debug('Session cache invalidated', { instanceId });
        }
    }

    // /** Write a binary file to the sandbox using small base64 chunks to avoid large control messages. */
    // private async writeBinaryFileViaBase64(targetPath: string, data: ArrayBuffer, bytesPerChunk: number = 16 * 1024): Promise<void> {
    //     const dir = targetPath.includes('/') ? targetPath.slice(0, targetPath.lastIndexOf('/')) : '.';
    //     // Ensure directory and clean target file
    //     await this.safeSandboxExec(`mkdir -p '${dir}'`);
    //     await this.safeSandboxExec(`rm -f '${targetPath}'`);

    //     const buffer = new Uint8Array(data);
    //     for (let i = 0; i < buffer.length; i += bytesPerChunk) {
    //         const chunk = buffer.subarray(i, Math.min(i + bytesPerChunk, buffer.length));
    //         const base64Chunk = btoa(String.fromCharCode(...chunk));
    //         // Append decoded bytes into the target file inside the sandbox
    //         const appendResult = await this.safeSandboxExec(`printf '%s' '${base64Chunk}' | base64 -d >> '${targetPath}'`);
    //         if (appendResult.exitCode !== 0) {
    //             throw new Error(`Failed to append to ${targetPath}: ${appendResult.stderr}`);
    //         }
    //     }
    // }

    /**
     * Write multiple files efficiently using a single shell script
     * Reduces 2N requests to just 2 requests regardless of file count
     * Uses base64 encoding to handle all content safely
     */
    private async writeFilesViaScript(
        files: TemplateFile[],
        session: ExecutionSession
    ): Promise<Array<{file: string, success: boolean, error?: string}>> {
        if (files.length === 0) return [];

        this.logger.info('Writing files via shell script', { fileCount: files.length });

        // Generate shell script
        const scriptLines = ['#!/bin/bash'];

        for (const { filePath, fileContents } of files) {
            // Binary files arrive as `base64:<payload>` strings (from ZipExtractor or
            // R2-stored GitHub imports). The shell script base64-decodes its embedded
            // payload, so the existing base64 IS the on-disk bytes — pass it through
            // directly. UTF-8 encoding it first would write the literal text
            // "base64:iVBOR..." to disk and break any served image/font.
            let base64: string;
            if (fileContents.startsWith('base64:')) {
                base64 = fileContents.slice('base64:'.length).replace(/\s+/g, '');
            } else {
                const utf8Bytes = new TextEncoder().encode(fileContents);
                // Convert bytes to base64 in chunks to avoid stack overflow
                const chunkSize = 8192;
                const base64Chunks: string[] = [];
                for (let i = 0; i < utf8Bytes.length; i += chunkSize) {
                    const chunk = utf8Bytes.slice(i, i + chunkSize);
                    let binaryString = '';
                    for (let j = 0; j < chunk.length; j++) {
                        binaryString += String.fromCharCode(chunk[j]);
                    }
                    base64Chunks.push(btoa(binaryString));
                }
                base64 = base64Chunks.join('');
            }

            scriptLines.push(
                `mkdir -p "$(dirname "${filePath}")" && echo '${base64}' | base64 -d > "${filePath}" && echo "OK:${filePath}" || echo "FAIL:${filePath}"`
            );
        }

        const script = scriptLines.join('\n');
        const scriptPath = '/tmp/batch_write.sh';

        try {
            // Write script (1 request)
            const writeResult = await session.writeFile(scriptPath, script);    // TODO: Checksum integrity verification
            if (!writeResult.success) {
                throw new Error('Failed to write batch script');
            }

            // Execute with bash
            const { stdout, stderr } = await session.exec(`bash ${scriptPath}`, { timeout: 60000 });
            
            // Parse results from output
            const output = stdout + stderr;
            const matches = output.matchAll(/OK:(.+)/g);
            const successPaths = new Set<string>();
            for (const match of matches) {
                if (match[1]) successPaths.add(match[1]);
            }
            
            const results = files.map(({ filePath }) => ({
                file: filePath,
                success: successPaths.has(filePath),
                error: successPaths.has(filePath) ? undefined : 'Write failed'
            }));

            const successCount = successPaths.size;
            const failedCount = files.length - successCount;

            if (failedCount > 0) {
                this.logger.warn('Batch write completed with errors', { 
                    total: files.length, 
                    success: successCount, 
                    failed: failedCount 
                });
            } else {
                this.logger.info('Batch write completed', { 
                    total: files.length, 
                    success: successCount 
                });
            }

            return results;

        } catch (error) {
            this.logger.error('Batch write failed', error);
            return files.map(({ filePath }) => ({
                file: filePath,
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            }));
        }
    }

    async writeFilesBulk(instanceId: string, files: TemplateFile[]): Promise<WriteFilesResponse> {
        try {
            const session = await this.getInstanceSession(instanceId);
            const filesToWrite = files.map(file => ({
                filePath: `/workspace/${instanceId}/${file.filePath}`,
                fileContents: file.fileContents
            }));

            // Write in chunks. A single batch script holding every file inline as
            // base64 can grow large enough to be truncated or time out, which
            // silently dropped the files at the tail of the batch (e.g. a whole
            // `src/` tree the agent generated). Chunking keeps each script small
            // and each shell run fast, so writes don't get lost.
            const CHUNK_SIZE = 20;
            const resultByPath = new Map<string, { file: string; success: boolean; error?: string }>();

            const writeChunked = async (targets: typeof filesToWrite) => {
                for (let i = 0; i < targets.length; i += CHUNK_SIZE) {
                    const chunk = targets.slice(i, i + CHUNK_SIZE);
                    const chunkResults = await this.writeFilesViaScript(chunk, session);
                    for (const r of chunkResults) {
                        resultByPath.set(r.file, r);
                    }
                }
            };

            await writeChunked(filesToWrite);

            // Retry any files that failed once — covers transient failures and any
            // chunk whose OK marker was missed — so a partial write self-heals
            // instead of leaving the instance missing modules.
            const failedTargets = filesToWrite.filter(f => !resultByPath.get(f.filePath)?.success);
            if (failedTargets.length > 0) {
                this.logger.warn('Retrying failed file writes', {
                    instanceId,
                    count: failedTargets.length,
                    files: failedTargets.map(f => f.filePath.replace(`/workspace/${instanceId}/`, ''))
                });
                await writeChunked(failedTargets);
            }

            const results: WriteFilesResponse['results'] = filesToWrite.map(f => {
                const r = resultByPath.get(f.filePath);
                return {
                    file: f.filePath.replace(`/workspace/${instanceId}/`, ''),
                    success: !!r?.success,
                    error: r?.success ? undefined : (r?.error ?? 'Write failed')
                };
            });

            // Report success only if EVERY file landed. Previously this returned
            // `success: true` unconditionally, so partial writes were swallowed and
            // the preview silently served the template with the real code missing.
            const allSucceeded = results.every(r => r.success);
            if (!allSucceeded) {
                this.logger.error('Bulk write incomplete after retry', {
                    instanceId,
                    failed: results.filter(r => !r.success).map(r => r.file)
                });
            }

            return {
                success: allSucceeded,
                results,
                message: allSucceeded ? 'Files written successfully' : 'Some files failed to write'
            };
        } catch (error) {
            this.logger.error('writeFiles', error, { instanceId });
            return {
                success: false,
                results: files.map(f => ({ file: f.filePath, success: false, error: 'Instance error' })),
                message: 'Failed to write files'
            };
        }
    }

    async updateProjectName(instanceId: string, projectName: string): Promise<boolean> {
        try {
            await this.updateProjectConfiguration(instanceId, projectName);
            try {
                const metadata = await this.getInstanceMetadata(instanceId);
                const updated = { ...metadata, projectName } as InstanceMetadata;
                await this.storeInstanceMetadata(instanceId, updated);
            } catch (error) {
                this.logger.error('Failed to update instance metadata', error);
            }
            return true;
        } catch (error) {
            this.logger.error('Failed to update project name', error);
            return false;
        }
    }

    private getInstanceMetadataFile(instanceId: string): string {
        return `/workspace/${instanceId}-metadata.json`;
    }

    private async getInstanceMetadata(instanceId: string): Promise<InstanceMetadata> {
        // Check cache first
        if (this.metadataCache.has(instanceId)) {
            return this.metadataCache.get(instanceId)!;
        }
        
        // Cache miss - read from disk
        try {
            const session = await this.getDefaultSession();
            const metadataFile = await session.readFile(this.getInstanceMetadataFile(instanceId));
            if (!metadataFile.success) {
                throw new Error('Failed to read instance metadata file');
            }
            const metadata = JSON.parse(metadataFile.content) as InstanceMetadata;
            this.metadataCache.set(instanceId, metadata); // Cache it
            return metadata;
        } catch (error) {
            this.logger.error(`Failed to read instance metadata: ${error instanceof Error ? error.message : 'Unknown error'}`);
            throw new Error(`Failed to read instance metadata: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async storeInstanceMetadata(instanceId: string, metadata: InstanceMetadata): Promise<void> {
        const session = await this.getDefaultSession();
        const result = await session.writeFile(this.getInstanceMetadataFile(instanceId), JSON.stringify(metadata));
        if (!result.success) {
            throw new Error(`Failed to write instance metadata: ${result.path}`);
        }
        this.metadataCache.set(instanceId, metadata); // Update cache
    }

    private invalidateMetadataCache(instanceId: string): void {
        this.metadataCache.delete(instanceId);
    }

    private async allocateAvailablePort(excludedPorts: number[] = [3000]): Promise<number> {
        const startTime = Date.now();
        const excludeList = excludedPorts.join(' ');
        
        // Single command to find first available port in dev range (8001-8999)
        const findPortCmd = `
            for port in $(seq 8001 8999); do
                if ! echo "${excludeList}" | grep -q "\\\\b$port\\\\b" && 
                   ! netstat -tuln 2>/dev/null | grep -q ":$port " && 
                   ! ss -tuln 2>/dev/null | grep -q ":$port "; then
                    echo $port
                    break
                fi
            done
        `;
        
        const result = await this.safeSandboxExec(findPortCmd.trim());
        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;
        this.logger.info(`Port allocation took ${duration} seconds`);
        
        const portStr = result.stdout.trim();
        if (portStr) {
            const port = parseInt(portStr);
            this.logger.info(`Allocated available port: ${port}`);
            return port;
        }
        
        throw new Error('No available ports found in range 8001-8999');
    }
    
    private async buildFileTree(instanceId: string): Promise<FileTreeNode | undefined> {
        try {
            // Generate find command with exclusions
            const { dirExclusions, fileExclusions } = FileTreeBuilder.generateFindExclusions();
            
            // Build the command dynamically
            const buildTreeCmd = `echo "===FILES==="; find . -type d \\( ${dirExclusions} \\) -prune -o \\( -type f ${fileExclusions} \\) -print; echo "===DIRS==="; find . -type d \\( ${dirExclusions} \\) -prune -o -type d -print`;

            const filesResult = await this.executeCommand(instanceId, buildTreeCmd);
            if (filesResult.exitCode === 0) {
                return FileTreeBuilder.buildFromFindOutput(filesResult.stdout.trim());
            }
        } catch (error) {
            this.logger.warn('Failed to build file tree', error);
        }
        return undefined;
    }

    // ==========================================
    // INSTANCE LIFECYCLE
    // ==========================================

    async listAllInstances(): Promise<ListInstancesResponse> {
        try {
            this.logger.info('Retrieving instance metadata');
            
            // Use a single command to find metadata files only in current directory (not nested)
            const bulkResult = await this.safeSandboxExec(`find . -maxdepth 1 -name "*-metadata.json" -type f -exec sh -c 'echo "===FILE:$1==="; cat "$1"' _ {} \\;`);
            
            if (bulkResult.exitCode !== 0) {
                return {
                    success: true,
                    instances: [],
                    count: 0
                };
            }
            
            const instances: InstanceDetails[] = [];
            
            // Parse the combined output
            const metadataSections: string[] = bulkResult.stdout.split('===FILE:').filter((section: string) => section.trim());
            
            for (const section of metadataSections) {
                try {
                    const lines = section.trim().split('\n');
                    if (lines.length < 2) continue;
                    
                    // First line contains the file path, remaining lines contain the JSON
                    const filePath = lines[0].replace('===', '');
                    const jsonContent = lines.slice(1).join('\n');
                    
                    // Extract instance ID from filename (remove ./ prefix and -metadata.json suffix)
                    const instanceId = filePath.replace('./', '').replace('-metadata.json', '');
                    
                    // Parse metadata
                    const metadata = JSON.parse(jsonContent) as InstanceMetadata;
                    
                    // Update cache with the metadata we just read
                    this.metadataCache.set(instanceId, metadata);
                    
                    // Create lightweight instance details from metadata
                    const instanceDetails: InstanceDetails = {
                        runId: instanceId,
                        startTime: new Date(metadata.startTime),
                        uptime: Math.floor((Date.now() - new Date(metadata.startTime).getTime()) / 1000),
                        directory: instanceId,
                        serviceDirectory: instanceId,
                        previewURL: resolvePreviewUrl(metadata.previewURL, metadata.tunnelURL, env),
                        processId: metadata.processId,
                        tunnelURL: metadata.tunnelURL,
                        // Skip file tree
                        fileTree: undefined,
                        runtimeErrors: undefined
                    };
                    
                    instances.push(instanceDetails);
                } catch (error) {
                    this.logger.warn(`Failed to process metadata section`, error);
                }
            }
            
            this.logger.info('Instance list retrieved', { instanceCount: instances.length });
            
            return {
                success: true,
                instances,
                count: instances.length
            };
        } catch (error) {
            this.logger.error('listAllInstances', error);
            return {
                success: false,
                instances: [],
                count: 0,
                error: `Failed to list instances: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }

    /**
     * Waits for the development server to be ready by monitoring logs for readiness indicators
     */
    private async waitForServerReady(instanceId: string, processId: string, maxWaitTimeMs: number = 10000): Promise<boolean> {
        const startTime = Date.now();
        const pollIntervalMs = 500;
        const maxAttempts = Math.ceil(maxWaitTimeMs / pollIntervalMs);
        
        // Patterns that indicate the server is ready
        const readinessPatterns = [
            /http:\/\/[^\s]+/,           // Any HTTP URL (most reliable)
            /ready in \d+/i,             // Vite "ready in X ms"
            /Local:\s+http/i,            // Vite local server line
            /Network:\s+http/i,          // Vite network server line
            /server running/i,           // Generic server running message
            /listening on/i,             // Generic listening message
            /Web Bundled/i,              // Expo web first-bundle complete
            /Bundled \d+ms/i,            // Expo/Metro bundle complete
            /Waiting on http/i,          // Expo "Web is waiting on http://…"
            /Logs for your project/i     // Expo dev server banner
        ];

        this.logger.info('Waiting for development server', { instanceId, processId, timeoutMs: maxWaitTimeMs });

        // Tail helper: surface the real container Metro/Expo stdout in worker tail.
        // Worker logs alone never showed the container's actual error, so we dump
        // the last ~40 lines on both the ready path and the timeout path.
        const tail = (text: string | undefined, n: number = 40): string =>
            (text || '').split('\n').slice(-n).join('\n');
        let lastStdout = '';
        let lastStderr = '';

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                // Get recent logs only to avoid processing old content
                const logsResult = await this.getLogs(instanceId, true);

                if (logsResult.success) {
                    if (logsResult.logs.stdout) lastStdout = logsResult.logs.stdout;
                    if (logsResult.logs.stderr) lastStderr = logsResult.logs.stderr;
                }

                if (logsResult.success && logsResult.logs.stdout) {
                    const logs = logsResult.logs.stdout;

                    // Check for any readiness pattern
                    for (const pattern of readinessPatterns) {
                        if (pattern.test(logs)) {
                            const elapsedTime = Date.now() - startTime;
                            this.logger.info('Development server ready', { instanceId, elapsedTimeMs: elapsedTime, attempts: `${attempt}/${maxAttempts}` });
                            this.logger.info('Container stdout tail (ready)', { instanceId, stdoutTail: tail(lastStdout), stderrTail: tail(lastStderr) });
                            return true;
                        }
                    }
                }
                
                // Wait before next attempt (except on last attempt)
                if (attempt < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
                }
                
            } catch (error) {
                this.logger.warn(`Error checking server readiness for ${instanceId} (attempt ${attempt}):`, error);
                // Continue trying even if there's an error getting logs
                if (attempt < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
                }
            }
        }
        
        const elapsedTime = Date.now() - startTime;
        this.logger.warn('Development server readiness timeout', { instanceId, elapsedTimeMs: elapsedTime, totalAttempts: maxAttempts });
        this.logger.warn('Container stdout tail (timeout)', { instanceId, stdoutTail: tail(lastStdout), stderrTail: tail(lastStderr) });
        return false;
    }

    private async startDevServer(instanceId: string, initCommand: string, port: number): Promise<string> {
        try {
            // Use session-based process management
            // Note: Environment variables should already be set via setLocalEnvVars
            const session = await this.getOrCreateSession(`${instanceId}-dev`, `/workspace/${instanceId}`);
            
            // Start process with env vars inline for those not in .dev.vars
            const process = await session.startProcess(
                `VITE_LOGGER_TYPE=json PORT=${port} monitor-cli process start --instance-id ${instanceId} --port ${port} -- ${initCommand}`
            );
            this.logger.info('Development server started', { instanceId, processId: process.id });
            
            // Wait for the server to be ready (non-blocking - always returns the process ID)
            try {
                // Expo's first web bundle is slow (Metro cold-starts and transpiles
                // the full RN web runtime), so allow well beyond Vite's quick boot.
                const isReady = await this.waitForServerReady(instanceId, process.id, 90000);
                if (isReady) {
                    this.logger.info('Development server is ready', { instanceId });
                } else {
                    this.logger.warn('Development server may not be fully ready', { instanceId });
                }
            } catch (readinessError) {
                this.logger.warn(`Error during readiness check for ${instanceId}:`, readinessError);
                this.logger.info('Continuing with server startup despite readiness check error', { instanceId });
            }
            
            return process.id;
        } catch (error) {
            this.logger.warn('Failed to start dev server', error);
            throw error;
        }
    }

    /**
     * Provisions Cloudflare resources for template placeholders in wrangler.jsonc
     */
    private async provisionTemplateResources(instanceId: string, projectName: string): Promise<ResourceProvisioningResult> {
        try {
            const session = await this.getInstanceSession(instanceId);
            
            // Read wrangler.jsonc file using absolute path
            // readFile throws FileNotFoundError when missing rather than returning { success: false }
            let wranglerFile: Awaited<ReturnType<typeof session.readFile>>;
            try {
                wranglerFile = await session.readFile(`/workspace/${instanceId}/wrangler.jsonc`);
            } catch {
                this.logger.info(`No wrangler.jsonc found for ${instanceId}, skipping resource provisioning`);
                return {
                    success: true,
                    provisioned: [],
                    failed: [],
                    replacements: {},
                    wranglerUpdated: false
                };
            }
            if (!wranglerFile.success) {
                this.logger.info(`No wrangler.jsonc found for ${instanceId}, skipping resource provisioning`);
                return {
                    success: true,
                    provisioned: [],
                    failed: [],
                    replacements: {},
                    wranglerUpdated: false
                };
            }

            // Parse and detect placeholders
            const templateParser = new TemplateParser(this.logger);
            const parseResult = templateParser.parseWranglerConfig(wranglerFile.content);

            if (!parseResult.hasPlaceholders) {
                this.logger.info('No placeholders found in wrangler configuration', { instanceId });
                return {
                    success: true,
                    provisioned: [],
                    failed: [],
                    replacements: {},
                    wranglerUpdated: false
                };
            }

            this.logger.info('Placeholders found for provisioning', { instanceId, count: parseResult.placeholders.length });

            // Initialize resource provisioner (skip if credentials are not available)
            let resourceProvisioner: ResourceProvisioner;
            try {
                resourceProvisioner = new ResourceProvisioner(this.logger);
            } catch (error) {
                this.logger.warn(`Cannot initialize resource provisioner: ${error instanceof Error ? error.message : 'Unknown error'}`);
                return {
                    success: true,
                    provisioned: [],
                    failed: parseResult.placeholders.map(p => ({
                        placeholder: p.placeholder,
                        resourceType: p.resourceType,
                        error: 'Missing Cloudflare credentials',
                        binding: p.binding
                    })),
                    replacements: {},
                    wranglerUpdated: false
                };
            }
            
            const provisioned: ResourceProvisioningResult['provisioned'] = [];
            const failed: ResourceProvisioningResult['failed'] = [];
            const replacements: Record<string, string> = {};

            // Provision each resource
            for (const placeholderInfo of parseResult.placeholders) {
                this.logger.info(`Provisioning ${placeholderInfo.resourceType} resource for placeholder ${placeholderInfo.placeholder}`);
                
                const provisionResult = await resourceProvisioner.provisionResource(
                    placeholderInfo.resourceType,
                    projectName
                );

                if (provisionResult.success && provisionResult.resourceId) {
                    provisioned.push({
                        placeholder: placeholderInfo.placeholder,
                        resourceType: placeholderInfo.resourceType,
                        resourceId: provisionResult.resourceId,
                        binding: placeholderInfo.binding
                    });
                    replacements[placeholderInfo.placeholder] = provisionResult.resourceId;
                } else {
                    failed.push({
                        placeholder: placeholderInfo.placeholder,
                        resourceType: placeholderInfo.resourceType,
                        error: provisionResult.error || 'Unknown error',
                        binding: placeholderInfo.binding
                    });
                    this.logger.warn(`Failed to provision ${placeholderInfo.resourceType} for ${placeholderInfo.placeholder}: ${provisionResult.error}`);
                }
            }

            // Update wrangler.jsonc if we have replacements
            let wranglerUpdated = false;
            if (Object.keys(replacements).length > 0) {
                const updatedContent = templateParser.replacePlaceholders(wranglerFile.content, replacements);
                const writeResult = await session.writeFile(`/workspace/${instanceId}/wrangler.jsonc`, updatedContent);
                
                if (writeResult.success) {
                    wranglerUpdated = true;
                    this.logger.info(`Updated wrangler.jsonc with ${Object.keys(replacements).length} resource IDs for ${instanceId}`);
                    this.logger.info(templateParser.createReplacementSummary(replacements));
                } else {
                    this.logger.error(`Failed to update wrangler.jsonc for ${instanceId}`);
                }
            }

            const result: ResourceProvisioningResult = {
                success: failed.length === 0,
                provisioned,
                failed,
                replacements,
                wranglerUpdated
            };

            if (failed.length > 0) {
                this.logger.warn(`Resource provisioning completed with ${failed.length} failures for ${instanceId}`);
            } else {
                this.logger.info(`Resource provisioning completed successfully for ${instanceId}`);
            }

            return result;
        } catch (error) {
            this.logger.error(`Exception during resource provisioning for ${instanceId}:`, error);
            return {
                success: false,
                provisioned: [],
                failed: [],
                replacements: {},
                wranglerUpdated: false
            };
        }
    }

    /*
    * Starts a cloudflared tunnel for the specified instance
    * Super usefulfor local development
    */
    private async startCloudflaredTunnel(instanceId: string, port: number): Promise<string> {
        try {
            const session = await this.getOrCreateSession(`${instanceId}-tunnel`, `/workspace/${instanceId}`);
            const process = await session.startProcess(
                `cloudflared tunnel --url http://localhost:${port}`
            );
            this.logger.info(`Started cloudflared tunnel for ${instanceId}`);

            // Stream process logs to extract the preview URL
            const logStream = await this.getSandbox().streamProcessLogs(process.id);
            
            return new Promise<string>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    // reject(new Error('Timeout waiting for cloudflared tunnel URL'));
                    this.logger.warn('Timeout waiting for cloudflared tunnel URL');
                    resolve('');
                }, 20000); // 20 second timeout

                const processLogs = async () => {
                    try {
                        for await (const event of parseSSEStream<LogEvent>(logStream)) {
                            if (event.data) {
                                const logLine = event.data;
                                this.logger.info(`Cloudflared log ===> ${logLine}`);
                                
                                // Look for the preview URL in the logs
                                // Format: https://subdomain.trycloudflare.com
                                const urlMatch = logLine.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
                                if (urlMatch) {
                                    clearTimeout(timeout);
                                    const previewURL = urlMatch[0];
                                    this.logger.info(`Found cloudflared tunnel URL: ${previewURL}`);
                                    resolve(previewURL);
                                    return;
                                }
                            }
                        }
                    } catch (error) {
                        this.logger.error('Cloudflare tunnel process failed', error);
                        clearTimeout(timeout);
                        reject(error);
                    }
                };

                processLogs();
            });
        } catch (error) {
            this.logger.warn('Failed to start cloudflared tunnel', error);
            throw error;
        }
    }

    /**
     * Extracts the Expo Go `exp://…exp.direct` URL from a running `expo start --tunnel`
     * dev-server process. Expo prints it once the ngrok tunnel is established (can take
     * 15-40s). Non-fatal: resolves '' on timeout/error so a failed tunnel never blocks
     * the (already-working) web preview — the QR just falls back to the web URL.
     */
    private async extractExpoTunnelUrl(processId: string): Promise<string> {
        // Poll the FULL buffered process output (not a live stream): the dev server has
        // usually been up for a while by the time we get here, so the exp:// line that
        // Expo prints at startup is already in the buffer. A live stream would miss it.
        const urlRe = /exp:\/\/[a-z0-9._-]+\.exp\.direct(?::\d+)?/i;
        const intervalMs = 3000;
        const maxPolls = 15; // ~45s — ngrok tunnel setup is slow
        let lastCombined = '';
        for (let i = 0; i < maxPolls; i++) {
            try {
                const logs = await this.getSandbox().getProcessLogs(processId);
                lastCombined = `${logs.stdout || ''}\n${logs.stderr || ''}`;
                const match = lastCombined.match(urlRe);
                if (match) {
                    this.logger.info(`Found Expo tunnel URL: ${match[0]}`);
                    return match[0];
                }
            } catch (error) {
                this.logger.warn('getProcessLogs failed during Expo tunnel extraction', error);
            }
            await new Promise((r) => setTimeout(r, intervalMs));
        }
        // No exp:// found — dump a diagnostic tail so we can see WHY (ngrok error vs
        // never attempted). Non-fatal: '' means the QR falls back to the web URL.
        const ngrokLine = lastCombined.split('\n').reverse().find(
            (l) => /ngrok|tunnel|exp\.direct/i.test(l)
        );
        this.logger.warn('Expo tunnel: no exp:// URL found', {
            ngrokLine: ngrokLine?.trim().slice(0, 300) || '(no ngrok/tunnel lines in output)',
            stderrTail: lastCombined.slice(-600),
        });
        return '';
    }

    /**
     * Updates project configuration files with the specified project name
     */
    private async updateProjectConfiguration(instanceId: string, projectName: string): Promise<void> {
        try {
            const session = await this.getInstanceSession(instanceId);
            
            // Update package.json with new project name (top-level only)
            this.logger.info(`Updating package.json with project name: ${projectName}`);
            const packageJsonResult = await session.exec(`sed -i '1,10s/^[ \t]*"name"[ ]*:[ ]*"[^"]*"/  "name": "${projectName}"/' package.json`);
            
            if (packageJsonResult.exitCode !== 0) {
                this.logger.warn('Failed to update package.json', packageJsonResult.stderr);
            }
            
            // Update wrangler.jsonc with new project name (top-level only)
            this.logger.info(`Updating wrangler.jsonc with project name: ${projectName}`);
            const wranglerResult = await session.exec(`sed -i '0,/"name":/s/"name"[ ]*:[ ]*"[^"]*"/"name": "${projectName}"/' wrangler.jsonc`);
               
            if (wranglerResult.exitCode !== 0) {
                this.logger.warn('Failed to update wrangler.jsonc', wranglerResult.stderr);
            }
            
            this.logger.info('Project configuration updated successfully');
        } catch (error) {
            this.logger.error(`Error updating project configuration: ${error}`);
            throw error;
        }
    }

    private async setLocalEnvVars(instanceId: string, localEnvVars: Record<string, string>): Promise<void> {
        try {
            // Write .dev.vars file - tools will read environment variables from this file
            const session = await this.getInstanceSession(instanceId);
            const envVarsContent = Object.entries(localEnvVars)
                .map(([key, value]) => `${key}=${value}`)
                .join('\n');
            const result = await session.writeFile(`/workspace/${instanceId}/.dev.vars`, envVarsContent);
            if (!result.success) {
                throw new Error('Failed to write .dev.vars file');
            }
            this.logger.info('Environment variables written to .dev.vars', { instanceId, varCount: Object.keys(localEnvVars).length });
        } catch (error) {
            this.logger.error(`Error setting local environment variables: ${error}`);
            throw error;
        }
    }

    private async setupInstance(
        instanceId: string,
        projectName: string,
        initCommand: string,
        isExpo: boolean,
        localEnvVars?: Record<string, string>,
    ): Promise<{previewURL: string, tunnelURL: string, processId: string, allocatedPort: number} | undefined> {
        try {
            const sandbox = this.getSandbox();
            // Update project configuration with the specified project name
            await this.updateProjectConfiguration(instanceId, projectName);
            
            // Provision Cloudflare resources if template has placeholders
            const resourceProvisioningResult = await this.provisionTemplateResources(instanceId, projectName);
            if (!resourceProvisioningResult.success && resourceProvisioningResult.failed.length > 0) {
                this.logger.warn(`Some resources failed to provision for ${instanceId}, but continuing setup process`);
            }
            
            // Store wrangler.jsonc configuration in KV after resource provisioning
            try {
                const session = await this.getInstanceSession(instanceId);
                const wranglerConfigFile = await session.readFile(`/workspace/${instanceId}/wrangler.jsonc`);
                if (wranglerConfigFile.success) {
                    await env.VibecoderStore.put(this.getWranglerKVKey(instanceId), wranglerConfigFile.content);
                    this.logger.info('Wrangler configuration stored in KV', { instanceId });
                } else {
                    this.logger.warn('Could not read wrangler.jsonc for KV storage', { instanceId });
                }
            } catch (error) {
                this.logger.warn('Failed to store wrangler config in KV', { instanceId, error: error instanceof Error ? error.message : 'Unknown error' });
                // Non-blocking - continue with setup
            }
            // If on local development, start cloudflared tunnel
            let tunnelUrlPromise = Promise.resolve('');
            // Allocate single port for both dev server and tunnel
            const allocatedPort = await this.allocateAvailablePort();

            if (isDev(env) || env.USE_TUNNEL_FOR_PREVIEW) {
                this.logger.info('Starting cloudflared tunnel for local development', { instanceId });
                tunnelUrlPromise = this.startCloudflaredTunnel(instanceId, allocatedPort);
            }

            // Patch known-bad template values before bun install / dev start.
            // - react/react-dom 18.3.2 don't exist on npm (latest 18.x is 18.3.1). The LLM
            //   frequently hallucinates this version (with or without a ^/~ prefix), so match
            //   tolerantly — an exact-string match misses "^18.3.2" / "~18.3.2" and the install fails.
            // - expo dev/start scripts must bind to the sandbox-allocated $PORT on all interfaces.
            //   They must NOT set CI=1: CI mode makes Expo treat the run as a one-shot build and
            //   DISABLES Metro's file watcher ("running in CI mode, reloads are disabled"), so the
            //   agent's edits never reach the running preview (frozen bundle / "edits don't apply").
            //   Non-interactivity comes for free from the container's no-TTY launch — verified that
            //   `bun run dev` without CI stays non-interactive AND live-reloads edits + new routes.
            //   The trailing rule strips any pre-baked `CI=1 ` from template dev/start scripts.
            // Single-quoted sed keeps ${PORT:-8081} literal so bun run dev expands it at start time.
            await this.executeCommand(instanceId, `sed -i -E 's/("react(-dom)?"[[:space:]]*:[[:space:]]*")[~^]?18\\.3\\.2"/\\118.3.1"/g; s|"dev": "expo start --web --non-interactive"|"dev": "expo start --web --port \${PORT:-8081} --host lan"|g; s|"start": "expo start --non-interactive"|"start": "expo start --port \${PORT:-8081} --host lan"|g; s|: "CI=1 expo start|: "expo start|g' package.json 2>/dev/null || true`, { timeout: 5000 });

            this.logger.info('Installing dependencies', { instanceId });
            let [installResult, tunnelURL] = await Promise.all([
                this.executeCommand(instanceId, `bun install`, { timeout: 300000 }),
                tunnelUrlPromise
            ]);
            this.logger.info('Dependencies installed', { instanceId, tunnelURL });
                
            if (installResult.exitCode === 0) {
                // Try to start development server in background
                try {
                    if (localEnvVars) {
                        await this.setLocalEnvVars(instanceId, localEnvVars);
                    }
                    // Start dev server on allocated port
                    const processId = await this.startDevServer(instanceId, initCommand, allocatedPort);
                    this.logger.info('Instance created successfully', { instanceId, processId, port: allocatedPort });

                    // For Expo, the native Expo Go URL comes from `expo start --tunnel`'s
                    // own output (ngrok). Extract it from the dev-server logs; '' on failure
                    // so the web preview is never blocked.
                    if (isExpo && !tunnelURL) {
                        tunnelURL = await this.extractExpoTunnelUrl(processId);
                        this.logger.info('Expo tunnel URL resolved', { instanceId, tunnelURL: tunnelURL || '(none)' });
                    }
                        
                    // Expose the same port for preview URL
                    const previewResult = await sandbox.exposePort(allocatedPort, { hostname: getPreviewDomain(env) });
                    let previewURL = previewResult.url;
                    if (!isDev(env)) {
                        const previewDomain = getPreviewDomain(env);
                        if (previewDomain) {
                            // Replace CUSTOM_DOMAIN with previewDomain in previewURL
                            previewURL = previewURL.replace(env.CUSTOM_DOMAIN, previewDomain);
                        }
                    }

                    this.logger.info('Preview URL exposed', { instanceId, previewURL, tunnelURL });
                        
                    return { previewURL, tunnelURL, processId, allocatedPort };
                } catch (error) {
                    this.logger.warn('Failed to start dev server', error);
                    return undefined;
                }
            } else {
                this.logger.warn('Failed to install dependencies', installResult.stderr);
            }
        } catch (error) {
            this.logger.warn('Failed to setup instance', error);
        }
        
        return undefined;
    }
    
    async createInstance(
        options: InstanceCreationRequest
    ): Promise<BootstrapResponse> {
        const { files, projectName, webhookUrl, envVars, initCommand } = options;   
        try {
            // Environment variables will be set via session creation on first use
            if (envVars && Object.keys(envVars).length > 0) {
                this.logger.info('Environment variables will be configured via session', { envVars: Object.keys(envVars) });
            }
            let instanceId: string;
            // Default to one-to-one allocation unless many-to-one is explicitly
            // configured. An unset ALLOCATION_STRATEGY must NOT fall through to the
            // random-instance-id path below: that skips the dedup guard and mints a
            // fresh instance + dev server + port on every createInstance call, which
            // produces multiple live instances per app (preview points at a stale one).
            if (env.ALLOCATION_STRATEGY !== AllocationStrategy.MANY_TO_ONE) {
                // Exactly one instance should exist per sandbox. If one is already
                // running, reuse it (healthy) or shut it down and recreate (unhealthy).
                const instancesResp = await this.listAllInstances();
                if (instancesResp.success && instancesResp.instances.length > 0) {
                    // Try to see if this instance actually exists and if the process is active
                    const firstInstance = instancesResp.instances[0];
                    const instanceStatus = await this.getInstanceStatus(firstInstance.runId);
                    if (instanceStatus.success && instanceStatus.isHealthy) {
                        this.logger.info('Reusing existing healthy instance instead of creating a duplicate', { instance: firstInstance });
                        // Return instance information
                        return {
                            success: true,
                            runId: firstInstance.runId,
                            previewURL: instanceStatus.previewURL,
                            tunnelURL: instanceStatus.tunnelURL,
                            processId: instanceStatus.processId,
                            message: instanceStatus.message
                        };
                    } else {
                        this.logger.warn('Existing instance is not healthy, removing it before recreating', { instance: firstInstance });
                        await this.shutdownInstance(firstInstance.runId);
                    }
                }
            
                instanceId = `i-${this.sandboxId}`;
            } else {
                instanceId = `i-${generateId()}`;
            }
            this.logger.info('Creating sandbox instance', { instanceId, projectName });

            const dontTouchFile = files.find(f => f.filePath === '.donttouch_files.json');
            const dontTouchFiles = dontTouchFile ? JSON.parse(dontTouchFile.fileContents) : [];
            
            const redactedFile = files.find(f => f.filePath === '.redacted_files.json');
            const redactedFiles = redactedFile ? JSON.parse(redactedFile.fileContents) : [];

            // Create directory for instance
            await this.sandbox.exec(`mkdir -p /workspace/${instanceId}`);

            // Write files in bulk to sandbox
            const rawResults = await this.writeFilesBulk(instanceId, files);
            if (!rawResults.success) {
                return {
                    success: false,
                    error: 'Failed to write files to sandbox'
                };
            }
            
            // Detect Expo from the template's dev script so we know to extract the
            // native exp:// tunnel URL (Expo templates run `expo start --tunnel`).
            const pkgJsonFile = files.find(f => f.filePath === 'package.json');
            const isExpo = pkgJsonFile ? /expo start/.test(pkgJsonFile.fileContents) : false;

            const results = await this.setupInstance(instanceId, projectName, initCommand, isExpo, envVars);
            if (!results) {
                return {
                    success: false,
                    error: 'Failed to setup instance'
                };
            }
            // Store instance metadata
            const metadata = {
                projectName: projectName,
                startTime: new Date().toISOString(),
                webhookUrl: webhookUrl,
                previewURL: results.previewURL,
                processId: results.processId,
                tunnelURL: results.tunnelURL,
                allocatedPort: results.allocatedPort,
                donttouch_files: dontTouchFiles,
                redacted_files: redactedFiles,
            };
            await this.storeInstanceMetadata(instanceId, metadata);

            return {
                success: true,
                runId: instanceId,
                message: `Successfully created instance ${instanceId}`,
                previewURL: results.previewURL,
                tunnelURL: results.tunnelURL,
                processId: results.processId,
            };
        } catch (error) {
            this.logger.error(`Failed to create instance for project ${projectName}`, error);
            return {
                success: false,
                error: `Failed to create instance: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }

    async getInstanceDetails(instanceId: string): Promise<GetInstanceResponse> {
        try {            
            // Get instance metadata
            const metadata = await this.getInstanceMetadata(instanceId);
            if (!metadata) {
                return {
                    success: false,
                    error: `Instance ${instanceId} not found or metadata corrupted`
                };
            }

            const startTime = new Date(metadata.startTime);
            const uptime = Math.floor((Date.now() - startTime.getTime()) / 1000);

            // Get runtime errors
            const [fileTree, runtimeErrors] = await Promise.all([
                this.buildFileTree(instanceId),
                this.getInstanceErrors(instanceId)
            ]);

            const instanceDetails: InstanceDetails = {
                runId: instanceId,
                startTime,
                uptime,
                directory: instanceId,
                serviceDirectory: instanceId,
                fileTree,
                runtimeErrors: runtimeErrors.errors,
                previewURL: resolvePreviewUrl(metadata.previewURL, metadata.tunnelURL, env),
                processId: metadata.processId,
                tunnelURL: metadata.tunnelURL,
            };

            return {
                success: true,
                instance: instanceDetails
            };
        } catch (error) {
            this.logger.error('getInstanceDetails', error, { instanceId });
            return { 
                success: false,
                error: `Failed to get instance details: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }

    async getInstanceStatus(instanceId: string): Promise<BootstrapStatusResponse> {
        try {
            // Check if instance exists by checking metadata
            const metadata = await this.getInstanceMetadata(instanceId);
            if (!metadata) {
                return {
                    success: false,
                    pending: false,
                    isHealthy: false,
                    error: `Instance ${instanceId} not found`
                };
            }
            
            let isHealthy = true;
            try {
                // Optionally check if process is still running
                if (metadata.processId) {
                    for (let i = 0; i < 3; i++) {
                        try {
                            const processes = await this.getSandbox().listProcesses();
                            const process = processes.find((p: {id: string; status: string}) => p.id === metadata.processId);
                            isHealthy = !!(process && process.status === 'running');
                            break;
                        } catch (error) {
                            this.logger.error(`Failed to check process ${metadata.processId}, retrying...${i + 1}/3`, {error});
                            isHealthy = false; // Process not found or not running
                        }
                    }
                }
            } catch {
                // No preview available
                isHealthy = false;
            }

            return {
                success: true,
                pending: false,
                isHealthy,
                message: isHealthy ? 'Instance is running normally' : 'Instance may have issues',
                previewURL: resolvePreviewUrl(metadata.previewURL, metadata.tunnelURL, env),
                tunnelURL: metadata.tunnelURL,
                processId: metadata.processId
            };
        } catch (error) {
            this.logger.error('getInstanceStatus', error, { instanceId });
            return {
                success: false,
                pending: false,
                isHealthy: false,
                error: `Failed to get instance status: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }

    async shutdownInstance(instanceId: string): Promise<ShutdownResponse> {
        try {
            // Check if instance exists 
            const metadata = await this.getInstanceMetadata(instanceId);
            if (!metadata) {
                return {
                    success: false,
                    error: `Instance ${instanceId} not found`
                };
            }

            this.logger.info(`Shutting down instance: ${instanceId}`);

            const sandbox = this.getSandbox();
            
            if (metadata.processId) {
                try {
                    await sandbox.killProcess(metadata.processId);
                } catch (error) {
                    this.logger.warn(`Failed to kill process ${metadata.processId}`, error);
                }
            }
            
            // Unexpose the allocated port if we know what it was
            if (metadata.allocatedPort) {
                try {
                    await sandbox.unexposePort(metadata.allocatedPort);
                    this.logger.info(`Unexposed port ${metadata.allocatedPort} for instance ${instanceId}`);
                } catch (error) {
                    this.logger.warn(`Failed to unexpose port ${metadata.allocatedPort}`, error);
                }
            }
            
            // Clean up files
            await this.safeSandboxExec(`rm -rf ${instanceId}`);

            // Invalidate session cache
            this.invalidateSessionCache(instanceId);
            
            // Invalidate metadata cache since instance is being shutdown
            this.invalidateMetadataCache(instanceId);

            return {
                success: true,
                message: `Successfully shutdown instance ${instanceId}`
            };
        } catch (error) {
            this.logger.error('shutdownInstance', error, { instanceId });
            return {
                success: false,
                error: `Failed to shutdown instance: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }

    /**
     * Restart the dev server with its bundler cache cleared, reusing the same port
     * so the preview URL stays valid.
     *
     * Why this is needed (Expo/Metro): the sandbox has no Watchman, so Metro relies
     * on node file-watching, which misses files CREATED in new directories (e.g. a
     * freshly generated src/hooks/ tree). Metro caches the resulting "Unable to
     * resolve module" and a page reload (.reload-trigger) re-bundles from that stale
     * resolver state — so the import keeps failing even though the file is on disk.
     * `expo start --clear` rebuilds the haste map + transform cache, picking the new
     * files up. Best-effort: never throws (a broken restart can't be worse than the
     * already-broken stale-cache preview it's trying to repair).
     */
    async restartDevServer(instanceId: string, initCommand: string): Promise<boolean> {
        try {
            const metadata = await this.getInstanceMetadata(instanceId);
            const port = metadata.allocatedPort;
            if (!port) {
                this.logger.warn('Cannot restart dev server: no allocated port', { instanceId });
                return false;
            }
            const sandbox = this.getSandbox();
            if (metadata.processId) {
                try {
                    await sandbox.killProcess(metadata.processId);
                } catch (error) {
                    this.logger.warn(`restartDevServer: failed to kill old process ${metadata.processId}`, error);
                }
            }
            const processId = await this.startDevServer(instanceId, initCommand, port);
            await this.storeInstanceMetadata(instanceId, { ...metadata, processId });
            this.logger.info('Dev server restarted with cleared cache', { instanceId, processId, port });
            return true;
        } catch (error) {
            this.logger.error('restartDevServer', error, { instanceId });
            return false;
        }
    }

    // ==========================================
    // FILE OPERATIONS
    // ==========================================

    async writeFiles(instanceId: string, files: WriteFilesRequest['files']): Promise<WriteFilesResponse> {
        try {
            const session = await this.getInstanceSession(instanceId);
            // Filter out donttouch files
            const metadata = await this.getInstanceMetadata(instanceId);
            const donttouchFiles = new Set(metadata.donttouch_files);
            
            const filteredFiles = files.filter(file => !donttouchFiles.has(file.filePath));
            const rawResults = await this.writeFilesBulk(instanceId, filteredFiles);
            const results = rawResults.results;

            // Add files that were not written to results
            const wereDontTouchFiles = files.filter(file => donttouchFiles.has(file.filePath));
            wereDontTouchFiles.forEach(file => {
                results.push({
                    file: file.filePath,
                    success: false,
                    error: 'File is forbidden to be modified'
                });
            });

            if (wereDontTouchFiles.length > 0) {
                this.logger.warn('Files were not written (protected by donttouch_files)', { files: wereDontTouchFiles.map(f => f.filePath) });
            }

            const successCount = results.filter(r => r.success).length;

            // If code files were modified, touch .reload-trigger to trigger a page reload
            // We use .reload-trigger instead of vite.config.ts because:
            // - vite.config.ts triggers a FULL SERVER RESTART (disposes miniflare, causes race condition errors)
            // - .reload-trigger triggers a PAGE RELOAD via WebSocket (server stays running)
            if (successCount > 0 && filteredFiles.some(file => file.filePath.endsWith('.ts') || file.filePath.endsWith('.tsx'))) {
                this.logger.info('Touching .reload-trigger to trigger page reload');
                await session.exec(`touch .reload-trigger`);
            }

            return {
                success: true,
                results,
                message: `Successfully wrote ${successCount}/${files.length} files`
            };
        } catch (error) {
            this.logger.error('writeFiles', error, { instanceId });
            return {
                success: false,
                results: files.map(f => ({ file: f.filePath, success: false, error: 'Instance error' })),
                error: `Failed to write files: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }

    async getFiles(templateOrInstanceId: string, filePaths?: string[], applyFilter: boolean = true, redactedFiles?: string[]): Promise<GetFilesResponse> {
        try {
            const session = await this.getInstanceSession(templateOrInstanceId);

            if (!filePaths) {
                // Read '.important_files.json' in instance directory
                const importantFiles = await session.exec(`jq -r '.[]' .important_files.json | while read -r path; do if [ -d "$path" ]; then find "$path" -type f; elif [ -f "$path" ]; then echo "$path"; fi; done`);
                this.logger.info(`Read important files: stdout: ${importantFiles.stdout}, stderr: ${importantFiles.stderr}`);
                filePaths = importantFiles.stdout.split('\n').filter((path: string) => path);
                if (!filePaths) {
                    return {
                        success: false,
                        files: [],
                        error: 'Failed to read important files'
                    };
                }
                this.logger.info(`Successfully read important files: ${filePaths}`);
                applyFilter = true;
            }

            let redactedPaths: Set<string> = new Set();

            if (applyFilter) {
                if (redactedFiles) {
                    redactedPaths = new Set(redactedFiles);
                } else {
                    try {
                        const metadata = await this.getInstanceMetadata(templateOrInstanceId);
                        redactedPaths = new Set(metadata.redacted_files);
                    } catch (error) {
                        this.logger.warn('Failed to get redacted files', { templateOrInstanceId });
                    }
                }
            }

            const files = [];
            const errors = [];

            const readPromises = filePaths.map(async (filePath: string) => {
                try {
                    const result = await session.readFile(`/workspace/${templateOrInstanceId}/${filePath}`);
                    return {
                        result,
                        filePath
                    };
                } catch (error) {
                    this.logger.error(`Failed to read file ${filePath}`, { error });
                    return {
                        result: null,
                        filePath,
                        error
                    };
                }
            });
        
            const readResults = await Promise.allSettled(readPromises);
        
            for (const readResult of readResults) {
                if (readResult.status === 'fulfilled') {
                    const { result, filePath } = readResult.value;
                    if (result && result.success) {
                        files.push({
                            filePath: filePath,
                            fileContents: (applyFilter && redactedPaths.has(filePath)) ? '[REDACTED]' : result.content
                        });
                        
                        this.logger.info('File read successfully', { filePath });
                    } else {
                        this.logger.error('File read failed', { filePath });
                        errors.push({
                            file: filePath,
                            error: 'Failed to read file'
                        });
                    }
                } else {
                    this.logger.error(`Promise rejected for file read`);
                    errors.push({
                        file: 'unknown',
                        error: 'Promise rejected'
                    });
                }
            }

            return {
                success: true,
                files,
                errors: errors.length > 0 ? errors : undefined
            };
        } catch (error) {
            this.logger.error('getFiles', error, { templateOrInstanceId });
            return {
                success: false,
                files: [],
                error: `Failed to get files: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }
    // ==========================================
    // LOG RETRIEVAL
    // ==========================================
    async getLogs(instanceId: string, onlyRecent?: boolean, durationSeconds?: number): Promise<GetLogsResponse> {
        try {
            this.logger.info('Retrieving instance logs', { instanceId, durationSeconds });
            // Use CLI to get all logs and reset the file
            const durationArg = durationSeconds ? `--duration ${durationSeconds}` : '';
            const cmd = `timeout 10s monitor-cli logs get -i ${instanceId} --format raw ${onlyRecent ? '--reset' : ''} ${durationArg}`;
            const result = await this.executeCommand(instanceId, cmd, { timeout: 15000 });
            return {
                success: true,
                logs: {
                    stdout: result.stdout,
                    stderr: result.stderr,
                },
                error: undefined
            };
        } catch (error) {
            this.logger.error('getLogs', error, { instanceId });
            return {
                success: false,
                logs: {
                    stdout: '',
                    stderr: '',
                },
                error: `Failed to get logs: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }

    // ==========================================
    // COMMAND EXECUTION
    // ==========================================

    async executeCommands(instanceId: string, commands: string[], timeout?: number): Promise<ExecuteCommandsResponse> {
        try {
            const results: CommandExecutionResult[] = [];
            
            for (const command of commands) {
                try {
                    const result = await this.executeCommand(instanceId, command, { timeout });
                    
                    results.push({
                        command,
                        success: result.exitCode === 0,
                        output: result.stdout,
                        error: result.stderr || undefined,
                        exitCode: result.exitCode
                    });
                    
                    if (result.exitCode !== 0) {
                        this.logger.error('Command execution failed', { command, error: result.stderr });
                    }
                    
                    this.logger.info('Command executed', { command, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr });
                } catch (error) {
                    this.logger.error('Command execution failed with error', { command, error });
                    results.push({
                        command,
                        success: false,
                        output: '',
                        error: error instanceof Error ? error.message : 'Execution error'
                    });
                }
            }

            const successCount = results.filter(r => r.success).length;
            return {
                success: true,
                results,
                message: `Executed ${successCount}/${commands.length} commands successfully`
            };
        } catch (error) {
            this.logger.error('executeCommands', error, { instanceId });
            return {
                success: false,
                results: commands.map(cmd => ({
                    command: cmd,
                    success: false,
                    output: '',
                    error: 'Instance error' 
                })),
                error: `Failed to execute commands: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }

    // ==========================================
    // ERROR MANAGEMENT
    // ==========================================

    /**
     * Probe the Expo web entry bundle from INSIDE the container and surface any
     * Metro compile/transform error as a runtime error.
     *
     * Why this exists: a Metro TransformError (e.g. duplicate identifier, unresolved
     * import) makes the bundle return HTTP 500 with a JSON error body. The JS never
     * executes, so the client error logger never fires and `monitor-cli errors` stays
     * EMPTY — the agent thinks the build succeeded while the user stares at a blank
     * white screen. Probing localhost inside the container also works during the
     * port-bind race (the platform proxy on 10.0.0.1 may be flaky while localhost is up).
     *
     * Self-gating: only Expo serves this path. Non-Expo templates 404/200 here, so this
     * returns nothing for them and never touches the Vite/website flow. Transient states
     * (connection refused while Metro restarts) are ignored — the agent can't fix those.
     */
    private async probeExpoBundleError(instanceId: string, port?: number): Promise<RuntimeError | null> {
        if (!port) return null;
        try {
            const bundleUrl = `http://localhost:${port}/node_modules/expo-router/entry.bundle?platform=web&dev=true&hot=false&transform.engine=hermes&transform.routerRoot=app&unstable_transformProfile=hermes-stable`;
            const cmd = `curl -s -m 12 -w '\\n__HTTP_STATUS__%{http_code}' '${bundleUrl}'`;
            const result = await this.executeCommand(instanceId, cmd, { timeout: 18000 });
            const out = result.stdout || '';
            const marker = out.lastIndexOf('__HTTP_STATUS__');
            if (marker === -1) return null; // connection refused / Metro restarting — transient, ignore
            const status = out.slice(marker + '__HTTP_STATUS__'.length).trim();
            if (status !== '500') return null; // 200 = healthy, 404 = not an Expo app
            const body = out.slice(0, marker);
            let description = '';
            try {
                const parsed = JSON.parse(body) as { type?: string; message?: string; errors?: Array<{ description?: string }> };
                description = parsed.errors?.[0]?.description || parsed.message || body;
            } catch {
                description = body;
            }
            // Strip ANSI colour codes so the agent gets clean text
            description = description.replace(/\x1b\[[0-9;]*m/g, '').trim();
            if (!description) return null;
            const firstLine = description.split('\n')[0];
            this.logger.warn('Expo bundle compile error detected', { instanceId, error: firstLine });
            return {
                timestamp: new Date().toISOString(),
                level: 60, // fatal — a non-compiling bundle is a blank screen for the user
                message: `Web bundle failed to compile (Metro returned 500, the preview is a blank white screen until this is fixed): ${firstLine}`,
                rawOutput: `Metro TransformError on the web bundle:\n${description}`,
            };
        } catch (error) {
            this.logger.warn('probeExpoBundleError failed (non-fatal)', { instanceId, error: error instanceof Error ? error.message : 'unknown' });
            return null;
        }
    }

    async getInstanceErrors(instanceId: string, clear?: boolean): Promise<RuntimeErrorResponse> {
        try {
            let errors: RuntimeError[] = [];
            // Surface Metro compile errors that produce a silent white screen (see probeExpoBundleError).
            let bundleError: RuntimeError | null = null;
            try {
                const meta = await this.getInstanceMetadata(instanceId);
                bundleError = await this.probeExpoBundleError(instanceId, meta.allocatedPort);
            } catch { /* non-fatal */ }
            const cmd = `timeout 3s monitor-cli errors list -i ${instanceId} --format json ${clear ? '--reset' : ''}`;
            const result = await this.executeCommand(instanceId, cmd, { timeout: 15000 });
            
            if (result.exitCode === 0) {
                let response: {success: boolean, errors: StoredError[]};
                try {
                    response = JSON.parse(result.stdout);
                    this.logger.info(`getInstanceErrors - ${response.errors.length ? 'errors found' : ''}: ${result.stdout}`);
                } catch (parseError) {
                    this.logger.warn('Failed to parse CLI output as JSON', { stdout: result.stdout });
                    throw new Error('Invalid JSON response from CLI tools');
                }
                if (response.success && response.errors) {
                    // Convert StoredError objects to RuntimeError format
                    errors = response.errors;
                    // Prepend the bundle compile error (the silent white-screen cause) so the agent fixes it first.
                    if (bundleError) errors = [bundleError, ...errors];

                    return {
                        success: true,
                        errors,
                        hasErrors: errors.length > 0
                    };
                }
            }
            this.logger.error(`Failed to get errors for instance ${instanceId}: STDERR: ${result.stderr}, STDOUT: ${result.stdout}`);

            // Even when monitor-cli fails, a detected bundle compile error must still reach the agent.
            return {
                success: bundleError ? true : false,
                errors: bundleError ? [bundleError] : [],
                hasErrors: !!bundleError,
                error: bundleError ? undefined : `Failed to get errors for instance ${instanceId}: STDERR: ${result.stderr}, STDOUT: ${result.stdout}`
            };
        } catch (error) {
            this.logger.error('getInstanceErrors', error, { instanceId });
            return {
                success: false,
                errors: [],
                hasErrors: false,
                error: `Failed to get errors: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }

    async clearInstanceErrors(instanceId: string): Promise<ClearErrorsResponse> {
        try {
            // Try enhanced error system first - clear ALL errors
            try {
                const cmd = `timeout 10s monitor-cli errors clear -i ${instanceId} --confirm`;
                const result = await this.executeCommand(instanceId, cmd, { timeout: 15000 }); // 15 second timeout
                
                if (result.exitCode === 0) {
                    let response: any;
                    try {
                        response = JSON.parse(result.stdout);
                    } catch (parseError) {
                        this.logger.warn('Failed to parse CLI output as JSON', { stdout: result.stdout });
                        throw new Error('Invalid JSON response from CLI tools');
                    }
                    if (response.success) {
                        return {
                            success: true,
                            message: response.message || `Cleared ${response.clearedCount || 0} errors`
                        };
                    }
                }
            } catch (enhancedError) {
                this.logger.warn('Error clearing unavailable, falling back to legacy', enhancedError);
            }

            this.logger.info(`Cleared errors for instance ${instanceId}`);

            return {
                success: true,
                message: `Cleared errors`
            };
        } catch (error) {
            this.logger.error('clearInstanceErrors', error, { instanceId });
            return {
                success: false,
                error: `Failed to clear errors: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }

    // ==========================================
    // CODE ANALYSIS & FIXING
    // ==========================================

    async runStaticAnalysisCode(instanceId: string): Promise<StaticAnalysisResponse> {
        try {
            const lintIssues: CodeIssue[] = [];
            const typecheckIssues: CodeIssue[] = [];
            
            // Run ESLint and TypeScript check in parallel
            const [lintResult, tscResult] = await Promise.allSettled([
                this.executeCommand(instanceId, 'bun run lint'),
                this.executeCommand(instanceId, 'bunx tsc -b --incremental --noEmit --pretty false')
            ]);

            const results: StaticAnalysisResponse = {
                success: true,
                lint: {
                    issues: [],
                    summary: {
                        errorCount: 0,
                        warningCount: 0,
                        infoCount: 0
                    },
                    rawOutput: ''
                },
                typecheck: {
                    issues: [],
                    summary: {
                        errorCount: 0,
                        warningCount: 0,
                        infoCount: 0
                    },
                    rawOutput: ''
                }
            };
            
            // Process ESLint results
            if (lintResult.status === 'fulfilled') {
                try {
                    const lintData = JSON.parse(lintResult.value.stdout) as Array<{
                        filePath: string;
                        messages: Array<{
                            message: string;
                            line?: number;
                            column?: number;
                            severity: number;
                            ruleId?: string;
                        }>;
                    }>;
                    
                    for (const fileResult of lintData) {
                        for (const message of fileResult.messages || []) {
                            lintIssues.push({
                                message: message.message,
                                filePath: fileResult.filePath,
                                line: message.line || 0,
                                column: message.column,
                                severity: this.mapESLintSeverity(message.severity),
                                ruleId: message.ruleId || '',
                                source: 'eslint'
                            });
                        }
                    }
                } catch (error) {
                    this.logger.warn('Failed to parse ESLint output', error);
                }

                results.lint.issues = lintIssues;
                results.lint.summary = {
                    errorCount: lintIssues.filter(issue => issue.severity === 'error').length,
                    warningCount: lintIssues.filter(issue => issue.severity === 'warning').length,
                    infoCount: lintIssues.filter(issue => issue.severity === 'info').length
                };
                results.lint.rawOutput = `STDOUT: ${lintResult.value.stdout}\nSTDERR: ${lintResult.value.stderr}`;
            } else if (lintResult.status === 'rejected') {
                this.logger.warn('ESLint analysis failed', lintResult.reason);
            }
            
            // Process TypeScript check results
            if (tscResult.status === 'fulfilled') {
                try {
                    // TypeScript errors can come from either stdout or stderr
                    const output = tscResult.value.stderr || tscResult.value.stdout;
                    
                    if (!output || output.trim() === '') {
                        this.logger.info('No TypeScript output to parse');
                    } else {
                        this.logger.info(`Parsing TypeScript output: ${output.substring(0, 200)}...`);
                        
                        // Split by lines and parse each error
                        const lines = output.split('\n');
                        let currentError: any = null;
                        
                        for (const line of lines) {
                            // Match TypeScript error format: path(line,col): error TSxxxx: message
                            const match = line.match(/^(.+?)\((\d+),(\d+)\): error TS(\d+): (.*)$/);
                            if (match) {
                                // If we have a previous error being built, add it
                                if (currentError) {
                                    typecheckIssues.push(currentError);
                                }
                                
                                // Start building new error
                                currentError = {
                                    message: match[5].trim(),
                                    filePath: match[1].trim(),
                                    line: parseInt(match[2]),
                                    column: parseInt(match[3]),
                                    severity: 'error' as const,
                                    source: 'typescript',
                                    ruleId: `TS${match[4]}`
                                };
                                
                                this.logger.info(`Found TypeScript error: ${currentError.filePath}:${currentError.line} - ${currentError.ruleId}`);
                            } else if (currentError && line.trim() && !line.startsWith('src/') && !line.includes(': error TS')) {
                                // This might be a continuation of the error message
                                currentError.message += ' ' + line.trim();
                            }
                        }
                        
                        // Add the last error if it exists
                        if (currentError) {
                            typecheckIssues.push(currentError);
                        }
                        
                        this.logger.info(`Parsed ${typecheckIssues.length} TypeScript errors`);
                    }
                } catch (error) {
                    this.logger.warn('Failed to parse TypeScript output', error);
                }
                
                results.typecheck.issues = typecheckIssues;
                results.typecheck.summary = {
                    errorCount: typecheckIssues.filter(issue => issue.severity === 'error').length,
                    warningCount: typecheckIssues.filter(issue => issue.severity === 'warning').length,
                    infoCount: typecheckIssues.filter(issue => issue.severity === 'info').length
                };
                results.typecheck.rawOutput = `STDOUT: ${tscResult.value.stdout}\nSTDERR: ${tscResult.value.stderr}`;
            } else if (tscResult.status === 'rejected') {
                this.logger.warn('TypeScript analysis failed', tscResult.reason);
            }

            this.logger.info(`Analysis completed: ${lintIssues.length} lint issues, ${typecheckIssues.length} typecheck issues`);

            return {
                ...results
            };
        } catch (error) {
            this.logger.error('runStaticAnalysisCode', error, { instanceId });
            return {
                success: false,
                lint: { issues: [] },
                typecheck: { issues: [] },
                error: `Failed to run analysis: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }

    private mapESLintSeverity(severity: number): LintSeverity {
        switch (severity) {
            case 1: return 'warning';
            case 2: return 'error';
            default: return 'info';
        }
    }

    // ==========================================
    // DEPLOYMENT
    // ==========================================
    async deployToCloudflareWorkers(instanceId: string, target: DeploymentTarget = 'platform'): Promise<DeploymentResult> {
        try {
            this.logger.info('Starting deployment', { instanceId });
            
            // Get project metadata
            const metadata = await this.getInstanceMetadata(instanceId);
            const projectName = metadata?.projectName || instanceId;
            
            // Get credentials from environment (secure - no exposure to external processes)
            const accountId = env.CLOUDFLARE_ACCOUNT_ID;
            const apiToken = env.CLOUDFLARE_API_TOKEN;
            
            if (!accountId || !apiToken) {
                throw new Error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must be set in environment');
            }
            
            this.logger.info('Processing deployment', { instanceId });
            
            // Step 1: Run build (vite build with @cloudflare/vite-plugin bundles both frontend and Worker)
            this.logger.info('Building project');
            const buildResult = await this.executeCommand(instanceId, 'bun run build');
            if (buildResult.exitCode !== 0) {
                this.logger.warn('Build step failed', buildResult.stdout, buildResult.stderr);
                throw new Error(`Build failed: ${buildResult.stderr}`);
            }

            // Step 2: Parse wrangler config from KV
            this.logger.info('Reading wrangler configuration from KV');
            const wranglerConfigContent = await env.VibecoderStore.get(this.getWranglerKVKey(instanceId));

            if (!wranglerConfigContent) {
                throw new Error(`Wrangler config not found in KV for ${instanceId}`);
            }
            this.logger.info('Using wrangler configuration from KV');

            const config = parseWranglerConfig(wranglerConfigContent);

            this.logger.info('Worker configuration', { scriptName: config.name });
            this.logger.info('Worker compatibility', { compatibilityDate: config.compatibility_date });

            // Step 3: Read worker script from build output
            // @cloudflare/vite-plugin outputs the Worker bundle to dist/{workerEnvName}/index.js
            // where workerEnvName is the wrangler name with dashes replaced by underscores
            this.logger.info('Reading worker script');
            const session = await this.getInstanceSession(instanceId);
            const workerEnvName = config.name.replaceAll('-', '_');
            const viteWorkerPath = `/workspace/${instanceId}/dist/${workerEnvName}/index.js`;

            let workerContent: string | undefined;
            try {
                const workerFile = await session.readFile(viteWorkerPath);
                if (workerFile.success) {
                    workerContent = workerFile.content;
                    this.logger.info('Worker script loaded from vite build', { sizeKB: (workerContent.length / 1024).toFixed(2) });
                }
            } catch {
                this.logger.info('Worker not at vite output path, falling back to wrangler build');
            }

            // Fallback: run wrangler build standalone and find its output in .wrangler/tmp/
            if (!workerContent) {
                const wranglerBuildResult = await this.executeCommand(instanceId, 'bunx wrangler build');
                if (wranglerBuildResult.exitCode === 0) {
                    const findResult = await this.executeCommand(instanceId, 'find .wrangler/tmp -name "index.js" 2>/dev/null | sort -rn | head -1');
                    if (findResult.exitCode === 0 && findResult.stdout.trim()) {
                        try {
                            const wranglerFile = await session.readFile(`/workspace/${instanceId}/${findResult.stdout.trim()}`);
                            if (wranglerFile.success) {
                                workerContent = wranglerFile.content;
                                this.logger.info('Worker script loaded from wrangler build', { sizeKB: (workerContent.length / 1024).toFixed(2) });
                            }
                        } catch {
                            // Not found at fallback path either
                        }
                    }
                } else {
                    this.logger.warn('Wrangler build fallback also failed', wranglerBuildResult.stdout, wranglerBuildResult.stderr);
                }
            }

            if (!workerContent) {
                throw new Error('Worker script not found after build. Ensure the project builds correctly.');
            }

            this.logger.info('Worker script ready', { sizeKB: (workerContent.length / 1024).toFixed(2) });
            
            // Step 3a: Check for additional worker modules (ESM imports)
            // Process them the same way as assets but as strings for the Map
            let additionalModules: Map<string, string> | undefined;
            try {
                const workerAssetsPath = `${instanceId}/dist/assets`;
                const workerAssetsResult = await this.safeSandboxExec(`test -d ${workerAssetsPath} && echo "exists" || echo "missing"`);
                const hasWorkerAssets = workerAssetsResult.exitCode === 0 && workerAssetsResult.stdout.trim() === "exists";
                
                if (hasWorkerAssets) {
                    this.logger.info('Processing additional worker modules', { workerAssetsPath });
                    
                    // Find all JS files in the worker assets directory
                    const findResult = await this.safeSandboxExec(`find ${workerAssetsPath} -type f -name "*.js"`);
                    if (findResult.exitCode === 0) {
                        const modulePaths = findResult.stdout.trim().split('\n').filter((path: string) => path.trim());
                        
                        if (modulePaths.length > 0) {
                            additionalModules = new Map<string, string>();
                            
                            for (const fullPath of modulePaths) {
                                const relativePath = fullPath.replace(`${instanceId}/dist/`, '');
                                
                                try {
                                    const buffer = await this.readFileAsBase64Buffer(fullPath);
                                    const moduleContent = buffer.toString('utf8');
                                    additionalModules.set(relativePath, moduleContent);
                                    
                                    this.logger.info('Worker module loaded', { 
                                        path: relativePath, 
                                        sizeKB: (moduleContent.length / 1024).toFixed(2) 
                                    });
                                } catch (error) {
                                    this.logger.warn(`Failed to read worker module ${fullPath}:`, error);
                                }
                            }
                            
                            if (additionalModules.size > 0) {
                                this.logger.info('Found additional worker modules', { count: additionalModules.size });
                            }
                        }
                    }
                }
            } catch (error) {
                this.logger.error('Failed to process additional worker modules:', error);
            }
            
            // Step 4: Check for static assets and process them
            const assetsPath = `${instanceId}/dist/client`;
            let assetsManifest: Record<string, { hash: string; size: number }> | undefined;
            let fileContents: Map<string, Buffer> | undefined;
            
            const assetDirResult = await this.safeSandboxExec(`test -d ${assetsPath} && echo "exists" || echo "missing"`);
            const hasAssets = assetDirResult.exitCode === 0 && assetDirResult.stdout.trim() === "exists";
            
            if (hasAssets) {
                this.logger.info('Processing static assets', { assetsPath });
                const assetProcessResult = await this.processAssetsInSandbox(instanceId, assetsPath);
                assetsManifest = assetProcessResult.assetsManifest;
                fileContents = assetProcessResult.fileContents;
            } else {
                this.logger.info('No static assets found, deploying worker only');
            }
            
            // Step 5: Override config for dispatch deployment
            const dispatchConfig = {
                ...config,
                name: config.name
            };
        
            
            // Step 6: Build deployment config using pure function
            const deployConfig = buildDeploymentConfig(
                dispatchConfig,
                workerContent,
                accountId,
                apiToken,
                assetsManifest,
                config.compatibility_flags
            );
            
            // Step 7: Deploy using pure function
            const useDispatch = target === 'platform';
            this.logger.info('Deploying to Cloudflare', { target });
            
            if (useDispatch) {
                if (!('DISPATCH_NAMESPACE' in env)) {
                    throw new Error('DISPATCH_NAMESPACE not found in environment variables, cannot deploy without dispatch namespace');
                }
                
                this.logger.info('Using dispatch namespace', { dispatchNamespace: env.DISPATCH_NAMESPACE });
                await deployToDispatch(
                    {
                        ...deployConfig,
                        dispatchNamespace: env.DISPATCH_NAMESPACE as string
                    },
                    fileContents,
                    additionalModules,
                    config.migrations,
                    config.assets
                );
            } else {
                await deployWorker(
                    deployConfig,
                    fileContents,
                    additionalModules,
                    config.migrations,
                    config.assets
                );
            }
            
            // Step 8: Determine deployment URL
            const deployedUrl = `${this.getProtocolForHost()}://${projectName}.${getPreviewDomain(env)}`;
            const deploymentId = projectName;
            
            this.logger.info('Deployment successful', { 
                instanceId,
                deployedUrl, 
                deploymentId,
                mode: useDispatch ? 'dispatch-namespace' : 'user-worker'
            });
            
            return {
                success: true,
                message: `Successfully deployed ${instanceId} using secure API deployment`,
                deployedUrl,
                deploymentId,
                output: `Deployed`
            };
            
        } catch (error) {
            this.logger.error('deployToCloudflareWorkers', error, { instanceId });
            return {
                success: false,
                message: `Deployment failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
    
    /**
     * Process static assets in sandbox and create manifest for deployment
     */
    private async processAssetsInSandbox(_instanceId: string, assetsPath: string): Promise<{
        assetsManifest: Record<string, { hash: string; size: number }>;
        fileContents: Map<string, Buffer>;
    }> {
        // Get list of all files in assets directory
        const findResult = await this.safeSandboxExec(`find ${assetsPath} -type f`);
        if (findResult.exitCode !== 0) {
            throw new Error(`Failed to list assets: ${findResult.stderr}`);
        }
        
        const filePaths = findResult.stdout.trim().split('\n').filter((path: string) => path);
        this.logger.info('Asset files found', { count: filePaths.length });
        
        const fileContents = new Map<string, Buffer>();
        const filesAsArrayBuffer = new Map<string, ArrayBuffer>();
        
        // Read each file and calculate hashes
        for (const fullPath of filePaths) {
            const relativePath = fullPath.replace(`${assetsPath}/`, '/');
            
            try {
                // Use base64 encoding to preserve binary files and Unicode
                const buffer = await this.readFileAsBase64Buffer(fullPath);
                fileContents.set(relativePath, buffer);
                
                const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
                filesAsArrayBuffer.set(relativePath, arrayBuffer);
                
                this.logger.info('Asset file processed', { path: relativePath, sizeBytes: buffer.length });
            } catch (error) {
                this.logger.warn(`Failed to read asset file ${fullPath}:`, error);
            }
        }
        
        // Create asset manifest using pure function
        const assetsManifest = await createAssetManifest(filesAsArrayBuffer);
        const assetCount = Object.keys(assetsManifest).length;
        this.logger.info('Asset manifest created', { assetCount });
        
        return { assetsManifest, fileContents };
    }
    
    /**
     * Read file from sandbox as base64 and convert to Buffer
     * Uses default session for deployment file operations with absolute paths
     */
    private async readFileAsBase64Buffer(filePath: string): Promise<Buffer> {
        // Use base64 with no line wrapping (-w 0) to preserve binary data
        const base64Result = await this.safeSandboxExec(`base64 -w 0 "${filePath}"`);
        if (base64Result.exitCode !== 0) {
            throw new Error(`Failed to encode file: ${base64Result.stderr}`);
        }
        
        return Buffer.from(base64Result.stdout, 'base64');
    }

    /**
     * Get protocol for host (utility method)
     */
    private getProtocolForHost(): string {
        // Simple heuristic - use https for production-like domains
        const previewDomain = getPreviewDomain(env);
        if (previewDomain.includes('localhost') || previewDomain.includes('127.0.0.1')) {
            return 'http';
        }
        return 'https';
    }
}
