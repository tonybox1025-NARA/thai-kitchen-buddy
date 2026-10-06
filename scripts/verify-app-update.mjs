import fs from "node:fs";

const update = fs.readFileSync("src/lib/app-update.ts", "utf8");
const settings = fs.readFileSync("src/routes/_app/settings.tsx", "utf8");
const agents = fs.readFileSync("AGENTS.md", "utf8");

const checks = [
  [update.includes("export function findPosApk"), "shared POS APK selector"],
  [update.includes("candidates.length === 1"), "single non-bridge APK fallback"],
  [settings.includes("const posApk = findPosApk(release)"), "update screen uses safe selector"],
  [settings.includes("POS update file is missing from this release"), "missing asset is visible"],
  [agents.includes("LONMOH-POS-vX.Y.Z.apk"), "canonical release asset naming rule"],
];

const failed = checks.filter(([ok]) => !ok);
if (failed.length) {
  for (const [, label] of failed) console.error(`Missing: ${label}`);
  process.exit(1);
}

console.log("Android in-app update regression guard passed.");
