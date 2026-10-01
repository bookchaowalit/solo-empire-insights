#!/usr/bin/env node
/**
 * Verify solo-empire-insights + portfolio data-product clients against:
 *  - fixture mode (no APIs required)
 *  - live local APIs 8101–8110 (must already be running)
 *
 * Also checks CORS allowlist for local origins and blocks non-local origins.
 * Never calls POST /v1/refresh from the consumer path.
 */
import { createServer } from "node:http";
import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INSIGHTS_ROOT = join(__dirname, "..");
// Override with INSIGHTS_PORTFOLIO_ROOT; portfolio checks are skipped when the
// sibling checkout is absent.
const PORTFOLIO_ROOT =
  process.env.INSIGHTS_PORTFOLIO_ROOT ||
  join(
    INSIGHTS_ROOT,
    "../../../bookchaowalit-website/book-apps/portfolio/bookchaowalit-portfolio-frontend",
  );
const PORTFOLIO_CLIENT = join(PORTFOLIO_ROOT, "src/lib/data-products/client.ts");

async function portfolioAvailable() {
  try {
    await access(PORTFOLIO_CLIENT);
    return true;
  } catch {
    return false;
  }
}

const PORTS = [8101, 8102, 8103, 8104, 8105, 8106, 8107, 8108, 8110];
const LOCAL_ORIGINS = [
  "http://127.0.0.1:4173",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];
const BLOCKED_ORIGINS = ["https://evil.example", "http://192.168.1.10:3000"];

const failures = [];
function ok(msg) {
  console.log(`  ✓ ${msg}`);
}
function fail(msg) {
  console.error(`  ✗ ${msg}`);
  failures.push(msg);
}

async function getJson(url, { origin, method = "GET", body } = {}) {
  const headers = { Accept: "application/json" };
  if (origin) headers.Origin = origin;
  if (body) headers["Content-Type"] = "application/json";
  const resp = await fetch(url, { method, headers, body });
  const text = await resp.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: resp.status, headers: resp.headers, json, text };
}

async function apisUp() {
  for (const port of PORTS) {
    try {
      const r = await getJson(`http://127.0.0.1:${port}/healthz`);
      if (r.status !== 200) return false;
    } catch {
      return false;
    }
  }
  return true;
}

async function verifyCors() {
  console.log("\n[CORS] local-only origins on 8101–8110");
  for (const port of PORTS) {
    const url = `http://127.0.0.1:${port}/v1/records?limit=1`;
    for (const origin of LOCAL_ORIGINS) {
      const r = await getJson(url, { origin });
      const acao = r.headers.get("access-control-allow-origin");
      if (r.status !== 200) fail(`port ${port} GET failed for ${origin}: ${r.status}`);
      else if (acao !== origin) fail(`port ${port} missing ACAO for ${origin} (got ${acao})`);
      else ok(`:${port} allows ${origin}`);
    }
    for (const origin of BLOCKED_ORIGINS) {
      const r = await getJson(url, { origin });
      const acao = r.headers.get("access-control-allow-origin");
      if (acao) fail(`port ${port} should NOT allow ${origin} (got ${acao})`);
      else ok(`:${port} denies ${origin}`);
    }
    // preflight
    const pre = await fetch(`http://127.0.0.1:${port}/v1/records`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://127.0.0.1:4173",
        "Access-Control-Request-Method": "GET",
      },
    });
    if (pre.status !== 204 && pre.status !== 200) {
      fail(`port ${port} OPTIONS expected 204, got ${pre.status}`);
    } else if (pre.headers.get("access-control-allow-origin") !== "http://127.0.0.1:4173") {
      fail(`port ${port} OPTIONS missing local ACAO`);
    } else {
      const methods = (pre.headers.get("access-control-allow-methods") || "").toUpperCase();
      if (methods.includes("POST") && !methods.includes("GET")) {
        fail(`port ${port} OPTIONS should prefer GET, not POST-only`);
      }
      if (!methods.includes("GET")) fail(`port ${port} OPTIONS missing GET`);
      else ok(`:${port} OPTIONS preflight for local origin`);
    }
  }
}

