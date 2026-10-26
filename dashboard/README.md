# Shadow test dashboard

A static page (plain HTML and JavaScript, no build step) that reads the public `shadow-data` files from GitHub in the browser.
It shows test progress, results per symbol, an equity chart vs buy-and-hold, data health and recent fetch errors.
Everything is simulated: no orders are sent and no keys are involved.

## How it is deployed (Cloudflare Worker, static assets)
`wrangler.jsonc` at the repo root defines a Worker named `dollar` that serves this folder and attaches the custom domain
`dollar.elskatemm.com`. The Worker is connected to this repo in the Cloudflare dashboard (Workers Builds), so every push to
`main` rebuilds and redeploys it. The Worker name in `wrangler.jsonc` must match the Worker in the dashboard.
Live address: https://dollar.elskatemm.com

Data comes from `https://raw.githubusercontent.com/denegrijustin/Mlbv9/shadow-data/shadow/`. GitHub caches these files for a few
minutes, so the page can lag the workflow slightly. To point the page at other data (for testing): `?base=/path/to/shadow/`.

## Tuning
Constants at the top of the script in `index.html`: `PROTOCOL_START` (first counted trading day), `MIN_DAYS`, `EXPECTED_POLLS`.
