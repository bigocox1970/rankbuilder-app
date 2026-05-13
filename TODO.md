# RankBuilder – Current State & Next Steps

**As of 2026-05-13 — app is live and stable at https://app.rankbuilder.app**

---

## Infrastructure (all live)

- Worker: `vibesdk-production` on Cloudflare
- Domain: `app.rankbuilder.app` (custom domain on worker)
- Marketing: `rankbuilder.app` (Cloudflare Pages)
- Database: D1 `vibesdk-db` (users, sessions, apps)
- Auth: email/password, JWT sessions, `emailVerified` set on register
- Environment: `ENVIRONMENT=production` (dev bypass removed)

## Deploy command (from vibesdk/ directory)

```bash
PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH" npm run build && PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH" npx wrangler deploy
```

---

## What's working

- [x] Email/password login, register, JWT sessions
- [x] Dashboard with prompt box ("What should we build today?")
- [x] Recent projects: 4-slot grid with thumbnail cards, placeholders for empty slots, grid/list toggle
- [x] My Apps page: grid/list toggle, back arrow, consistent heading
- [x] Discover page: grid/list toggle
- [x] Sidebar: offcanvas (no icon strip), Dashboard, Discover, Settings, theme toggle, user avatar/logout
- [x] Chat pane: RankBuilder logo + sidebar trigger in left panel
- [x] Preview pane: icons green on hover/active, proper sizing
- [x] AppCard: thumbnail with proper padding, text truncation at any width
- [x] Page headings: consistent brand font (green, tracking-tight)
- [x] GitHub export flow (GITHUB_EXPORTER_CLIENT_ID/SECRET set as secrets)

---

## Next priorities

1. **Mobile responsive** — see RANKBUILDER_PLAN.md Phase 6
2. **Templating & branding onboarding** — see RANKBUILDER_PLAN.md Phase 7
3. **Google OAuth** — see RANKBUILDER_PLAN.md Phase 8
4. **"Deploy to Cloudflare" button fix** — see RANKBUILDER_PLAN.md Phase 10

---

## Test credentials

- Email: perimeter.uk@gmail.com
- Password: VibeSDK2024!
