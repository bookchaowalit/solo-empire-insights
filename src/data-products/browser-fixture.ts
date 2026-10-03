import { fetchJsonWithTimeout } from "./request.ts";
import type { DataProductEnvelope, FetchOptions } from "./types.ts";

export async function loadFixture(
  productId: string,
  options: FetchOptions = {},
): Promise<DataProductEnvelope> {
  const base = document.querySelector<HTMLMetaElement>('meta[name="data-products-fixture-base"]')
    ?.content || "fixtures/data-products/";
  const url = base.replace(/\/?$/, "/") + productId + ".json";
  const { response, body } = await fetchJsonWithTimeout(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: options.signal,
  }, options.timeoutMs ?? 4000, options.fetchImpl);
  if (!response.ok) throw new Error("Fixture unavailable");
  // The shared client validates every loader's envelope before using it.
  return body as DataProductEnvelope;
}
