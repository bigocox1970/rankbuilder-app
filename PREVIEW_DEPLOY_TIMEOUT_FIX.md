# Preview deploy timeout fix — why heavy imports (TanStack / Next) never previewed

**Date:** 2026-06-01
**Branch:** `feat/expo-tunnel`
**Status:** Fixed, deployed to production (`app.rankbuilder.app`), verified live on a TanStack Start import.

This was a high-impact, long-standing bug: **any imported project with a heavy dependency
tree (TanStack Start, Next.js, large Vite apps) would never show a live preview** — the
assistant said "Running deploy_preview" and then hung indefinitely with no error. Plain
Vite + React imports worked fine, which made it look framework-specific. It was not.

---

## Symptom

- Import of a TanStack Start repo (test case: `bigocox1970/JG-Resorations`) completed
  successfully — files imported, chat worked, the agent could read the codebase.
- On asking for a preview, the chat showed **"Deploying preview, updating preview
  environment"** and **nothing ever happened** — no preview, no error.
- Occasionally the chat WebSocket reconnected and dropped the user's pending message.
- Plain **Vite + React** imports previewed normally. This was the key clue.

## How it was diagnosed

Followed the project's standard method: **get the real logs before theorising.**

```bash
# Node 22 + prod secrets
export PATH="/Users/<you>/.nvm/versions/node/v22.x/bin:$PATH"
set -a; source .prod.vars; set +a
bunx wrangler tail vibesdk-production --format json > /tmp/tail.json
```

Reproduced live and grepped the capture. The decisive sequence:

```
Deployment attempt 1 timed out
Deployment attempt 2
Creating sandbox instance
SandboxError: Session 'i-<sessionId>' already exists      (component: sandbox-do, httpStatus 500)
SandboxError: Session 'sandbox-default' already exists
```

Critically, the log **never reached `Installing dependencies`** — so the problem was *not*
TanStack's install or its vite config. The deploy was dying upstream, on a timeout.

## Root cause

`DeploymentManager.executeDeploymentWithRetry` runs each deploy attempt under
`withTimeout(deploy(), PER_ATTEMPT_TIMEOUT_MS)`. **`PER_ATTEMPT_TIMEOUT_MS` was `60_000`
(60 seconds).**

But a *new-instance* attempt does a lot of synchronous work inside that single attempt:

```
deploy() → ensureInstance() → createNewInstance()
        → client.createInstance()  →  setupInstance():
              bun install            (internal budget: 300s)
              start dev server + wait for readiness (up to 90s)
```

`bun install` for a heavy tree (`@tanstack/react-start`, `nitro`, `vite 7`,
`@lovable.dev/vite-tanstack-config`, etc.) takes **well over 60 seconds** on a cold
container. And `withTimeout` **does not abort the underlying work** — it only stops waiting
and lets the retry loop continue. So:

1. **Attempt 1 times out at 60s** while `bun install` is still running on the container.
2. The retry calls `createSession` again and **collides with the still-initializing
   session** → `Session 'i-<sessionId>' already exists` (500 from the sandbox DO).
3. The retry's reset logic only fired on a fixed set of error strings (network-lost,
   `SANDBOX_SESSION_WEDGED`) or every 3rd attempt — it did **not** treat `already exists`
   or `timed out` as a reason to mint a fresh sandbox. So it kept reusing the same
   `sessionId` and **kept colliding**, wedging the loop.
4. The 5-minute master timeout eventually returned `null`. `deployPreview` then returned
   the useless string `"Failed to deploy: undefined"`, and the assistant went silent.

**Why Vite + React worked:** its dependency install finishes in well under 60s, so attempt 1
completed before the timeout, no collision, no wedge. The 60s cap was the entire delta
between "works" and "hangs forever."

### Supporting facts
- The Sandbox Durable Object is keyed by `sandboxId` (`getSandbox(env.Sandbox, sandboxId)`),
  and `sandboxId === the agent's sessionId` (instance id is `i-${sandboxId}`). So
  `resetSessionId()` genuinely yields a **fresh, non-colliding container** — the recovery
  just wasn't being triggered on the right errors.
- The `Durable Object reset because its code was updated` lines seen in the tail were a
  *fresh-deploy settling* side-effect (deploying a new worker version resets in-flight DOs),
  an aggravating factor during testing — not the root cause.

---

## The fix

Three files, all on the deploy/sandbox path.

### 1. `worker/agents/services/implementations/DeploymentManager.ts`
- **`PER_ATTEMPT_TIMEOUT_MS` 60_000 → 240_000** (4 min). A single attempt must outlast a
  cold `bun install` + dev-server boot, so heavy installs finish in one uninterrupted go.
- **`MASTER_DEPLOYMENT_TIMEOUT_MS` 300_000 → 360_000** (6 min) so there's room for one full
  attempt plus a respin.
- **Reset the session on collision/timeout**: added `/already exists/i` and `/timed out/i`
  to the set of errors that trigger `resetSessionId()`. A timed-out or colliding attempt
  means a previous attempt left a session mid-initialization; reusing the same id just
  collides again. Minting a fresh sandbox lets the next attempt start clean (and auto-clears
  an already-wedged sandbox the next time the user deploys).

### 2. `worker/services/sandbox/sandboxSdkClient.ts` (`setupInstance`)
- Install failure and dev-server-start failure now **throw the real reason** (install exit
  code + last ~25 lines of stderr) instead of returning a silent `undefined`. The outer
  catch re-throws, so `createInstance` surfaces the actual cause as the deploy error.
- Before: a failed install was logged and swallowed → the deploy layer only saw a generic
  "Failed to setup instance" → the user got a blind hang with no reason. Now the cause is
  visible in logs and in the returned error.

### 3. `worker/agents/core/behaviors/base.ts` (`deployPreview`)
- A `null` deploy result now returns an **actionable message** ("the preview did not finish
  starting in time — the app may still be installing dependencies; try again / check logs")
  instead of `"Failed to deploy: undefined"`, so the assistant tells the user what happened.

---

## Verification

Deployed to production, then re-triggered the preview on `bigocox1970/JG-Resorations`:
the TanStack Start app installed, booted its dev server, and **rendered in the builder
preview** — confirmed live. The previously-wedged sandbox for that app self-cleared via the
new `already exists` → fresh-sandbox path.

To re-verify in future: `wrangler tail` and watch for
`Creating sandbox instance` → `Installing dependencies` → `Dependencies installed` (exit 0)
→ dev-server readiness (`Local: http://…`) → `Preview URL exposed` → iframe renders.

---

## Scope / impact

- Fixes preview for **all heavy-dependency imports**, not just TanStack — Next.js (v0
  output) and large Vite apps would have hit the same 60s wall.
- **Caveat:** a genuinely enormous dependency tree could still exceed the new 4-minute
  window. It will now fail **visibly** with the real install error rather than hanging — so
  we'd see it and can extend the budget or pre-warm, instead of guessing.

## Follow-ups (not in this change)
- Staged import/preview UX: "Importing… / Installing dependencies… / Starting preview…"
  with a preview-pane spinner instead of a blank frame.
- HTML / static-website import profile (deferred until import-preview reliability was solid).
- Publish-to-Cloudflare surfacing: persistent deployment URL + DNS (A / CNAME) records the
  user points their domain at.
