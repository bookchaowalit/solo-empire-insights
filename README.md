# Solo Empire Insights

Consumer application for the seven frozen free-only **data-product APIs** plus
the additive `news.v1` and `discovery.v1` APIs.

This repo no longer scrapes upstream providers and does not import legacy
scraper modules or read legacy scraper CSV paths. It only:

1. calls local read-only HTTP APIs on ports **8101–8110**, or
2. renders sanitized fixture envelopes for offline demos.

## Data products

| Product | Port | Schema | Repository |
|---|---|---|---|
| Crypto | 8101 | `crypto.v1` | `book-crypto-data` |
| Stocks | 8102 | `stock.v1` | `book-stock-data` |
| FX | 8103 | `fx.v1` | `book-fx-data` |
| DeFi | 8104 | `defi.v1` | `book-defi-data` |
| Flights | 8105 | `flight.v1` | `book-flight-data` |
| SEO | 8106 | `seo.v1` | `book-seo-data` |
| AI Tools | 8107 | `ai_tools.v1` | `book-ai-tools-data` |
| News Signals | 8108 | `news.v1` | `book-news-scraping` |
| Technology Discovery | 8110 | `discovery.v1` | `book-discovery-data` |

Expected envelope:

```json
{
  "schema_version": "crypto.v1",
  "source": "book-crypto-data",
  "retrieved_at": "2026-08-01T12:00:00Z",
  "data_status": "ok",
  "items": [],
  "next_cursor": null
}
```

## Development

```bash
# From the Solo Empire root, validate then replay approved captures.
task scraping:ingest -- --validate-only
task scraping:ingest

# Start the domain APIs (including news) plus Track B jobs (:8109) and keep them running.
task scraping:stack

# Or smoke-check all APIs and stop them automatically.
task scraping:stack -- --check

# Offline demo (no network, fixtures only)
python3 -m http.server 4178 --bind 127.0.0.1
# Run from this Insights repository; open http://127.0.0.1:4178/?fixtures=1

# Live local APIs (same server, no ?fixtures=1)
# open http://127.0.0.1:4178/
# By default, domain APIs allow CORS only for http://127.0.0.1:* and
# http://localhost:*. For a hosted frontend, set the same explicit origin in
# each API's CORS_ALLOWED_ORIGINS environment variable.

# Automated browser-consumer checks (APIs must be up). Portfolio checks use
# INSIGHTS_PORTFOLIO_ROOT (default: the sibling website checkout) and are
# skipped when it is absent.
node scripts/verify-browser-consumers.mjs
```

Replay defaults to the isolated, Git-ignored
`data/lake-local/scraping-captures-v2` lake for crypto, stocks, FX, DeFi, and
approved SEO owned-page provenance, and approved news RSS/Atom captures.
The stack uses that same lake. Existing batches in `data/lake` are preserved;
they are not automatically migrated or overwritten. Use `--lake-uri` on both
commands to select another reviewed lake. Local lineage files are unchanged
unless replay explicitly receives `--update-lineage` after reconciliation.
The helper imports existing captures only: it does not schedule upstream
collection. Run it again after the approved scrapers update their exports.

Flights and AI tools may return empty on this isolated stack. Flights require
a permitted source. SEO is now mapped as owned-page provenance: reachability,
title, canonical URL, HTTP status, and capture time; it does not claim SERP
rankings. AI tools still require reuse permission review.
Jobs use a separate internal ingestion workflow. API health alone does not
mean these products contain usable data. `--validate-only --product seo`
checks file structure without granting publication permission.

For the internal Jobs data boundary, use `task scraping:jobs:ingest --
--dry-run` first, then `task scraping:jobs:ingest`. Verify it with
`task data:job:readiness -- --data-lake-uri
$(pwd)/data/lake-local/scraping-captures-v2 --dataset job_postings --dataset
job_matches --dataset job_leads`. Jobs are served on `:8109` with `job.v1`;
they are not included in this public seven-product UI because the contract is
classified `internal` and may contain contact/application fields.

