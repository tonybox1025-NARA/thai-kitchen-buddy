import fs from "node:fs";

const source = fs.readFileSync("src/routes/_app/live.tsx", "utf8");

if (!source.includes("display_shift?: string | null")) {
  throw new Error("Live attendance response must accept Manager's display_shift");
}
if (!source.includes("row.display_shift ?? inferredShift(row.clock_in)")) {
  throw new Error("POS Live must prefer Manager's attendance shift over local inference");
}

console.log("Live attendance shift regression guard passed.");
