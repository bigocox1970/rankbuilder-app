# Native Expo Go Preview over cloudflared — Working Solution

Status: **WORKING, confirmed on device 2026-05-31.** Scanning the QR in an Expo build
opens the real native React Native app in Expo Go on a physical phone, while the
in-builder web preview pane also renders the app. Both work simultaneously.

Deployed state at time of writing:
- Worker: `vibesdk-production` version `078e4297` (native tunnel flow + bundle pre-warm)
- Templates (R2 `vibesdk-templates`): Expo templates on **SDK 54** with the metro host-header fix

---

## The goal

Two previews from one Expo dev server (Metro) running in the sandbox container:
1. **Web preview** — the phone-frame pane inside the builder UI (a browser/iframe hitting
   the `8001-<id>-<token>.rankbuilder.app` port proxy).
2. **Native preview** — user scans a QR with **Expo Go** and the real native app loads on
   their phone, over a public tunnel.

## Why each piece exists (every one was required, learned the hard way)

### 1. cloudflared tunnel — NOT ngrok
`expo start --tunnel` (ngrok) **hangs in the Cloudflare sandbox** — it never produces an
`exp://` URL (ngrok's outbound is blocked). cloudflared dials Cloudflare's own edge, which
the container can reach, and establishes a `*.trycloudflare.com` quick tunnel in ~5s.
The `cloudflared` binary is baked into `SandboxDockerfile`.
- `startCloudflaredTunnel()` in `worker/services/sandbox/sandboxSdkClient.ts` runs it and
  parses the `https://<name>.trycloudflare.com` URL from the process logs.

### 2. SDK 54 templates
Expo Go on iOS only runs the **latest** SDK. The templates were SDK 52; the phone's Expo Go
is SDK 54, so it rejected SDK 52 projects ("Project incompatible"). Templates were upgraded
to SDK 54 (expo `^54`, react-native `0.81.5`, react `19.1`, expo-router `~6`) via
`expo install --fix`. Config files needed no changes; only `package.json`.

### 3. Strip `--web` from the dev script
`expo start --web` is web-only and won't serve the native manifest. Plain `expo start`
serves **both** the native manifest (to Expo Go, via `expo-platform` header) AND the web
build (to a browser `Accept: text/html` request) from one server. The worker's `sed` step
removes `--web` from the `dev` script. The in-builder web preview is unaffected.

### 4. `EXPO_PACKAGER_PROXY_URL`
Metro's manifest advertises bundle URLs on the host the request came in on (`127.0.0.1`),
which a phone can't reach. Setting `EXPO_PACKAGER_PROXY_URL=https://<tunnel>` makes Metro
write the public tunnel host into the manifest's `bundleUrl`. Injected inline in
`startDevServer()` for Expo builds. It does NOT couple the web preview to the tunnel — the
web HTML's `<script src>` stays same-origin (relative).

### 5. QR target = `exp://<host>` — NO PORT
Expo Go speaks **plain HTTP** to an `exp://` host. cloudflared quick tunnels serve BOTH
`http` (:80) and `https` (:443). So `exp://<host>` → Expo Go fetches the manifest over
`http://host:80` (works), then loads the bundle from the manifest's `https://host` URL
(works). **Adding `:443` breaks it**: Expo Go sends plain HTTP to the TLS-only 443 port →
`400 The plain HTTP request was sent to HTTPS port`. Built as `exp://${new URL(tunnelURL).hostname}`.

### 6. `metro.config.js` host-header fix (the SDK 54 white-page killer)
SDK 54 ships Metro 0.83, whose `Server._processRequest` does:
```js
const reqHost  = req.headers['x-forwarded-host'] || req.headers['host'];
const reqProto = req.headers['x-forwarded-proto'] || ...;
const urlObj   = new URL(req.url, reqProto + '://' + reqHost);  // throws on bad input
```
The builder's **multi-hop proxy** (preview host → CF sandbox → container) sends
**comma-joined** `x-forwarded-host` ("host-a, host-b") AND `x-forwarded-proto`
("https, http"). `new URL()` throws `TypeError: Invalid URL` → the **web** bundle 500s →
blank preview / "MIME type text/html is not executable". (Native worked anyway because
cloudflared sends single clean values — which is why native loaded but web went white.)
Fix collapses both headers to their first hop before Metro parses the request, via
`config.server.enhanceMiddleware`. SDK 52's older Metro didn't do this strict parse, which
is why it never happened before. See `templates/definitions/<expo>/metro.config.js`.

### 7. Native bundle pre-warm
The first compile of a full RN app to **Hermes bytecode** (`transform.bytecode=1`, ~1100+
modules) takes 60–90s+ on the constrained sandbox. Over the tunnel that exceeds
Cloudflare's ~100s edge timeout, so Expo Go's first bundle request 502s / "New update
available, downloading…" then "Could not connect to development server". Retrying doesn't
help — each attempt is killed mid-compile.
Fix: after the dev server starts, fire a fire-and-forget `curl` of the iOS bundle **over
localhost inside the sandbox** (no edge timeout) so the compile runs to completion and
populates Metro's transform cache. The real over-tunnel scan then serves the cached bundle.
Measured: native bundle went from `502 after 94s` to `200 in 2.18s` (full 6 MB). See the
pre-warm block in `setupInstance()` in `sandboxSdkClient.ts`.

---

## Known caveats / next hardening

- **trycloudflare quick tunnels flap** (no uptime guarantee) — transient 530/1033/502 that
  self-recover. For production reliability, move to a **named cloudflared tunnel** on the
  Cloudflare account. A named tunnel does NOT fix the compile-time 502 (pre-warm does).
- **Only fresh builds work.** Existing apps have their SDK baked into their committed files,
  and recycled sandboxes lose the tunnel. Returning to an old app shows tunnel/SDK errors —
  build fresh.
- **tube-trainer** is not in the catalog (no standalone yaml) — not user-selectable.

## Deploy / restore

- Worker: `bun --env-file .prod.vars scripts/deploy.ts` (needs Node 22 via nvm; the
  `.prod.vars` `CLOUDFLARE_API_TOKEN` authenticates when wrangler OAuth is lapsed).
- Templates: from `templates/`, `export R2_BUCKET_NAME=vibesdk-templates` then
  `bash deploy_templates.sh` (the bucket-name export is REQUIRED or all uploads fail).
- The D1 migration step fails at `0007` (pre-existing dup-column, non-fatal) on every deploy.

## Verifying without a phone (debugging the bundle path)

```sh
# web bundle through the exact failing proxy headers:
curl -H "x-forwarded-host: a.app, 10.0.0.1:8001" -H "x-forwarded-proto: https, http" \
  "https://8001-<id>.rankbuilder.app/node_modules/expo-router/entry.bundle?platform=web&dev=true&..."
# native bundle over the tunnel (should be 200 + a few seconds once pre-warmed):
curl -H "expo-platform: ios" "https://<name>.trycloudflare.com/"   # manifest -> bundleUrl
```
Always `grep -a` on `wrangler tail` capture files — the big JSON log reads as binary otherwise.
