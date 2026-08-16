#!/usr/bin/env node
/**
 * Post-build step for `npm run build:android`.
 *
 * TanStack Start's SPA mode prerenders the app shell to `_shell.html`, which is
 * what a static host would rewrite every route to. Capacitor has no rewrite
 * layer — its WebView just opens `index.html` at the root of webDir — so the
 * shell is promoted to `index.html` here.
 *
 * Also drops the service worker: it only exists to satisfy Chrome's PWA
 * installability check, and inside the APK the assets are already local.
 */
import { rename, rm, access, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const www = join(root, "dist", "client");

const exists = async (p) => access(p).then(() => true, () => false);

if (!(await exists(www))) {
  console.error(`❌  ${www} not found — run the vite build first.`);
  process.exit(1);
}

const shell = join(www, "_shell.html");
const index = join(www, "index.html");

if (await exists(shell)) {
  await rename(shell, index);
  console.log("✓  _shell.html → index.html");
} else if (await exists(index)) {
  console.log("✓  index.html already present");
} else {
  console.error("❌  no _shell.html or index.html in dist/client — is spa mode enabled?");
  process.exit(1);
}

for (const stale of ["sw.js"]) {
  const p = join(www, stale);
  if (await exists(p)) {
    await rm(p);
    console.log(`✓  removed ${stale} (not needed in the APK)`);
  }
}

console.log(`✓  android web bundle ready: ${www} (${(await readdir(www)).length} entries)`);
