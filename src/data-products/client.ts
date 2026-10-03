/**
 * Typed read-only client for the free-only data-product APIs.
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
  DataStatus,
} from "./types.ts";
import { loadFixture as defaultNodeFixtureLoader } from "./node-fixture.ts";
import { fetchJsonWithTimeout } from "./request.ts";

/**
 * Resolve a public API override for hosted demos while keeping loopback
 * defaults for local development. These values are URLs only; no credential
 * belongs in a frontend environment variable.
 */
function configuredBaseUrl(productId: string, fallback: string): string {
  if (typeof process === "undefined" || !process.env) return fallback;
  const configured =
    productId === "crypto"
      ? process.env.NEXT_PUBLIC_DATA_PRODUCT_URL_CRYPTO
      : productId === "stocks"
        ? process.env.NEXT_PUBLIC_DATA_PRODUCT_URL_STOCKS
        : productId === "fx"
          ? process.env.NEXT_PUBLIC_DATA_PRODUCT_URL_FX
          : productId === "defi"
            ? process.env.NEXT_PUBLIC_DATA_PRODUCT_URL_DEFI
            : productId === "flights"
              ? process.env.NEXT_PUBLIC_DATA_PRODUCT_URL_FLIGHTS
              : productId === "seo"
                ? process.env.NEXT_PUBLIC_DATA_PRODUCT_URL_SEO
                : productId === "ai_tools"
                  ? process.env.NEXT_PUBLIC_DATA_PRODUCT_URL_AI_TOOLS
                  : productId === "news"
                    ? process.env.NEXT_PUBLIC_DATA_PRODUCT_URL_NEWS
                  : productId === "discovery"
                    ? process.env.NEXT_PUBLIC_DATA_PRODUCT_URL_DISCOVERY
                  : undefined;
  return configured?.trim() || fallback;
}

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
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  for (const key of ENVELOPE_KEYS) {
    if (!(key in obj)) return false;
  }
  return (
    typeof obj.schema_version === "string" && obj.schema_version.trim().length > 0 &&
    typeof obj.source === "string" && obj.source.trim().length > 0 &&
    typeof obj.retrieved_at === "string" && Number.isFinite(Date.parse(obj.retrieved_at)) &&
    typeof obj.data_status === "string" && DATA_STATUSES.includes(obj.data_status as DataStatus) &&
    Array.isArray(obj.items) && obj.items.every((item) =>
      item !== null && typeof item === "object" && !Array.isArray(item)) &&
    (obj.next_cursor === null || typeof obj.next_cursor === "string")
  );
}

const DATA_STATUSES: readonly DataStatus[] = [
  "ok", "empty", "stale", "malformed", "not_found", "forbidden", "error", "accepted",
];

function stateFromEnvelope(envelope: DataProductEnvelope): ConsumerLoadState {
  switch (envelope.data_status) {
    case "ok": return envelope.items.length === 0 ? "empty" : "ready";
    case "empty": return "empty";
    case "stale": return "stale";
    case "not_found":
    case "accepted": return "unavailable";
    case "malformed":
    case "forbidden":
    case "error":
    default: return "error";
  }
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

function baseResult(
  productId: string,
  partial: Omit<ProductLoadResult, "productId" | "freeOnly" | "allowExternalWrites">,
): ProductLoadResult {
  // Failure/pending envelopes must not expose records through any consumer,
  // including fixtures and timeout fallback. Keep successful/stale data intact.
  const envelopeState = partial.envelope ? stateFromEnvelope(partial.envelope) : null;
  const suppressEnvelope = envelopeState === "error" || envelopeState === "unavailable";
  return {
    productId,
    freeOnly: true,
    allowExternalWrites: false,
    ...partial,
    ...(suppressEnvelope ? {
      envelope: null,
      errorMessage: partial.errorMessage ?? sanitizeUserFacingMessage("generic"),
    } : {}),
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
  const fixtureLoader = options.loadFixture ?? defaultNodeFixtureLoader;
  const loadFixture = async (id: string) => {
    const envelope = await fixtureLoader(id);
    if (!isDataProductEnvelope(envelope) || envelope.schema_version !== product.schemaVersion) {
      throw new Error("Invalid fixture envelope");
    }
    return envelope;
  };

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

  const baseUrl = (options.baseUrl ?? configuredBaseUrl(product.id, product.baseUrl)).replace(/\/$/, "");
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

  try {
    const { response, body } = await fetchJsonWithTimeout(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: options.signal,
    }, timeoutMs, fetchImpl);

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

    if (!isDataProductEnvelope(body) || body.schema_version !== product.schemaVersion) {
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
  const baseUrl = (options.baseUrl ?? configuredBaseUrl(product.id, product.baseUrl)).replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 2000;
  try {
    const { response, body } = await fetchJsonWithTimeout(`${baseUrl}/healthz`, {
      method: "GET",
      signal: options.signal,
    }, timeoutMs, fetchImpl, true);
    return { ok: response.ok, body };
  } catch {
    return {
      ok: false,
      body: null,
      error: sanitizeUserFacingMessage("unavailable"),
    };
  }
}

export { DATA_PRODUCT_CATALOG, FREE_ONLY_DEFAULTS, getProduct };
