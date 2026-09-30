# Upgrade plan

## Current state

Score: 8/10 (7.5 after pass 2, 7 after pass 1, 5 before) — typed client,
browser bundle, static page wiring and the rendered DOM states are under
test; the static UI still duplicates client logic by hand.

## Backlog

- P1: Generate `js/data-products-browser.js` from `src/data-products/` (e.g.
  a tiny esbuild step) instead of keeping two hand-written copies; the parity
  test in `tests/browser-bundle.test.ts` guards drift until then.
- P2: Accessibility pass on the product tables (header scope is set; add
  focusable table wrapper and reduced-motion styles).
- P2: `scripts/verify-browser-consumers.mjs` needs all local APIs up; add a
  fixtures-only mode so it can run in CI.

## Done in this pass

- Removed the broken `build:browser` script (it pointed at a missing
  `scripts/build-browser.mjs`); added `npm run check` and `engines.node`.
- Added browser-bundle tests: catalog parity with the typed client, fixture
  and page coverage per product, GET-only reads, URL overrides, sanitized
  HTTP fallback, timeout, invalid envelopes.
- Fixed `escapeHtml` in the browser bundle to escape single quotes.
- Added GitHub Actions CI (Node 22: `npm ci`, typecheck, tests, syntax check).
- README: documented `NEXT_PUBLIC_DATA_PRODUCT_URL_NEWS` and the test layout.

## Done in this pass (pass 2)

- Removed `public/`: verified unreferenced (no HTML, script, CI, README, or
  parent Solo Empire reference; pages are served from the repo root) and it
  was a partial copy missing `news`/`discovery` fixtures.
- Added `tests/static-site.test.ts`: every root page's local `src`/`href`
  resolves, each catalog product has a fixture, and no mirror of `js/` may
  reappear under `public/`, `dist/` or `static/`.
- `scripts/verify-browser-consumers.mjs`: portfolio path now comes from
  `INSIGHTS_PORTFOLIO_ROOT` (default unchanged) and portfolio checks skip
  cleanly when the sibling checkout is absent.

## Done in this pass (pass 3)

- Added `tests/dom.test.ts` (happy-dom, stubbed fetch): loading banner and
  `aria-busy`, rendered rows, escaping of hostile item keys/values, timeout
  fixture fallback, sanitized unavailable message, dashboard cards.
- Fixed: the dashboard banner was always styled `ok`, even when no product
  loaded; it is now `ok`/`warn`/`bad` by how many loaded.
- Fixed: a product page with an empty envelope rendered a header-only table
  with a made-up `record_id` column; it now says "No records in this envelope."
- Hardened the verification script's fixture server against paths outside
  the repository root.
