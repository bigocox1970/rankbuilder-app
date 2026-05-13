# RankBuilder – Current State & Next Steps

**As of 2026-05-13 — app is live and stable at https://app.rankbuilder.app**

---

## Infrastructure (all live)

- Worker: `vibesdk-production` on Cloudflare
- Domain: `app.rankbuilder.app` (custom domain on worker)
- Marketing: `rankbuilder.app` (Cloudflare Pages — deployed manually via `wrangler pages deploy`)
- Database: D1 `vibesdk-db` (users, sessions, apps, password reset tokens)
- Auth: email/password, JWT sessions, `emailVerified` set on register
- Email: SendGrid (`SENDGRID_API_KEY` set as wrangler secret, domain `rankbuilder.app` verified)
- Environment: `ENVIRONMENT=production` (dev bypass removed)

## Deploy commands

**App (from vibesdk/ directory):**
```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm run build && npx wrangler deploy
```

**Marketing site (from rankbuilder-marketing/ directory):**
```bash
npm run build && npx wrangler pages deploy dist --project-name=rankbuilder --commit-dirty=true
```

---

## What's working

- [x] Email/password login, register, JWT sessions
- [x] Forgot password — sends branded reset email via SendGrid
- [x] Reset password — standalone page at `/reset-password?token=xxx`
- [x] Change password — in Settings > Security (email accounts only)
- [x] Sign out — redirects to `rankbuilder.app` marketing site
- [x] Dashboard with prompt box ("What should we build today?")
- [x] Recent projects: 4-slot grid with thumbnail cards, placeholders for empty slots, grid/list toggle
- [x] My Apps page: grid/list toggle, back arrow, consistent heading
- [x] Discover page: grid/list toggle
- [x] Sidebar: offcanvas (no icon strip), Dashboard, Discover, Settings, theme toggle, user avatar/logout
- [x] Sidebar mobile: shows search + project history correctly (fixed isCollapsed logic)
- [x] Chat pane: RankBuilder logo + sidebar trigger in left panel
- [x] Preview pane: title removed entirely (visible in chat pane only), icons green on hover/active
- [x] Mobile: floating toggle button switches between chat pane and preview pane
- [x] Mobile: overflow-x prevention on body
- [x] Mobile: expand button renders as `<a>` link on iOS (no fullscreen API)
- [x] AI prompts: mobile/PWA baseline rules added (overflow, touch targets, manifest, 375px)
- [x] AppCard: thumbnail with proper padding, text truncation at any width
- [x] Page headings: consistent brand font (green, tracking-tight)
- [x] GitHub export flow (GITHUB_EXPORTER_CLIENT_ID/SECRET set as secrets)
- [x] Marketing site: favicon updated, logo icon added, all CTAs link to app.rankbuilder.app
- [x] App header: logo icon + text matches marketing site size

---

## Next priorities

1. **Google OAuth login** — requires `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` set as wrangler secrets; OAuth provider already stubbed in auth controller
2. **GitHub OAuth login** — requires `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET`; same pattern as Google
3. **Templating & branding onboarding** — see RANKBUILDER_PLAN.md Phase 7
4. **"Deploy to Cloudflare" button fix** — FileNotFoundError in sandboxSdkClient.ts
5. **Admin/user management panel**
6. **Stripe billing integration**
7. **Contact form on rankbuilder.app**

---

## Test credentials

- Email: perimeter.uk@gmail.com
- Password: VibeSDK2024!

---

## Notes

- Marketing site repo: https://github.com/bigocox1970/rankbuilder (Cloudflare Pages, no auto-deploy from GitHub — must deploy manually)
- App repo: https://github.com/bigocox1970/rankbuilder-app (remote name: `personal`)
- Cloudflare Workers Paid plan ($5/mo) required for Durable Objects duration billing — must be active
- `CUSTOM_DOMAIN=app.rankbuilder.app`, `CUSTOM_PREVIEW_DOMAIN=rankbuilder.app` in wrangler.jsonc
- User app previews served at `{subdomain}.rankbuilder.app`
