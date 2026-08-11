/** Shared envelope and consumer-side status types for data-product APIs. */

export type DataStatus =
  | "ok"
  | "empty"
  | "stale"
  | "malformed"
  | "not_found"
  | "forbidden"
  | "error"
  | "accepted";

export interface DataProductEnvelope<T = Record<string, unknown>> {
  schema_version: string;
  source: string;
  retrieved_at: string;
  data_status: DataStatus | string;
  items: T[];
  next_cursor: string | null;
  error?: string;
  detail?: string;
}

export type ConsumerLoadState =
  | "loading"
  | "ready"
  | "empty"
  | "stale"
  | "timeout"
  | "unavailable"
  | "error";

export interface ProductDefinition {
  id: string;
  title: string;
  icon: string;
  repo: string;
  schemaVersion: string;
  port: number;
  /** Development loopback base, e.g. http://127.0.0.1:8101 */
  baseUrl: string;
}

export interface FetchOptions {
  /** Override base URL (tests / custom hosts). */
  baseUrl?: string;
  /** Request timeout in ms. Default 4000. */
  timeoutMs?: number;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
  /** Force fixture path even if fetch would work. */
  useFixtures?: boolean;
  /** Custom fetch implementation (tests). */
  fetchImpl?: typeof fetch;
  /** Fixture loader override (tests / browser). */
  loadFixture?: (productId: string) => Promise<DataProductEnvelope> | DataProductEnvelope;
  limit?: number;
  cursor?: string | null;
}

export interface ProductLoadResult<T = Record<string, unknown>> {
  productId: string;
  state: ConsumerLoadState;
  envelope: DataProductEnvelope<T> | null;
  source: "api" | "fixture" | "none";
  errorMessage?: string;
  freeOnly: true;
  allowExternalWrites: false;
}
