import type { CapacitorConfig } from "@capacitor/cli";

// CAP_SANDBOX=1 builds the throwaway APK that talks to the local Supabase over
// plain http. Production builds must never set it.
const sandbox = process.env.CAP_SANDBOX === "1";

const config: CapacitorConfig = {
  appId: "com.lonmoh.pos",
  appName: "LONMOH POS",

  // Produced by `npm run build:android` — the prerendered SPA shell plus assets.
  webDir: "dist/client",

  server: {
    // https://localhost keeps the WebView on a secure origin, which Supabase's
    // auth storage and the Web Crypto APIs both require.
    //
    // The sandbox build drops to http://localhost — still a secure context per
    // spec, so auth and crypto keep working, but it also lets the page open the
    // ws:// realtime socket that the local (non-TLS) Supabase serves. From an
    // https page the browser blocks that outright and every screen using
    // realtime dies.
    androidScheme: sandbox ? "http" : "https",
  },

  android: {
    // Everything a production build loads is either bundled or Supabase over TLS.
    allowMixedContent: sandbox,
  },
};

export default config;
