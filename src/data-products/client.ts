/**
 * Typed read-only client for the eight free-only data-product APIs.
 *
 * Rules:
 * - Consumers only call GET endpoints on local APIs.
 * - Never scrape upstream providers from this package.
 * - Never import scraper modules or read legacy scraper paths.
 * - Offline demos use sanitized fixtures.
 * - UI-facing messages never include secrets, stack traces, or raw provider errors.
 */

import { DATA_PRODUCT_CATALOG, FREE_ONLY_DEFAULTS, getProduct } from "./catalog.ts";
import type {
  ConsumerLoadState,
  DataProductEnvelope,
  FetchOptions,
  ProductLoadResult,
} from "./types.ts";

const ENVELOPE_KEYS = [
  "schema_version",
  "source",
  "retrieved_at",
  "data_status",
  "items",
  "next_cursor",
] as const;

/** Safe, non-secret messages for UI and logs. Never include raw provider/network payloads. */
export function sanitizeUserFacingMessage(
  kind:
    | "timeout"
    | "unavailable"
    | "http"
    | "invalid_envelope"
    | "unknown_product"
    | "fixture_failed"
    | "generic",
  detail?: { status?: number; productId?: string; usingFixture?: boolean },
): string {
  const fixtureSuffix = detail?.usingFixture ? "; using fixture fallback" : "";
  switch (kind) {
    case "timeout":
      return `Local API timed out${fixtureSuffix}`;
    case "unavailable":
      return `Local API unavailable${fixtureSuffix}`;
    case "http":
      return `Local API returned HTTP ${detail?.status ?? "error"}${fixtureSuffix}`;
    case "invalid_envelope":
      return "Response is not a versioned data-product envelope";
    case "unknown_product":
      return `Unknown product id: ${detail?.productId ?? "?"}`;
    case "fixture_failed":
      return "Offline fixture unavailable";
    default:
      return "Unable to load data product";
  }
}

export function isDataProductEnvelope(value: unknown): value is DataProductEnvelope {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  for (const key of ENVELOPE_KEYS) {
    if (!(key in obj)) return false;
  }
  if (!Array.isArray(obj.items)) return false;
  return typeof obj.schema_version === "string" && typeof obj.source === "string";
}

function stateFromEnvelope(envelope: DataProductEnvelope): ConsumerLoadState {
  if (envelope.data_status === "empty" || envelope.items.length === 0) return "empty";
  if (envelope.data_status === "stale") return "stale";
  if (envelope.data_status === "malformed") return "error";
  return "ready";
}

async function defaultNodeFixtureLoader(productId: string): Promise<DataProductEnvelope> {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));
  // src/data-products -> ../../fixtures/data-products
  const path = join(here, "..", "..", "fixtures", "data-products", `${productId}.json`);
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!isDataProductEnvelope(parsed)) {
    throw new Error(`Fixture for ${productId} is not a valid envelope`);
  }
  return parsed;
}

function preferFixturesEnv(): boolean {
  if (typeof process !== "undefined" && process.env) {
    const v = process.env.DATA_PRODUCTS_USE_FIXTURES ?? process.env.OFFLINE_FIXTURES;
    if (v != null) {
      return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
    }
  }
  return false;
}

function isTimeoutError(err: unknown): boolean {
  if (err instanceof Error && err.name === "AbortError") return true;
  const message = err instanceof Error ? err.message : String(err);
  return /timeout|aborted/i.test(message);
}

function combineSignals(
  timeoutSignal: AbortSignal,
  userSignal?: AbortSignal,
): AbortSignal {
  if (!userSignal) return timeoutSignal;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([userSignal, timeoutSignal]);
  }
  return userSignal;
}

function baseResult(
  productId: string,
  partial: Omit<ProductLoadResult, "productId" | "freeOnly" | "allowExternalWrites">,
): ProductLoadResult {
  return {
    productId,
    freeOnly: true,
    allowExternalWrites: false,
    ...partial,
  };
}

