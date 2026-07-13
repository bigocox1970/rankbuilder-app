# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Communication Style
- Be professional, concise, and direct
- Do NOT use emojis in code reviews, changelogs, or any generated content. You may use professional visual indicators or favor markdown formatting over emojis.
- Focus on substance over style
- Use clear technical language

## Strategic Direction (RankBuilder / Diamond Internet)

This fork is deployed as **RankBuilder** (live at app.rankbuilder.app) and is being repurposed as **Diamond Internet's internal website factory for UK tradespeople**. Intended pipeline: Checkatrade prospect → brand pack → generated static HTML site.

- **Website mode (`tradesperson-sp`, static HTML) is now the primary/only product path.** Every trades build should go through Website mode — the static-HTML flow already enforces a sticky header, real server-rendered HTML, JSON-LD, and SEO outputs, which fixes the failures seen when a trades site was accidentally built via the App/React flow (empty client-rendered shell with a default "Vite + R + TS" title, no sticky header, broken images, fabricated reviews).
- **App and Expo modes stay in the codebase** (upstream fork hygiene with `cloudflare/vibesdk`) but will be **hidden in the UI** in upcoming work.

**Planned next steps (for future sessions):**
1. Lock the home-screen stack toggle to Website mode (hide App/Expo in the UI).
2. Brand-pack JSON input in the planner UI — currently the pipeline harvests via free-text prompt; upcoming work adds a structured JSON field to `SiteContentPlan` (business facts, curated services, verbatim reviews, image URLs with dimensions, logo palette hex values) that flows into the blueprint directly.

## Real-Data / Brand-Pack Pipeline (`realData`)

The planner now extracts and threads real business assets verbatim from the user's brief. Relevant files:

- **`worker/api/controllers/agent/types.ts`** — `RealBusinessData`, `RealImage`, `RealReview`, `RealFacts` types on `SiteContentPlan.realData`. Also carries `wireframe` and `pageStructure` ('single'|'multi') for the planner.
- **`worker/api/controllers/plan/controller.ts`** — plan LLM is instructed to extract `realData` verbatim; image URLs are sanitised (must be https + substring-matched against the original description to block hallucinated URLs); `max_tokens` raised 2048→6144 to fit verbatim review text; new 12-theme/12-font/12-wireframe enumerations replace the old 8-theme/5-font sets; fallback defaults now `ledger` / `courthouse`.
- **`worker/agents/core/behaviors/phasic.ts`** — if `realData.images` is non-empty, AI image generation is skipped entirely (real photos win); the `[REAL BUSINESS DATA]` block (images, reviews, verified facts) is appended to `storedQuery` so the LLM sees it at build time; a `DESIGN.md` file (colour swatches + font preview using inline HTML, wireframe section list) is injected into every website template build.
- **`src/components/SitePlanner.tsx`** — review step shows colour swatch picker (`ColorPicker`), live font preview picker (`FontPicker`), page-structure toggle (single/multi), and a real-data summary line ("Using your real data: N photos · N verified reviews · rated 9.9/10"). All picks are hoisted to the final `SiteContentPlan` passed to `onApprove`.
- **`templates/definitions/tradesperson-sp/prompts/usage.md`** — image priority: `[REAL BUSINESS DATA]` photos > `[GENERATED IMAGES]`; never leave `<img src>` empty; no opacity-0 scroll-triggered animations (invisible to crawlers + users without JS events).

## Template Changes (`tradesperson-sp`)

The `tradesperson-sp` template now ships the **design-freedom** variant (12 colour themes + 12 font pairings, model writes its own CSS, multi-page supported) and carries three prompt fixes (`templates/definitions/tradesperson-sp/prompts/`):

