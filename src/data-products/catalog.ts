import type { ProductDefinition } from "./types.ts";

/** Local free-only data-product loopback ports (development). */
export const DATA_PRODUCT_CATALOG: readonly ProductDefinition[] = [
  {
    id: "crypto",
    title: "Crypto Markets",
    icon: "₿",
    repo: "book-crypto-data",
    schemaVersion: "crypto.v1",
    port: 8101,
    baseUrl: "http://127.0.0.1:8101",
  },
  {
    id: "stocks",
    title: "Stock Portfolio",
    icon: "📈",
    repo: "book-stock-data",
    schemaVersion: "stock.v1",
    port: 8102,
    baseUrl: "http://127.0.0.1:8102",
  },
  {
    id: "fx",
    title: "Exchange Rates",
    icon: "💱",
    repo: "book-fx-data",
    schemaVersion: "fx.v1",
    port: 8103,
    baseUrl: "http://127.0.0.1:8103",
  },
  {
    id: "defi",
    title: "DeFi Yields",
    icon: "🏦",
    repo: "book-defi-data",
    schemaVersion: "defi.v1",
    port: 8104,
    baseUrl: "http://127.0.0.1:8104",
  },
  {
    id: "flights",
    title: "Flight Prices",
    icon: "✈️",
    repo: "book-flight-data",
    schemaVersion: "flight.v1",
    port: 8105,
    baseUrl: "http://127.0.0.1:8105",
  },
  {
    id: "seo",
    title: "SEO Provenance",
    icon: "🔍",
    repo: "book-seo-data",
    schemaVersion: "seo.v1",
    port: 8106,
    baseUrl: "http://127.0.0.1:8106",
  },
  {
    id: "ai_tools",
    title: "AI Tools",
    icon: "🤖",
    repo: "book-ai-tools-data",
    schemaVersion: "ai_tools.v1",
    port: 8107,
    baseUrl: "http://127.0.0.1:8107",
  },
  {
    id: "news",
    title: "News Signals",
    icon: "📰",
    repo: "book-news-scraping",
    schemaVersion: "news.v1",
    port: 8108,
    baseUrl: "http://127.0.0.1:8108",
  },
  {
    id: "discovery",
    title: "Technology Discovery",
    icon: "🧭",
    repo: "book-discovery-data",
    schemaVersion: "discovery.v1",
    port: 8110,
    baseUrl: "http://127.0.0.1:8110",
  },
] as const;

export function getProduct(id: string): ProductDefinition | undefined {
  return DATA_PRODUCT_CATALOG.find((p) => p.id === id);
}

export const FREE_ONLY_DEFAULTS = {
  freeOnly: true as const,
  allowPaidProviders: false as const,
  allowExternalWrites: false as const,
};
