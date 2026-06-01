import { Connection } from 'agents';
import { 
    FileConceptType,
    FileOutputType,
    Blueprint,
    AgenticBlueprint,
    PhasicBlueprint,
} from '../../schemas';
import { CodeIssue, ExecuteCommandsResponse, PreviewType, RuntimeError, StaticAnalysisResponse, TemplateDetails, TemplateFile } from '../../../services/sandbox/sandboxTypes';
import { BaseProjectState, AgenticState, FileState } from '../state';
import { AllIssues, AgentSummary, AgentInitArgs, AgentImportInitArgs, BehaviorType, DeploymentTarget, ProjectType } from '../types';
import { fetchImportedBinaries } from '../../../services/github/importedBinaries';
import { WebSocketMessageResponses } from '../../constants';
import { ProjectSetupAssistant } from '../../assistants/projectsetup';
import { UserConversationProcessor, RenderToolCall } from '../../operations/UserConversationProcessor';
import { FileRegenerationOperation } from '../../operations/FileRegeneration';
// Database schema imports removed - using zero-storage OAuth flow
import { BaseSandboxService } from '../../../services/sandbox/BaseSandboxService';
import { getTemplateImportantFiles } from '../../../services/sandbox/utils';
import { createScratchTemplateDetails } from '../../utils/templates';
import { isExpoTemplate } from 'shared/constants/templates';
import { WebSocketMessageData, WebSocketMessageType } from '../../../api/websocketTypes';
import { AgentActionKey, InferenceContext, InferenceRuntimeOverrides, ModelConfig } from '../../inferutils/config.types';
import { ModelConfigService } from '../../../database/services/ModelConfigService';
import { fixProjectIssues } from '../../../services/code-fixer';
import { isExternalModule, isValidNpmPackageName } from '../../../services/code-fixer/utils/modules';
import { FastCodeFixerOperation } from '../../operations/PostPhaseCodeFixer';
import { looksLikeCommand, validateAndCleanBootstrapCommands } from '../../utils/common';
import { customizeTemplateFiles, generateBootstrapScript } from '../../utils/templateCustomizer';
import { AppService } from '../../../database';
import { RateLimitExceededError } from 'shared/types/errors';
import { ImageAttachment, type ProcessedImageAttachment } from '../../../types/image-attachment';
import { OperationOptions } from '../../operations/common';
import { ImageType, uploadImage, detectBlankScreenshot } from 'worker/utils/images';
import { ScreenshotSecurity } from 'worker/utils/screenshot-security';
import { DeepDebugResult } from '../types';
import { updatePackageJson } from '../../utils/packageSyncer';
import { ICodingAgent } from '../../services/interfaces/ICodingAgent';
import { SimpleCodeGenerationOperation } from '../../operations/SimpleCodeGeneration';
import { AgentComponent } from '../AgentComponent';
import type { AgentInfrastructure } from '../AgentCore';
import { GitVersionControl } from '../../git';
import { DeepDebuggerOperation } from '../../operations/DeepDebugger';
import type { DeepDebuggerInputs } from '../../operations/DeepDebugger';
import { generatePortToken } from 'worker/utils/cryptoUtils';
import { getPreviewDomain, getProtocolForHost } from 'worker/utils/urls';
import { isDev } from 'worker/utils/envs';
import { InMemoryAnalyzer } from '../../../services/static-analysis';
import { regenerateTradeImage } from '../../../services/imageGeneration/tradeImageGenerator';
import { RateLimitService } from '../../../services/rate-limit/rateLimits';

// Screenshot capture configuration
const SCREENSHOT_CONFIG = {
    PAGE_LOAD_TIMEOUT: 15000,    // 15s for page load
    WAIT_FOR_TIMEOUT: 2000,      // 2s additional wait after network idle
    MAX_RETRIES: 2,              // 2 retries = 3 total attempts
    RETRY_DELAY_BASE: 2000,      // 2s base delay between retries
    MIN_FILE_SIZE: 10000,        // 10KB minimum for valid screenshot
    MIN_ENTROPY: 2.0,            // Minimum entropy threshold
};

export interface BaseCodingOperations {
    regenerateFile: FileRegenerationOperation;
    fastCodeFixer: FastCodeFixerOperation;
    processUserMessage: UserConversationProcessor;
    simpleGenerateFiles: SimpleCodeGenerationOperation;
}

/**
 * Base class for all coding behaviors
 */