An immutable-batch conflict is a failed replay, not a successful refresh.
Do not delete old batches to bypass it: replay into an isolated lake, compare
records/history and timestamps, then explicitly select that lake for serving.

For a hosted frontend, set URL-only public variables in the frontend runtime:
`NEXT_PUBLIC_DATA_PRODUCT_URL_CRYPTO`, `NEXT_PUBLIC_DATA_PRODUCT_URL_STOCKS`,
`NEXT_PUBLIC_DATA_PRODUCT_URL_FX`, `NEXT_PUBLIC_DATA_PRODUCT_URL_DEFI`,
`NEXT_PUBLIC_DATA_PRODUCT_URL_FLIGHTS`, `NEXT_PUBLIC_DATA_PRODUCT_URL_SEO`,
`NEXT_PUBLIC_DATA_PRODUCT_URL_AI_TOOLS`, `NEXT_PUBLIC_DATA_PRODUCT_URL_NEWS`, and
`NEXT_PUBLIC_DATA_PRODUCT_URL_DISCOVERY`. Keep API tokens server-side; all
domain APIs are read-only and still require their own lake configuration.
The static HTML consumer accepts the equivalent URL-only map as
`window.DATA_PRODUCT_URLS` before loading `js/data-products-browser.js`.

Typed client (Node/TypeScript):

```ts
import { fetchProductRecords, fetchAllProducts } from "./src/data-products/index.ts";

const crypto = await fetchProductRecords("crypto", { useFixtures: true });
// crypto.envelope.items — domain-specific records
```

## UI states

The dashboard surfaces: **loading**, **ready**, **stale**, **empty**,
**timeout**, **unavailable**, and **error**. When a local API is down, the UI
falls back to sanitized fixtures under `fixtures/data-products/`.

## Free-only policy

- `FREE_ONLY=true`
- `ALLOW_PAID_PROVIDERS=false`
- `ALLOW_EXTERNAL_WRITES=false`
- No Telegram / Todoist / email writes from this consumer
- No Firecrawl or paid search/market APIs

## Tests

Requires Node.js 22.6+ (tests run TypeScript via `--experimental-strip-types`).

```bash
npm ci
npm run build:browser  # regenerate the tracked static bundle after source edits
npm run check          # typecheck + generated bundle freshness + tests
```

Contract tests mock HTTP responses and never call real upstream providers.
`tests/browser-bundle.test.ts` runs the generated
`js/data-products-browser.js` in a sandbox and checks its public browser API.
Edit `src/data-products/`, then run `npm run build:browser`; the typed client
owns the catalog, envelope validation, state mapping and request deadlines.
`browser.js` adds browser URL/fixture settings and rendering; the build swaps
the Node fixture loader for `browser-fixture.ts`. CI runs
`npm run check:browser` and fails if the committed bundle differs from source.
`tests/static-site.test.ts` checks that every page's
local assets exist; the site is served from the repository root, so do not add
a `public/` copy of `js/`, `css/` or `fixtures/`. `tests/dom.test.ts` runs the
bundle in a happy-dom window and checks what `mountDashboard` and
`mountProductPage` render: loading/`aria-busy`, ready, empty, timeout and
unavailable states, the dashboard banner (ok/warn/bad by how many products
loaded) and HTML escaping of item keys and values.

Envelope validation checks every required field, known statuses, object records,
a parseable retrieval timestamp and the requested product's schema version.
`error`, `forbidden` and `malformed` remain errors even with records;
`not_found` and `accepted` are unavailable. Unknown statuses fail validation.
Failure and pending envelopes expose no records to consumers or rendered tables,
including fixture/fallback paths; `ok` and `stale` retain their records.
The request timeout covers both response headers and JSON parsing, including
health reads and browser fixture loads. A fallback has its own deadline.

## Layout

- `src/data-products/` — typed catalog + client
- `fixtures/data-products/` — sanitized offline envelopes
- `js/`, `css/`, `*.html` — static consumer UI
- `archive/legacy-static/` — old scraper-generated snapshots (not used at runtime)

## Safety

Do not publish, deploy, commit secrets, enable billing, or point this consumer
at paid providers without owner approval.
