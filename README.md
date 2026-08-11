# Solo Empire Insights

Consumer application for the eight free-only **data-product APIs**.

This repo no longer scrapes upstream providers and does not import legacy
scraper modules or read legacy scraper CSV paths. It only:

1. calls local read-only HTTP APIs on ports **8101–8108**, or
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
| Opportunities | 8108 | `opportunity.v1` | `book-opportunity-intelligence` |

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
# Start all free-only local APIs 8101–8108 (fixture/local data only)
python3 ../../book-apps/tools/book-opportunity-intelligence/scripts/start_local_data_apis.py

# Offline demo (no network, fixtures only)
python3 -m http.server 4173
# open http://127.0.0.1:4173/?fixtures=1

# Live local APIs (same server, no ?fixtures=1)
# open http://127.0.0.1:4173/
# Domain APIs allow CORS only for http://127.0.0.1:* and http://localhost:*

# Automated browser-consumer checks (APIs must be up)
node scripts/verify-browser-consumers.mjs
```

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

```bash
npm test
npm run typecheck
```

Contract tests mock HTTP responses and never call real upstream providers.

## Layout

- `src/data-products/` — typed catalog + client
- `fixtures/data-products/` — sanitized offline envelopes
- `js/`, `css/`, `*.html` — static consumer UI
- `archive/legacy-static/` — old scraper-generated snapshots (not used at runtime)

## Safety

Do not publish, deploy, commit secrets, enable billing, or point this consumer
at paid providers without owner approval.
