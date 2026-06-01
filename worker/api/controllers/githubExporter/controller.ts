import { BaseController } from '../baseController';
import { RouteContext } from '../../types/route-context';
import { GitHubService } from '../../../services/github';
import { GitHubExporterOAuthProvider } from '../../../services/oauth/github-exporter';
import { getAgentStub } from '../../../agents';
import { createLogger } from '../../../logger';
import { AppService } from '../../../database/services/AppService';
import { ExportResult } from 'worker/agents/core/types';
import { SignJWT, jwtVerify, JWTPayload } from 'jose';
import { validateRedirectUrl } from '../../../utils/authUtils';
import { generateId } from '../../../utils/idGenerator';
import { importRepositoryStreaming, parseGitHubRepoUrl } from '../../../services/github/GitHubImporter';
import { scaffoldCloudflareImport } from '../../../services/github/CloudflareScaffold';

export interface GitHubExportData {
    success: boolean;
    repositoryUrl?: string;
    error?: string;
}

interface GitHubExportStatePayload extends JWTPayload {
    userId: string;
    purpose: 'repository_export';
    mode?: 'export';
    agentId: string;
    returnUrl: string;
    exportData: {
        repositoryName: string;
        description?: string;
        isPrivate?: boolean;
    };
}

interface GitHubImportStatePayload extends JWTPayload {
    userId: string;
    purpose: 'repository_import';
    mode: 'import';
    returnUrl: string;
    importData: {
        owner: string;
        repo: string;
        branch: string;
        agentId: string;
    };
}

type GitHubOAuthStatePayload = GitHubExportStatePayload | GitHubImportStatePayload;

function isImportState(payload: GitHubOAuthStatePayload): payload is GitHubImportStatePayload {
    return payload.purpose === 'repository_import';
}

export class GitHubExporterController extends BaseController {
    static readonly logger = createLogger('GitHubExporterController');
    private static readonly STATE_EXPIRY = '10m';

    private static async signState(payload: Omit<GitHubOAuthStatePayload, 'iat' | 'exp'>, secret: string): Promise<string> {
        return new SignJWT(payload as unknown as JWTPayload)
            .setProtectedHeader({ alg: 'HS256' })
            .setIssuedAt()
            .setExpirationTime(this.STATE_EXPIRY)
            .sign(new TextEncoder().encode(secret));
    }

    private static async verifyState(token: string, secret: string): Promise<GitHubOAuthStatePayload | null> {
        try {
            const { payload } = await jwtVerify(
                token,
                new TextEncoder().encode(secret)
            );
            return payload as unknown as GitHubOAuthStatePayload;
        } catch (error) {
            this.logger.warn('State verification failed', { error });
            return null;
        }
    }

