/**
 * Static page adapter. Catalog, validation, state and request deadlines are shared
 * with the typed client; only browser configuration and rendering live here.
 */
import {
  DATA_PRODUCT_CATALOG as CATALOG,
  FREE_ONLY_DEFAULTS,
  getProduct,
  fetchProductRecords as fetchTypedProductRecords,
  isDataProductEnvelope as isEnvelope,
  sanitizeUserFacingMessage,
} from "./client.ts";
import { loadFixture } from "./browser-fixture.ts";

const global = typeof window !== "undefined" ? window : globalThis;

function preferFixtures() {
  const params = new URLSearchParams(location.search);
  return params.get("fixtures") === "1" || params.get("offline") === "1" ||
    global.DATA_PRODUCTS_USE_FIXTURES === true;
}

function fetchProductRecords(productId, options = {}) {
  const product = getProduct(productId);
  const configured = global.DATA_PRODUCT_URLS?.[productId];
  const baseUrl = typeof configured === "string" && configured.trim()
    ? configured.trim() : product?.baseUrl;
  const fetchImpl = options.fetchImpl ?? fetch;
  return fetchTypedProductRecords(productId, {
    ...options,
    baseUrl: options.baseUrl ?? baseUrl,
    useFixtures: options.useFixtures ?? preferFixtures(),
    fetchImpl,
    loadFixture: options.loadFixture ?? ((id) => loadFixture(id, { ...options, fetchImpl })),
  });
}

