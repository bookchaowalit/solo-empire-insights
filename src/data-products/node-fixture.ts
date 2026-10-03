import type { DataProductEnvelope } from "./types.ts";

export async function loadFixture(productId: string): Promise<DataProductEnvelope> {
  const { readFile } = await import("node:fs/promises");
  const url = new URL(`../../fixtures/data-products/${productId}.json`, import.meta.url);
  return JSON.parse(await readFile(url, "utf8")) as DataProductEnvelope;
}
