# Upgrade plan

## Current state

Score: 7/10 (was 5/10) — typed client and browser bundle are now both under
test and CI runs the real checks; the static UI still duplicates client logic
by hand and has no DOM-level tests.

## Backlog

- P1: Decide the fate of `public/` (a stale partial copy of `js/`, `css/`,
  and fixtures without `news`/`discovery`; nothing references it). Either
  delete it or generate it, then add a test so it cannot drift.
- P1: Generate `js/data-products-browser.js` from `src/data-products/` (e.g.
  a tiny esbuild step) instead of keeping two hand-written copies; the parity
  test in `tests/browser-bundle.test.ts` guards drift until then.
- P1: DOM tests for `mountDashboard` / `mountProductPage` (jsdom or
  happy-dom) covering loading/empty/timeout states and escaping of item data.
- P2: Accessibility pass on the product tables (header scope is set; add
  focusable table wrapper and reduced-motion styles).
- P2: `scripts/verify-browser-consumers.mjs` hard-codes a sibling portfolio
  path; accept it via an env var and skip cleanly when absent.

## Done in this pass

- Removed the broken `build:browser` script (it pointed at a missing
  `scripts/build-browser.mjs`); added `npm run check` and `engines.node`.
- Added browser-bundle tests: catalog parity with the typed client, fixture
  and page coverage per product, GET-only reads, URL overrides, sanitized
  HTTP fallback, timeout, invalid envelopes.
- Fixed `escapeHtml` in the browser bundle to escape single quotes.
- Added GitHub Actions CI (Node 22: `npm ci`, typecheck, tests, syntax check).
- README: documented `NEXT_PUBLIC_DATA_PRODUCT_URL_NEWS` and the test layout.
