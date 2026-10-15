# Mobile UI specification

Mobile is a responsive web experience for the Owner and operational staff, not a separate native app. The current implementation uses the same authenticated API, permissions, company/branch scope and transaction rules as desktop.

## Navigation and use

- At narrow widths, provide a fixed bottom bar for the most-used destinations and a permission-aware **More** menu for remaining modules and settings.
- Keep language, branch and account controls reachable without obscuring the work area. Restore adequate content padding above fixed navigation and respect device safe-area insets.
- Use touch targets of at least 44 CSS pixels for primary controls; preserve clear text labels alongside icons.
- Stack forms and summary cards; make long tables horizontally scrollable or provide a compact row/card view so essential actions remain reachable.
- Show connection state and stale/read-only status when using cached data. Offline writes must remain drafts until the server accepts them.
- The **More** navigation panel behaves as a modal dialog: opening moves keyboard focus into it, Tab stays within it, Escape closes it, closing restores focus, and background scrolling is locked while open.

## Supported offline behavior

The web service worker caches the bilingual offline shell and eligible same-origin app assets. The dashboard can show a stale session-local summary. Permitted expense entries and loading-photo retries can persist in encrypted, per-user IndexedDB with idempotency keys and user-actionable queue states. API calls and non-GET writes bypass HTTP cache. Offline approvals, sending transactions while disconnected, background upload while the app is closed and cross-device draft sync are not supported.

## UAT gates

At minimum inspect 390×844 and a desktop viewport, English and Tamil, role-specific navigation, branch controls, forms with the on-screen keyboard, fixed navigation/safe areas, network loss/reconnect, upload interruption, storage quota and browser reload. Current automated adapter checks pass; real-device offline, weak-network, accessibility and full authenticated module walkthroughs remain open. See [`UAT.md`](UAT.md).