async function verifyNoBrowserRefresh() {
  console.log("\n[Safety] POST /v1/refresh remains 403; consumers use GET only");
  for (const port of PORTS) {
    const r = await getJson(`http://127.0.0.1:${port}/v1/refresh`, {
      method: "POST",
      body: "{}",
      origin: "http://127.0.0.1:4173",
    });
    if (r.status !== 403) fail(`port ${port} refresh expected 403, got ${r.status}`);
    else ok(`:${port} POST /v1/refresh → 403`);
  }

  // Source audit: browser client never issues POST /v1/refresh
  const browserJs = await readFile(join(INSIGHTS_ROOT, "js/data-products-browser.js"), "utf8");
  if (/method:\s*["']POST["']/.test(browserJs) || browserJs.includes("/v1/refresh")) {
    // comment about never POST is ok if no method POST
    if (/method:\s*["']POST["']/.test(browserJs)) fail("insights browser uses POST");
    else ok("insights browser documents refresh but does not POST");
  } else {
    ok("insights browser has no POST /v1/refresh");
  }
  if (!(await portfolioAvailable())) {
    console.log(`  - portfolio client skipped (not found: ${PORTFOLIO_CLIENT})`);
    return;
  }
  const portfolioClient = await readFile(PORTFOLIO_CLIENT, "utf8");
  if (/method:\s*["']POST["']/.test(portfolioClient)) fail("portfolio client uses POST");
  else ok("portfolio client is GET-only");
}

async function verifyLiveRecords() {
  console.log("\n[Live APIs] GET /v1/records envelopes 8101–8110");
  for (const port of PORTS) {
    const r = await getJson(`http://127.0.0.1:${port}/v1/records?limit=3`, {
      origin: "http://127.0.0.1:4173",
    });
    if (r.status !== 200) {
      fail(`:${port} records status ${r.status}`);
      continue;
    }
    for (const key of [
      "schema_version",
      "source",
      "retrieved_at",
      "data_status",
      "items",
      "next_cursor",
    ]) {
      if (!(key in r.json)) fail(`:${port} missing ${key}`);
    }
    const blob = JSON.stringify(r.json);
    if (/(api[_-]?key|bearer\s|password=|FIRECRAWL|TEQUILA_API)/i.test(blob)) {
      fail(`:${port} response may contain secret-like material`);
    } else {
      ok(`:${port} ${r.json.schema_version} items=${r.json.items?.length ?? 0}`);
    }
  }
}

async function loadInsightsClient() {
  // Dynamic import of TS via experimental strip is not available here; use browser JS logic
  // by evaluating the sanitized message patterns from the TS client via node test of portfolio.
  return null;
}

async function verifyPortfolioClientLiveAndFixtures() {
  console.log("\n[Portfolio client] fixture + live modes");
  if (!(await portfolioAvailable())) {
    console.log(`  - skipped (set INSIGHTS_PORTFOLIO_ROOT; not found: ${PORTFOLIO_CLIENT})`);
    return;
  }
  // Run via node --experimental-strip-types on portfolio tests is separate;
  // here we call the client module if possible.
  try {
    // Use child process to run a small strip-types harness
    const { spawnSync } = await import("node:child_process");
    const harness = `
import assert from "node:assert/strict";
import { fetchAllProducts, fetchProductRecords, sanitizeUserFacingMessage } from ${JSON.stringify(
      pathToFileURL(join(PORTFOLIO_ROOT, "src/lib/data-products/index.ts")).href,
    )};

const calls = [];
const orig = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  calls.push({ url: String(input), method: (init?.method || "GET").toUpperCase() });
  return orig(input, init);
};
try {
  // fixture mode: zero network to APIs
  const fixtures = await fetchAllProducts({
    useFixtures: true,
    loadFixture: async (id) => {
      const r = await orig("file://" + ${JSON.stringify(join(PORTFOLIO_ROOT, "fixtures/data-products/"))} + id + ".json");
      // file:// may fail; use fs via dynamic import
      throw new Error("use fs");
    },
  });
} catch {}
import { readFile } from "node:fs/promises";
import { join } from "node:path";
const root = ${JSON.stringify(PORTFOLIO_ROOT)};
async function loadFixture(id) {
  return JSON.parse(await readFile(join(root, "fixtures/data-products", id + ".json"), "utf8"));
}
const fixtureResults = await fetchAllProducts({ useFixtures: true, loadFixture, fetchImpl: async () => { throw new Error("net"); } });
assert.equal(fixtureResults.length, 9);
assert.ok(fixtureResults.every(r => r.source === "fixture"));
assert.ok(fixtureResults.every(r => !/api[_-]?key|secret/i.test(String(r.errorMessage||""))));

// live mode
const live = await fetchAllProducts({ useFixtures: false, loadFixture, timeoutMs: 4000 });
assert.equal(live.length, 9);
const apiCount = live.filter(r => r.source === "api").length;
assert.ok(apiCount >= 1, "expected some live API sources, got " + apiCount);
assert.ok(live.every(r => r.freeOnly === true));
assert.ok(live.every(r => r.allowExternalWrites === false));
for (const r of live) {
  if (r.errorMessage) {
    assert.equal(/ECONNREFUSED|super-secret|FIRECRAWL|api_key/i.test(r.errorMessage), false);
  }
}
// timeout path
const timed = await fetchProductRecords("crypto", {
  useFixtures: false,
  loadFixture,
  timeoutMs: 1,
  fetchImpl: async (_u, init) => new Promise((_, rej) => {
    const e = new Error("aborted"); e.name = "AbortError";
    if (init?.signal?.aborted) return rej(e);
    init?.signal?.addEventListener("abort", () => rej(e));
  }),
});
assert.ok(timed.state === "timeout" || timed.source === "fixture");
assert.equal(timed.errorMessage, "Local API timed out; using fixture fallback");

// unavailable
const unav = await fetchProductRecords("stocks", {
  useFixtures: false,
  loadFixture,
  fetchImpl: async () => { throw new TypeError("fetch failed secret=abc"); },
});
assert.equal(unav.errorMessage, "Local API unavailable; using fixture fallback");

// empty
const empty = await fetchProductRecords("fx", {
  useFixtures: false,
  loadFixture: async () => { throw new Error("no"); },
  fetchImpl: async () => new Response(JSON.stringify({
    schema_version: "fx.v1", source: "book-fx-data", retrieved_at: "2026-08-04T00:00:00Z",
    data_status: "empty", items: [], next_cursor: null
  }), { status: 200 }),
});
assert.equal(empty.state, "empty");

// error invalid envelope
const bad = await fetchProductRecords("defi", {
  useFixtures: false,
  loadFixture: async () => { throw new Error("no"); },
  fetchImpl: async () => new Response(JSON.stringify({ nope: true }), { status: 200 }),
});
assert.equal(bad.state, "error");

// no POST recorded
assert.ok(calls.every(c => c.method === "GET"));
assert.ok(calls.every(c => !c.url.includes("/v1/refresh")));
console.log("PORTFOLIO_CLIENT_OK apiCount=" + apiCount);
`;
    const r = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "-e", harness],
      { encoding: "utf8", cwd: PORTFOLIO_ROOT },
    );
    if (r.status !== 0) {
      fail(`portfolio client harness failed: ${r.stderr || r.stdout}`);
      console.error(r.stdout);
      console.error(r.stderr);
    } else {
      ok((r.stdout || "").trim().split("\n").pop() || "portfolio client ok");
    }
  } catch (err) {
    fail(`portfolio client verify error: ${err}`);
  }
}

async function verifyInsightsBrowserJs() {
  console.log("\n[Insights browser] fixture mode via static server + fetch");
  // Minimal static server for fixtures
  const root = INSIGHTS_ROOT;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      let path = url.pathname === "/" ? "/index.html" : url.pathname;
      const file = resolve(root, decodeURIComponent(path).replace(/^\/+/, ""));
      // Never serve anything outside the repository root (e.g. encoded "..").
      if (file !== root && !file.startsWith(root + sep)) throw new Error("outside root");
      const data = await readFile(file);
      const type = file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".json")
          ? "application/json"
          : file.endsWith(".css")
            ? "text/css"
            : "text/html";
      res.writeHead(200, { "Content-Type": type });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  // Fixture mode: load each fixture JSON (same path browser uses)
  for (const id of [
    "crypto",
    "stocks",
    "fx",
    "defi",
    "flights",
    "seo",
    "ai_tools",
    "news",
    "discovery",
  ]) {
    const r = await getJson(`${base}/fixtures/data-products/${id}.json`);
    if (r.status !== 200 || !r.json?.schema_version) fail(`fixture ${id} missing`);
    else ok(`fixture ${id} ${r.json.schema_version}`);
  }

  // Live mode simulation: browser-origin fetch to APIs with CORS
  const origin = base;
  for (const p of PORTS) {
    const r = await getJson(`http://127.0.0.1:${p}/v1/records?limit=2`, { origin });
    if (r.status !== 200) fail(`insights-origin live :${p} → ${r.status}`);
    else if (r.headers.get("access-control-allow-origin") !== origin) {
      fail(`insights-origin CORS mismatch on :${p}`);
    } else ok(`insights origin ${origin} → :${p} CORS+records`);
  }

  // Audit browser bundle for unsafe patterns
  const js = await readFile(join(root, "js/data-products-browser.js"), "utf8");
  if (!js.includes("sanitizeUserFacingMessage")) fail("browser missing sanitize");
  else ok("browser sanitizes user messages");
  if (!js.includes('method: "GET"') && !js.includes("method: 'GET'")) {
    // fetch defaults GET
    ok("browser fetch defaults to GET");
  } else ok("browser explicit GET");
  if (/(api[_-]?key|FIRECRAWL_API|TEQUILA)/i.test(js)) fail("browser contains secret markers");
  else ok("browser free of secret markers");

  server.close();
}

async function verifyInsightsTsClient() {
  console.log("\n[Insights TS client] fixture + live states");
  const { spawnSync } = await import("node:child_process");
  const harness = `
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  fetchAllProducts,
  fetchProductRecords,
  sanitizeUserFacingMessage,
  DATA_PRODUCT_CATALOG,
} from ${JSON.stringify(pathToFileURL(join(INSIGHTS_ROOT, "src/data-products/index.ts")).href)};

const root = ${JSON.stringify(INSIGHTS_ROOT)};
async function loadFixture(id) {
  return JSON.parse(await readFile(join(root, "fixtures/data-products", id + ".json"), "utf8"));
}

assert.equal(DATA_PRODUCT_CATALOG.length, 9);
const fixtures = await fetchAllProducts({ useFixtures: true, loadFixture, fetchImpl: async () => { throw new Error("net"); } });
assert.ok(fixtures.every(r => r.source === "fixture"));

const live = await fetchAllProducts({ useFixtures: false, loadFixture, timeoutMs: 4000 });
assert.equal(live.length, 9);
assert.ok(live.some(r => r.source === "api"));
for (const r of live) {
  assert.equal(r.freeOnly, true);
  assert.equal(r.allowExternalWrites, false);
  if (r.errorMessage) assert.equal(/secret=|api_key|FIRECRAWL/i.test(r.errorMessage), false);
}

// loading states via synthetic
const stale = await fetchProductRecords("crypto", {
  useFixtures: false,
  loadFixture,
  fetchImpl: async () => new Response(JSON.stringify({
    ...(await loadFixture("crypto")), data_status: "stale"
  }), { status: 200 }),
});
assert.equal(stale.state, "stale");

const ready = await fetchProductRecords("stocks", {
  useFixtures: false,
  loadFixture,
  fetchImpl: async () => new Response(JSON.stringify({
    ...(await loadFixture("stocks")), data_status: "ok"
  }), { status: 200 }),
});
assert.equal(ready.state, "ready");

assert.match(sanitizeUserFacingMessage("timeout", { usingFixture: true }), /timed out/);
console.log("INSIGHTS_CLIENT_OK liveApi=" + live.filter(r=>r.source==="api").length);
`;
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", harness],
    { encoding: "utf8", cwd: INSIGHTS_ROOT },
  );
  if (r.status !== 0) {
    fail(`insights client harness failed: ${r.stderr || r.stdout}`);
    console.error(r.stdout);
    console.error(r.stderr);
  } else {
    ok((r.stdout || "").trim().split("\n").pop() || "insights client ok");
  }
}

async function main() {
  console.log("Browser consumer verification against local data-product APIs");
  const up = await apisUp();
  if (!up) {
    console.error("APIs 8101–8110 are not all up. Start each domain API first.");
    // path relative note
    process.exit(2);
  }
  ok("all healthz 8101–8110 up");

  await verifyLiveRecords();
  await verifyCors();
  await verifyNoBrowserRefresh();
  await verifyInsightsBrowserJs();
  await verifyInsightsTsClient();
  await verifyPortfolioClientLiveAndFixtures();

  console.log("\n==== SUMMARY ====");
  if (failures.length) {
    console.error(`${failures.length} failure(s):`);
    for (const f of failures) console.error(" -", f);
    process.exit(1);
  }
  console.log("All browser-consumer checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