    /**
     * Creates GitHub repository and pushes files from agent
     * If existingRepositoryUrl is provided, skips creation and syncs to existing repo
     */
    private static async createRepositoryAndPush(options: {
        env: Env;
        agentId: string;
        repositoryName: string;
        description?: string;
        isPrivate: boolean;
        token: string;
        username: string;
        existingRepositoryUrl?: string;
    }): Promise<
        | { success: true; repositoryUrl: string } 
        | { success: false; error: string; alreadyExists?: boolean; existingRepositoryUrl?: string }
    > {
        const { env, agentId, repositoryName, description, isPrivate, token, username, existingRepositoryUrl } = options;
        
        try {
            let repositoryUrl: string | undefined;
            let cloneUrl: string | undefined;
            
            // Check database for existing repository if not provided
            let finalExistingRepoUrl = existingRepositoryUrl;
            if (!finalExistingRepoUrl) {
                try {
                    const appService = new AppService(env);
                    const app = await appService.getAppDetails(agentId);
                    finalExistingRepoUrl = app?.githubRepositoryUrl || undefined;
                    
                    if (finalExistingRepoUrl) {
                        this.logger.info('Found existing GitHub repository in database', { 
                            agentId, 
                            repositoryUrl: finalExistingRepoUrl 
                        });
                    }
                } catch (error) {
                    this.logger.warn('Failed to check for existing repository', { error, agentId });
                }
            }
            
            // Determine repository details (sync to existing or create new)
            if (finalExistingRepoUrl) {
                // Check if repository still exists on GitHub
                const exists = await GitHubService.repositoryExists({
                    repositoryUrl: finalExistingRepoUrl,
                    token
                });
                
                if (!exists) {
                    // Repository doesn't exist - clear from database and create new
                    this.logger.info('Repository no longer exists, creating new one', {
                        agentId,
                        oldUrl: finalExistingRepoUrl,
                        repositoryName
                    });
                    
                    try {
                        const appService = new AppService(env);
                        await appService.updateGitHubRepository(agentId, '', 'public');
                    } catch (clearError) {
                        this.logger.warn('Failed to clear repository URL', { error: clearError, agentId });
                    }
                    
                    // Create new repository
                    finalExistingRepoUrl = undefined;
                } else {
                    // Repository exists, use it
                    repositoryUrl = finalExistingRepoUrl;
                    cloneUrl = finalExistingRepoUrl.endsWith('.git') 
                        ? finalExistingRepoUrl 
                        : `${finalExistingRepoUrl}.git`;
                }
            }
            
            if (!finalExistingRepoUrl) {
                this.logger.info('Creating new repository', { agentId, repositoryName });
                
                const createResult = await GitHubService.createUserRepository({
                    name: repositoryName,
                    description,
                    private: isPrivate,
                    token
                });

                if (!createResult.success) {
                    // Repository already exists on GitHub - fetch the actual repository
                    if (createResult.alreadyExists && createResult.repositoryName) {
                        this.logger.warn('Repository already exists, fetching repository info', { 
                            agentId, 
                            repositoryName: createResult.repositoryName 
                        });
                        
                        const repoResult = await GitHubService.getRepository({
                            owner: username,
                            repo: createResult.repositoryName,
                            token
                        });
                        
                        if (repoResult.success && repoResult.repository) {
                            return { 
                                success: false, 
                                error: 'Repository already exists',
                                alreadyExists: true,
                                existingRepositoryUrl: repoResult.repository.html_url
                            };
                        }
                    }
                    
                    return { success: false, error: createResult.error || 'Repository creation failed' };
                }

                if (!createResult.repository) {
                    return { success: false, error: 'Repository creation failed' };
                }

                const { repository } = createResult;
                repositoryUrl = repository.html_url;
                cloneUrl = repository.clone_url;
                
                this.logger.info('Repository created', { agentId, repositoryUrl });
            }

            // Ensure repository URLs are set
            if (!repositoryUrl || !cloneUrl) {
                return { 
                    success: false, 
                    error: 'Failed to determine repository URLs' 
                };
            }

            // Push files to repository
            this.logger.info('Pushing files to repository', { agentId, repositoryUrl });
            
            const agentStub = await getAgentStub(env, agentId);
            const pushResult: ExportResult = await agentStub.exportProject({
                kind: 'github',
                github: {
                    cloneUrl,
                    repositoryHtmlUrl: repositoryUrl,
                    isPrivate,
                    token,
                    email: 'vibesdk-bot@cloudflare.com',
                    username
                }
            });

            if (!pushResult?.success) {
                return { 
                    success: false, 
                    error: pushResult?.error || (finalExistingRepoUrl ? 'Sync failed' : 'File push failed')
                };
            }

            const operationType = finalExistingRepoUrl ? 'Sync' : 'Export';
            this.logger.info(`${operationType} completed`, { agentId, repositoryUrl });
            
            return { success: true, repositoryUrl };
        } catch (error) {
            this.logger.error('Repository operation failed', { error, agentId, repositoryName });
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }

    static async handleOAuthCallback(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<Response> {
        try {
            const code = context.queryParams.get('code');
            const stateParam = context.queryParams.get('state');
            const error = context.queryParams.get('error');

            if (error) {
                this.logger.error('OAuth authorization error', { error });
                return Response.redirect(
                    `${new URL(request.url).origin}/settings?integration=github&status=error&reason=${encodeURIComponent(error)}`,
                    302,
                );
            }

            if (!code) {
                return Response.redirect(
                    `${new URL(request.url).origin}/settings?integration=github&status=error&reason=missing_code`,
                    302,
                );
            }

            if (!stateParam) {
                return Response.redirect(
                    `${new URL(request.url).origin}/settings?integration=github&status=error&reason=missing_state`,
                    302,
                );
            }

            const parsedState = await this.verifyState(stateParam, env.JWT_SECRET);

            if (!parsedState) {
                this.logger.warn('Invalid or expired OAuth state');
                return Response.redirect(
                    `${new URL(request.url).origin}/settings?integration=github&status=error&reason=invalid_state`,
                    302,
                );
            }

            const { userId, returnUrl } = parsedState;

            if (!context.user || context.user.id !== userId) {
                this.logger.warn('Session user mismatch in OAuth callback', {
                    stateUserId: userId,
                    sessionUserId: context.user?.id,
                });
                return Response.redirect(
                    `${new URL(request.url).origin}/settings?integration=github&status=error&reason=session_mismatch`,
                    302,
                );
            }

            const validatedReturnUrl = validateRedirectUrl(returnUrl, request)
                || `${new URL(request.url).origin}/chat`;

            const baseUrl = new URL(request.url).origin;
            const oauthProvider = GitHubExporterOAuthProvider.create(env, baseUrl);

            const tokenResult = await oauthProvider.exchangeCodeForTokens(code);

            if (!tokenResult || !tokenResult.accessToken) {
                this.logger.error('Failed to exchange OAuth code', { userId });

                return Response.redirect(
                    `${validatedReturnUrl}?github_export=error&reason=token_exchange_failed`,
                    302,
                );
            }

            this.logger.info('OAuth authorization successful', {
                userId,
                purpose: parsedState.purpose,
            });

            if (isImportState(parsedState)) {
                return this.handleImportCallback(parsedState, tokenResult.accessToken, baseUrl, env);
            }

            const exportState = parsedState as GitHubExportStatePayload;
            const { agentId, exportData } = exportState;

            const appService = new AppService(env);
            const ownershipResult = await appService.checkAppOwnership(agentId, userId);
            if (!ownershipResult.isOwner) {
                this.logger.warn('OAuth callback ownership check failed', { userId, agentId });
                return Response.redirect(
                    `${validatedReturnUrl}?github_export=error&reason=${encodeURIComponent('You do not have permission to export this app')}`,
                    302,
                );
            }

            const result = await this.createRepositoryAndPush({
                env,
                agentId,
                repositoryName: exportData.repositoryName,
                description: exportData.description,
                isPrivate: exportData.isPrivate || false,
                token: tokenResult.accessToken,
                username: 'vibesdk-bot'
            });

            if (!result.success) {
                return Response.redirect(
                    `${validatedReturnUrl}?github_export=error&reason=${encodeURIComponent(result.error)}`,
                    302,
                );
            }

            this.logger.info('OAuth export completed', { userId, agentId, repositoryUrl: result.repositoryUrl });

            return Response.redirect(
                `${validatedReturnUrl}?github_export=success&repository_url=${encodeURIComponent(result.repositoryUrl)}`,
                302,
            );
        } catch (error) {
            this.logger.error('Failed to handle OAuth callback', error);
            return Response.redirect(
                `${new URL(request.url).origin}/settings?integration=github&status=error`,
                302,
            );
        }
    }

    /**
     * Handle the OAuth callback for the import flow: fetch the requested
     * repository, ingest it into a new agent, and redirect to the chat page.
     */
    private static async handleImportCallback(
        state: GitHubImportStatePayload,
        token: string,
        baseUrl: string,
        env: Env,
    ): Promise<Response> {
        const { userId, importData } = state;
        const { owner, repo, branch, agentId } = importData;

        const importResult = await importRepositoryStreaming({ owner, repo, requestedBranch: branch, token, env, agentId });
        if (!importResult.success) {
            this.logger.warn('GitHub import failed', { userId, owner, repo, branch, reason: importResult.reason });
            return Response.redirect(
                `${baseUrl}/?github_import=error&reason=${encodeURIComponent(importResult.reason)}&repo=${encodeURIComponent(`${owner}/${repo}`)}&message=${encodeURIComponent(importResult.message)}`,
                302,
            );
        }

        try {
            const appService = new AppService(env);
            await appService.createApp({
                id: agentId,
                userId,
                title: importResult.repoInfo.fullName.substring(0, 100),
                originalPrompt: `Imported from GitHub: ${importResult.repoInfo.fullName}@${importResult.effectiveBranch}`,
                visibility: 'private',
                status: 'generating',
                sessionToken: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const agentStub = await getAgentStub(env, agentId, { behaviorType: 'phasic', projectType: 'app' });

            const projectName = importResult.packageJson.name
                || importResult.repoInfo.fullName.split('/').pop()!.replace(/[^a-z0-9-_]/gi, '-').toLowerCase();

            const frameworksList = Object.keys({
                ...importResult.packageJson.dependencies,
                ...importResult.packageJson.devDependencies,
            }).filter(name => ['react', 'vite', 'react-dom', 'react-router', 'react-router-dom', 'tailwindcss'].includes(name));

            const scaffolded = scaffoldCloudflareImport(importResult.files, {
                projectName,
                repoFullName: importResult.repoInfo.fullName,
            }, importResult.framework);

            this.logger.info('Cloudflare scaffold applied to imported project', {
                added: scaffolded.addedPaths,
                totalFiles: scaffolded.files.length,
                binaries: importResult.binaryPaths.length,
            });

            // Binary assets (images, fonts) were already streamed straight to R2
            // during import — out of DO state and out of worker memory.
            const importedBinaryPaths = importResult.binaryPaths;

            await agentStub.initializeFromImport({
                files: scaffolded.files.map(f => ({
                    filePath: f.filePath,
                    fileContents: f.fileContents,
                    filePurpose: scaffolded.addedPaths.includes(f.filePath)
                        ? 'RankBuilder-added Cloudflare scaffold'
                        : 'Imported from GitHub',
                })),
                hostname: new URL(baseUrl).host,
                inferenceContext: {
                    metadata: {
                        agentId,
                        userId,
                    },
                    enableRealtimeCodeFix: false,
                    enableFastSmartCodeFix: false,
                    shouldUseUserKey: false,
                },
                projectName,
                repoFullName: importResult.repoInfo.fullName,
                repoUrl: importResult.repoInfo.htmlUrl,
                branch: importResult.effectiveBranch,
                branchFallback: importResult.branchFallback,
                description: importResult.repoInfo.description ?? importResult.packageJson.description ?? null,
                isPrivate: importResult.repoInfo.isPrivate,
                frameworks: frameworksList.length > 0 ? frameworksList : ['react', 'vite'],
                extraDontTouch: [
                    ...scaffolded.addedPaths.filter(p => p !== 'package.json'),
                    ...importedBinaryPaths,
                ],
                importedBinaryPaths,
            });

            this.logger.info('GitHub import completed', { userId, agentId, repo: importResult.repoInfo.fullName });

            const params = new URLSearchParams({
                github_import: 'success',
                repo: importResult.repoInfo.fullName,
                branch: importResult.effectiveBranch,
            });
            if (importResult.branchFallback) {
                params.set('branch_fallback', '1');
            }
            return Response.redirect(`${baseUrl}/chat/${agentId}?${params.toString()}`, 302);
        } catch (error) {
            this.logger.error('Import ingestion failed', { error, userId, owner, repo });
            const message = error instanceof Error ? error.message : 'Unknown error';
            return Response.redirect(
                `${baseUrl}/?github_import=error&reason=github_error&message=${encodeURIComponent(message)}`,
                302,
            );
        }
    }

    /**
     * Initiate the GitHub import OAuth flow.
     * Body: { repoUrl: string, branch?: string }
     * Returns: { authUrl } — frontend redirects user to GitHub.
     */
    static async initiateGitHubImport(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<Response> {
        try {
            if (!context.user) {
                return GitHubExporterController.createErrorResponse<never>(
                    'Authentication required',
                    401,
                );
            }

            const body = await request.json() as {
                repoUrl: string;
                branch?: string;
            };

            const parsed = parseGitHubRepoUrl(body.repoUrl);
            if (!parsed) {
                return GitHubExporterController.createErrorResponse<never>(
                    'Invalid GitHub repository URL',
                    400,
                );
            }

            const branch = (body.branch || 'main').trim() || 'main';
            const newAgentId = generateId();

            const baseUrl = new URL(request.url).origin;

            const statePayload: Omit<GitHubImportStatePayload, 'iat' | 'exp'> = {
                userId: context.user.id,
                purpose: 'repository_import',
                mode: 'import',
                returnUrl: `${baseUrl}/chat/${newAgentId}`,
                importData: {
                    owner: parsed.owner,
                    repo: parsed.repo,
                    branch,
                    agentId: newAgentId,
                },
            };

            const signedState = await this.signState(statePayload, env.JWT_SECRET);
            const oauthProvider = GitHubExporterOAuthProvider.create(env, baseUrl);
            const authUrl = await oauthProvider.getAuthorizationUrl(signedState);

            this.logger.info('Initiating GitHub import OAuth flow', {
                userId: context.user.id,
                owner: parsed.owner,
                repo: parsed.repo,
                branch,
                agentId: newAgentId,
            });

            return GitHubExporterController.createSuccessResponse<{ authUrl: string; agentId: string }>({
                authUrl,
                agentId: newAgentId,
            });
        } catch (error) {
            this.logger.error('Failed to initiate GitHub import', error);
            return GitHubExporterController.createErrorResponse<never>(
                'Failed to initiate GitHub import',
                500,
            );
        }
    }

    static async initiateGitHubExport(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<Response> {
        try {
            if (!context.user) {
                return GitHubExporterController.createErrorResponse<never>(
                    'Authentication required',
                    401,
                );
            }

            const body = await request.json() as {
                repositoryName: string;
                description?: string;
                isPrivate?: boolean;
                agentId: string;
            };

            const appService = new AppService(env);
            const ownershipResult = await appService.checkAppOwnership(body.agentId, context.user.id);
            if (!ownershipResult.isOwner) {
                return GitHubExporterController.createErrorResponse<never>(
                    'You do not have permission to access this app',
                    403
                );
            }

            this.logger.info('Export initiated', { userId: context.user.id, agentId: body.agentId });

            if (!body.repositoryName) {
                return GitHubExporterController.createErrorResponse<never>(
                    'Repository name is required',
                    400,
                );
            }

            if (!body.agentId) {
                return GitHubExporterController.createErrorResponse<never>(
                    'Instance ID is required for file pushing',
                    400,
                );
            }

            const agentStub = await getAgentStub(env, body.agentId);
            const cachedToken = await agentStub.getGitHubToken();
            
            if (cachedToken) {
                this.logger.info('Using cached token', { agentId: body.agentId, username: cachedToken.username });
                
                const result = await this.createRepositoryAndPush({
                    env,
                    agentId: body.agentId,
                    repositoryName: body.repositoryName,
                    description: body.description,
                    isPrivate: body.isPrivate ?? false,
                    token: cachedToken.token,
                    username: cachedToken.username
                });
                
                if (result.success) {
                    this.logger.info('Direct export completed', { repositoryUrl: result.repositoryUrl, agentId: body.agentId });
                    return GitHubExporterController.createSuccessResponse({
                        success: true,
                        repositoryUrl: result.repositoryUrl,
                        skippedOAuth: true
                    });
                }
                
                const isTemporaryError = result.error?.includes('rate limit') || 
                                        result.error?.includes('timeout') ||
                                        result.error?.includes('ECONNRESET');
                
                if (isTemporaryError) {
                    this.logger.warn('Temporary error, keeping token', { error: result.error, agentId: body.agentId });
                    return GitHubExporterController.createErrorResponse(
                        result.error || 'Temporary GitHub error',
                        503
                    );
                }
            } else {
                this.logger.info('No cached token, initiating OAuth', { agentId: body.agentId });
            }

            const baseUrl = new URL(request.url).origin;
            const rawReturnUrl = request.headers.get('referer') || `${baseUrl}/chat`;
            const validatedReturnUrl = validateRedirectUrl(rawReturnUrl, request) || `${baseUrl}/chat`;

            const statePayload: Omit<GitHubExportStatePayload, 'iat' | 'exp'> = {
                userId: context.user.id,
                purpose: 'repository_export',
                agentId: body.agentId,
                exportData: {
                    repositoryName: body.repositoryName,
                    description: body.description,
                    isPrivate: body.isPrivate
                },
                returnUrl: validatedReturnUrl,
            };

            const signedState = await this.signState(statePayload, env.JWT_SECRET);
            const oauthProvider = GitHubExporterOAuthProvider.create(env, baseUrl);

            const authUrl = await oauthProvider.getAuthorizationUrl(signedState);

            this.logger.info('Initiating OAuth flow', { userId: context.user.id, agentId: body.agentId });

            return GitHubExporterController.createSuccessResponse<{ authUrl: string }>({
                authUrl
            });
        } catch (error) {
            this.logger.error('Failed to initiate GitHub export', error);
            return GitHubExporterController.createErrorResponse<never>(
                'Failed to initiate GitHub export',
                500,
            );
        }
    }

    static async checkRemoteStatus(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<Response> {
        try {
            if (!context.user) {
                return GitHubExporterController.createErrorResponse<never>(
                    'Authentication required',
                    401
                );
            }

            const body = await request.json() as {
                repositoryUrl: string;
                agentId: string;
            };

            if (!body.repositoryUrl || !body.agentId) {
                return GitHubExporterController.createErrorResponse<never>(
                    'Repository URL and agent ID are required',
                    400
                );
            }

            const appService = new AppService(env);
            const ownershipResult = await appService.checkAppOwnership(body.agentId, context.user.id);
            if (!ownershipResult.isOwner) {
                return GitHubExporterController.createErrorResponse<never>(
                    'You do not have permission to access this app',
                    403
                );
            }

            const agentStub = await getAgentStub(env, body.agentId);
            
            // Try to get cached token
            const cachedToken = await agentStub.getGitHubToken();
            
            if (!cachedToken) {
                return GitHubExporterController.createErrorResponse<never>(
                    'No cached GitHub token. Please re-authenticate.',
                    401
                );
            }

            // Export git objects and template details
            const { gitObjects, query, templateDetails } = await agentStub.exportGitObjects();
            
            // Get app createdAt
            let appCreatedAt: Date | undefined;
            try {
                const appService = new AppService(env);
                const app = await appService.getAppDetails(body.agentId);
                if (app && app.createdAt) {
                    appCreatedAt = new Date(app.createdAt);
                }
            } catch (error) {
                this.logger.warn('Failed to get app createdAt for sync check', { error });
            }
            
            // Check remote status
            const status = await GitHubService.checkRemoteStatus({
                gitObjects,
                templateDetails,
                appQuery: query,
                appCreatedAt,
                repositoryUrl: body.repositoryUrl,
                token: cachedToken.token
            });

            return GitHubExporterController.createSuccessResponse(status);
        } catch (error) {
            this.logger.error('Failed to check remote status', error);
            return GitHubExporterController.createErrorResponse<never>(
                'Failed to check remote status',
                500
            );
        }
    }
}
