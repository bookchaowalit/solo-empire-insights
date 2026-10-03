import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  DATA_PRODUCT_CATALOG,
  FREE_ONLY_DEFAULTS,
  fetchAllProducts,
  fetchProductRecords,
  fetchProductHealth,
  isDataProductEnvelope,
  sanitizeUserFacingMessage,
} from "../src/data-products/index.ts";
import type { DataProductEnvelope } from "../src/data-products/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

async function loadFixture(productId: string): Promise<DataProductEnvelope> {
  const raw = await readFile(
    join(root, "fixtures", "data-products", `${productId}.json`),
    "utf8",
  );
  return JSON.parse(raw) as DataProductEnvelope;
}

function mockFetch(handlers: Record<string, () => Response | Promise<Response>>): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method !== "GET") {
      throw new Error(`Non-GET method forbidden in consumer: ${method}`);
    }
    for (const [prefix, handler] of Object.entries(handlers)) {
      if (url.includes(prefix)) return handler();
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
}

it("explicit URL wins over environment and malformed empty data remains an error", async () => {
  const original = process.env.NEXT_PUBLIC_DATA_PRODUCT_URL_CRYPTO;
  process.env.NEXT_PUBLIC_DATA_PRODUCT_URL_CRYPTO = "http://127.0.0.1:9999";
  try {
    const fixture = await loadFixture("crypto");
    const result = await fetchProductRecords("crypto", {
      useFixtures: false,
      baseUrl: "http://127.0.0.1:8999",
      fetchImpl: async (input) => {
        assert.ok(String(input).startsWith("http://127.0.0.1:8999/"));
        return new Response(JSON.stringify({ ...fixture, data_status: "malformed", items: [] }));
      },
    });
    assert.equal(result.source, "api");
    assert.equal(result.state, "error");
  } finally {
    if (original === undefined) delete process.env.NEXT_PUBLIC_DATA_PRODUCT_URL_CRYPTO;
    else process.env.NEXT_PUBLIC_DATA_PRODUCT_URL_CRYPTO = original;
  }
});

describe("data-product catalog", () => {
  it("covers the seven frozen ports plus news.v1 and discovery.v1", () => {
    assert.equal(DATA_PRODUCT_CATALOG.length, 9);
    const ports = DATA_PRODUCT_CATALOG.map((p) => p.port).sort();
    assert.deepEqual(ports, [8101, 8102, 8103, 8104, 8105, 8106, 8107, 8108, 8110]);
    assert.equal(FREE_ONLY_DEFAULTS.freeOnly, true);
    assert.equal(FREE_ONLY_DEFAULTS.allowExternalWrites, false);
    assert.equal(FREE_ONLY_DEFAULTS.allowPaidProviders, false);
  });

  it("binds every product to a unique loopback base URL", () => {
    const urls = DATA_PRODUCT_CATALOG.map((p) => p.baseUrl);
    assert.equal(new Set(urls).size, 9);
    for (const product of DATA_PRODUCT_CATALOG) {
      assert.match(product.baseUrl, /^http:\/\/127\.0\.0\.1:(810[1-8]|8110)$/);
    }
  });
});

describe("envelope contract", () => {
  for (const product of DATA_PRODUCT_CATALOG) {
    it(`fixture envelope for ${product.id} matches contract`, async () => {
      const env = await loadFixture(product.id);
      assert.equal(isDataProductEnvelope(env), true);
      assert.equal(env.schema_version, product.schemaVersion);
      assert.equal(env.source, product.repo);
      assert.ok(Array.isArray(env.items));
      assert.ok(env.items.length > 0, "sanitized fixtures should be non-empty");
      for (const key of [
        "schema_version",
        "source",
        "retrieved_at",
        "data_status",
        "items",
        "next_cursor",
      ]) {
        assert.ok(key in env, `missing ${key}`);
      }
      // Fixtures must not look like paid-provider or secret material.
      const raw = JSON.stringify(env);
      assert.equal(/api[_-]?key|bearer\s|password|secret_token|FIRECRAWL|TEQUILA/i.test(raw), false);
    });
  }
});