function fetchAllProducts(options) {
  return Promise.all(CATALOG.map((product) => fetchProductRecords(product.id, options)));
}

  function stateLabel(state) {
    return (
      {
        loading: "Loading",
        ready: "Ready",
        empty: "Empty",
        stale: "Stale data",
        timeout: "Timeout (fixture)",
        unavailable: "API unavailable",
        error: "Error",
      }[state] || state
    );
  }

  function stateClass(state) {
    return (
      {
        ready: "ok",
        stale: "warn",
        empty: "warn",
        timeout: "warn",
        unavailable: "bad",
        error: "bad",
        loading: "muted",
      }[state] || "muted"
    );
  }

  function sourceLabel(source) {
    if (source === "api") return "local API";
    if (source === "fixture") return "offline fixture";
    return "no source";
  }

  // Display text for one record value: missing values are blank, but a real 0
  // or false stays visible ("APY 0%", not "APY %"); nested values are shown as
  // JSON instead of "[object Object]".
  function displayValue(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "number" && !isFinite(value)) return "";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  function renderItemPreview(productId, item) {
    if (!item) return "";
    var v = function (value, fallback) {
      var text = displayValue(value);
      return text === "" && fallback !== undefined ? fallback : text;
    };
    if (productId === "crypto") {
      return v(item.coin_id, "?") + " · " + v(item.currency) + " · " + v(item.price);
    }
    if (productId === "stocks") {
      return v(item.symbol, "?") + " · " + v(item.price) + " (" + v(item.change_pct) + "%)";
    }
    if (productId === "fx") {
      return v(item.base) + "/" + v(item.currency) + " · " + v(item.rate);
    }
    if (productId === "defi") {
      return v(item.project) + " · " + v(item.symbol) + " · APY " + v(item.apy) + "%";
    }
    if (productId === "flights") {
      return v(item.origin) + "-" + v(item.destination) + " · ฿" + v(item.price_thb);
    }
    if (productId === "seo") {
      if (item.capture_kind === "owned_page_provenance") {
        var pageStatus = item.page_data_status || (String(item.found).toLowerCase() === "true" ? "reachable" : "unreachable");
        var httpStatus = item.page_http_status ? " · HTTP " + item.page_http_status : "";
        return (item.target_domain || item.keyword || "") + " · " + pageStatus + httpStatus;
      }
      return (item.keyword || "") + " · rank " + v(item.best_rank, "—");
    }
    if (productId === "ai_tools") {
      return (item.name || "") + " · " + (item.source || "");
    }
    if (productId === "news") {
      return (item.headline || item.title || "") + " · " + (item.publisher || item.source || "");
    }
    if (productId === "discovery") {
      return (item.title || "") + " · " + (item.publisher || item.source || "");
    }
    return JSON.stringify(item).slice(0, 120);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  async function mountDashboard(root) {
    if (!root) return;
    root.setAttribute("aria-busy", "true");
    root.innerHTML =
      '<div class="status-banner muted" role="status" aria-live="polite">Loading data products…</div>' +
      '<div class="grid" id="dp-grid" role="list" aria-label="Data product status cards"></div>';
    var grid = root.querySelector("#dp-grid");
    CATALOG.forEach(function (p) {
      var card = document.createElement("article");
      card.className = "card";
      card.id = "card-" + p.id;
      card.setAttribute("role", "listitem");
      card.setAttribute("aria-labelledby", "title-" + p.id);
      card.innerHTML =
        "<h3 id='title-" +
        p.id +
        "'>" +
        p.icon +
        " " +
        escapeHtml(p.title) +
        '</h3><div class="meta">port ' +
        p.port +
        " · " +
        escapeHtml(p.schemaVersion) +
        ' · free-only</div><div class="badge muted" role="status" aria-live="polite">loading</div><div class="body">Fetching local API…</div>';
      grid.appendChild(card);
    });

    var results = await fetchAllProducts();
    var ready = 0;
    results.forEach(function (result) {
      var product = getProduct(result.productId);
      var card = document.getElementById("card-" + result.productId);
      if (!card || !product) return;
      var badge = card.querySelector(".badge");
      var body = card.querySelector(".body");
      badge.className = "badge " + stateClass(result.state);
      badge.textContent = stateLabel(result.state) + " · " + sourceLabel(result.source);
      badge.setAttribute(
        "aria-label",
        product.title +
          " status: " +
          stateLabel(result.state) +
          ", data source: " +
          sourceLabel(result.source),
      );
      if (result.state === "ready" || result.state === "stale") ready += 1;
      if (!result.envelope) {
        body.textContent = result.errorMessage || "No data";
        return;
      }
      var items = result.envelope.items.slice(0, 5);
      var rows = items
        .map(function (item) {
          return "<li>" + escapeHtml(renderItemPreview(result.productId, item)) + "</li>";
        })
        .join("");
      body.innerHTML =
        "<div class='env' aria-label='Envelope metadata'>" +
        "source=" +
        escapeHtml(result.envelope.source) +
        " · data_status=" +
        escapeHtml(String(result.envelope.data_status)) +
        " · items=" +
        result.envelope.items.length +
        " · retrieved " +
        escapeHtml(result.envelope.retrieved_at) +
        "</div><ul>" +
        rows +
        "</ul>" +
        (result.errorMessage
          ? "<div class='note' role='note'>" + escapeHtml(result.errorMessage) + "</div>"
          : "");
    });

    var banner = root.querySelector(".status-banner");
    // A partial or failed load must not look healthy.
    banner.className = "status-banner " + (ready === results.length ? "ok" : ready === 0 ? "bad" : "warn");
    banner.textContent =
      ready +
      "/" +
      results.length +
      " products loaded · free-only · no external writes · GET /v1/records only";
    root.setAttribute("aria-busy", "false");
  }

  async function mountProductPage(productId, root) {
    if (!root) return;
    root.setAttribute("aria-busy", "true");
    root.innerHTML =
      '<div class="status-banner muted" role="status" aria-live="polite">Loading…</div>' +
      '<div class="body" id="dp-body"></div>';
    var result = await fetchProductRecords(productId);
    var banner = root.querySelector(".status-banner");
    var body = root.querySelector("#dp-body");
    banner.className = "status-banner " + stateClass(result.state);
    banner.textContent =
      stateLabel(result.state) +
      " · " +
      sourceLabel(result.source) +
      " · free-only · no external writes";
    banner.setAttribute(
      "aria-label",
      "Status: " + stateLabel(result.state) + ". Data source: " + sourceLabel(result.source),
    );
    if (!result.envelope) {
      body.textContent = result.errorMessage || "No data";
      root.setAttribute("aria-busy", "false");
      return;
    }
    var envelopeMeta =
      "<div class='env' aria-label='Envelope metadata'>" +
      "schema=" +
      escapeHtml(result.envelope.schema_version) +
      " · source=" +
      escapeHtml(result.envelope.source) +
      " · data_status=" +
      escapeHtml(String(result.envelope.data_status)) +
      " · retrieved=" +
      escapeHtml(result.envelope.retrieved_at) +
      "</div>";
    var note = result.errorMessage
      ? "<div class='note' role='note'>" + escapeHtml(result.errorMessage) + "</div>"
      : "";
    if (result.envelope.items.length === 0) {
      body.innerHTML = envelopeMeta + "<p class='empty-state'>No records in this envelope.</p>" + note;
      root.setAttribute("aria-busy", "false");
      return;
    }
    var seoProvenance =
      productId === "seo" &&
      result.envelope.items.some(function (item) {
        return item.capture_kind === "owned_page_provenance";
      });
    var headers = seoProvenance
      ? [
          "target_domain",
          "page_data_status",
          "page_http_status",
          "found",
          "result_title",
          "result_url",
          "observed_at",
          "capture_kind",
        ]
      : result.envelope.items.reduce(function (keys, item) {
          // Union of every record's keys, so a field missing from the first
          // record still gets a column.
          Object.keys(item || {}).forEach(function (key) {
            if (keys.indexOf(key) === -1) keys.push(key);
          });
          return keys;
        }, []);
    var head = headers
      .map(function (h) {
        return "<th scope='col'>" + escapeHtml(h) + "</th>";
      })
      .join("");
    var rows = result.envelope.items
      .map(function (item) {
        return (
          "<tr>" +
          headers
            .map(function (h) {
              return "<td>" + escapeHtml(displayValue(item[h])) + "</td>";
            })
            .join("") +
          "</tr>"
        );
      })
      .join("");
    body.innerHTML =
      envelopeMeta +
      "<div class='table-wrap'><table class='data-table'><caption class='sr-only'>" +
      escapeHtml(productId) +
      " records</caption><thead><tr>" +
      head +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table></div>" +
      note;
    root.setAttribute("aria-busy", "false");
  }


global.DataProducts = {
  CATALOG,
  fetchProductRecords,
  fetchAllProducts,
  mountDashboard,
  mountProductPage,
  isEnvelope,
  sanitizeUserFacingMessage,
  escapeHtml,
  FREE_ONLY: FREE_ONLY_DEFAULTS.freeOnly,
  ALLOW_EXTERNAL_WRITES: FREE_ONLY_DEFAULTS.allowExternalWrites,
  ALLOW_PAID_PROVIDERS: FREE_ONLY_DEFAULTS.allowPaidProviders,
};
