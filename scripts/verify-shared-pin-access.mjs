import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const auth = read("src/lib/auth.tsx");
const login = read("src/routes/login.tsx");
const app = read("src/routes/_app.tsx");
const client = read("src/lib/shared-access.ts");
const edge = read("supabase/functions/shared-pin-auth/index.ts");

const required = [
  [login, "signInWithPin(profileId, pin)", "login must use the shared PIN flow"],
  [login, "Connection needed", "a status outage must not expose the legacy login"],
  [client, "supabase.auth.verifyOtp", "PIN login must establish a persistent Supabase session"],
  [client, "device_id: sharedAccessDeviceId()", "PIN login must carry a stable device identifier"],
  [auth, "remembered !== status.version", "a PIN rotation must invalidate remembered devices"],
  [auth, 'signOut({ scope: "local" })', "version mismatch must sign out only this device"],
  [
    auth,
    "Slow/offline startup must not erase a valid till session",
    "temporary network failure must preserve a saved session",
  ],
  [auth, "5 * 60 * 1000", "open devices must periodically recheck the shared PIN version"],
  [
    app,
    "accessStatus && !accessStatus.configured",
    "POS and Live must use the shared PIN staff gate",
  ],
  [
    edge,
    "POS_CATALOG_SYNC_SECRET",
    "POS must verify the single Manager-owned PIN through a protected bridge",
  ],
  [edge, 'action: "bridge_verify"', "POS must centrally verify the PIN"],
  [edge, "device_id: deviceId", "central verification must be rate-limitable per device"],
];

const failed = required.filter(([source, needle]) => !source.includes(needle));
if (failed.length) {
  for (const [, , message] of failed) console.error(`FAIL: ${message}`);
  process.exit(1);
}

if (auth.includes("AUTH_INIT_TIMEOUT_MS") || auth.includes("1_800")) {
  console.error("FAIL: auth startup must not force a false logout on a fixed short timeout");
  process.exit(1);
}

console.log("Shared PIN device access contract verified.");
