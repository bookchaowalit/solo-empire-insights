/**
 * The static site is served from the repository root (see README "Offline
 * demo"). These tests keep every page's local asset references resolvable and
 * stop a stale mirror directory (such as the removed `public/`) from creeping
 * back and drifting from the real js/, css/ and fixtures/.
 */
import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { DATA_PRODUCT_CATALOG } from "../src/data-products/index.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pages = (await readdir(root)).filter((name) => name.endsWith(".html")).sort();

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function localRefs(html: string): string[] {
  const refs: string[] = [];
  for (const match of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    const ref = match[1];
    if (/^(?:[a-z]+:|\/\/|#|\?)/i.test(ref)) continue;
    refs.push(ref.split(/[?#]/)[0]);
  }
  return refs;
}

describe("static site", () => {
  it("serves at least the dashboard and one page per catalog product", async () => {
    assert.ok(pages.includes("index.html"));
    for (const product of DATA_PRODUCT_CATALOG) {
      assert.ok(
        await exists(join(root, "fixtures", "data-products", `${product.id}.json`)),
        `missing fixture for ${product.id}`,
      );
    }
  });

  for (const page of pages) {
    it(`${page} references only files that exist`, async () => {
      const html = await readFile(join(root, page), "utf8");
      const refs = localRefs(html);
      assert.ok(refs.length > 0, `${page} has no local asset references`);
      for (const ref of refs) {
        assert.ok(await exists(join(root, ref)), `${page} -> ${ref} does not exist`);
      }
    });
  }

  it("has no stale mirror of js/, css/ or fixtures/", async () => {
    for (const mirror of ["public", "dist", "static"]) {
      assert.equal(
        await exists(join(root, mirror, "js", "data-products-browser.js")),
        false,
        `${mirror}/ duplicates js/; serve the repository root instead`,
      );
    }
  });
});
