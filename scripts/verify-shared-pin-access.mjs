import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";

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

// Exercise the production credential expression: Supabase Auth rejects more
// than 72 UTF-8 bytes even after the user's correct store PIN has been verified.
const passwordExpression = edge.match(/const randomPassword = (.+);/);
if (!passwordExpression) throw new Error("Device credential generation is missing");
const passwords = new Set();
for (let attempt = 0; attempt < 128; attempt += 1) {
  const password = runInNewContext(passwordExpression[1], { crypto: webcrypto });
  const bytes = Buffer.byteLength(password, "utf8");
  if (bytes < 48 || bytes > 72) {
    throw new Error(`Device credential must use 48-72 UTF-8 bytes; received ${bytes}`);
  }
  if (
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/[0-9]/.test(password) ||
    !/[^a-zA-Z0-9]/.test(password)
  ) {
    throw new Error("Device credential must satisfy password character requirements");
  }
  passwords.add(password);
}
if (passwords.size !== 128) throw new Error("Device credentials must be fresh and random");

console.log("Shared PIN device access contract verified.");
await import("./test-shared-pin-auth-startup.mjs");
