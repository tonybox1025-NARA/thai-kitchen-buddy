/**
 * One-off script: apply migration 20260521000002_cancel_reason.sql
 * to the remote Supabase project using the service role key.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/apply-migration.js
 *
 * The service role key can be found in:
 *   Supabase dashboard → Settings → API → Project API keys → service_role
 */

const https = require("https");

const PROJECT_REF = "sbjzbphdjfpjvjbzjuzk";

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_ROLE_KEY) {
  console.error("❌  Set SUPABASE_SERVICE_ROLE_KEY before running this script.");
  console.error("    Supabase dashboard → Settings → API → service_role secret");
  process.exit(1);
}

const SQL = `
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES public.staff(id);
`;

const body = JSON.stringify({ query: SQL });

const req = https.request(
  {
    hostname: `${PROJECT_REF}.supabase.co`,
    path: "/rest/v1/rpc/exec_sql",   // fallback path – see below
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
  },
  (res) => {
    let data = "";
    res.on("data", (chunk) => (data += chunk));
    res.on("end", () => {
      if (res.statusCode === 200 || res.statusCode === 204) {
        console.log("✅  Migration applied successfully.");
      } else {
        // exec_sql RPC may not exist; print SQL for manual run
        console.log(`ℹ️  Status ${res.statusCode}: ${data}`);
        console.log("\n— Run this SQL in the Supabase SQL editor instead —\n");
        console.log(SQL);
      }
    });
  }
);

req.on("error", (e) => console.error("Request error:", e.message));
req.write(body);
req.end();