export async function fetchProductRecords(
  productId: string,
  options: FetchOptions = {},
): Promise<ProductLoadResult> {
  const product = getProduct(productId);
  if (!product) {
    return baseResult(productId, {
      state: "error",
      envelope: null,
      source: "none",
      errorMessage: sanitizeUserFacingMessage("unknown_product", { productId }),
    });
  }

  const useFixtures = options.useFixtures ?? preferFixturesEnv();
  const loadFixture = options.loadFixture ?? defaultNodeFixtureLoader;

  if (useFixtures) {
    try {
      const envelope = await loadFixture(productId);
      return baseResult(productId, {
        state: stateFromEnvelope(envelope),
        envelope,
        source: "fixture",
      });
    } catch {
      return baseResult(productId, {
        state: "unavailable",
        envelope: null,
        source: "none",
        errorMessage: sanitizeUserFacingMessage("fixture_failed"),
      });
    }
  }

  const baseUrl = (options.baseUrl ?? product.baseUrl).replace(/\/$/, "");
  const limit = options.limit ?? 50;
  const cursor = options.cursor ? `&cursor=${encodeURIComponent(options.cursor)}` : "";
  // Read-only contract: GET /v1/records only (never POST /v1/refresh).
  const url = `${baseUrl}/v1/records?limit=${limit}${cursor}`;
  const timeoutMs = options.timeoutMs ?? 4000;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (typeof fetchImpl !== "function") {
    try {
      const envelope = await loadFixture(productId);
      return baseResult(productId, {
        state: stateFromEnvelope(envelope),
        envelope,
        source: "fixture",
        errorMessage: sanitizeUserFacingMessage("unavailable", { usingFixture: true }),
      });
    } catch {
      return baseResult(productId, {
        state: "unavailable",
        envelope: null,
        source: "none",
        errorMessage: sanitizeUserFacingMessage("unavailable"),
      });
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = combineSignals(controller.signal, options.signal);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      try {
        const envelope = await loadFixture(productId);
        return baseResult(productId, {
          state: stateFromEnvelope(envelope),
          envelope,
          source: "fixture",
          errorMessage: sanitizeUserFacingMessage("http", {
            status: response.status,
            usingFixture: true,
          }),
        });
      } catch {
        return baseResult(productId, {
          state: "unavailable",
          envelope: null,
          source: "none",
          errorMessage: sanitizeUserFacingMessage("http", { status: response.status }),
        });
      }
    }

    const body = (await response.json()) as unknown;
    if (!isDataProductEnvelope(body)) {
      return baseResult(productId, {
        state: "error",
        envelope: null,
        source: "api",
        errorMessage: sanitizeUserFacingMessage("invalid_envelope"),
      });
    }

    // Never surface envelope.error / envelope.detail (may contain provider internals).
    return baseResult(productId, {
      state: stateFromEnvelope(body),
      envelope: body,
      source: "api",
    });
  } catch (err) {
    clearTimeout(timer);
    const timedOut = isTimeoutError(err);

    try {
      const envelope = await loadFixture(productId);
      return baseResult(productId, {
        state: timedOut ? "timeout" : stateFromEnvelope(envelope),
        envelope,
        source: "fixture",
        errorMessage: sanitizeUserFacingMessage(timedOut ? "timeout" : "unavailable", {
          usingFixture: true,
        }),
      });
    } catch {
      return baseResult(productId, {
        state: timedOut ? "timeout" : "unavailable",
        envelope: null,
        source: "none",
        errorMessage: sanitizeUserFacingMessage(timedOut ? "timeout" : "unavailable"),
      });
    }
  }
}

export async function fetchAllProducts(
  options: FetchOptions = {},
): Promise<ProductLoadResult[]> {
  const results = await Promise.all(
    DATA_PRODUCT_CATALOG.map((p) => fetchProductRecords(p.id, options)),
  );
  return results;
}

export async function fetchProductHealth(
  productId: string,
  options: FetchOptions = {},
): Promise<{ ok: boolean; body: unknown; error?: string }> {
  const product = getProduct(productId);
  if (!product) return { ok: false, body: null, error: "unknown product" };
  if (options.useFixtures ?? preferFixturesEnv()) {
    return {
      ok: true,
      body: {
        status: "ok",
        repository: product.repo,
        data_status: "fixture",
        free_only: FREE_ONLY_DEFAULTS.freeOnly,
        allow_external_writes: FREE_ONLY_DEFAULTS.allowExternalWrites,
      },
    };
  }
  const baseUrl = (options.baseUrl ?? product.baseUrl).replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 2000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}/healthz`, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timer);
    const body = await response.json();
    return { ok: response.ok, body };
  } catch {
    clearTimeout(timer);
    return {
      ok: false,
      body: null,
      error: sanitizeUserFacingMessage("unavailable"),
    };
  }
}

export { DATA_PRODUCT_CATALOG, FREE_ONLY_DEFAULTS, getProduct };
