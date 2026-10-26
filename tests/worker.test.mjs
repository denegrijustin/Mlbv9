// Run with: node --test tests/worker.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import worker, { dispatch } from "../src/worker.js";

const mockFetch = (status = 204, text = "") => {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return { status, text: async () => text }; };
  return { f, calls };
};
const quiet = (fn) => async (...a) => { const orig = console.error; const logs = []; console.error = (m) => logs.push(m); try { return [await fn(...a), logs]; } finally { console.error = orig; } };

test("no token: nothing is sent, and it says why", async () => {
  const { f, calls } = mockFetch();
  const [r, logs] = await quiet(dispatch)({ cron: "*/5 13-21 * * MON-FRI" }, {}, f);
  assert.equal(calls.length, 0);
  assert.deepEqual(r, { ok: false, reason: "no_token" });
  assert.match(logs[0], /GITHUB_TOKEN/);
});

test("5-minute cron dispatches 'record' to the right workflow, on main, with the token only in the header", async () => {
  const { f, calls } = mockFetch(204);
  const r = await dispatch({ cron: "*/5 13-21 * * MON-FRI" }, { GITHUB_TOKEN: "t0k" }, f);
  assert.deepEqual(r, { ok: true, task: "record" });
  const c = calls[0];
  assert.equal(c.url, "https://api.github.com/repos/denegrijustin/Mlbv9/actions/workflows/shadow.yml/dispatches");
  assert.equal(c.init.method, "POST");
  assert.equal(c.init.headers.Authorization, "Bearer t0k");
  assert.deepEqual(JSON.parse(c.init.body), { ref: "main", inputs: { task: "record" } });
  assert.ok(!c.url.includes("t0k") && !c.init.body.includes("t0k"));
});

test("after-close cron dispatches 'report'", async () => {
  const { f, calls } = mockFetch(204);
  await dispatch({ cron: "40 21 * * MON-FRI" }, { GITHUB_TOKEN: "x" }, f);
  assert.equal(JSON.parse(calls[0].init.body).inputs.task, "report");
});

test("GitHub rejection is logged with status, not thrown, and never echoes the token", async () => {
  const { f } = mockFetch(401, '{"message":"Bad credentials"}');
  const [r, logs] = await quiet(dispatch)({ cron: "*/5 13-21 * * MON-FRI" }, { GITHUB_TOKEN: "secret-value" }, f);
  assert.deepEqual(r, { ok: false, reason: "http_401" });
  assert.match(logs[0], /401/);
  assert.ok(!logs[0].includes("secret-value"));
});

test("scheduled handler defers the work with waitUntil", async () => {
  let waited = null;
  worker.scheduled({ cron: "*/5 13-21 * * MON-FRI" }, {}, { waitUntil: (p) => { waited = p; } });
  assert.ok(waited instanceof Promise);
  const orig = console.error; console.error = () => {};
  try { await waited; } finally { console.error = orig; }
});

test("fetch passes everything else to the static assets", async () => {
  const seen = [];
  const res = await worker.fetch({ url: "https://x/y" }, { ASSETS: { fetch: async (r) => { seen.push(r.url); return "asset"; } } });
  assert.equal(res, "asset");
  assert.deepEqual(seen, ["https://x/y"]);
});

import { health } from "../src/worker.js";

test("health: no token reports token_set false and makes no request", async () => {
  const { f, calls } = mockFetch();
  const r = await health({}, f);
  assert.deepEqual(r, { token_set: false, repo: "denegrijustin/Mlbv9", workflow: "shadow.yml" });
  assert.equal(calls.length, 0);
});

test("health: reports GitHub status and never leaks the token", async () => {
  const bad = mockFetch(401, '{"message":"Bad credentials"}');
  const r1 = await health({ GITHUB_TOKEN: "sekrit" }, bad.f);
  assert.equal(r1.github_status, 401);
  assert.ok(!JSON.stringify(r1).includes("sekrit"));
  const ok = { status: 200, ok: true, json: async () => ({ workflow_runs: [{ created_at: "t", status: "completed", conclusion: "success" }] }), text: async () => "" };
  const r2 = await health({ GITHUB_TOKEN: "sekrit" }, async () => ok);
  assert.deepEqual(r2.latest_dispatched_run, { created_at: "t", status: "completed", conclusion: "success" });
});

test("fetch serves /_health as JSON and passes other paths to assets", async () => {
  const res = await worker.fetch({ url: "https://x/_health" }, { ASSETS: { fetch: async () => "asset" } });
  assert.equal(res.headers.get("content-type"), "application/json");
  assert.equal((await res.json()).token_set, false);
  assert.equal(await worker.fetch({ url: "https://x/other" }, { ASSETS: { fetch: async () => "asset" } }), "asset");
});