- **`usage.md` — "REAL BUSINESS DATA — VERBATIM ONLY"**: reviews/testimonials may only come from the prompt/blueprint and must be reproduced faithfully; if none supplied, omit the testimonials section entirely; never invent names, quotes, ratings, or business facts. Added because a live build fabricated named 5-star reviews ("Sarah T.") for a real business — a UK consumer-law liability.
- **`usage.md` — image rules**: use supplied/CDN image URLs verbatim (exact characters), give every `<img>` meaningful `alt` + a `var(--surface)` fallback container; enforce aspect-ratio discipline (16:9 hero, 4:3 cards, `object-fit:cover`; logos height-constrained only). Added because the model cannot see images and was distorting them.
- **`selection.md`**: multi-page enabled (per-service / per-project SEO landing pages with real URLs and their own title/meta/JSON-LD) and scope broadened to any business/service website.

**Deploying template changes:** templates live in `templates/definitions/` (source; `templates/build/` is a **gitignored generated artifact** — never edit it, it is rebuilt from `definitions/`). The catalog (`template_catalog.json`) **embeds** each template's `selection` and `usage` prompt text, so a prompt change requires re-uploading the catalog, not just the zip. Targeted single-template deploy to R2 (no worker release needed — the worker reads the catalog + zips from R2 at build time):

```bash
cd templates && export R2_BUCKET_NAME=vibesdk-templates
python3 tools/generate_templates.py --template tradesperson-sp --no-bun   # regen only this template into build/
python3 generate_template_catalog.py --output template_catalog.json --pretty
python3 create_zip.py build/tradesperson-sp zips/tradesperson-sp.zip
wrangler r2 object put "$R2_BUCKET_NAME/tradesperson-sp.zip" --file=zips/tradesperson-sp.zip --remote
wrangler r2 object put "$R2_BUCKET_NAME/template_catalog.json" --file=template_catalog.json --remote
```

The full `./deploy_templates.sh` rebuilds and uploads **all** templates; use the targeted flow above when only one template changed to avoid shipping unrelated in-progress template edits. Note: the `templates/` directory is its own git repo (`origin = cloudflare/vibesdk-templates` — do not push there; no personal remote is configured yet).

## Project Overview
vibesdk is an AI-powered full-stack application generation platform built on Cloudflare infrastructure.

**Tech Stack:**
- Frontend: React 19, TypeScript, Vite, TailwindCSS, React Router v7
- Backend: Cloudflare Workers, Durable Objects, D1 (SQLite)
- AI/LLM: OpenAI, Anthropic, Google AI Studio (Gemini)
- WebSocket: PartySocket for real-time communication
- Sandbox: Custom container service with CLI tools
- Git: isomorphic-git with SQLite filesystem

**Project Structure**

**Frontend (`/src`):**
- React application with 80+ components
- Single source of truth for types: `src/api-types.ts`
- All API calls in `src/lib/api-client.ts`
- Custom hooks in `src/hooks/`
- Route components in `src/routes/`

**Backend (`/worker`):**
- Entry point: `worker/index.ts` (7860 lines)
- Agent system: `worker/agents/` (88 files)
  - Core: SimpleCodeGeneratorAgent (Durable Object, 2800+ lines)
  - Operations: PhaseGeneration, PhaseImplementation, UserConversationProcessor
  - Tools: tools for LLM (read-files, run-analysis, regenerate-file, etc.)
  - Git: isomorphic-git with SQLite filesystem
- Database: `worker/database/` (Drizzle ORM, D1)
- Services: `worker/services/` (sandbox, code-fixer, oauth, rate-limit, secrets)
- API: `worker/api/` (routes, controllers, handlers)

**Other:**
- `/shared` - Shared types between frontend/backend (not worker specific types that are also imported in frontend)
- `/migrations` - D1 database migrations
- `/container` - Sandbox container tooling
- `/templates` - Project scaffolding templates

**Core Architecture:**
- Each chat session is a Durable Object instance (SimpleCodeGeneratorAgent)
- State machine drives code generation (IDLE → PHASE_GENERATING → PHASE_IMPLEMENTING → REVIEWING)
- Git history stored in SQLite, full clone protocol support
- WebSocket for real-time streaming and state synchronization

