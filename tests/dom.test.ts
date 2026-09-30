/**
 * DOM-level tests for the static pages' mount functions: the browser bundle
 * runs inside a happy-dom window with a stubbed fetch, and the rendered markup
 * is checked for loading, ready, empty, timeout and unavailable states and
 * for escaping of item data.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { Window } from "happy-dom";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundleSource = await readFile(join(root, "js", "data-products-browser.js"), "utf8");

type Handler = (url: string) => Promise<Response>;
type Api = {
  mountDashboard: (root: unknown) => Promise<void>;
  mountProductPage: (id: string, root: unknown) => Promise<void>;
};

function envelope(productId: string, items: Array<Record<string, unknown>>, dataStatus = "fresh") {
  return {
    schema_version: `${productId}.v1`,
    source: `book-${productId}-data`,
    retrieved_at: "2026-09-01T00:00:00Z",
    data_status: dataStatus,
    items,
    next_cursor: null,
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function mount(handler: Handler) {
  const window = new Window({ url: "http://localhost/index.html" });
  const document = window.document;
  document.body.innerHTML = '<div id="app"></div>';
  const fetch = (input: string) => handler(String(input));
  // The bundle is a classic script: run it with the window's globals in scope.
  const run = new Function("window", "document", "location", "fetch", "globalThis", bundleSource);
  run(window, document, window.location, fetch, window);
  const api = (window as unknown as { DataProducts: Api }).DataProducts;
  return { window, document, api, app: document.getElementById("app")! };
}

describe("mountProductPage", () => {
  it("shows a loading banner and aria-busy until the read settles, then renders rows", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { api, app } = mount(async (url) => {
      await gate;
      assert.match(url, /^http:\/\/127\.0\.0\.1:8101\/v1\/records\?limit=50$/);
      return json(envelope("crypto", [{ coin_id: "bitcoin", price: "65000" }]));
    });

    const pending = api.mountProductPage("crypto", app);
    assert.equal(app.getAttribute("aria-busy"), "true");
    assert.match(app.querySelector(".status-banner")!.textContent!, /Loading/);
    release();
    await pending;

    assert.equal(app.getAttribute("aria-busy"), "false");
    assert.match(app.querySelector(".status-banner")!.className, /\bok\b/);
    const headers = [...app.querySelectorAll("th")].map((th) => th.textContent);
    assert.deepEqual(headers, ["coin_id", "price"]);
    assert.equal(app.querySelectorAll("tbody tr").length, 1);
  });

  it("escapes item keys and values instead of injecting markup", async () => {
    const hostile = '<img src=x onerror="alert(1)">';
    const { api, app } = mount(async () => json(envelope("news", [{ [hostile]: hostile, title: "a'b" }])));

    await api.mountProductPage("news", app);

    // Compare with ===: assert on a DOM node would try to inspect the whole window.
    assert.ok(app.querySelector("img") === null, "no element may be created from item data");
    assert.ok(app.textContent!.includes(hostile));
    assert.ok(app.querySelector("tbody")!.textContent!.includes("a'b"));
  });

  it("gives every record's fields a column and shows 0, false and nested values", async () => {
    const { api, app } = mount(async () =>
      json(envelope("stocks", [{ symbol: "AAA", change_pct: 0 }, { symbol: "BBB", halted: false, meta: { lot: 100 } }])),
    );

    await api.mountProductPage("stocks", app);

    const headers = [...app.querySelectorAll("th")].map((th) => th.textContent);
    assert.deepEqual(headers, ["symbol", "change_pct", "halted", "meta"]);
    const cells = [...app.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent));
    assert.deepEqual(cells, [
      ["AAA", "0", "", ""],
      ["BBB", "", "false", '{"lot":100}'],
    ]);
  });

  it("says so when the envelope has no records instead of an empty table", async () => {
    const { api, app } = mount(async () => json(envelope("fx", [], "empty")));

    await api.mountProductPage("fx", app);

    assert.match(app.querySelector(".status-banner")!.className, /\bwarn\b/);
    assert.ok(app.querySelector("table") === null, "an empty envelope renders no table");
    assert.match(app.querySelector("#dp-body")!.textContent!, /No records/);
  });

  it("falls back to the fixture on timeout and labels it", async () => {
    const { api, app } = mount(async (url) => {
      if (url.startsWith("fixtures/")) return json(envelope("fx", [{ base: "USD", currency: "THB", rate: "36.1" }]));
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      throw error;
    });

    await api.mountProductPage("fx", app);

    const banner = app.querySelector(".status-banner")!;
    assert.match(banner.textContent!, /Timeout \(fixture\) · offline fixture/);
    assert.match(app.querySelector(".note")!.textContent!, /timed out; using fixture fallback/);
    assert.equal(app.querySelectorAll("tbody tr").length, 1);
  });

  it("shows a sanitized message when neither the API nor a fixture is available", async () => {
    const { api, app } = mount(async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:8103 secret-token=abc");
    });

    await api.mountProductPage("fx", app);

    assert.match(app.querySelector(".status-banner")!.className, /\bbad\b/);
    assert.equal(app.querySelector("#dp-body")!.textContent, "Local API unavailable");
    assert.ok(!app.textContent!.includes("secret-token"));
  });
});

describe("mountDashboard", () => {
  it("renders one card per product and a banner that reflects how many loaded", async () => {
    const { api, app } = mount(async (url) => {
      if (url.startsWith("http://127.0.0.1:8101/")) return json(envelope("crypto", [{ coin_id: "bitcoin", currency: "usd", price: "1" }]));
      return new Response("down", { status: 503 });
    });

    await api.mountDashboard(app);

    const cards = app.querySelectorAll("article.card");
    assert.equal(cards.length, 9);
    assert.match(app.querySelector("#card-crypto .badge")!.textContent!, /Ready · local API/);
    assert.match(app.querySelector("#card-crypto li")!.textContent!, /bitcoin · usd · 1/);
    assert.match(app.querySelector("#card-fx .body")!.textContent!, /Local API returned HTTP 503/);
    const banner = app.querySelector(".status-banner")!;
    assert.match(banner.textContent!, /^1\/9 products loaded/);
    assert.match(banner.className, /\bwarn\b/, "a partial load must not look fully healthy");
    assert.equal(app.getAttribute("aria-busy"), "false");
  });

  it("keeps a zero price, change or APY in the card preview", async () => {
    const { api, app } = mount(async (url) => {
      if (url.startsWith("http://127.0.0.1:8101/")) return json(envelope("crypto", [{ coin_id: "dust", currency: "usd", price: 0 }]));
      if (url.includes("/v1/records")) {
        return json(envelope("stocks", [{ symbol: "FLAT", price: "10", change_pct: 0, project: "pool", apy: 0 }]));
      }
      return new Response("down", { status: 503 });
    });

    await api.mountDashboard(app);

    assert.equal(app.querySelector("#card-crypto li")!.textContent, "dust · usd · 0");
    assert.equal(app.querySelector("#card-stocks li")!.textContent, "FLAT · 10 (0%)");
    assert.equal(app.querySelector("#card-defi li")!.textContent, "pool · FLAT · APY 0%");
  });

  it("marks the banner bad when nothing loaded and ok when everything did", async () => {
    const down = mount(async () => new Response("down", { status: 500 }));
    await down.api.mountDashboard(down.app);
    assert.match(down.app.querySelector(".status-banner")!.className, /\bbad\b/);

    const up = mount(async (url) => {
      const port = Number(new URL(url).port);
      return json(envelope(String(port), [{ record_id: "r" }]));
    });
    await up.api.mountDashboard(up.app);
    assert.match(up.app.querySelector(".status-banner")!.className, /\bok\b/);
  });
});
