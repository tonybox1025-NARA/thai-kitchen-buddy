import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Run the production validation callback with controlled network completion
// order; real Supabase startup emits INITIAL_SESSION alongside getSession().
const source = ts.createSourceFile(
  "auth.tsx",
  readFileSync("src/lib/auth.tsx", "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let callback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "validate") {
    callback = node.initializer.getText(source);
  }
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(callback, "Production auth validation callback must exist");
const javascript = ts.transpileModule(`globalThis.validate = ${callback};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const session = { user: { id: "test-device" } };
const status = { configured: true, version: 1, profiles: [] };

function harness() {
  const pending = [];
  const state = { loading: true, session: null, signOuts: 0, changes: 0 };
  const context = {
    mounted: true,
    validationSequence: 0,
    STAFF_KEY: "pos.activeStaff",
    console: { warn() {} },
    loadPosAccessStatus: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    storedSharedAccessVersion: () => 1,
    rememberSharedAccessVersion() {},
    clearSharedAccessVersion() {},
    localStorage: { removeItem() {} },
    setStaffState() {},
    setAccessStatus() {
      state.changes += 1;
    },
    setSession(value) {
      state.session = value;
    },
    setLoading(value) {
      state.loading = value;
    },
    supabase: {
      auth: {
        async signOut() {
          state.signOuts += 1;
        },
      },
    },
  };
  runInNewContext(javascript, context);
  return { validate: context.validate, context, pending, state };
}

// The first response must not release the spinner while the newer response
// still owns validation; doing so redirects /pos to /login and clears staff.
{
  const h = harness();
  const first = h.validate(session);
  const second = h.validate(session);
  h.pending[0].resolve(status);
  await first;
  assert.equal(h.state.loading, true, "Older validation must not end startup");
  assert.equal(h.state.changes, 0, "Older validation must not publish access state");
  h.pending[1].resolve(status);
  await second;
  assert.equal(h.state.session, session);
  assert.equal(h.state.loading, false);
}

// A late stale PIN-version response must not sign out a restored device.
{
  const h = harness();
  const first = h.validate(session);
  const second = h.validate(session);
  h.pending[1].resolve(status);
  await second;
  h.pending[0].resolve({ ...status, version: 2 });
  await first;
  assert.equal(h.state.session, session);
  assert.equal(h.state.signOuts, 0);
}

// Slow/offline status checks preserve a saved session, and a later sign-out
// or unmount prevents any in-flight request from restoring the old session.
{
  const h = harness();
  const check = h.validate(session);
  h.pending[0].reject(new Error("Offline"));
  await check;
  assert.equal(h.state.session, session);
  assert.equal(h.state.loading, false);
}
for (const reason of ["signout", "unmount"]) {
  const h = harness();
  const check = h.validate(session);
  if (reason === "signout") await h.validate(null);
  else h.context.mounted = false;
  h.pending[0].resolve(status);
  await check;
  assert.equal(h.state.session, null);
  assert.equal(h.state.changes, 0);
}

// A current PIN rotation must still invalidate this device and finish loading.
{
  const h = harness();
  const check = h.validate(session);
  h.pending[0].resolve({ ...status, version: 2 });
  await check;
  assert.equal(h.state.signOuts, 1);
  assert.equal(h.state.session, null);
  assert.equal(h.state.loading, false);
}

console.log("Shared-PIN concurrent session startup verified.");