## Key Architectural Patterns

**Durable Objects Pattern:**
- Each chat session = Durable Object instance
- Persistent state in SQLite (blueprint, files, history)
- Ephemeral state in memory (abort controllers, active promises)
- Single-threaded per instance

**State Machine:**
IDLE → PHASE_GENERATING → PHASE_IMPLEMENTING → REVIEWING → IDLE

**CodeGenState (Agent State):**
- Project Identity: blueprint, projectName, templateName
- File Management: generatedFilesMap (tracks all files)
- Phase Tracking: generatedPhases, currentPhase
- State Machine: currentDevState, shouldBeGenerating
- Sandbox: sandboxInstanceId, commandsHistory
- Conversation: conversationMessages, pendingUserInputs

**WebSocket Communication:**
- Real-time streaming via PartySocket
- State restoration on reconnect (agent_connected message)
- Message deduplication (tool execution causes duplicates)

**Git System:**
- isomorphic-git with SQLite filesystem adapter
- Full commit history in Durable Object storage
- Git clone protocol support (rebase on template)
- FileManager auto-syncs from git via callbacks

## Common Development Tasks

**Change LLM Model for Operation:**
Edit `/worker/agents/inferutils/config.ts` → `AGENT_CONFIG` object

**Modify Conversation Agent Behavior:**
Edit `/worker/agents/operations/UserConversationProcessor.ts` (system prompt line 50)

**Add New WebSocket Message:**
1. Add type to `worker/api/websocketTypes.ts`
2. Handle in `worker/agents/core/websocket.ts`
3. Handle in `src/routes/chat/utils/handle-websocket-message.ts`

**Add New LLM Tool:**
1. Create `/worker/agents/tools/toolkit/my-tool.ts`
2. Export `createMyTool(agent, logger)` function
3. Import in `/worker/agents/tools/customTools.ts`
4. Add to `buildTools()` (conversation) or `buildDebugTools()` (debugger)

**Add API Endpoint:**
1. Define types in `src/api-types.ts`
2. Add to `src/lib/api-client.ts`
3. Create service in `worker/database/services/`
4. Create controller in `worker/api/controllers/`
5. Add route in `worker/api/routes/`
6. Register in `worker/api/routes/index.ts`

## Important Context

**Deep Debugger:**
- Location: `/worker/agents/assistants/codeDebugger.ts`
- Model: Gemini 2.5 Pro (reasoning_effort: high, 32k tokens)
- Diagnostic priority: run_analysis → get_runtime_errors → get_logs
- Can fix multiple files in parallel (regenerate_file)
- Cannot run during code generation (checked via isCodeGenerating())

**User Secrets Store (Durable Object):**
- Location: `/worker/services/secrets/`
- Purpose: Encrypted storage for user API keys with key rotation
- Architecture: One DO per user, XChaCha20-Poly1305 encryption, SQLite backend
- Key derivation: MEK → UMK → DEK (hierarchical PBKDF2)
- Features: Key rotation, soft deletion, access tracking, expiration support
- RPC Methods: Return `null`/`boolean` on error, never throw exceptions
- Testing: 90 comprehensive tests in `/test/worker/services/secrets/`

**Git System:**
- GitVersionControl class wraps isomorphic-git
- Key methods: commit(), reset(), log(), show()
- FileManager auto-syncs via callback registration
- Access control: user conversations get safe commands, debugger gets full access
- SQLite filesystem adapter (`/worker/agents/git/fs-adapter.ts`)

**Abort Controller Pattern:**
- `getOrCreateAbortController()` reuses controller for nested operations
- Cleared after top-level operations complete
- Shared by parent and nested tool calls
- User abort cancels entire operation tree