export abstract class BaseCodingBehavior<TState extends BaseProjectState> 
    extends AgentComponent<TState> implements ICodingAgent {
    protected static readonly MAX_COMMANDS_HISTORY = 10;

    protected projectSetupAssistant: ProjectSetupAssistant | undefined;

    protected templateDetailsCache: TemplateDetails | null = null;
    
    // In-memory storage for user-uploaded images (not persisted in DO state)
    protected pendingUserImages: ProcessedImageAttachment[] = []
    protected generationPromise: Promise<void> | null = null;
    protected currentAbortController?: AbortController;
    protected deepDebugPromise: Promise<{ transcript: string } | { error: string }> | null = null;
    protected deepDebugConversationId: string | null = null;

    protected staticAnalysisCache: StaticAnalysisResponse | null = null;

    // Set when missing external packages are auto-installed during static analysis
    // (before the LLM is asked to fix them). The running dev server / Metro bundler
    // must be redeployed once at the end of the turn so the preview picks them up.
    private pendingMissingModuleRedeploy = false;

    // Local module paths we've already tried to generate for missing imports.
    // Caps the heal at one attempt per path per DO lifetime so a module the
    // generator can't satisfy never sends us into a regenerate loop.
    private attemptedLocalModuleGeneration = new Set<string>();

    private sandboxReadyPromise: Promise<void>;
    private resolveSandboxReady!: () => void;

    protected userModelConfigs?: Record<AgentActionKey, ModelConfig>;
    protected runtimeOverrides?: InferenceRuntimeOverrides;
    
    protected operations: BaseCodingOperations = {
        regenerateFile: new FileRegenerationOperation(),
        fastCodeFixer: new FastCodeFixerOperation(),
        processUserMessage: new UserConversationProcessor(),
        simpleGenerateFiles: new SimpleCodeGenerationOperation(),
    };

    getBehavior(): BehaviorType {
        return this.state.behaviorType;
    }

    protected isAgenticState(state: BaseProjectState): state is AgenticState {
        return state.behaviorType === 'agentic';
    }

    constructor(infrastructure: AgentInfrastructure<TState>, protected projectType: ProjectType) {
        super(infrastructure);

        this.sandboxReadyPromise = new Promise(resolve => { this.resolveSandboxReady = resolve; });
        if (this.state.sandboxInstanceId) {
            this.resolveSandboxReady();
        }

        this.setState({
            ...this.state,
            behaviorType: this.getBehavior(),
            projectType: this.projectType,
        });
    }

    protected async waitForSandboxReady(timeoutMs: number = 5000): Promise<boolean> {
        const ready = await Promise.race([
            this.sandboxReadyPromise.then(() => true),
            new Promise<false>(resolve => setTimeout(() => resolve(false), timeoutMs))
        ]);
        if (!ready) {
            this.logger.warn(`Sandbox not ready after ${timeoutMs}ms`);
        }
        return ready;
    }

    public async initialize(
        initArgs: AgentInitArgs,
        ..._args: unknown[]
    ): Promise<TState> {
        this.logger.info("Initializing agent");
        const { templateInfo } = initArgs;
        if (templateInfo) {
            this.templateDetailsCache = templateInfo.templateDetails;

            await this.ensureTemplateDetails();
        }

        // Reset the logg
        return this.state;
    }

    /**
     * Initialize the agent from a GitHub-imported project.
     *
     * Skips blueprint + phase generation: the imported files are saved as-is
     * and the agent transitions straight to a ready-for-chat state so the user
     * can iterate via Orange. A synthetic TemplateDetails is constructed so
     * downstream behaviour (dontTouch enforcement, file regeneration, deploy)
     * has the same shape as a normal generated project.
     */
    public async initializeFromImport(args: AgentImportInitArgs): Promise<TState> {
        const { files, projectName, repoFullName, repoUrl, branch, description, isPrivate, frameworks, extraDontTouch, inferenceContext, hostname } = args;
        if (!args.sandboxSessionId) {
            throw new Error('initializeFromImport requires sandboxSessionId from the agent layer');
        }
        const sandboxSessionId = args.sandboxSessionId;
        const importedBinaryPaths = args.importedBinaryPaths ?? [];

        const filesMap: Record<string, string> = {};
        for (const file of files) {
            filesMap[file.filePath] = file.fileContents;
        }

        // Fetch binary assets (images, fonts) back from R2 and merge them
        // into the template's allFiles map. They live alongside text files
        // in the sandbox at deploy time but stay out of DO state.
        if (importedBinaryPaths.length > 0) {
            try {
                const binaries = await fetchImportedBinaries({
                    env: this.env,
                    agentId: inferenceContext.metadata.agentId,
                    paths: importedBinaryPaths,
                });
                for (const b of binaries) {
                    filesMap[b.filePath] = b.fileContents;
                }
                this.logger.info('Merged R2-hosted binaries into template allFiles', { count: binaries.length });
            } catch (err) {
                this.logger.warn('Failed to fetch imported binaries from R2', { err });
            }
        }

        const dontTouchSet = new Set<string>([
            'index.html',
            'src/main.tsx',
            'src/main.jsx',
            'vite.config.ts',
            'vite.config.js',
            'package.json',
            'package-lock.json',
            'bun.lockb',
            'yarn.lock',
            'pnpm-lock.yaml',
            'tsconfig.json',
            'tsconfig.app.json',
            'tsconfig.node.json',
            '.gitignore',
            ...extraDontTouch,
        ]);

        const dontTouchFiles = Array.from(dontTouchSet).filter(path => files.some(f => f.filePath === path) || ['index.html', 'src/main.tsx', 'src/main.jsx', 'vite.config.ts', 'vite.config.js', 'package.json'].includes(path));

        const syntheticTemplate: TemplateDetails = {
            name: `imported-${repoFullName.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}`,
            language: 'typescript',
            frameworks,
            projectType: 'app',
            description: {
                selection: `GitHub import: ${repoFullName}`,
                usage: `Imported from ${repoUrl}. Edit components in src/ to iterate; build configs are protected.`,
            },
            renderMode: 'sandbox',
            disabled: false,
            fileTree: { path: '/', type: 'directory', children: [] },
            allFiles: filesMap,
            deps: {},
            importantFiles: ['src/App.tsx', 'src/App.jsx', 'package.json'].filter(p => p in filesMap),
            dontTouchFiles,
            redactedFiles: [],
        };

        this.templateDetailsCache = syntheticTemplate;

        const fileSummary = summariseImportedFiles(files);
        const detailedDescription = [
            `This is an EXISTING React + Vite project the user has imported from GitHub (${repoUrl}, branch: ${branch}).`,
            `It is NOT a project you should rebuild from scratch — the user wants to iterate on what they already have.`,
            ``,
            `Detected frameworks: ${frameworks.join(', ') || 'react, vite'}.`,
            `Total files: ${files.length}.`,
            ``,
            `Key files visible to you:`,
            fileSummary,
            ``,
            `Cloudflare deploy scaffolding was added automatically on import (wrangler.jsonc, worker/index.ts, vite.config.cloudflare.ts, plus dev/deploy scripts). Do NOT remove these — they are required for the live preview.`,
            ``,
            `This is the user's OWN project. NEVER claim it was built with, generated by, or based on a Rank Builder starter/template, never add "built with Rank Builder" credits or branding, and never invent URLs. Leave README, LICENSE, and author/credit content alone unless the user explicitly asks you to change it.`,
            ``,
            `When the user sends their first message, briefly acknowledge what you can see (1-2 sentences) and ask what they would like to change. Do not propose redesigns unprompted.`,
        ].join('\n');

        const blueprint = {
            title: repoFullName,
            projectName,
            description: description || `Imported React + Vite project from ${repoFullName}`,
            colorPalette: [],
            frameworks,
            detailedDescription,
            views: [],
            userFlow: {
                uiLayout: 'Existing user-provided React + Vite UI — preserve current layout.',
                uiDesign: 'Existing user-provided design — preserve current styling unless the user asks otherwise.',
                userJourney: 'The user has imported their project to iterate on it. Wait for their instructions.',
            },
            dataFlow: 'Inherited from the imported project — inspect files before assuming any data flow.',
            architecture: { dataFlow: 'Inherited from the imported project.' },
            pitfalls: [
                'Do NOT regenerate or rewrite files the user did not explicitly ask you to change.',
                'Do NOT touch wrangler.jsonc, worker/index.ts, vite.config.cloudflare.ts, package.json, or vite.config.* — they are protected.',
                'Read existing files with read_files before editing them.',
            ],
            implementationRoadmap: [],
            initialPhase: { name: 'Imported', description: 'Files imported from GitHub', files: [] },
        } as unknown as PhasicBlueprint;

        const nextState = {
            ...this.state,
            projectName,
            query: `Imported from GitHub: ${repoFullName}@${branch}. The user wants to iterate on this existing React + Vite project — do not rebuild it.`,
            blueprint,
            templateName: syntheticTemplate.name,
            sandboxInstanceId: undefined,
            commandsHistory: [],
            lastPackageJson: filesMap['package.json'] || '',
            sessionId: sandboxSessionId,
            hostname,
            metadata: inferenceContext.metadata,
            projectType: 'app' as ProjectType,
            // Force 'phasic' — onStart may have left behaviorType as 'unknown'
            // when the agent was instantiated before any state existed.
            // GenerationContext discriminates on this exact value.
            behaviorType: 'phasic' as BehaviorType,
            mvpGenerated: true,
            reviewingInitiated: false,
            shouldBeGenerating: false,
            importSource: `github:${repoFullName}@${branch}`,
            importedDontTouch: Array.from(dontTouchSet),
            importedBinaryPaths,
            generatedPhases: [],
            phasesCounter: (this.state as { phasesCounter?: number }).phasesCounter ?? 100,
            currentDevState: (this.state as { currentDevState?: unknown }).currentDevState,
        } as TState;

        this.setState(nextState);

        const filesToSave: FileOutputType[] = files.map(f => ({
            filePath: f.filePath,
            fileContents: f.fileContents,
            filePurpose: 'Imported from GitHub',
        }));

        await this.fileManager.saveGeneratedFiles(
            filesToSave,
            `Initial import from GitHub: ${repoFullName}@${branch}${isPrivate ? ' (private)' : ''}`,
            true,
        );

        this.logger.info('Imported repository committed', {
            files: filesToSave.length,
            repoFullName,
            branch,
            isPrivate,
        });

        // Surface what's happening to the user. The cold deploy is ~60-90s
        // (bun install + first vite boot) and silence in the chat pane reads
        // as "broken". These three messages narrate the wait.
        this.broadcast(WebSocketMessageResponses.GITHUB_IMPORT_PROGRESS, {
            message: `Imported ${repoFullName} (${files.length} files). Booting your preview now — this takes about a minute on first boot while dependencies install.`,
            step: 'booting',
        });

        // Schedule mid-flight reassurance in case the deploy takes the full
        // ~90s. Use a guard so we don't post the "still installing" message
        // after the deploy has already completed.
        let deployFinished = false;
        setTimeout(() => {
            if (deployFinished) return;
            this.broadcast(WebSocketMessageResponses.GITHUB_IMPORT_PROGRESS, {
                message: 'Still installing dependencies… give it another moment.',
                step: 'installing',
            });
        }, 35_000);
        setTimeout(() => {
            if (deployFinished) return;
            this.broadcast(WebSocketMessageResponses.GITHUB_IMPORT_PROGRESS, {
                message: 'Starting the dev server…',
                step: 'starting',
            });
        }, 70_000);

        // Fire-and-forget deploy. Frontend tracks via DEPLOYMENT_* WS events.
        this.deployToSandbox([], false, `Boot imported project: ${repoFullName}`)
            .then(async (result) => {
                deployFinished = true;
                this.logger.info('[IMPORT-DIAG] Initial deploy promise resolved', {
                    previewURL: result?.previewURL,
                    sandboxInstanceId: this.state.sandboxInstanceId,
                });
                this.broadcast(WebSocketMessageResponses.GITHUB_IMPORT_PROGRESS, {
                    message: result?.previewURL
                        ? 'Preview is live — tell me what you want to change.'
                        : 'Preview boot finished but no URL came back. Try a redeploy if it does not appear.',
                    step: 'ready',
                });
                // Wait a beat for the dev server to either come up or crash,
                // then dump whatever it printed to the worker log so we can
                // diagnose import-specific issues without sandbox shell access.
                await new Promise(resolve => setTimeout(resolve, 25_000));
                try {
                    const instanceId = this.state.sandboxInstanceId;
                    if (!instanceId) {
                        this.logger.warn('[IMPORT-DIAG] No sandboxInstanceId — skipping log dump');
                        return;
                    }
                    const logs = await this.getSandboxServiceClient().getLogs(instanceId, true);
                    this.logger.info('[IMPORT-DIAG] Sandbox dev-server logs after ~25s', {
                        instanceId,
                        success: logs?.success,
                        stdoutTail: logs?.logs?.stdout?.slice(-4000),
                        stderrTail: logs?.logs?.stderr?.slice(-4000),
                    });
                } catch (err) {
                    this.logger.warn('[IMPORT-DIAG] Could not fetch sandbox logs', { err });
                }
            })
            .catch((error: unknown) => {
                deployFinished = true;
                this.logger.error('[IMPORT-DIAG] Initial deploy promise rejected', { error });
                this.broadcastError('Imported preview deploy failed', error);
            });

        return this.state;
    }

    onStart(_props?: Record<string, unknown> | undefined): Promise<void> {
        return Promise.resolve();
    }

    protected async initializeAsync(): Promise<void> {
        try {
            // Fill the otherwise-silent setup window (sandbox boot + setup-command
            // prediction run in parallel before any command_executing fires).
            this.broadcast(WebSocketMessageResponses.GENERATION_PROGRESS, {
                message: 'Setting up your project environment…',
            });
            const [, setupCommands] = await Promise.all([
                this.deployToSandbox(),
                this.getProjectSetupAssistant().generateSetupCommands(),
                this.generateReadme()
            ]);
            this.logger.info("Deployment to sandbox service and initial commands predictions completed successfully");
                await this.executeCommands(setupCommands.commands);
                this.logger.info("Initial commands executed successfully");
        } catch (error) {
            this.logger.error("Error during async initialization:", error);
            // throw error;
        }
    }
    onStateUpdate(_state: TState, _source: "server" | Connection) {}

    async ensureTemplateDetails() {
        // Skip fetching details for "scratch" baseline
        if (!this.templateDetailsCache) {
            if (this.state.templateName === 'scratch') {
                this.logger.info('Skipping template details fetch for scratch baseline');
                return;
            }
            // GitHub-imported projects have no R2 template — reconstruct a
            // synthetic TemplateDetails from state so downstream logic (deploy,
            // dontTouch enforcement, file regeneration) keeps working after
            // DO cold-start.
            if (this.state.importSource) {
                this.logger.info('Reconstructing template details for imported project', { importSource: this.state.importSource });
                const allFiles: Record<string, string> = {};
                for (const file of this.fileManager.getGeneratedFiles()) {
                    allFiles[file.filePath] = file.fileContents;
                }
                const binaryPaths = this.state.importedBinaryPaths ?? [];
                if (binaryPaths.length > 0) {
                    try {
                        const binaries = await fetchImportedBinaries({
                            env: this.env,
                            agentId: this.state.metadata.agentId,
                            paths: binaryPaths,
                        });
                        for (const b of binaries) {
                            allFiles[b.filePath] = b.fileContents;
                        }
                        this.logger.info('Cold-start: refilled imported binaries from R2', { count: binaries.length });
                    } catch (err) {
                        this.logger.warn('Cold-start: failed to fetch imported binaries', { err });
                    }
                }
                this.templateDetailsCache = {
                    name: this.state.templateName,
                    language: 'typescript',
                    frameworks: this.state.blueprint?.frameworks ?? [],
                    projectType: 'app',
                    description: {
                        selection: `GitHub import: ${this.state.importSource}`,
                        usage: 'Imported project. Edit components in src/; build configs are protected.',
                    },
                    renderMode: 'sandbox',
                    disabled: false,
                    fileTree: { path: '/', type: 'directory', children: [] },
                    allFiles,
                    deps: {},
                    importantFiles: [],
                    dontTouchFiles: this.state.importedDontTouch ?? [],
                    redactedFiles: [],
                };
                return;
            }
            this.logger.info(`Loading template details for: ${this.state.templateName}`);
            const results = await BaseSandboxService.getTemplateDetails(this.state.templateName);
            if (!results.success || !results.templateDetails) {
                throw new Error(`Failed to get template details for: ${this.state.templateName}`);
            }
            
            const templateDetails = results.templateDetails;
            
            const customizedAllFiles = { ...templateDetails.allFiles };
            
            this.logger.info('Customizing template files for older app');
            const customizedFiles = customizeTemplateFiles(
                templateDetails.allFiles,
                {
                    projectName: this.state.projectName,
                    commandsHistory: this.getBootstrapCommands()
                }
            );
            Object.assign(customizedAllFiles, customizedFiles);
            
            this.templateDetailsCache = {
                ...templateDetails,
                allFiles: customizedAllFiles
            };
            this.logger.info('Template details loaded and customized');

            // If renderMode == 'browser', we can deploy right away
            if (templateDetails.renderMode === 'browser') {
                await this.deployToSandbox();
            }
        }
        return this.templateDetailsCache;
    }

    public getTemplateDetails(): TemplateDetails {
        if (!this.templateDetailsCache) {
            // Synthesize a minimal scratch template when starting from scratch
            if (this.state.templateName === 'scratch') {
                this.templateDetailsCache = createScratchTemplateDetails();
                return this.templateDetailsCache;
            }
            this.ensureTemplateDetails();
            throw new Error('Template details not loaded. Call ensureTemplateDetails() first.');
        }
        return this.templateDetailsCache;
    }

    protected isPreviewable(): boolean {
        if (!this.fileManager.fileExists('package.json')) return false;
        // Expo apps use their own dev server — no wrangler config needed
        if (isExpoTemplate(this.getTemplateDetails()?.name)) return true;
        return this.fileManager.fileExists('wrangler.jsonc') || this.fileManager.fileExists('wrangler.toml');
    }

    /**
     * Returns the effective set of files the LLM must never modify.
     *
     * Combines the template's declared dontTouchFiles with implicit protections
     * for sandbox-mode (Vite/React) entry files. These implicit protections
     * exist because a template imported from GitHub/Lovable may not declare a
     * dontTouchFiles list, and the LLM regenerating `index.html` or
     * `src/main.tsx` always breaks the React mount.
     */
    protected getEffectiveDontTouchFiles(): Set<string> {
        const templateDetails = this.templateDetailsCache;
        const declared = templateDetails?.dontTouchFiles || [];
        const result = new Set<string>(declared);

        const isBrowserMode = templateDetails?.renderMode === 'browser';
        if (!isBrowserMode) {
            // Vite entry chain: root index.html and src/main.tsx
            // For React/Vite templates, the LLM has no legitimate reason to
            // modify either — they only contain mount-point boilerplate.
            // SEO meta must use react-helmet-async or prerender.mjs instead.
            result.add('index.html');
            result.add('src/main.tsx');
        }

        // GitHub-imported projects: protect build configs by default so the
        // LLM can iterate on app code without breaking the build. Customers
        // importing a Lovable/v0/Bolt repo do not think to mark these files.
        const importedDontTouch = (this.state as { importedDontTouch?: string[] }).importedDontTouch;
        if (importedDontTouch?.length) {
            for (const path of importedDontTouch) {
                result.add(path);
            }
        }
        return result;
    }

    /**
     * Update bootstrap script when commands history changes
     * Called after significant command executions
     */
    private async updateBootstrapScript(commandsHistory: string[]): Promise<void> {
        if (!commandsHistory || commandsHistory.length === 0) {
            return;
        }
        
        // Use only validated commands
        const bootstrapScript = generateBootstrapScript(
            this.state.projectName,
            commandsHistory
        );
        
        await this.fileManager.saveGeneratedFile(
            {
                filePath: '.bootstrap.js',
                fileContents: bootstrapScript,
                filePurpose: 'Updated bootstrap script for first-time clone setup'
            },
            'chore: Update bootstrap script with latest commands',
            true
        );
        
        this.logger.info('Updated bootstrap script with commands', {
            commandCount: commandsHistory.length,
            commands: commandsHistory
        });
    }

    getProjectSetupAssistant(): ProjectSetupAssistant {
        if (this.projectSetupAssistant === undefined) {
            this.projectSetupAssistant = new ProjectSetupAssistant({
                env: this.env,
                agentId: this.getAgentId(),
                query: this.state.query,
                blueprint: this.state.blueprint,
                template: this.getTemplateDetails(),
                inferenceContext: this.getInferenceContext()
            });
        }
        return this.projectSetupAssistant;
    }

    getSessionId() {
        return this.deploymentManager.getSessionId();
    }

    getSandboxServiceClient(): BaseSandboxService {
        return this.deploymentManager.getClient();
    }

    isCodeGenerating(): boolean {
        return this.generationPromise !== null;
    }

    getUserModelConfigs(): Record<AgentActionKey, ModelConfig> | undefined {
        return this.userModelConfigs;
    }

    setUserModelConfigs(configs: Record<AgentActionKey, ModelConfig> | undefined): void {
        this.userModelConfigs = configs;
    }

    getRuntimeOverrides(): InferenceRuntimeOverrides | undefined {
        return this.runtimeOverrides;
    }

    setRuntimeOverrides(overrides: InferenceRuntimeOverrides | undefined): void {
        this.runtimeOverrides = overrides;
    }

    abstract getOperationOptions(): OperationOptions;

    /**
     * Gets or creates an abort controller for the current operation
     * Reuses existing controller for nested operations (e.g., tool calling)
     */
    protected getOrCreateAbortController(): AbortController {
        // Don't reuse aborted controllers
        if (this.currentAbortController && !this.currentAbortController.signal.aborted) {
            return this.currentAbortController;
        }
        
        // Create new controller in memory for new operation
        this.currentAbortController = new AbortController();
        
        return this.currentAbortController;
    }
    
    /**
     * Cancels the current inference operation if any
     */
    public cancelCurrentInference(): boolean {
        if (this.currentAbortController) {
            this.logger.info('Cancelling current inference operation');
            this.currentAbortController.abort();
            this.currentAbortController = undefined;
            return true;
        }
        return false;
    }
    
    /**
     * Clears abort controller after successful completion
     */
    protected clearAbortController(): void {
        this.currentAbortController = undefined;
    }
    
    /**
     * Gets inference context with abort signal
     * Reuses existing abort controller for nested operations
     */
    protected getInferenceContext(): InferenceContext {
        const controller = this.getOrCreateAbortController();

        // The encrypted Cloudflare OAuth blob is kept fresh on `state.cloudflareToken`
        // (updated on WS connect and on transparent refresh). Pass it as a top-level
        // context field so `infer()` can decrypt the most recent access token.
        const liveBlob = this.state.cloudflareToken ?? null;

        return {
            metadata: this.state.metadata,
            enableFastSmartCodeFix: false,  // TODO: Do we want to enable it via some config?
            enableRealtimeCodeFix: false,   // TODO: Do we want to enable it via some config?
            abortSignal: controller.signal,
            userModelConfigs: this.getUserModelConfigs(),
            runtimeOverrides: this.getRuntimeOverrides(),
            userApiToken: liveBlob,
            onUsageConsumed: () => {
                this.broadcast(WebSocketMessageResponses.USAGE_UPDATED, {
                    message: 'Usage data updated',
                });
            },
        };
    }

    async generateReadme() {
        this.logger.info('Generating README.md');
        this.broadcast(WebSocketMessageResponses.FILE_GENERATING, {
            message: 'Generating README.md',
            filePath: 'README.md',
            filePurpose: 'Project documentation and setup instructions'
        });

        const readme = await this.operations.simpleGenerateFiles.generateReadme(this.getOperationOptions());

        await this.fileManager.saveGeneratedFile(readme, "feat: README.md");

        this.broadcast(WebSocketMessageResponses.FILE_GENERATED, {
            message: 'README.md generated successfully',
            file: readme
        });
        this.logger.info('README.md generated successfully');
    }

    async setBlueprint(blueprint: Blueprint): Promise<void> {
        this.setState({
            ...this.state,
            blueprint: blueprint as AgenticBlueprint | PhasicBlueprint,
        });
        this.broadcast(WebSocketMessageResponses.BLUEPRINT_UPDATED, {
            message: 'Blueprint updated',
            updatedKeys: Object.keys(blueprint || {})
        });
        // Agentic builds (e.g. Expo apps) declare their npm frameworks in the
        // blueprint but rely on the LLM to `bun add` them later, which it skips —
        // leaving Metro unable to resolve the module. Install them now, up front.
        // Phasic (website) flow has its own setup-command dependency handling, so
        // this is gated to agentic to avoid disturbing it.
        if (this.state.behaviorType === 'agentic') {
            try {
                await this.installBlueprintFrameworks(blueprint?.frameworks);
            } catch (error) {
                this.logger.warn('Failed to pre-install blueprint frameworks', { error });
            }
        }
    }

    getProjectType() {
        return this.state.projectType;
    }

    async queueUserRequest(request: string, images?: ProcessedImageAttachment[]): Promise<void> {
        this.setState({
            ...this.state,
            pendingUserInputs: [...this.state.pendingUserInputs, request]
        });
        if (images && images.length > 0) {
            this.logger.info('Storing user images in-memory for phase generation', {
                imageCount: images.length,
            });
            this.pendingUserImages = [...this.pendingUserImages, ...images];
        }
    }

    protected fetchPendingUserRequests(): string[] {
        const inputs = this.state.pendingUserInputs;
        if (inputs.length > 0) {
            this.setState({
                ...this.state,
                pendingUserInputs: []
            });
        }
        return inputs;
    }

    clearConversation(): void {
        this.infrastructure.clearConversation();
    }

    getGit(): GitVersionControl {
        return this.git;
    }


    /**
     * State machine controller for code generation with user interaction support
     * Executes phases sequentially with review cycles and proper state transitions
     */
    async generateAllFiles(): Promise<void> {
        if (this.state.mvpGenerated && this.state.pendingUserInputs.length === 0) {
            this.logger.info("Code generation already completed and no user inputs pending");
            return;
        }
        if (this.isCodeGenerating()) {
            this.logger.info("Code generation already in progress");
            return;
        }
        this.generationPromise = this.buildWrapper();
        await this.generationPromise;
    }

    setMVPGenerated(): boolean {
        if (!this.state.mvpGenerated) {
            this.setState({ ...this.state, mvpGenerated: true });
            this.logger.info('MVP generated');
            return true;
        }
        return false;
    }

    isMVPGenerated(): boolean {
        return this.state.mvpGenerated;
    }

    private async buildWrapper() {
        this.broadcast(WebSocketMessageResponses.GENERATION_STARTED, {
            message: 'Starting code generation',
            totalFiles: this.getTotalFiles()
        });
        this.logger.info('Starting code generation', {
            totalFiles: this.getTotalFiles()
        });
        await this.ensureTemplateDetails();
        try {
            await this.build();
        } catch (error) {
            if (error instanceof RateLimitExceededError) {
                this.logger.error("Error in state machine:", error);
                this.broadcast(WebSocketMessageResponses.RATE_LIMIT_ERROR, { error });
            } else {
                this.broadcastError("Error during generation", error);
            }
        } finally {
            // Clear abort controller after generation completes
            this.clearAbortController();
            
            const appService = new AppService(this.env);
            await appService.updateApp(
                this.getAgentId(),
                {
                    status: 'completed',
                }
            );
            this.generationPromise = null;
            this.broadcast(WebSocketMessageResponses.GENERATION_COMPLETE, {
                message: "Code generation and review process completed.",
                instanceId: this.state.sandboxInstanceId,
            });
        }
    }
    
    /**
     * Abstract method to be implemented by subclasses
     * Contains the main logic for code generation and review process
     */
    abstract build(): Promise<void>

    async executeDeepDebug(
        issue: string,
        toolRenderer: RenderToolCall,
        streamCb: (chunk: string) => void,
        focusPaths?: string[],
    ): Promise<DeepDebugResult> {
        const debugPromise = (async () => {
            try {
                const previousTranscript = this.state.lastDeepDebugTranscript ?? undefined;
                const operationOptions = this.getOperationOptions();
                const filesIndex = operationOptions.context.allFiles
                    .filter((f) =>
                        !focusPaths?.length ||
                        focusPaths.some((p) => f.filePath.includes(p)),
                    );

                const runtimeErrors = await this.fetchRuntimeErrors(false);

                const inputs: DeepDebuggerInputs = {
                    issue,
                    previousTranscript,
                    filesIndex,
                    runtimeErrors,
                    streamCb,
                    toolRenderer,
                };

                const operation = new DeepDebuggerOperation();

                const result = await operation.execute(inputs, operationOptions);

                const transcript = result.transcript;

                // Save transcript for next session
                this.setState({
                    ...this.state,
                    lastDeepDebugTranscript: transcript,
                });

                return { success: true as const, transcript };
            } catch (e) {
                this.logger.error('Deep debugger failed', e);
                return { success: false as const, error: `Deep debugger failed: ${String(e)}` };
            } finally {
                this.deepDebugPromise = null;
                this.deepDebugConversationId = null;
            }
        })();

        // Store promise before awaiting
        this.deepDebugPromise = debugPromise;

        return await debugPromise;
    }


    getModelConfigsInfo() {
        const modelService = new ModelConfigService(this.env);
        return modelService.getModelConfigsInfo(this.state.metadata.userId);
    }

    getTotalFiles(): number {
        return this.fileManager.getGeneratedFilePaths().length
    }

    getSummary(): Promise<AgentSummary> {
        const summaryData = {
            query: this.state.query,
            generatedCode: this.fileManager.getGeneratedFiles(),
        };
        return Promise.resolve(summaryData);
    }

    async getFullState(): Promise<TState> {
        return this.state;
    }
    
    migrateStateIfNeeded(): void {
        // no-op, only older phasic agents need this, for now.
    }

    getFileGenerated(filePath: string) {
        return this.fileManager!.getGeneratedFile(filePath) || null;
    }

    async fetchRuntimeErrors(clear: boolean = true, shouldWait: boolean = true): Promise<RuntimeError[]> {
        if (shouldWait) {
            await this.deploymentManager.waitForPreview();
        }

        try {
            const errors = await this.deploymentManager.fetchRuntimeErrors(clear);
            
            if (errors.length > 0) {
                this.broadcast(WebSocketMessageResponses.RUNTIME_ERROR_FOUND, {
                    errors,
                    message: "Runtime errors found",
                    count: errors.length
                });
            }

            return errors;
        } catch (error) {
            this.logger.error("Exception fetching runtime errors:", error);
            // If fetch fails, initiate redeploy
            this.deployToSandbox();
            const message = "<runtime errors not available at the moment as preview is not deployed>";
            return [{ message, timestamp: new Date().toISOString(), level: 0, rawOutput: message }];
        }
    }

    /**
     * Perform static code analysis on the generated files
     * This helps catch potential issues early in the development process
     */
    async runStaticAnalysisCode(files?: string[]): Promise<StaticAnalysisResponse> {
        try {
            // Only use cache for full (unscoped) analysis
            if (!files && this.staticAnalysisCache) {
                return this.staticAnalysisCache;
            }

            // Use in-memory analysis for browser-rendered projects (no sandbox)
            const templateDetails = this.getTemplateDetails();
            let analysisResponse: StaticAnalysisResponse;

            if (templateDetails?.renderMode === 'browser') {
                analysisResponse = await this.runInMemoryAnalysis(files);
            } else {
                analysisResponse = await this.deploymentManager.runStaticAnalysis(files);

                // Self-heal missing npm packages BEFORE the result reaches the LLM.
                // A TS2307 "Cannot find module" for an external package can never be
                // fixed by regenerating the file (re-importing does nothing) — the
                // agent would otherwise burn repeated regenerate_file attempts and
                // sometimes give up. Install the package deterministically and strip
                // the now-resolved issue so the model never sees it as a fix target.
                const installed = await this.installMissingExternalModules(analysisResponse.typecheck.issues);
                if (installed.length > 0) {
                    analysisResponse = {
                        ...analysisResponse,
                        typecheck: {
                            ...analysisResponse.typecheck,
                            issues: this.stripInstalledModuleIssues(analysisResponse.typecheck.issues, installed),
                        },
                    };
                    this.pendingMissingModuleRedeploy = true;
                }
            }

            // Only cache full (unscoped) analysis results
            if (!files) {
                this.staticAnalysisCache = analysisResponse;
            }

            const { lint, typecheck } = analysisResponse;
            this.broadcast(WebSocketMessageResponses.STATIC_ANALYSIS_RESULTS, {
                lint: { issues: lint.issues, summary: lint.summary },
                typecheck: { issues: typecheck.issues, summary: typecheck.summary }
            });

            return analysisResponse;
        } catch (error) {
            this.broadcastError("Failed to lint code", error);
            return { success: false, lint: { issues: [], }, typecheck: { issues: [], } };
        }
    }

    /**
     * Run in-memory static analysis for browser-rendered projects
     * Performs static analysis directly in the worker without using the sandbox
     */
    private async runInMemoryAnalysis(filePaths?: string[]): Promise<StaticAnalysisResponse> {
        const allFiles = this.fileManager.getAllFiles();
        const filePathSet = filePaths ? new Set(filePaths) : null;
        const filesToAnalyze = filePathSet
            ? allFiles.filter((f) => filePathSet.has(f.filePath))
            : allFiles;

        const fileInputs = filesToAnalyze.map((f) => ({
            path: f.filePath,
            content: f.fileContents,
        }));

        const analyzer = new InMemoryAnalyzer();
        return analyzer.analyze(fileInputs);
    }

    /**
     * Extract the module specifier from a "Cannot find module" (TS2307) issue.
     * Returns null for any other issue.
     */
    private parseMissingModuleSpecifier(issue: CodeIssue): string | null {
        const isModuleNotFound = issue.ruleId === 'TS2307' || /Cannot find module/i.test(issue.message);
        if (!isModuleNotFound) {
            return null;
        }
        const match = issue.message.match(/Cannot find module ['"](.+?)['"]/);
        return match?.[1]?.trim() || null;
    }

    /**
     * Reduce a module specifier to the installable npm package name
     * (e.g. "date-fns/locale" -> "date-fns", "@scope/pkg/sub" -> "@scope/pkg").
     */
    private getInstallablePackageName(specifier: string): string {
        const segments = specifier.split('/');
        return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
    }

    /**
     * Pinned versions for packages whose latest release breaks the Expo/Metro
     * web stack. nanoid v5 is ESM/exports-only and ships no `non-secure/package.json`,
     * so expo-router's static (SSR) render throws `ENOENT … non-secure/package.json`
     * — v3 is CJS, ships that file, and is the React-Native-standard. Add sparingly.
     */
    private static readonly PINNED_PACKAGE_VERSIONS: Record<string, string> = {
        nanoid: '3',
    };

    /**
     * The `bun add` spec for a package, applying any pinned version
     * (e.g. "nanoid" -> "nanoid@3"). Bare name otherwise.
     */
    private getInstallSpec(pkg: string): string {
        const pinned = BaseCodingBehavior.PINNED_PACKAGE_VERSIONS[pkg];
        return pinned ? `${pkg}@${pinned}` : pkg;
    }

    /**
     * Whether a `bun add` for this package has already been attempted, matching
     * both bare (`bun add nanoid`) and versioned (`bun add nanoid@3`) history
     * entries so a pinned install isn't retried every turn.
     */
    private installAlreadyAttempted(pkg: string): boolean {
        const history = this.state.commandsHistory ?? [];
        return history.some(cmd => cmd === `bun add ${pkg}` || cmd.startsWith(`bun add ${pkg}@`));
    }

    /**
     * Collect installable npm package names from TS2307 issues for external
     * (non-local) modules, skipping internal aliases and runtime builtins.
     */
    private extractMissingExternalPackages(typeCheckIssues: CodeIssue[]): string[] {
        const packages = new Set<string>();
        for (const issue of typeCheckIssues) {
            const specifier = this.parseMissingModuleSpecifier(issue);
            if (!specifier || !isExternalModule(specifier)) {
                continue;
            }
            const pkg = this.getInstallablePackageName(specifier);
            if (!pkg || !isValidNpmPackageName(pkg) || pkg.startsWith('@shared') || pkg.startsWith('node:') || pkg.startsWith('bun:') || pkg.includes('cloudflare:')) {
                continue;
            }
            packages.add(pkg);
        }
        return [...packages];
    }

    /**
     * Install npm packages referenced by unresolved TS2307 imports that are
     * external (npm) modules. Packages already attempted (present in
     * commandsHistory) are skipped so a failing install never loops. This runs
     * before the LLM is asked to fix the issue, so the agent never wastes
     * regenerate_file attempts on a missing package it cannot fix by editing code.
     * Returns the package names that were installed this call.
     */
    protected async installMissingExternalModules(typeCheckIssues: CodeIssue[]): Promise<string[]> {
        const packages = this.extractMissingExternalPackages(typeCheckIssues);
        if (packages.length === 0) {
            return [];
        }
        const toInstall = packages.filter(pkg => !this.installAlreadyAttempted(pkg));
        if (toInstall.length === 0) {
            return [];
        }
        // executeCommands persists only SUCCESSFUL commands to commandsHistory, so the
        // install replays on redeploy / fresh sandbox and the dedup above holds.
        // Apply pinned versions (e.g. nanoid@3) for Metro-incompatible latest releases.
        await this.executeCommands(toInstall.map(pkg => `bun add ${this.getInstallSpec(pkg)}`), false);

        // Treat only packages that actually landed in commandsHistory as installed —
        // a failed `bun add` must stay visible to the LLM and be retried next turn,
        // not silently stripped while the preview is still broken.
        const installed = toInstall.filter(pkg => this.installAlreadyAttempted(pkg));
        if (installed.length > 0) {
            this.logger.info(`Auto-installed missing external packages: ${installed.join(', ')}`);
        }
        return installed;
    }

    /**
     * Names of packages already present in the project's package.json
     * (dependencies + devDependencies), reduced to installable package names.
     * Used to avoid reinstalling deps the template already ships.
     */
    private getInstalledPackageNames(): Set<string> {
        const names = new Set<string>();
        const raw = this.state.lastPackageJson;
        if (!raw) {
            return names;
        }
        try {
            const pkg = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
            for (const dep of [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]) {
                names.add(this.getInstallablePackageName(dep));
            }
        } catch {
            // Malformed package.json — treat as no known deps; install logic dedups
            // against commandsHistory regardless, so this can't cause an install loop.
        }
        return names;
    }

    /**
     * Install the external npm frameworks a freshly-generated blueprint declares
     * (e.g. date-fns, nanoid), up front — before the agent writes code that
     * imports them. The blueprint already names these, so installing them
     * deterministically removes the dependence on post-hoc TS2307 analysis, which
     * a parse error elsewhere in the file can mask (leaving Metro stuck on
     * "Unable to resolve module"). Skips packages already in package.json and any
     * already attempted (commandsHistory), so it never loops. Agentic flow only.
     */
    protected async installBlueprintFrameworks(frameworks: string[] | undefined): Promise<void> {
        if (!frameworks || frameworks.length === 0 || !this.state.sandboxInstanceId) {
            return;
        }
        const alreadyInstalled = this.getInstalledPackageNames();
        const packages = new Set<string>();
        for (const framework of frameworks) {
            const specifier = framework?.trim();
            if (!specifier || !isExternalModule(specifier)) {
                continue;
            }
            const pkg = this.getInstallablePackageName(specifier);
            if (!pkg || !isValidNpmPackageName(pkg) || pkg.startsWith('@shared') || pkg.startsWith('node:') || pkg.startsWith('bun:') || pkg.includes('cloudflare:')) {
                continue;
            }
            if (alreadyInstalled.has(pkg) || this.installAlreadyAttempted(pkg)) {
                continue;
            }
            packages.add(pkg);
        }
        if (packages.size === 0) {
            return;
        }
        this.logger.info(`Pre-installing blueprint frameworks: ${[...packages].join(', ')}`);
        // bun add hits the live sandbox node_modules directly and persists to
        // commandsHistory, so a later sandbox recycle replays it on redeploy. The
        // next bundle request re-resolves node_modules, so no forced redeploy here.
        // Apply pinned versions (e.g. nanoid@3) for Metro-incompatible latest releases.
        await this.executeCommands([...packages].map(pkg => `bun add ${this.getInstallSpec(pkg)}`), false);
    }

    /**
     * Drop TS2307 issues whose package we just installed, so they aren't surfaced
     * to the LLM (or re-fixed) within the same analysis result.
     */
    private stripInstalledModuleIssues(issues: CodeIssue[], installedPackages: string[]): CodeIssue[] {
        const installed = new Set(installedPackages);
        return issues.filter(issue => {
            const specifier = this.parseMissingModuleSpecifier(issue);
            if (!specifier) {
                return true;
            }
            return !installed.has(this.getInstallablePackageName(specifier));
        });
    }

    /**
     * Resolve a LOCAL import specifier to the project-relative path (no extension)
     * where the missing module should live. `@/foo` and `src/foo` map to `src/foo`
     * (the modern layout the agent uses; the template's multi-target `@/*` alias
     * resolves both root and src/). Relative imports normalise against the importing
     * file's directory. Returns null for any non-local / unrecognised form.
     */
    private resolveLocalModulePath(specifier: string, importerPath: string): string | null {
        let base: string;
        if (specifier.startsWith('@/')) {
            base = `src/${specifier.slice(2)}`;
        } else if (specifier.startsWith('src/')) {
            base = specifier;
        } else if (specifier.startsWith('./') || specifier.startsWith('../')) {
            const dirParts = importerPath.split('/').slice(0, -1);
            const normalized: string[] = [];
            for (const part of [...dirParts, ...specifier.split('/')]) {
                if (part === '..') {
                    normalized.pop();
                } else if (part !== '.' && part !== '') {
                    normalized.push(part);
                }
            }
            base = normalized.join('/');
        } else {
            return null;
        }
        return base.replace(/\.(ts|tsx|js|jsx)$/, '');
    }

    /**
     * Whether a generated file already satisfies an extension-less module path,
     * either directly (`base.ts`) or as a directory index (`base/index.ts`).
     */
    private localModuleExists(basePath: string): boolean {
        const candidates = new Set<string>();
        for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
            candidates.add(basePath + ext);
            candidates.add(`${basePath}/index${ext}`);
        }
        return this.fileManager.getAllFiles().some(f => candidates.has(f.filePath));
    }

    /**
     * Best-effort extension for a module we're about to create: `.tsx` when the
     * path looks like a React component (a component/screen dir or a PascalCase
     * basename), `.ts` otherwise. Both resolve via Metro/tsc, so a wrong guess
     * only affects whether JSX is allowed — never whether the import resolves.
     */
    private inferModuleExtension(basePath: string): string {
        const basename = basePath.split('/').pop() || '';
        const inComponentDir = /(^|\/)(components|screens|pages|views|layouts)\//.test(basePath);
        const isPascalCase = /^[A-Z]/.test(basename);
        return inComponentDir || isPascalCase ? '.tsx' : '.ts';
    }

    /**
     * Generate LOCAL modules that are imported but were never created.
     *
     * The agentic builder sometimes writes a file importing a relative/`@/` module
     * (e.g. `app/index.tsx` importing `@/store/habitStore`) and then never creates
     * that module. A "Cannot find module" for a LOCAL path can never be fixed by
     * editing the importer — re-importing does nothing — so the file/realtime fixer
     * loops on the importer forever (the "going in circles" symptom). Detect those
     * absent local modules and generate them from how the importing files use them,
     * breaking the loop at its source.
     *
     * Agentic flow only: the phasic/website flow is structured and doesn't hit this,
     * and Chris's constraint is to leave it untouched. Strictly additive — it only
     * creates imported-but-absent files, so it can't degrade a working build.
     * Returns true if any module was generated (the caller should re-analyse).
     */
    protected async generateMissingLocalModules(typeCheckIssues: CodeIssue[]): Promise<boolean> {
        if (this.state.behaviorType !== 'agentic') {
            return false;
        }
        // target module path -> importing files that reference it (usage context)
        const missing = new Map<string, Set<string>>();
        for (const issue of typeCheckIssues) {
            const specifier = this.parseMissingModuleSpecifier(issue);
            if (!specifier || isExternalModule(specifier)) {
                continue;
            }
            const basePath = this.resolveLocalModulePath(specifier, issue.filePath);
            if (!basePath || this.localModuleExists(basePath)) {
                continue;
            }
            const targetPath = basePath + this.inferModuleExtension(basePath);
            if (this.attemptedLocalModuleGeneration.has(targetPath)) {
                continue;
            }
            if (!missing.has(targetPath)) {
                missing.set(targetPath, new Set());
            }
            if (issue.filePath) {
                missing.get(targetPath)!.add(issue.filePath);
            }
        }
        if (missing.size === 0) {
            return false;
        }

        const allFiles = this.fileManager.getAllFiles();
        const fileConcepts: FileConceptType[] = [];
        const requirements: string[] = [];
        for (const [targetPath, importerSet] of missing) {
            this.attemptedLocalModuleGeneration.add(targetPath);
            const importers = [...importerSet];
            fileConcepts.push({
                path: targetPath,
                purpose: `Module imported by ${importers.join(', ') || 'the app'} but never created. Implement it so those imports resolve.`,
                changes: null,
            });
            for (const importer of importers) {
                const file = allFiles.find(f => f.filePath === importer);
                if (file) {
                    requirements.push(
                        `'${targetPath}' is imported by '${importer}'. Infer its exact exports (named vs default), TypeScript types, and runtime behaviour from how '${importer}' uses it — every imported symbol must exist with a matching signature. Importing file contents:\n\`\`\`tsx\n${file.fileContents}\n\`\`\``
                    );
                }
            }
        }
        this.logger.info(`Generating ${missing.size} missing local module(s): ${[...missing.keys()].join(', ')}`);
        await this.generateFiles(
            'Create missing imported modules',
            'Create local modules that existing files import but that were never generated, so the build resolves and the importer stops failing.',
            requirements,
            fileConcepts,
        );
        // generateFiles deploys new files; the cached analysis is now stale.
        this.staticAnalysisCache = null;
        return true;
    }

    /**
     * Redeploy once if external packages were auto-installed during this turn so
     * the running dev server / Metro bundler resolves them. Idempotent.
     */
    private async flushPendingMissingModuleRedeploy(): Promise<void> {
        if (!this.pendingMissingModuleRedeploy) {
            return;
        }
        this.pendingMissingModuleRedeploy = false;
        await this.deployToSandbox([], true, "chore: install missing dependencies");
        this.logger.info("Redeployed sandbox after installing missing modules");
    }

    /**
     * Expo only: after a turn creates NEW files, restart Metro with its cache cleared.
     *
     * The sandbox has no Watchman, so Metro misses files created in new directories
     * (e.g. a freshly generated `src/hooks/` tree) and caches "Unable to resolve
     * module" for them — a page reload re-bundles from that stale resolver state, so
     * the preview keeps showing the template even though the files are on disk and
     * tsc resolves them fine. `expo start --clear` rebuilds Metro's haste/transform
     * cache so the new modules resolve. Gated to expo-app and to turns that actually
     * created new files (edits to existing files are picked up by HMR and don't need
     * a restart). Best-effort: the sandbox call swallows its own failures.
     */
    protected async restartExpoServerForNewModules(createdNewFiles: boolean): Promise<void> {
        if (!createdNewFiles || !isExpoTemplate(this.getTemplateDetails()?.name)) {
            return;
        }
        const instanceId = this.state.sandboxInstanceId;
        if (!instanceId) {
            return;
        }
        // `bun run dev` is the exact command createInstance launches; appending
        // `--clear` after `--` forwards it to that known-good `expo start` invocation
        // (which binds ${PORT} on the allocated port, so the preview URL is unchanged).
        this.logger.info('Restarting Expo dev server with cleared Metro cache (new modules created this turn)', { instanceId });
        await this.getSandboxServiceClient().restartDevServer(instanceId, 'bun run dev -- --clear');
    }

    /**
     * Apply deterministic code fixes for common TypeScript errors
     */
    protected async applyDeterministicCodeFixes() : Promise<StaticAnalysisResponse | undefined> {
        try {
            // Get static analysis and do deterministic fixes. runStaticAnalysisCode()
            // already auto-installs missing external packages (TS2307) and strips them
            // from the result, so the issues below are the genuinely code-fixable ones.
            let staticAnalysis = await this.runStaticAnalysisCode();

            // Heal missing LOCAL imports (agentic flow): generate any relative/@/ module
            // that is imported but was never created. Editing the importer can never fix
            // a missing local dependency, so without this the fixer loops on it forever.
            // Re-analyse afterwards: the generated module resolves the import and may
            // surface its own (now code-fixable) issues.
            if (await this.generateMissingLocalModules(staticAnalysis.typecheck.issues)) {
                staticAnalysis = await this.runStaticAnalysisCode();
            }

            if (staticAnalysis.typecheck.issues.length == 0) {
                // Packages may still have been installed (here or in the agent's tool
                // loop) — make sure the preview picks them up before returning.
                await this.flushPendingMissingModuleRedeploy();
                this.logger.info("No typecheck issues found, skipping deterministic fixes");
                return staticAnalysis;  // So that static analysis is not repeated again
            }
            const typeCheckIssues = staticAnalysis.typecheck.issues;
            this.broadcast(WebSocketMessageResponses.DETERMINISTIC_CODE_FIX_STARTED, {
                message: `Attempting to fix ${typeCheckIssues.length} TypeScript issues using deterministic code fixer`,
                issues: typeCheckIssues
            });

            this.logger.info(`Attempting to fix ${typeCheckIssues.length} TypeScript issues using deterministic code fixer`);
            const allFiles = this.fileManager.getAllFiles();

            const fixResult = fixProjectIssues(
                allFiles.map(file => ({
                    filePath: file.filePath,
                    fileContents: file.fileContents,
                    filePurpose: ''
                })),
                typeCheckIssues
            );

            this.broadcast(WebSocketMessageResponses.DETERMINISTIC_CODE_FIX_COMPLETED, {
                message: `Fixed ${typeCheckIssues.length} TypeScript issues using deterministic code fixer`,
                issues: typeCheckIssues,
                fixResult
            });

            if (fixResult) {
                // Belt-and-suspenders: install any external packages the analysis
                // pre-pass didn't already handle (e.g. TS2307s surfaced only here).
                const installed = await this.installMissingExternalModules(typeCheckIssues);
                if (installed.length > 0) {
                    this.pendingMissingModuleRedeploy = true;
                }

                if (fixResult.modifiedFiles.length > 0) {
                        this.logger.info("Applying deterministic fixes to files, Fixes: ", JSON.stringify(fixResult, null, 2));
                        const fixedFiles = fixResult.modifiedFiles.map(file => ({
                            filePath: file.filePath,
                            filePurpose: allFiles.find(f => f.filePath === file.filePath)?.filePurpose || '',
                            fileContents: file.fileContents
                    }));
                    await this.fileManager.saveGeneratedFiles(fixedFiles, "fix: applied deterministic fixes");

                    await this.deployToSandbox(fixedFiles, false, "fix: applied deterministic fixes");
                    this.logger.info("Deployed deterministic fixes to sandbox");
                    // The file deploy already refreshes the sandbox with the newly
                    // installed packages, so a separate module-only redeploy is moot.
                    this.pendingMissingModuleRedeploy = false;
                } else {
                    // No file fixes to deploy — redeploy on its own so the dev server
                    // picks up the freshly installed packages.
                    await this.flushPendingMissingModuleRedeploy();
                }
            }
            this.logger.info(`Applied deterministic code fixes: ${JSON.stringify(fixResult, null, 2)}`);
        } catch (error) {
            this.broadcastError('Deterministic code fixer failed', error);
        }
        // return undefined;
    }

    async fetchAllIssues(resetIssues: boolean = false): Promise<AllIssues> {
        const templateDetails = this.getTemplateDetails();
        const isBrowserOnly = templateDetails?.renderMode === 'browser';

        // For browser-rendered projects (no sandbox), only run static analysis
        if (isBrowserOnly) {
            const staticAnalysis = await this.runStaticAnalysisCode();
            this.logger.info("Fetched issues (browser-rendered):", JSON.stringify({ runtimeErrors: [], staticAnalysis }));
            return { runtimeErrors: [], staticAnalysis };
        }
        if (!await this.waitForSandboxReady()) {
            return { runtimeErrors: [], staticAnalysis: { success: false, lint: { issues: [] }, typecheck: { issues: [] } } };
        }
        const [runtimeErrors, staticAnalysis] = await Promise.all([
            this.fetchRuntimeErrors(resetIssues),
            this.runStaticAnalysisCode()
        ]);
        this.logger.info("Fetched all issues:", JSON.stringify({ runtimeErrors, staticAnalysis }));
        
        return { runtimeErrors, staticAnalysis };
    }

    async updateProjectName(newName: string): Promise<boolean> {
        try {
            const valid = /^[a-z0-9-_]{3,50}$/.test(newName);
            if (!valid) return false;
            const updatedBlueprint = { ...this.state.blueprint, projectName: newName };
            this.setState({
                ...this.state,
                blueprint: updatedBlueprint
            });
            let ok = true;
            if (this.state.sandboxInstanceId) {
                try {
                    ok = await this.getSandboxServiceClient().updateProjectName(this.state.sandboxInstanceId, newName);
                } catch (_) {
                    ok = false;
                }
            }
            try {
                const appService = new AppService(this.env);
                const dbOk = await appService.updateApp(this.getAgentId(), { title: newName });
                ok = ok && dbOk;
            } catch (error) {
                this.logger.error('Error updating project name in database:', error);
                ok = false;
            }
            this.broadcast(WebSocketMessageResponses.PROJECT_NAME_UPDATED, {
                message: 'Project name updated',
                projectName: newName
            });
            return ok;
        } catch (error) {
            this.logger.error('Error updating project name:', error);
            return false;
        }
    }

    /**
     * Update user-facing blueprint fields
     * Only allows updating safe, cosmetic fields - not internal generation state
     */
    async updateBlueprint(patch: Partial<Blueprint>): Promise<Blueprint> {
        // Fields that are safe to update after generation starts
        // Excludes: initialPhase (breaks phasic generation)
        const safeUpdatableFields = new Set([
            'title',
            'description',
            'detailedDescription',
            'colorPalette',
            'views',
            'userFlow',
            'dataFlow',
            'architecture',
            'pitfalls',
            'frameworks',
            'implementationRoadmap'
        ]);

        // Filter to only safe fields
        const filtered: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(patch)) {
            if (safeUpdatableFields.has(key) && value !== undefined) {
                filtered[key] = value;
            }
        }

        // Agentic: allow initializing plan if not set yet (first-time plan initialization only)
        if (this.isAgenticState(this.state)) {
            const currentPlan = this.state.blueprint?.plan;
            const patchPlan = 'plan' in patch ? patch.plan : undefined;
            if (Array.isArray(patchPlan) && (!Array.isArray(currentPlan) || currentPlan.length === 0)) {
                filtered['plan'] = patchPlan;
            }
        }

        // projectName requires sandbox update, handle separately
        if ('projectName' in patch && typeof patch.projectName === 'string') {
            await this.updateProjectName(patch.projectName);
        }

        // Merge and update state
        const updated = { ...this.state.blueprint, ...filtered } as Blueprint;
        this.setState({
            ...this.state,
            blueprint: updated
        });
        
        this.broadcast(WebSocketMessageResponses.BLUEPRINT_UPDATED, {
            message: 'Blueprint updated',
            updatedKeys: Object.keys(filtered)
        });
        
        return updated;
    }

    // ===== Debugging helpers for assistants =====
    listFiles(): FileOutputType[] {
        return this.fileManager.getAllRelevantFiles();
    }

    async readFiles(paths: string[]): Promise<{ files: { path: string; content: string }[] }> {
        const results: { path: string; content: string }[] = [];
        const notFoundInFileManager: string[] = [];

        // First, try to read from FileManager (template + generated files)
        for (const path of paths) {
            const file = this.fileManager.getFile(path);
            if (file) {
                results.push({ path, content: file.fileContents });
            } else {
                notFoundInFileManager.push(path);
            }
        }

        // If some files not found in FileManager and sandbox exists, try sandbox
        if (notFoundInFileManager.length > 0 && this.state.sandboxInstanceId) {
            const resp = await this.getSandboxServiceClient().getFiles(
                this.state.sandboxInstanceId,
                notFoundInFileManager
            );
            if (resp.success) {
                results.push(...resp.files.map(f => ({
                    path: f.filePath,
                    content: f.fileContents
                })));
            }
        }

        return { files: results };
    }

    async execCommands(commands: string[], shouldSave: boolean, timeout?: number): Promise<ExecuteCommandsResponse> {
        const { sandboxInstanceId } = this.state;
        if (!sandboxInstanceId) {
            return { success: false, results: [], error: 'No sandbox instance' };
        }
        const result = await this.getSandboxServiceClient().executeCommands(sandboxInstanceId, commands, timeout);
        if (shouldSave) {
            this.saveExecutedCommands(commands);
        }
        return result;
    }

    updateSlideManifest(file: FileOutputType) {
        // If the project type is presentation and this is a slide file, update the manifest
        if (this.projectType === 'presentation') {
            const templateDetails = this.getTemplateDetails()
            if (!templateDetails) {
                return;
            }
            const slidesDirectory = templateDetails.slideDirectory ?? '/public/slides';
            if (file.filePath.startsWith(slidesDirectory) && file.filePath.endsWith('.json')) {
                const manifestPath = `${slidesDirectory}/manifest.json`
                const existingManifest = this.fileManager.getFile(manifestPath)
                
                // Parse existing manifest or create new one
                let manifestData: { slides: string[] } = { slides: [] };
                if (existingManifest) {
                    try {
                        const parsed = JSON.parse(existingManifest.fileContents);
                        manifestData = {
                            slides: Array.isArray(parsed.slides) ? parsed.slides : []
                        };
                    } catch (error) {
                        this.logger.error('Failed to parse existing manifest.json', error);
                        manifestData = { slides: [] };
                    }
                } else {
                    manifestData = { slides: [] };
                }
                
                // Add slide path to slides array if not already present
                const relativeSlidePath = file.filePath.replace(slidesDirectory + '/', '');
                if (!manifestData.slides.includes(relativeSlidePath)) {
                    manifestData.slides.push(relativeSlidePath);
                    
                    // Save updated manifest
                    const updatedManifest: FileOutputType = {
                        filePath: manifestPath,
                        fileContents: JSON.stringify(manifestData, null, 2),
                        filePurpose: 'Presentation slides manifest'
                    };
                    this.fileManager.recordFileChanges([updatedManifest]);
                    
                    this.logger.info('Updated manifest.json with new slide', {
                        slidePath: relativeSlidePath,
                        totalSlides: manifestData.slides.length
                    });
                }
            }
        }
    }

    /**
     * Regenerate a file to fix identified issues
     * Retries up to 3 times before giving up
     */
    async regenerateFile(file: FileOutputType, issues: string[], retryIndex: number = 0) {
        this.broadcast(WebSocketMessageResponses.FILE_REGENERATING, {
            message: `Regenerating file: ${file.filePath}`,
            filePath: file.filePath,
            original_issues: issues,
        });
        
        const result = await this.operations.regenerateFile.execute(
            {file, issues, retryIndex},
            this.getOperationOptions()
        );

        this.updateSlideManifest(result);
        const fileState = await this.fileManager.saveGeneratedFile(result);

        this.broadcast(WebSocketMessageResponses.FILE_REGENERATED, {
            message: `Regenerated file: ${file.filePath}`,
            file: fileState,
            original_issues: issues,
        });
        
        return fileState;
    }

    async regenerateFileByPath(path: string, issues: string[]): Promise<{ path: string; diff: string }> {
        this.getTemplateDetails(); // ensure cache is loaded
        if (this.getEffectiveDontTouchFiles().has(path)) {
            return {
                path,
                diff: '<WRITE PROTECTED - TEMPLATE FILE, CANNOT MODIFY - SKIPPED - NO CHANGES MADE>'
            };
        }
        // Prefer local file manager; fallback to sandbox
        let fileContents = '';
        let filePurpose = '';
        try {
            const fmFile = this.fileManager.getFile(path);
            if (fmFile) {
                fileContents = fmFile.fileContents;
                filePurpose = fmFile.filePurpose || '';
            } else {
                const { sandboxInstanceId } = this.state;
                if (!sandboxInstanceId) {
                    throw new Error('No sandbox instance available');
                }
                const resp = await this.getSandboxServiceClient().getFiles(sandboxInstanceId, [path]);
                const f = resp.success ? resp.files.find(f => f.filePath === path) : undefined;
                if (!f) throw new Error(resp.error || `File not found: ${path}`);
                fileContents = f.fileContents;
            }
        } catch (e) {
            throw new Error(`Failed to read file for regeneration: ${String(e)}`);
        }

        const regenerated = await this.regenerateFile({ filePath: path, fileContents, filePurpose }, issues, 0);
        // Invalidate cache
        this.staticAnalysisCache = null;
        // Route through the public deployToSandbox so browser-mode templates
        // are handled correctly and DEPLOYMENT_* events are broadcast.
        await this.deployToSandbox([regenerated]);
        return { path, diff: regenerated.lastDiff };
    }

    async regenerateImage(slot: string, description: string, quality: 'standard' | 'premium' = 'standard'): Promise<{ url: string }> {
        const agentId = this.getAgentId();
        if (!agentId || agentId === 'undefined') {
            throw new Error('Agent is not fully initialized yet — please wait a moment and try again');
        }
        // Credit deduction for single-image regen: Flux=2, SDXL=5.
        const cost = quality === 'premium' ? 5 : 2;
        await RateLimitService.deductCredits(this.env, this.state.metadata.userId, cost, quality === 'premium' ? 'premium image regeneration' : 'image regeneration');
        const prompt = description;
        const url = await regenerateTradeImage(this.env, agentId, slot, prompt, quality);
        const updatedUrls = { ...(this.state.generatedImageUrls || {}), [slot]: url };
        this.setState({ ...this.state, generatedImageUrls: updatedUrls });
        this.broadcast(WebSocketMessageResponses.IMAGES_GENERATED, { images: updatedUrls });
        this.broadcast(WebSocketMessageResponses.PREVIEW_FORCE_REFRESH, {});
        return { url };
    }

    getGeneratedImageUrls(): Record<string, string> {
        return this.state.generatedImageUrls || {};
    }

    async deleteGeneratedImageSlot(slot: string): Promise<void> {
        const urls = { ...(this.state.generatedImageUrls || {}) };
        delete urls[slot];
        this.setState({ ...this.state, generatedImageUrls: urls });
    }

    async generateFiles(
        phaseName: string,
        phaseDescription: string,
        requirements: string[],
        files: FileConceptType[]
    ): Promise<{ files: Array<{ path: string; purpose: string; diff: string }> }> {
        this.logger.info('Generating files for deep debugger', {
            phaseName,
            requirementsCount: requirements.length,
            filesCount: files.length
        });
        
        // Broadcast file generation started
        this.broadcast(WebSocketMessageResponses.PHASE_IMPLEMENTING, {
            message: `Generating files: ${phaseName}`,
            phaseName
        });

        const skippedFiles: { path: string; purpose: string; diff: string }[] = [];

        // Enforce template donttouch constraints (declared + implicit Vite-entry protection)
        this.getTemplateDetails(); // ensure cache is loaded
        const dontTouchFiles = this.getEffectiveDontTouchFiles();
        files = files.filter(file => {
            if (dontTouchFiles.has(file.path)) {
                this.logger.info('Skipping dont-touch file', { filePath: file.path });
                skippedFiles.push({ path: file.path, purpose: `WRITE-PROTECTED FILE, CANNOT MODIFY`, diff: "<WRITE PROTECTED - TEMPLATE FILE, CANNOT MODIFY - SKIPPED - NO CHANGES MADE>" });
                return false;
            }
            return true;
        });

        const savedFiles: FileState[] = [];

        const operation = new SimpleCodeGenerationOperation();
        const result = await operation.execute(
            {
                phaseName,
                phaseDescription,
                requirements,
                files,
                fileGeneratingCallback: (filePath: string, filePurpose: string) => {
                    this.broadcast(WebSocketMessageResponses.FILE_GENERATING, {
                        message: `Generating file: ${filePath}`,
                        filePath,
                        filePurpose
                    });
                },
                fileChunkGeneratedCallback: (filePath: string, chunk: string, format: 'full_content' | 'unified_diff') => {
                    this.broadcast(WebSocketMessageResponses.FILE_CHUNK_GENERATED, {
                        message: `Generating file: ${filePath}`,
                        filePath,
                        chunk,
                        format
                    });
                },
                fileClosedCallback: (file, message) => {
                    // Record file to state (sync)
                    const saved = this.fileManager.recordFileChanges([file]);
                    savedFiles.push(...saved);
                    this.updateSlideManifest(file);
                    this.broadcast(WebSocketMessageResponses.FILE_GENERATED, {
                        message,
                        file
                    });
                }
            },
            this.getOperationOptions()
        );

        await this.fileManager.saveGeneratedFiles(
            [],
            `feat: ${phaseName}\n\n${phaseDescription}`
        );

        this.logger.info('Files generated and saved', {
            fileCount: result.files.length
        });

        await this.deployToSandbox(savedFiles, false);

        return { 
            files: [
                ...skippedFiles,
                ...savedFiles.map(f => {
                    return {
                        path: f.filePath,
                        purpose: f.filePurpose || '',
                        diff: f.lastDiff || ''
                    };
                }) 
            ]
        };
    }

    /**
     * Get or create file serving token (lazy generation)
     */
    private getOrCreateFileServingToken(): string {
        if (!this.state.fileServingToken) {
            const token = generatePortToken();
            this.setState({
                ...this.state,
                fileServingToken: {
                    token,
                    createdAt: Date.now()
                }
            });
        }
        return this.state.fileServingToken!.token;
    }

    /**
     * Get browser preview URL for file serving
     */
    public getBrowserPreviewURL(): string {
        const token = this.getOrCreateFileServingToken();
        const agentId = this.getAgentId();
        const previewDomain = isDev(this.env) ? 'localhost:5173' : getPreviewDomain(this.env);

        // Format: b-{agentid}-{token}.{previewDomain}
        return `${getProtocolForHost(previewDomain)}://b-${agentId}-${token}.${previewDomain}`;
    }

    // A wrapper for LLM tool to deploy to sandbox
    async deployPreview(clearLogs: boolean = true, forceRedeploy: boolean = false): Promise<string> {
        const response = await this.deployToSandbox([], forceRedeploy, undefined, clearLogs);
        if (response && response.previewURL) {
            this.broadcast(WebSocketMessageResponses.PREVIEW_FORCE_REFRESH, {});
            return `Deployment successful: ${response.previewURL}`;
        }
        return `Failed to deploy: ${response?.tunnelURL}`;
    }

    async deployToSandbox(files: FileOutputType[] = [], redeploy: boolean = false, commitMessage?: string, clearLogs: boolean = false): Promise<PreviewType | null> {
        // Only deploy if project is previewable
        if (!this.isPreviewable()) {
            throw new Error('Project is not previewable');
        }
        this.logger.info('[AGENT] Deploying to sandbox', { files: files.length, redeploy, commitMessage, renderMode: this.getTemplateDetails()?.renderMode, templateDetails: this.getTemplateDetails() });

        if (this.getTemplateDetails()?.renderMode === 'browser') {
            this.logger.info('Deploying to browser native sandbox');
            this.broadcast(WebSocketMessageResponses.DEPLOYMENT_STARTED, {});
            const result: PreviewType = {
                previewURL: this.getBrowserPreviewURL()
            }
            this.logger.info('Deployed to browser native sandbox');
            this.broadcast(WebSocketMessageResponses.DEPLOYMENT_COMPLETED, result);
            return result;
        }
            
        // Invalidate static analysis cache
        this.staticAnalysisCache = null;
        
        // Call deployment manager with callbacks for broadcasting at the right times
        const result = await this.deploymentManager.deployToSandbox(
            files,
            redeploy,
            commitMessage,
            clearLogs,
            {
                onStarted: (data) => {
                    this.broadcast(WebSocketMessageResponses.DEPLOYMENT_STARTED, data);
                },
                onCompleted: (data) => {
                    this.broadcast(WebSocketMessageResponses.DEPLOYMENT_COMPLETED, data);
                    // Native Expo Go: broadcast the exp:// tunnel URL so the QR encodes the
                    // native target. (The bundle is warmed by a DETACHED, non-blocking task in
                    // setupInstance — we must NOT run a blocking warm here on every deploy, it
                    // serialises with the sandbox session and stalls the next deploy.)
                    if (data.tunnelURL) {
                        this.broadcast(WebSocketMessageResponses.EXPO_TUNNEL_URL, { tunnelUrl: data.tunnelURL });
                    }
                },
                onError: (data) => {
                    this.broadcast(WebSocketMessageResponses.DEPLOYMENT_FAILED, data);
                },
                onAfterSetupCommands: async () => {
                    // Sync package.json after setup commands (includes dependency installs)
                    await this.syncPackageJsonFromSandbox();
                }
            }
        );

        this.resolveSandboxReady();

        // Expo/Metro (no Watchman in our container) does NOT detect files added in
        // NEW directories while the dev server is running, so expo-router's
        // require.context('./app') is never re-scanned and the bundle 500s with
        // "Unable to resolve module ./index" — the preview white-screens. The only
        // reliable remedy (Expo/Metro docs + issues #21665/#36511) is restarting
        // Metro with its cache cleared. Do it here, at the single deploy chokepoint,
        // so EVERY write path is covered (initial build, follow-up edits, regenerate,
        // retries) — not just the one post-generation spot that kept getting skipped.
        // Expo-only and only when a brand-new directory appeared; harmless no-op
        // otherwise. Best-effort: restartDevServer swallows its own failures.
        if (result && files.length > 0 && isExpoTemplate(this.getTemplateDetails()?.name)) {
            await this.restartMetroIfNewDirectories(files);
        }
        return result;
    }

    private parentDir(path: string): string {
        const i = path.lastIndexOf('/');
        return i < 0 ? '' : path.slice(0, i);
    }

    /**
     * Expo-only: if this deploy added a file in a directory that no previously
     * existing file occupies, restart Metro with `--clear`. Without Watchman, Metro
     * does not pick up newly created directories on a running server, so the new
     * routes never bundle until Metro re-crawls the filesystem on a cache-cleared
     * restart. New files in already-existing directories ARE detected, so we restart
     * only when a genuinely new directory appears (keeps restarts to a minimum).
     */
    private async restartMetroIfNewDirectories(deployedFiles: FileOutputType[]): Promise<void> {
        const instanceId = this.state.sandboxInstanceId;
        if (!instanceId) return;
        const deployedPaths = new Set(deployedFiles.map(f => f.filePath));
        const existingDirs = new Set<string>();
        for (const p of Object.keys(this.state.generatedFilesMap)) {
            if (deployedPaths.has(p)) continue;
            existingDirs.add(this.parentDir(p));
        }
        const newDirs = [...new Set(deployedFiles.map(f => this.parentDir(f.filePath)))]
            .filter(dir => dir && !existingDirs.has(dir));
        if (newDirs.length === 0) return;
        this.logger.info('Restarting Expo dev server (--clear): deploy introduced new directories Metro cannot hot-detect', { instanceId, newDirs });
        await this.getSandboxServiceClient().restartDevServer(instanceId, 'bun run dev -- --clear');
    }

    /**
     * Deploy the generated code to Cloudflare Workers
     */
    async deployToCloudflare(target: DeploymentTarget = 'platform'): Promise<{ deploymentUrl?: string; workersUrl?: string } | null> {
        try {
            const renderMode = this.getTemplateDetails()?.renderMode;
            const isBrowserMode = renderMode === 'browser';

            // Sandbox-mode deploys need a running sandbox first to build the
            // worker bundle. Browser-mode skips this — the deploymentManager
            // ships `public/` directly via a passthrough worker.
            if (!isBrowserMode && !this.state.sandboxInstanceId) {
                this.logger.info('No sandbox instance, deploying to sandbox first');
                await this.deployToSandbox();

                if (!this.state.sandboxInstanceId) {
                    this.logger.error('Failed to deploy to sandbox service');
                    this.broadcast(WebSocketMessageResponses.CLOUDFLARE_DEPLOYMENT_ERROR, {
                        message: 'Deployment failed: Failed to deploy to sandbox service',
                        error: 'Sandbox service unavailable'
                    });
                    return null;
                }
            }

            // Call service - handles orchestration, callbacks for broadcasting
            const result = await this.deploymentManager.deployToCloudflare({
                target,
                renderMode: isBrowserMode ? 'browser' : 'sandbox',
                callbacks: {
                    onStarted: (data) => {
                        this.broadcast(WebSocketMessageResponses.CLOUDFLARE_DEPLOYMENT_STARTED, data);
                    },
                    onCompleted: (data) => {
                        this.broadcast(WebSocketMessageResponses.CLOUDFLARE_DEPLOYMENT_COMPLETED, data);
                    },
                    onError: (data) => {
                        this.broadcast(WebSocketMessageResponses.CLOUDFLARE_DEPLOYMENT_ERROR, data);
                    },
                }
            });

            // Update database with deployment ID if successful
            if (result.deploymentUrl && result.deploymentId) {
                const appService = new AppService(this.env);
                await appService.updateDeploymentId(
                    this.getAgentId(),
                    result.deploymentId
                );
            }

            return result.deploymentUrl ? { deploymentUrl: result.deploymentUrl } : null;

        } catch (error) {
            this.logger.error('Cloudflare deployment error:', error);
            this.broadcast(WebSocketMessageResponses.CLOUDFLARE_DEPLOYMENT_ERROR, {
                message: 'Deployment failed',
                error: error instanceof Error ? error.message : String(error)
            });
            return null;
        }
    }

    async importTemplate(templateName: string): Promise<{ templateName: string; filesImported: number; files: TemplateFile[] }> {
        this.logger.info(`Importing template into project: ${templateName}`);

        if (this.state.templateName !== templateName) {
            // Get template catalog info to sync projectType
            const catalogResponse = await BaseSandboxService.listTemplates();
            const catalogInfo = catalogResponse.success 
                ? catalogResponse.templates.find(t => t.name === templateName)
                : null;
            
            // Update state with template name and projectType if available
            this.setState({
                ...this.state,
                templateName: templateName,
                ...(catalogInfo?.projectType ? { projectType: catalogInfo.projectType } : {}),
            });

            this.templateDetailsCache = null;   // Clear template details cache
        }
        const templateDetails = await this.ensureTemplateDetails();
        if (!templateDetails) {
            throw new Error(`Failed to get template details for: ${templateName}`);
        }

        this.setState({
            ...this.state,
            lastPackageJson: templateDetails.allFiles['package.json'] || this.state.lastPackageJson,
        });

        // Get important files for return value
        const importantFiles = getTemplateImportantFiles(templateDetails);

        // Ensure deployment to sandbox 
        await this.deployToSandbox();

        // Notify frontend about template metadata update
        this.broadcast(WebSocketMessageResponses.TEMPLATE_UPDATED, {
            templateDetails
        });

        return {
            templateName: templateDetails.name,
            filesImported: Object.keys(templateDetails.allFiles).length,
            files: importantFiles
        };
    }

    async waitForGeneration(): Promise<void> {
        if (this.generationPromise) {
            try {
                await this.generationPromise;
                this.logger.info("Code generation completed successfully");
            } catch (error) {
                this.logger.error("Error during code generation:", error);
            }
        } else {
            this.logger.error("No generation process found");
        }
    }

    isDeepDebugging(): boolean {
        return this.deepDebugPromise !== null;
    }
    
    getDeepDebugSessionState(): { conversationId: string } | null {
        if (this.deepDebugConversationId && this.deepDebugPromise) {
            return { conversationId: this.deepDebugConversationId };
        }
        return null;
    }

    async waitForDeepDebug(): Promise<void> {
        if (this.deepDebugPromise) {
            try {
                await this.deepDebugPromise;
                this.logger.info("Deep debug session completed successfully");
            } catch (error) {
                this.logger.error("Error during deep debug session:", error);
            } finally {
                // Clear promise after waiting completes
                this.deepDebugPromise = null;
            }
        }
    }

    protected async onProjectUpdate(message: string): Promise<void> {
        this.setState({
            ...this.state,
            projectUpdatesAccumulator: [...this.state.projectUpdatesAccumulator, message]
        });
    }

    protected async getAndResetProjectUpdates() {
        const projectUpdates = this.state.projectUpdatesAccumulator || [];
        this.setState({
            ...this.state,
            projectUpdatesAccumulator: []
        });
        return projectUpdates;
    }

    public broadcast<T extends WebSocketMessageType>(msg: T, data?: WebSocketMessageData<T>): void {
        if (this.operations.processUserMessage.isProjectUpdateType(msg)) {
            let message = msg as string;
            if (data && 'message' in data) {
                message = (data as { message: string }).message;
            }
            this.onProjectUpdate(message);
        }
        super.broadcast(msg, data);
    }

    protected getBootstrapCommands() {
        const bootstrapCommands = this.state.commandsHistory || [];
        // Validate, deduplicate, and clean
        const { validCommands } = validateAndCleanBootstrapCommands(bootstrapCommands);
        return validCommands;
    }

    protected async saveExecutedCommands(commands: string[]) {
        this.logger.info('Saving executed commands', { commands });
        
        // Merge with existing history
        const mergedCommands = [...(this.state.commandsHistory || []), ...commands];
        
        // Validate, deduplicate, and clean
        const { validCommands, invalidCommands, deduplicated } = validateAndCleanBootstrapCommands(mergedCommands);

        // Log what was filtered out
        if (invalidCommands.length > 0 || deduplicated > 0) {
            this.logger.warn('[commands] Bootstrap commands cleaned', { 
                invalidCommands,
                invalidCount: invalidCommands.length,
                deduplicatedCount: deduplicated,
                finalCount: validCommands.length
            });
        }

        // Update state with cleaned commands
        this.setState({
            ...this.state,
            commandsHistory: validCommands
        });

        // Update bootstrap script with validated commands
        await this.updateBootstrapScript(validCommands);

        // Sync package.json if any dependency-modifying commands were executed
        const hasDependencyCommands = commands.some(cmd => 
            cmd.includes('install') || 
            cmd.includes(' add ') || 
            cmd.includes('remove') ||
            cmd.includes('uninstall')
        );
        
        if (hasDependencyCommands) {
            this.logger.info('Dependency commands executed, syncing package.json from sandbox');
            await this.syncPackageJsonFromSandbox();
        }
    }

    /**
     * Execute commands with retry logic
     * Chunks commands and retries failed ones with AI assistance
     */
    protected async executeCommands(commands: string[], shouldRetry: boolean = true, chunkSize: number = 5): Promise<void> {
        const state = this.state;
        if (!state.sandboxInstanceId) {
            this.logger.warn('No sandbox instance available for executing commands');
            return;
        }

        // Sanitize and prepare commands
        commands = commands.join('\n').split('\n').filter(cmd => cmd.trim() !== '').filter(cmd => looksLikeCommand(cmd) && !cmd.includes(' undefined'));
        if (commands.length === 0) {
            this.logger.warn("No commands to execute");
            return;
        }

        commands = commands.map(cmd => cmd.trim().replace(/^\s*-\s*/, '').replace(/^npm/, 'bun'));
        this.logger.info(`AI suggested ${commands.length} commands to run: ${commands.join(", ")}`);

        // Remove duplicate commands
        commands = Array.from(new Set(commands));

        // Execute in chunks
        const commandChunks = [];
        for (let i = 0; i < commands.length; i += chunkSize) {
            commandChunks.push(commands.slice(i, i + chunkSize));
        }

        const successfulCommands: string[] = [];

        for (const chunk of commandChunks) {
            // Retry failed commands up to 3 times
            let currentChunk = chunk;
            let retryCount = 0;
            const maxRetries = shouldRetry ? 3 : 1;
            
            while (currentChunk.length > 0 && retryCount < maxRetries) {
                try {
                    this.broadcast(WebSocketMessageResponses.COMMAND_EXECUTING, {
                        message: retryCount > 0 ? `Retrying commands (attempt ${retryCount + 1}/${maxRetries})` : "Executing commands",
                        commands: currentChunk
                    });
                    
                    const resp = await this.getSandboxServiceClient().executeCommands(
                        state.sandboxInstanceId,
                        currentChunk
                    );
                    if (!resp.results || !resp.success) {
                        this.logger.error('Failed to execute commands', { response: resp });
                        // Check if instance is still running
                        const status = await this.getSandboxServiceClient().getInstanceStatus(state.sandboxInstanceId);
                        if (!status.success || !status.isHealthy) {
                            this.logger.error(`Instance ${state.sandboxInstanceId} is no longer running`);
                            return;
                        }
                        break;
                    }

                    // Process results
                    const successful = resp.results.filter(r => r.success);
                    const failures = resp.results.filter(r => !r.success);

                    // Track successful commands
                    if (successful.length > 0) {
                        const successfulCmds = successful.map(r => r.command);
                        this.logger.info(`Successfully executed ${successful.length} commands: ${successfulCmds.join(", ")}`);
                        successfulCommands.push(...successfulCmds);
                    }

                    // If all succeeded, move to next chunk
                    if (failures.length === 0) {
                        this.logger.info(`All commands in chunk executed successfully`);
                        break;
                    }
                    
                    // Handle failures
                    const failedCommands = failures.map(r => r.command);
                    this.logger.warn(`${failures.length} commands failed: ${failedCommands.join(", ")}`);
                    
                    // Only retry if shouldRetry is true
                    if (!shouldRetry) {
                        break;
                    }
                    
                    retryCount++;
                    
                    // For install commands, try AI regeneration
                    const failedInstallCommands = failedCommands.filter(cmd => 
                        cmd.startsWith("bun") || cmd.startsWith("npm") || cmd.includes("install")
                    );
                    
                    if (failedInstallCommands.length > 0 && retryCount < maxRetries) {
                        // Use AI to suggest alternative commands
                        const newCommands = await this.getProjectSetupAssistant().generateSetupCommands(
                            `The following install commands failed: ${JSON.stringify(failures, null, 2)}. Please suggest alternative commands.`
                        );
                        
                        if (newCommands?.commands && newCommands.commands.length > 0) {
                            this.logger.info(`AI suggested ${newCommands.commands.length} alternative commands`);
                            this.broadcast(WebSocketMessageResponses.COMMAND_EXECUTING, {
                                message: "Executing regenerated commands",
                                commands: newCommands.commands
                            });
                            currentChunk = newCommands.commands.filter(looksLikeCommand);
                        } else {
                            this.logger.warn('AI could not generate alternative commands');
                            currentChunk = [];
                        }
                    } else {
                        // No retry needed for non-install commands
                        currentChunk = [];
                    }
                } catch (error) {
                    this.logger.error('Error executing commands:', error);
                    // Stop retrying on error
                    break;
                }
            }
        }

        // Record command execution history
        const failedCommands = commands.filter(cmd => !successfulCommands.includes(cmd));
        
        if (failedCommands.length > 0) {
            this.broadcastError('Failed to execute commands', new Error(failedCommands.join(", ")));
        } else {
            this.logger.info(`All commands executed successfully: ${successfulCommands.join(", ")}`);
        }

        this.saveExecutedCommands(successfulCommands);
    }

    /**
     * Sync package.json from sandbox to agent's git repository
     * Called after install/add/remove commands to keep dependencies in sync
     */
    protected async syncPackageJsonFromSandbox(): Promise<void> {
        try {
            this.logger.info('Fetching current package.json from sandbox');
            const results = await this.readFiles(['package.json']);
            if (!results || !results.files || results.files.length === 0) {
                this.logger.warn('Failed to fetch package.json from sandbox', { results });
                return;
            }
            const packageJsonContent = results.files[0].content;

            const { updated, packageJson } = updatePackageJson(this.state.lastPackageJson, packageJsonContent);
            if (!updated) {
                this.logger.info('package.json has not changed, skipping sync');
                return;
            }
            // Update state with latest package.json
            this.setState({
                ...this.state,
                lastPackageJson: packageJson
            });
            
            // Commit to git repository
            const fileState = await this.fileManager.saveGeneratedFile(
                {
                    filePath: 'package.json',
                    fileContents: packageJson,
                    filePurpose: 'Project dependencies and configuration'
                },
                'chore: sync package.json dependencies from sandbox',
                true
            );
            
            this.logger.info('Successfully synced package.json to git', { 
                filePath: fileState.filePath,
            });
            
            // Broadcast update to clients
            this.broadcast(WebSocketMessageResponses.FILE_GENERATED, {
                message: 'Synced package.json from sandbox',
                file: fileState
            });
            
        } catch (error) {
            this.logger.error('Failed to sync package.json from sandbox', error);
            // Non-critical error - don't throw, just log
        }
    }

    async getLogs(_reset?: boolean, durationSeconds?: number): Promise<string> {
        if (!this.state.sandboxInstanceId) {
            throw new Error('Cannot get logs: No sandbox instance available');
        }
        
        const response = await this.getSandboxServiceClient().getLogs(this.state.sandboxInstanceId, _reset, durationSeconds);
        if (response.success) {
            return `STDOUT: ${response.logs.stdout}\nSTDERR: ${response.logs.stderr}`;
        } else {
            return `Failed to get logs, ${response.error}`;
        }
    }

    /**
     * Delete files from the file manager
     */
    async deleteFiles(filePaths: string[]) : Promise<{ success: boolean, error?: string }> {
        const deleteCommands: string[] = [];
        for (const filePath of filePaths) {
            deleteCommands.push(`rm -rf ${filePath}`);
        }
        // Remove the files from file manager
        this.fileManager.deleteFiles(filePaths);
        try {
            await this.executeCommands(deleteCommands, false);
            this.logger.info(`Deleted ${filePaths.length} files: ${filePaths.join(", ")}`);
            return { success: true };
        } catch (error) {
            this.logger.error('Error deleting files:', error);
            return { success: false, error: error as string };
        }
    }

    /**
     * Handle user input during conversational code generation
     * Processes user messages and updates pendingUserInputs state
     */
    async handleUserInput(userMessage: string, images?: ImageAttachment[]): Promise<void> {
        try {
            this.logger.info('Processing user input message', { 
                messageLength: userMessage.length,
                pendingInputsCount: this.state.pendingUserInputs.length,
                hasImages: !!images && images.length > 0,
                imageCount: images?.length || 0
            });

            // Ensure template details are loaded before processing
            await this.ensureTemplateDetails();

            // Just fetch runtime errors
            const errors = await this.fetchRuntimeErrors(false, false);
            const projectUpdates = await this.getAndResetProjectUpdates();
            this.logger.info('Passing context to user conversation processor', { errors, projectUpdates });


            const conversationState = this.infrastructure.getConversationState();
            // If there are images, upload them and pass the URLs to the conversation processor
            let uploadedImages: ProcessedImageAttachment[] = [];
            if (images) {
                uploadedImages = await Promise.all(images.map(async (image) => {
                    return await uploadImage(this.env, image, ImageType.UPLOADS);
                }));

                this.logger.info('Uploaded images', { uploadedImages });
            }

            // Process the user message using conversational assistant
            const conversationalResponse = await this.operations.processUserMessage.execute(
                { 
                    userMessage, 
                    conversationState,
                    conversationResponseCallback: (
                        message: string,
                        conversationId: string,
                        isStreaming: boolean,
                        tool?: { name: string; status: 'start' | 'success' | 'error'; args?: Record<string, unknown> }
                    ) => {
                        // Track conversationId when deep_debug starts
                        if (tool?.name === 'deep_debug' && tool.status === 'start') {
                            this.deepDebugConversationId = conversationId;
                        }
                        
                        this.broadcast(WebSocketMessageResponses.CONVERSATION_RESPONSE, {
                            message,
                            conversationId,
                            isStreaming,
                            tool,
                        });
                    },
                    errors,
                    projectUpdates,
                    images: uploadedImages
                }, 
                this.getOperationOptions()
            );

            const { conversationResponse, conversationState: newConversationState } = conversationalResponse;
            this.logger.info('User input processed successfully', {
                responseLength: conversationResponse.userResponse.length,
            });

            this.infrastructure.setConversationState(newConversationState);
        } catch (error) {
            this.logger.error('Error processing user input', error);
            throw error;
        }
    }

    /**
     * Capture screenshot of the given URL using Cloudflare Browser Rendering REST API.
     * Includes retry logic with blank screenshot detection.
     */
    public async captureScreenshot(
        url: string,
        viewport: { width: number; height: number } = { width: 1280, height: 720 }
    ): Promise<string> {
        if (!this.env.DB || !this.getAgentId()) {
            const error = 'Cannot capture screenshot: DB or agentId not available';
            this.logger.warn(error);
            this.broadcast(WebSocketMessageResponses.SCREENSHOT_CAPTURE_ERROR, {
                error,
                configurationError: true
            });
            throw new Error(error);
        }

        if (!url) {
            const error = 'URL is required for screenshot capture';
            this.broadcast(WebSocketMessageResponses.SCREENSHOT_CAPTURE_ERROR, {
                error,
                url,
                viewport
            });
            throw new Error(error);
        }

        this.logger.info('Capturing screenshot via REST API', { url, viewport });

        // Notify start of screenshot capture
        this.broadcast(WebSocketMessageResponses.SCREENSHOT_CAPTURE_STARTED, {
            message: `Capturing screenshot of ${url}`,
            url,
            viewport
        });

        const maxRetries = SCREENSHOT_CONFIG.MAX_RETRIES;
        let lastError: Error | null = null;
        let lastBlankReason: string | null = null;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                // Log retry attempt
                if (attempt > 0) {
                    this.logger.info(`Screenshot retry attempt ${attempt}/${maxRetries}`, {
                        url,
                        previousBlankReason: lastBlankReason
                    });
                }

                // Capture screenshot
                const base64Screenshot = await this.executeScreenshotCapture(url, viewport);

                // Detect if screenshot is blank
                const blankDetection = detectBlankScreenshot(
                    base64Screenshot,
                    SCREENSHOT_CONFIG.MIN_FILE_SIZE,
                    SCREENSHOT_CONFIG.MIN_ENTROPY
                );

                if (blankDetection.isBlank) {
                    lastBlankReason = blankDetection.reason;
                    this.logger.warn(`Blank screenshot detected on attempt ${attempt + 1}`, {
                        reason: blankDetection.reason,
                        url
                    });

                    // If we have retries left, wait and try again
                    if (attempt < maxRetries) {
                        const delay = SCREENSHOT_CONFIG.RETRY_DELAY_BASE * Math.pow(2, attempt);
                        this.logger.info(`Waiting ${delay}ms before retry...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        continue;
                    }

                    // On final attempt, use the screenshot anyway
                    this.logger.warn('All retry attempts resulted in blank screenshot, using last capture');
                }

                // Process and store the screenshot
                return await this.processAndStoreScreenshot(base64Screenshot, url, viewport);

            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                this.logger.error(`Screenshot capture attempt ${attempt + 1} failed:`, error);

                // If we have retries left, wait and try again
                if (attempt < maxRetries) {
                    const delay = SCREENSHOT_CONFIG.RETRY_DELAY_BASE * Math.pow(2, attempt);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        // All attempts failed
        const errorMessage = lastError?.message || lastBlankReason || 'Unknown error after retries';
        this.broadcast(WebSocketMessageResponses.SCREENSHOT_CAPTURE_ERROR, {
            error: `Screenshot capture failed after ${maxRetries + 1} attempts: ${errorMessage}`,
            url,
            viewport
        });
        throw new Error(`Screenshot capture failed: ${errorMessage}`);
    }

    /**
     * Execute a single screenshot capture attempt using Cloudflare Browser Rendering API.
     */
    private async executeScreenshotCapture(
        url: string,
        viewport: { width: number; height: number }
    ): Promise<string> {
        const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${this.env.CLOUDFLARE_ACCOUNT_ID}/browser-rendering/snapshot`;

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.env.CLOUDFLARE_API_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                url: url,
                viewport: viewport,
                gotoOptions: {
                    waitUntil: 'networkidle2',
                    timeout: SCREENSHOT_CONFIG.PAGE_LOAD_TIMEOUT
                },
                waitForTimeout: SCREENSHOT_CONFIG.WAIT_FOR_TIMEOUT,
                screenshotOptions: {
                    fullPage: false,
                    type: 'png'
                }
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Browser Rendering API failed: ${response.status} - ${errorText}`);
        }

        const result = await response.json() as {
            success: boolean;
            result: {
                screenshot: string;
                content: string;
            };
        };

        if (!result.success || !result.result.screenshot) {
            throw new Error('Browser Rendering API succeeded but no screenshot returned');
        }

        return result.result.screenshot;
    }

    /**
     * Process and store a captured screenshot.
     */
    private async processAndStoreScreenshot(
        base64Screenshot: string,
        url: string,
        viewport: { width: number; height: number }
    ): Promise<string> {
        const screenshot: ImageAttachment = {
            id: this.getAgentId(),
            filename: 'latest.png',
            mimeType: 'image/png',
            base64Data: base64Screenshot
        };
        const uploadedImage = await uploadImage(this.env, screenshot, ImageType.SCREENSHOTS);

        // Persist in database
        try {
            const appService = new AppService(this.env);
            await appService.updateAppScreenshot(this.getAgentId(), uploadedImage.publicUrl);
        } catch (dbError) {
            const error = `Database update failed: ${dbError instanceof Error ? dbError.message : 'Unknown database error'}`;
            this.broadcast(WebSocketMessageResponses.SCREENSHOT_CAPTURE_ERROR, {
                error,
                url,
                viewport,
                screenshotCaptured: true,
                databaseError: true
            });
            throw new Error(error);
        }

        this.logger.info('Screenshot captured and stored successfully', {
            url,
            storage: uploadedImage.publicUrl.startsWith('data:') ? 'database' : (uploadedImage.publicUrl.includes('/api/screenshots/') ? 'r2' : 'images'),
            length: base64Screenshot.length
        });

        // Sign the URL if it points to our internal screenshot endpoint
        const security = new ScreenshotSecurity(this.env);
        const signedUrl = await security.signUrl(uploadedImage.publicUrl, this.getAgentId());

        // Notify successful screenshot capture
        this.broadcast(WebSocketMessageResponses.SCREENSHOT_CAPTURE_SUCCESS, {
            message: `Successfully captured screenshot of ${url}`,
            url,
            viewport,
            screenshotSize: base64Screenshot.length,
            timestamp: new Date().toISOString(),
            screenshotUrl: signedUrl,
        });

        return signedUrl;
    }
}

/**
 * Summarise the most LLM-useful files from a GitHub import so the agent has
 * concrete project context without dumping every path into the blueprint.
 * Prioritises React entry points, route files, and small config files.
 */
function summariseImportedFiles(files: FileOutputType[]): string {
    const priority = [
        'src/App.tsx', 'src/App.jsx',
        'src/main.tsx', 'src/main.jsx',
        'package.json',
        'README.md', 'readme.md',
        'tailwind.config.js', 'tailwind.config.ts',
    ];
    const picked: string[] = [];
    for (const path of priority) {
        if (files.some(f => f.filePath === path)) picked.push(path);
    }

    const routeOrPageFiles = files
        .filter(f => /(^|\/)(pages|routes|views)\/.+\.(tsx|jsx|ts|js)$/.test(f.filePath))
        .map(f => f.filePath)
        .slice(0, 8);
    picked.push(...routeOrPageFiles);

    const componentFiles = files
        .filter(f => /^src\/components\/.+\.(tsx|jsx)$/.test(f.filePath))
        .map(f => f.filePath)
        .slice(0, 6);
    picked.push(...componentFiles);

    const unique = Array.from(new Set(picked));
    if (unique.length === 0) {
        return `- ${files.slice(0, 12).map(f => f.filePath).join('\n- ')}`;
    }
    return `- ${unique.join('\n- ')}`;
}
