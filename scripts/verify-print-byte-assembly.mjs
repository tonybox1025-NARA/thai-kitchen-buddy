import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/lib/print/raster.ts", import.meta.url), "utf8");

const unsafePatterns = [
  /push\([^\n]*\.\.\.[^\n]*(?:toRaster|toLegacyRaster)\(\)/,
  /\[[^\n]*\.\.\.[^\n]*(?:toRaster|toLegacyRaster)\(\)/,
  /Uint8Array\.from\(\[[^\n]*(?:toRaster|toLegacyRaster)\(\)/,
];

for (const pattern of unsafePatterns) {
  if (pattern.test(source)) {
    throw new Error(`Unsafe raster byte spread found: ${pattern}`);
  }
}

if (!source.includes("function appendBytes") || !source.includes("appendBytes(out, d.toLegacyRaster())")) {
  throw new Error("Safe printer-byte assembly guard is missing");
}

console.log("Printer byte assembly regression guard passed");
