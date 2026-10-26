// Cloudflare Worker for the dashboard. Static assets (dashboard/) are served automatically; this script adds a
// cron trigger that starts the GitHub Actions workflow "shadow" on a reliable clock (GitHub's own cron is best-effort).
// Needs a Worker secret GITHUB_TOKEN: a fine-grained token limited to this repo with "Actions: Read and write" only.
// No orders, no broker keys: it only asks GitHub to run the recorder.

const REPO = "denegrijustin/Mlbv9";
const WORKFLOW = "shadow.yml";
const REPORT_CRON = "40 21 * * 1-5";   // after the close in both daylight and standard time: rebuild reports

export async function dispatch(event, env, fetchImpl = fetch) {
  if (!env.GITHUB_TOKEN) {
    console.error("GITHUB_TOKEN secret is not set; nothing dispatched");
    return { ok: false, reason: "no_token" };
  }
  const task = event.cron === REPORT_CRON ? "report" : "record";
  const res = await fetchImpl(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "dollar-shadow-trigger",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: "main", inputs: { task } }),
  });
  if (res.status !== 204) {
    const body = (await res.text()).slice(0, 200);
    console.error(`dispatch failed: HTTP ${res.status} ${body}`);
    return { ok: false, reason: `http_${res.status}` };
  }
  return { ok: true, task };
}

// Read-only self check at /_health: is the secret present, and does GitHub accept it? Never returns the token.
export async function health(env, fetchImpl = fetch) {
  const out = { token_set: Boolean(env.GITHUB_TOKEN), repo: REPO, workflow: WORKFLOW };
  if (!env.GITHUB_TOKEN) return out;
  const r = await fetchImpl(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=1&event=workflow_dispatch`, {
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "dollar-shadow-trigger" },
  });
  out.github_status = r.status;
  if (r.ok) {
    const run = ((await r.json()).workflow_runs || [])[0];
    out.latest_dispatched_run = run ? { created_at: run.created_at, status: run.status, conclusion: run.conclusion } : null;
  } else {
    out.github_message = (await r.text()).slice(0, 160);
  }
  return out;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(dispatch(event, env));
  },
  async fetch(request, env) {
    if (new URL(request.url).pathname === "/_health") {
      return new Response(JSON.stringify(await health(env), null, 1), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }
    return env.ASSETS.fetch(request);   // only reached for paths that are not static files
  },
};
