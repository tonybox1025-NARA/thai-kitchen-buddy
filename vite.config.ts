// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// The Android build (npm run build:android) bundles the staff POS into the APK as
// static assets, so it needs a prerendered SPA shell instead of per-request SSR.
// Gated on an env var so the web build the restaurant runs today is untouched
// (a plain `npm run build` / `vite build` produces byte-identical Cloudflare output).
const isAndroid = process.env.BUILD_TARGET === "android";

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
    ...(isAndroid ? { spa: { enabled: true } } : {}),
  },
  // The APK ships static assets only — there is no Cloudflare Worker to deploy to,
  // and nitro's output layout breaks the SPA shell prerender (it looks for
  // dist/server/server.js, which the cloudflare-module preset never writes).
  ...(isAndroid ? { nitro: false as const } : {}),
});