describe("sanitizeUserFacingMessage", () => {
  it("never echoes raw provider or network error text", () => {
    assert.equal(
      sanitizeUserFacingMessage("unavailable", { usingFixture: true }),
      "Local API unavailable; using fixture fallback",
    );
    assert.equal(
      sanitizeUserFacingMessage("timeout", { usingFixture: true }),
      "Local API timed out; using fixture fallback",
    );
    assert.equal(
      sanitizeUserFacingMessage("http", { status: 503, usingFixture: true }),
      "Local API returned HTTP 503; using fixture fallback",
    );
    assert.equal(
      sanitizeUserFacingMessage("invalid_envelope"),
      "Response is not a versioned data-product envelope",
    );
    assert.equal(sanitizeUserFacingMessage("fixture_failed"), "Offline fixture unavailable");
  });
});

describe("fetchProductRecords", () => {
  it("never labels failure or pending statuses ready even when records exist", async () => {
    const fixture = await loadFixture("crypto");
    for (const data_status of ["error", "forbidden", "malformed", "not_found", "accepted"]) {
      const result = await fetchProductRecords("crypto", {
        useFixtures: false,
        fetchImpl: async () => new Response(JSON.stringify({ ...fixture, data_status })),
      });
      assert.equal(result.state, data_status === "not_found" || data_status === "accepted" ? "unavailable" : "error", data_status);
      assert.equal(result.envelope, null, data_status);
      assert.equal(result.errorMessage, "Unable to load data product", data_status);
    }
  });

  it("suppresses failure fixture records and preserves ok/stale records", async () => {
    const fixture = await loadFixture("crypto");
    for (const data_status of ["error", "forbidden", "malformed", "not_found", "accepted", "ok", "stale"]) {
      const result = await fetchProductRecords("crypto", {
        useFixtures: true,
        loadFixture: () => ({ ...fixture, data_status }),
      });
      if (data_status === "ok" || data_status === "stale") {
        assert.deepEqual(result.envelope?.items, fixture.items, data_status);
      } else {
        assert.equal(result.envelope, null, data_status);
      }
    }
  });

  it("rejects invalid envelope fields and the wrong product schema", async () => {
    const fixture = await loadFixture("crypto");
    for (const fields of [
      { schema_version: "stock.v1" }, { schema_version: "" }, { source: "" },
      { retrieved_at: null }, { retrieved_at: "not-a-date" },
      { data_status: "unknown" }, { data_status: null }, { next_cursor: 42 },
      { items: [null] }, { items: ["record"] },
    ]) {
      const result = await fetchProductRecords("crypto", {
        useFixtures: false,
        fetchImpl: async () => new Response(JSON.stringify({ ...fixture, ...fields })),
      });
      assert.equal(result.state, "error", JSON.stringify(fields));
      assert.equal(result.envelope, null);
    }
  });

  it("bounds a hanging response body even when fetch ignores abort", { timeout: 1000 }, async () => {
    let signal: AbortSignal | null | undefined;
    const fetchImpl: typeof fetch = async (_input, init) => {
      signal = init?.signal;
      return { ok: true, json: () => new Promise(() => {}) } as Response;
    };
    const result = await fetchProductRecords("crypto", {
      useFixtures: false, fetchImpl, loadFixture, timeoutMs: 10,
    });
    assert.equal(signal?.aborted, true);
    assert.equal(result.state, "timeout");
    assert.equal(result.source, "fixture");
    const health = await fetchProductHealth("crypto", { useFixtures: false, fetchImpl, timeoutMs: 10 });
    assert.equal(health.ok, false);
  });

  it("uses offline fixtures without network when useFixtures=true", async () => {
    let networkCalls = 0;
    const fetchImpl: typeof fetch = async () => {
      networkCalls += 1;
      throw new Error("network should not be called");
    };
    const result = await fetchProductRecords("crypto", {
      useFixtures: true,
      fetchImpl,
      loadFixture,
    });
    assert.equal(networkCalls, 0);
    assert.equal(result.source, "fixture");
    assert.ok(result.envelope);
    assert.equal(isDataProductEnvelope(result.envelope), true);
    assert.ok(["ready", "stale", "empty"].includes(result.state));
    assert.equal(result.freeOnly, true);
    assert.equal(result.allowExternalWrites, false);
  });

  it("parses mocked API envelope into ready state", async () => {
    const fixture = await loadFixture("stocks");
    const live: DataProductEnvelope = {
      ...fixture,
      data_status: "ok",
      retrieved_at: "2026-08-04T00:00:00Z",
    };
    const fetchImpl = mockFetch({
      "127.0.0.1:8102/v1/records": () =>
        new Response(JSON.stringify(live), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });
    const result = await fetchProductRecords("stocks", {
      useFixtures: false,
      fetchImpl,
      loadFixture,
      timeoutMs: 1000,
    });
    assert.equal(result.source, "api");
    assert.equal(result.state, "ready");
    assert.equal(result.envelope?.schema_version, "stock.v1");
    assert.equal(result.envelope?.items.length, live.items.length);
  });

  it("maps empty envelope to empty state", async () => {
    const empty: DataProductEnvelope = {
      schema_version: "fx.v1",
      source: "book-fx-data",
      retrieved_at: "2026-08-04T00:00:00Z",
      data_status: "empty",
      items: [],
      next_cursor: null,
    };
    const fetchImpl = mockFetch({
      "127.0.0.1:8103/v1/records": () =>
        new Response(JSON.stringify(empty), { status: 200 }),
    });
    const result = await fetchProductRecords("fx", {
      useFixtures: false,
      fetchImpl,
      loadFixture,
    });
    assert.equal(result.state, "empty");
  });

  it("maps stale envelope to stale state", async () => {
    const fixture = await loadFixture("defi");
    const stale = { ...fixture, data_status: "stale" };
    const fetchImpl = mockFetch({
      "127.0.0.1:8104/v1/records": () =>
        new Response(JSON.stringify(stale), { status: 200 }),
    });
    const result = await fetchProductRecords("defi", {
      useFixtures: false,
      fetchImpl,
      loadFixture,
    });
    assert.equal(result.state, "stale");
  });

  it("handles timeout and falls back to fixture with safe message", async () => {
    const fetchImpl: typeof fetch = async (_input, init) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
          return;
        }
        signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    };
    const result = await fetchProductRecords("flights", {
      useFixtures: false,
      fetchImpl,
      loadFixture,
      timeoutMs: 20,
    });
    assert.equal(result.source, "fixture");
    assert.equal(result.state, "timeout");
    assert.equal(result.errorMessage, "Local API timed out; using fixture fallback");
    assert.equal(/stack|ECONNREFUSED|secret|api[_-]?key/i.test(String(result.errorMessage)), false);
  });

  it("handles API unavailable with fixture fallback and safe message", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError("fetch failed: ECONNREFUSED super-secret-token=xyz");
    };
    const result = await fetchProductRecords("seo", {
      useFixtures: false,
      fetchImpl,
      loadFixture,
    });
    assert.equal(result.source, "fixture");
    assert.ok(result.envelope);
    assert.equal(result.errorMessage, "Local API unavailable; using fixture fallback");
    assert.equal(String(result.errorMessage).includes("super-secret-token"), false);
    assert.equal(String(result.errorMessage).includes("ECONNREFUSED"), false);
  });

  it("handles HTTP error status with fixture fallback", async () => {
    const fetchImpl = mockFetch({
      "127.0.0.1:8107/v1/records": () => new Response("upstream boom", { status: 502 }),
    });
    const result = await fetchProductRecords("ai_tools", {
      useFixtures: false,
      fetchImpl,
      loadFixture,
    });
    assert.equal(result.source, "fixture");
    assert.ok(result.envelope);
    assert.equal(result.errorMessage, "Local API returned HTTP 502; using fixture fallback");
  });

  it("rejects non-envelope API payloads", async () => {
    const fetchImpl = mockFetch({
      "127.0.0.1:8101/v1/records": () =>
        new Response(JSON.stringify({ rows: [] }), { status: 200 }),
    });
    const result = await fetchProductRecords("crypto", {
      useFixtures: false,
      fetchImpl,
      loadFixture: async () => {
        throw new Error("no fixture in this test");
      },
    });
    assert.equal(result.source, "api");
    assert.equal(result.state, "error");
    assert.equal(result.errorMessage, "Response is not a versioned data-product envelope");
  });

  it("fetchAllProducts returns nine results in fixture mode", async () => {
    const results = await fetchAllProducts({ useFixtures: true, loadFixture });
    assert.equal(results.length, 9);
    assert.ok(results.every((r) => r.source === "fixture"));
    assert.ok(results.every((r) => r.freeOnly === true));
    assert.ok(results.every((r) => r.allowExternalWrites === false));
  });

  it("only issues GET requests to /v1/records", async () => {
    const methods: string[] = [];
    const urls: string[] = [];
    const fixture = await loadFixture("crypto");
    const fetchImpl: typeof fetch = async (input, init) => {
      methods.push((init?.method ?? "GET").toUpperCase());
      urls.push(String(input));
      return new Response(JSON.stringify({ ...fixture, data_status: "ok" }), { status: 200 });
    };
    await fetchProductRecords("crypto", {
      useFixtures: false,
      fetchImpl,
      loadFixture,
    });
    assert.deepEqual(methods, ["GET"]);
    assert.equal(urls.length, 1);
    assert.match(urls[0], /\/v1\/records\?limit=/);
    assert.equal(urls[0].includes("/v1/refresh"), false);
  });

  it("does not expose scraper legacy paths or paid-provider hooks", async () => {
    const src = await readFile(
      join(root, "src", "data-products", "client.ts"),
      "utf8",
    );
    assert.equal(src.includes("book-finance/data"), false);
    assert.equal(src.includes("book-scraping"), false);
    assert.equal(src.includes("scrape_"), false);
    assert.equal(src.includes("FIRECRAWL"), false);
    assert.equal(src.includes("TEQUILA"), false);
    assert.equal(/method:\s*["']POST["']/.test(src), false);
    assert.equal(src.includes("/v1/refresh"), true); // documented as never called
    assert.match(src, /method:\s*"GET"/);
  });

  it("browser bundle keeps free-only flags and safe messaging", async () => {
    const browser = await readFile(join(root, "js", "data-products-browser.js"), "utf8");
    // The browser API's actual flags are verified in browser-bundle.test.ts.
    assert.match(browser, /FREE_ONLY:/);
    assert.match(browser, /ALLOW_EXTERNAL_WRITES:/);
    assert.match(browser, /ALLOW_PAID_PROVIDERS:/);
    assert.match(browser, /sanitizeUserFacingMessage/);
    assert.match(browser, /aria-live/);
    assert.equal(browser.includes("scraper-dashboard"), false);
    assert.equal(browser.includes("FIRECRAWL"), false);
    assert.equal(/method:\s*["']POST["']/.test(browser), false);
    assert.match(browser, /never POST \/v1\/refresh/);
  });

  it("maps loading-related consumer states without raw provider errors", async () => {
    const ready = await fetchProductRecords("crypto", {
      useFixtures: false,
      loadFixture,
      fetchImpl: mockFetch({
        "127.0.0.1:8101/v1/records": async () =>
          new Response(
            JSON.stringify({
              ...(await loadFixture("crypto")),
              data_status: "ok",
            }),
            { status: 200 },
          ),
      }),
    });
    assert.equal(ready.state, "ready");

    const stale = await fetchProductRecords("stocks", {
      useFixtures: false,
      loadFixture,
      fetchImpl: mockFetch({
        "127.0.0.1:8102/v1/records": async () =>
          new Response(
            JSON.stringify({ ...(await loadFixture("stocks")), data_status: "stale" }),
            { status: 200 },
          ),
      }),
    });
    assert.equal(stale.state, "stale");

    const empty = await fetchProductRecords("fx", {
      useFixtures: false,
      loadFixture,
      fetchImpl: mockFetch({
        "127.0.0.1:8103/v1/records": () =>
          new Response(
            JSON.stringify({
              schema_version: "fx.v1",
              source: "book-fx-data",
              retrieved_at: "2026-08-04T00:00:00Z",
              data_status: "empty",
              items: [],
              next_cursor: null,
            }),
            { status: 200 },
          ),
      }),
    });
    assert.equal(empty.state, "empty");
  });

  it("index.html overview page exists for offline dashboard", async () => {
    const index = await readFile(join(root, "index.html"), "utf8");
    assert.match(index, /dashboard-root/);
    assert.match(index, /mountDashboard/);
    assert.match(index, /aria-label="Data products"/);
    assert.match(index, /Skip to content/);
  });
});
