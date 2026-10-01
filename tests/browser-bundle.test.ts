/**
 * The static pages load js/data-products-browser.js, a hand-maintained twin of
 * src/data-products. These tests run that bundle in a sandbox so the browser
 * path cannot silently drift from the typed client or its contract.
 */
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import vm from "node:vm";

import { DATA_PRODUCT_CATALOG } from "../src/data-products/index.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundleSource = await readFile(join(root, "js", "data-products-browser.js"), "utf8");

type FetchCall = { url: string; method: string };
type BrowserApi = {
  CATALOG: Array<Record<string, unknown>>;
  fetchProductRecords: (id: string, options?: Record<string, unknown>) => Promise<any>;
  isEnvelope: (value: unknown) => boolean;
  escapeHtml: (value: unknown) => string;
  FREE_ONLY: boolean;
  ALLOW_EXTERNAL_WRITES: boolean;
  ALLOW_PAID_PROVIDERS: boolean;
};

async function fixtureText(productId: string): Promise<string> {
  return readFile(join(root, "fixtures", "data-products", `${productId}.json`), "utf8");
}

function loadBundle(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
  globals: Record<string, unknown> = {},
): { api: BrowserApi; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const context: Record<string, unknown> = {
    location: { search: "" },
    document: { querySelector: () => null },
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ url, method });
      return handler(url, init);
    },
    ...globals,
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(bundleSource, context, { filename: "data-products-browser.js" });
  return { api: context.DataProducts as BrowserApi, calls };
}

function fixtureOrApi(apiResponse: () => Response) {
  return async (url: string) => {
    if (url.startsWith("fixtures/")) {
      const id = url.split("/").pop()!.replace(/\.json$/, "");
      return new Response(await fixtureText(id), { status: 200 });
    }
    return apiResponse();
  };
}

describe("browser bundle parity", () => {
  it("catalog matches the typed catalog exactly", () => {
    const { api } = loadBundle(async () => new Response("{}"));
    assert.deepEqual(
      JSON.parse(JSON.stringify(api.CATALOG)),
      JSON.parse(JSON.stringify(DATA_PRODUCT_CATALOG)),
    );
    assert.equal(api.FREE_ONLY, true);
    assert.equal(api.ALLOW_EXTERNAL_WRITES, false);
    assert.equal(api.ALLOW_PAID_PROVIDERS, false);
  });

  it("every catalog product has a fixture and a static page", async () => {
    for (const product of DATA_PRODUCT_CATALOG) {
      await access(join(root, "fixtures", "data-products", `${product.id}.json`));
      await access(join(root, `${product.id}.html`));
    }
  });
});

describe("browser fetchProductRecords", () => {
  it("reads live envelopes with GET /v1/records only", async () => {
    const body = await fixtureText("fx");
    const { api, calls } = loadBundle(async () => new Response(body, { status: 200 }));
    const result = await api.fetchProductRecords("fx", { useFixtures: false, limit: 5 });
    assert.equal(result.source, "api");
    assert.equal(result.state, JSON.parse(body).data_status === "stale" ? "stale" : "ready");
    assert.deepEqual(calls, [{ url: "http://127.0.0.1:8103/v1/records?limit=5", method: "GET" }]);
  });

  it("honours window.DATA_PRODUCT_URLS overrides", async () => {
    const body = await fixtureText("crypto");
    const { api, calls } = loadBundle(async () => new Response(body), {
      DATA_PRODUCT_URLS: { crypto: " https://api.example.test/crypto/ " },
    });
    await api.fetchProductRecords("crypto", { useFixtures: false });
    assert.equal(calls[0].url, "https://api.example.test/crypto/v1/records?limit=50");
  });

  it("falls back to fixtures on HTTP errors with a sanitized message", async () => {
    const { api } = loadBundle(
      fixtureOrApi(() => new Response("Traceback: secret stack", { status: 503 })),
    );
    const result = await api.fetchProductRecords("stocks", { useFixtures: false });
    assert.equal(result.source, "fixture");
    assert.equal(result.errorMessage, "Local API returned HTTP 503; using fixture fallback");
    assert.doesNotMatch(JSON.stringify(result.errorMessage), /Traceback|secret/);
  });

  it("reports timeout when the API hangs", async () => {
    const { api } = loadBundle(async (url, init) => {
      if (url.startsWith("fixtures/")) throw new Error("no fixture");
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      });
    });
    const result = await api.fetchProductRecords("defi", { useFixtures: false, timeoutMs: 10 });
    assert.equal(result.state, "timeout");
    assert.equal(result.envelope, null);
    assert.equal(result.errorMessage, "Local API timed out");
  });

  it("rejects non-envelope API bodies as errors", async () => {
    const { api } = loadBundle(async () => new Response(JSON.stringify({ items: [] })));
    const result = await api.fetchProductRecords("seo", { useFixtures: false });
    assert.equal(result.state, "error");
    assert.equal(result.errorMessage, "Response is not a versioned data-product envelope");
  });

  it("returns an error result for unknown products without fetching", async () => {
    const { api, calls } = loadBundle(async () => new Response("{}"));
    const result = await api.fetchProductRecords("paid_provider");
    assert.equal(result.state, "error");
    assert.equal(calls.length, 0);
  });
});

describe("browser escapeHtml", () => {
  it("escapes every HTML-significant character including single quotes", () => {
    const { api } = loadBundle(async () => new Response("{}"));
    assert.equal(
      api.escapeHtml(`<a href='x' title="y">&</a>`),
      "&lt;a href=&#39;x&#39; title=&quot;y&quot;&gt;&amp;&lt;/a&gt;",
    );
  });
});
