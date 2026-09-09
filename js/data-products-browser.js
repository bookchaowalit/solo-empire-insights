/**
 * Browser bundle (no build step required) for Solo Empire Insights.
 * Read-only consumer of local data-product APIs 8101–8110 + fixture fallback.
 * UI never exposes secrets, raw provider errors, or paid-provider assumptions.
 */
(function (global) {
  "use strict";

  const CATALOG = [
    { id: "crypto", title: "Crypto Markets", icon: "₿", repo: "book-crypto-data", schemaVersion: "crypto.v1", port: 8101, baseUrl: "http://127.0.0.1:8101" },
    { id: "stocks", title: "Stock Portfolio", icon: "📈", repo: "book-stock-data", schemaVersion: "stock.v1", port: 8102, baseUrl: "http://127.0.0.1:8102" },
    { id: "fx", title: "Exchange Rates", icon: "💱", repo: "book-fx-data", schemaVersion: "fx.v1", port: 8103, baseUrl: "http://127.0.0.1:8103" },
    { id: "defi", title: "DeFi Yields", icon: "🏦", repo: "book-defi-data", schemaVersion: "defi.v1", port: 8104, baseUrl: "http://127.0.0.1:8104" },
    { id: "flights", title: "Flight Prices", icon: "✈️", repo: "book-flight-data", schemaVersion: "flight.v1", port: 8105, baseUrl: "http://127.0.0.1:8105" },
    { id: "seo", title: "SEO Provenance", icon: "🔍", repo: "book-seo-data", schemaVersion: "seo.v1", port: 8106, baseUrl: "http://127.0.0.1:8106" },
    { id: "ai_tools", title: "AI Tools", icon: "🤖", repo: "book-ai-tools-data", schemaVersion: "ai_tools.v1", port: 8107, baseUrl: "http://127.0.0.1:8107" },
    { id: "news", title: "News Signals", icon: "📰", repo: "book-news-scraping", schemaVersion: "news.v1", port: 8108, baseUrl: "http://127.0.0.1:8108" },
    { id: "discovery", title: "Technology Discovery", icon: "🧭", repo: "book-discovery-data", schemaVersion: "discovery.v1", port: 8110, baseUrl: "http://127.0.0.1:8110" },
  ];

  function sanitizeUserFacingMessage(kind, detail) {
    detail = detail || {};
    const fixtureSuffix = detail.usingFixture ? "; using fixture fallback" : "";
    switch (kind) {
      case "timeout":
        return "Local API timed out" + fixtureSuffix;
      case "unavailable":
        return "Local API unavailable" + fixtureSuffix;
      case "http":
        return "Local API returned HTTP " + (detail.status != null ? detail.status : "error") + fixtureSuffix;
      case "invalid_envelope":
        return "Response is not a versioned data-product envelope";
      case "unknown_product":
        return "Unknown product id: " + (detail.productId || "?");
      case "fixture_failed":
        return "Offline fixture unavailable";
      default:
        return "Unable to load data product";
    }
  }

  function isEnvelope(value) {
    if (!value || typeof value !== "object") return false;
    return (
      typeof value.schema_version === "string" &&
      typeof value.source === "string" &&
      typeof value.retrieved_at === "string" &&
      "data_status" in value &&
      Array.isArray(value.items) &&
      "next_cursor" in value
    );
  }

  function stateFromEnvelope(envelope) {
    if (envelope.data_status === "malformed") return "error";
    if (envelope.data_status === "empty" || envelope.items.length === 0) return "empty";
    if (envelope.data_status === "stale") return "stale";
    return "ready";
  }

  function getProduct(id) {
    return CATALOG.find(function (p) {
      return p.id === id;
    });
  }

  function configuredBaseUrl(productId, fallback) {
    var overrides = global.DATA_PRODUCT_URLS;
    var configured = overrides && typeof overrides === "object" ? overrides[productId] : "";
    return typeof configured === "string" && configured.trim() ? configured.trim() : fallback;
  }

  function fixtureUrl(productId) {
    var base =
      (document.querySelector('meta[name="data-products-fixture-base"]') &&
        document.querySelector('meta[name="data-products-fixture-base"]').content) ||
      "fixtures/data-products/";
    return base.replace(/\/?$/, "/") + productId + ".json";
  }

  async function loadFixture(productId) {
    var resp = await fetch(fixtureUrl(productId), { headers: { Accept: "application/json" } });
    if (!resp.ok) throw new Error("fixture HTTP " + resp.status);
    var body = await resp.json();
    if (!isEnvelope(body)) throw new Error("invalid fixture envelope");
    return body;
  }

  function preferFixtures() {
    var params = new URLSearchParams(location.search);
    if (params.get("fixtures") === "1" || params.get("offline") === "1") return true;
    if (global.DATA_PRODUCTS_USE_FIXTURES === true) return true;
    return false;
  }

  async function fetchProductRecords(productId, options) {
    options = options || {};
    var product = getProduct(productId);
    if (!product) {
      return {
        productId: productId,
        state: "error",
        envelope: null,
        source: "none",
        errorMessage: sanitizeUserFacingMessage("unknown_product", { productId: productId }),
        freeOnly: true,
        allowExternalWrites: false,
      };
    }

    var useFixtures = options.useFixtures != null ? options.useFixtures : preferFixtures();
    if (useFixtures) {
      try {
        var fixtureEnvelope = await loadFixture(productId);
        return {
          productId: productId,
          state: stateFromEnvelope(fixtureEnvelope),
          envelope: fixtureEnvelope,
          source: "fixture",
          freeOnly: true,
          allowExternalWrites: false,
        };
      } catch (_err) {
        return {
          productId: productId,
          state: "unavailable",
          envelope: null,
          source: "none",
          errorMessage: sanitizeUserFacingMessage("fixture_failed"),
          freeOnly: true,
          allowExternalWrites: false,
        };
      }
    }

    var baseUrl = (options.baseUrl || configuredBaseUrl(product.id, product.baseUrl)).replace(/\/$/, "");
    var limit = options.limit || 50;
    // Read-only: GET /v1/records only — never POST /v1/refresh.
    var url = baseUrl + "/v1/records?limit=" + limit;
    var timeoutMs = options.timeoutMs || 4000;
    var controller = new AbortController();
    var timer = setTimeout(function () {
      controller.abort();
    }, timeoutMs);

    try {
      var response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) {
        try {
          var httpFixture = await loadFixture(productId);
          return {
            productId: productId,
            state: stateFromEnvelope(httpFixture),
            envelope: httpFixture,
            source: "fixture",
            errorMessage: sanitizeUserFacingMessage("http", {
              status: response.status,
              usingFixture: true,
            }),
            freeOnly: true,
            allowExternalWrites: false,
          };
        } catch (_httpErr) {
          return {
            productId: productId,
            state: "unavailable",
            envelope: null,
            source: "none",
            errorMessage: sanitizeUserFacingMessage("http", { status: response.status }),
            freeOnly: true,
            allowExternalWrites: false,
          };
        }
      }
      var body = await response.json();
      if (!isEnvelope(body)) {
        return {
          productId: productId,
          state: "error",
          envelope: null,
          source: "api",
          errorMessage: sanitizeUserFacingMessage("invalid_envelope"),
          freeOnly: true,
          allowExternalWrites: false,
        };
      }
      return {
        productId: productId,
        state: stateFromEnvelope(body),
        envelope: body,
        source: "api",
        freeOnly: true,
        allowExternalWrites: false,
      };
    } catch (err) {
      clearTimeout(timer);
      var isTimeout = (err && err.name === "AbortError") || /abort|timeout/i.test(String(err && err.message ? err.message : err));
      try {
        var fallback = await loadFixture(productId);
        return {
          productId: productId,
          state: isTimeout ? "timeout" : stateFromEnvelope(fallback),
          envelope: fallback,
          source: "fixture",
          errorMessage: sanitizeUserFacingMessage(isTimeout ? "timeout" : "unavailable", {
            usingFixture: true,
          }),
          freeOnly: true,
          allowExternalWrites: false,
        };
      } catch (_fallbackErr) {
        return {
          productId: productId,
          state: isTimeout ? "timeout" : "unavailable",
          envelope: null,
          source: "none",
          errorMessage: sanitizeUserFacingMessage(isTimeout ? "timeout" : "unavailable"),
          freeOnly: true,
          allowExternalWrites: false,
        };
      }
    }
  }

  async function fetchAllProducts(options) {
    return Promise.all(
      CATALOG.map(function (p) {
        return fetchProductRecords(p.id, options);
      }),
    );
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

  function renderItemPreview(productId, item) {
    if (!item) return "";
    if (productId === "crypto") {
      return (item.coin_id || "?") + " · " + (item.currency || "") + " · " + (item.price || "");
    }
    if (productId === "stocks") {
      return (item.symbol || "?") + " · " + (item.price || "") + " (" + (item.change_pct || "") + "%)";
    }
    if (productId === "fx") {
      return (item.base || "") + "/" + (item.currency || "") + " · " + (item.rate || "");
    }
    if (productId === "defi") {
      return (item.project || "") + " · " + (item.symbol || "") + " · APY " + (item.apy || "") + "%";
    }
    if (productId === "flights") {
      return (item.origin || "") + "-" + (item.destination || "") + " · ฿" + (item.price_thb || "");
    }
    if (productId === "seo") {
      if (item.capture_kind === "owned_page_provenance") {
        var pageStatus = item.page_data_status || (String(item.found).toLowerCase() === "true" ? "reachable" : "unreachable");
        var httpStatus = item.page_http_status ? " · HTTP " + item.page_http_status : "";
        return (item.target_domain || item.keyword || "") + " · " + pageStatus + httpStatus;
      }
      return (item.keyword || "") + " · rank " + (item.best_rank || "—");
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
      .replace(/"/g, "&quot;");
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
    banner.className = "status-banner ok";
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
      : Object.keys(result.envelope.items[0] || { record_id: "" });
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
              return "<td>" + escapeHtml(String(item[h] != null ? item[h] : "")) + "</td>";
            })
            .join("") +
          "</tr>"
        );
      })
      .join("");
    body.innerHTML =
      "<div class='env' aria-label='Envelope metadata'>" +
      "schema=" +
      escapeHtml(result.envelope.schema_version) +
      " · source=" +
      escapeHtml(result.envelope.source) +
      " · data_status=" +
      escapeHtml(String(result.envelope.data_status)) +
      " · retrieved=" +
      escapeHtml(result.envelope.retrieved_at) +
      "</div><div class='table-wrap'><table class='data-table'><caption class='sr-only'>" +
      escapeHtml(productId) +
      " records</caption><thead><tr>" +
      head +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table></div>" +
      (result.errorMessage
        ? "<div class='note' role='note'>" + escapeHtml(result.errorMessage) + "</div>"
        : "");
    root.setAttribute("aria-busy", "false");
  }

  global.DataProducts = {
    CATALOG: CATALOG,
    fetchProductRecords: fetchProductRecords,
    fetchAllProducts: fetchAllProducts,
    mountDashboard: mountDashboard,
    mountProductPage: mountProductPage,
    isEnvelope: isEnvelope,
    sanitizeUserFacingMessage: sanitizeUserFacingMessage,
    FREE_ONLY: true,
    ALLOW_EXTERNAL_WRITES: false,
    ALLOW_PAID_PROVIDERS: false,
  };
})(typeof window !== "undefined" ? window : globalThis);