**Message Deduplication:**
- Tool execution causes duplicate AI messages
- Backend skips redundant LLM calls (empty tool results)
- Frontend utilities deduplicate live and restored messages
- System prompt teaches LLM not to repeat

## Core Rules (Non-Negotiable)

**1. Strict Type Safety**
- NEVER use `any` type
- Frontend imports types from `@/api-types` (single source of truth)
- Search codebase for existing types before creating new ones

**2. DRY Principle**
- Search for similar functionality before implementing
- Extract reusable utilities, hooks, and components
- Never copy-paste code - refactor into shared functions

**3. Follow Existing Patterns**
- Frontend APIs: All in `/src/lib/api-client.ts`
- Backend Routes: Controllers in `worker/api/controllers/`, routes in `worker/api/routes/`
- Database Services: In `worker/database/services/`
- Types: Shared in `shared/types/`, API in `src/api-types.ts`

**4. Code Quality**
- Production-ready code only - no TODOs or placeholders
- No hacky workarounds
- Comments explain purpose, not narration
- No overly verbose AI-like comments

**5. File Naming**
- React Components: PascalCase.tsx
- Utilities/Hooks: kebab-case.ts
- Backend Services: PascalCase.ts

## Stripe Billing Integration

Status: **LIVE IN PRODUCTION** (2026-05-17). Real customers can pay real money. Account `acct_1TXo2r2ZIVja17Ct`.

**Architecture:**
- D1 migration `0007_stripe_subscriptions.sql` — users table has `stripe_customer_id`, `stripe_subscription_id`, `stripe_subscription_status`
- `worker/api/controllers/stripe/controller.ts` — checkout, top-up, portal, webhook, plus `ensureStripeCustomer()` helper that recreates customer if the stored ID doesn't resolve in current Stripe mode
- `worker/api/routes/stripeRoutes.ts` — routes at `/api/stripe/{create-checkout,topup,portal,webhook}` (webhook is exempt from CSRF, see commit 112aa50)
- Credit balance in KV `user_credits:{userId}` — token-weighted per-call deduction in `RateLimitService.recordActualUsage`
- Front-end UX: out-of-credits toasts include "Go to Settings" action (`src/routes/home.tsx`, `src/routes/chat/utils/message-helpers.ts`); top-up return uses 5-min silent background polling with friendly upfront messaging (`src/routes/settings/index.tsx`)

**Pricing (live):**
- One-time top-ups: £10/400 credits, £20/1000, £50/2500
- Pro subscription: £20/mo for 1500 credits

**Wrangler secrets (vibesdk-production worker):**
`STRIPE_SECRET_KEY` (sk_live_), `STRIPE_PUBLISHABLE_KEY` (pk_live_), `STRIPE_WEBHOOK_SECRET` (whsec_), `STRIPE_PRO_PRICE_ID`, `STRIPE_TOPUP_PRICE_10/20/50`.

**Critical gotcha — always `cd vibesdk/` before `wrangler secret put`.** The outer repo dir (`vibe-sdk/`) has its own wrangler config that targets a different worker. Putting a secret from the wrong directory uploads it to the wrong worker.

**Sandbox vs Production:** Stripe "Sandbox" is a fully separate account, not a test-mode toggle. RankBuilder has both — `acct_1TXo8E…` (Sandbox, dev only) and `acct_1TXo2r2Z…` (Production, live customers). Keys / product IDs / customer IDs do NOT cross between them. Verify which account a key belongs to via the account-id portion encoded in `sk_xxx_51AAAA…`.

## Common Pitfalls

**Don't:**
- Use `any` type (find or create proper types)
- Copy-paste code (extract to utilities)
- Use Vite env variables in Worker code
- Forget to update types when changing APIs
- Create new implementations without searching for existing ones
- Use emojis in code or comments
- Write verbose AI-like comments

**Do:**
- Search codebase thoroughly before creating new code
- Follow existing patterns consistently
- Keep comments concise and purposeful
- Write production-ready code
- Test thoroughly before submitting