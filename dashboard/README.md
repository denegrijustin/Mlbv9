# Shadow test dashboard

A static page (plain HTML and JavaScript, no build step) that reads the public `shadow-data` files from GitHub in the browser.
It shows test progress, results per symbol, an equity chart vs buy-and-hold, data health and recent fetch errors.
Everything is simulated: no orders are sent and no keys are involved.

## Deploy on Cloudflare Pages (free)
1. Cloudflare dashboard, Workers & Pages, Create, Pages, Connect to Git, choose `denegrijustin/Mlbv9`.
2. Production branch: `main`. Framework preset: **None**. Build command: leave empty. Build output directory: **`dashboard`**.
3. Save and deploy. You get a `*.pages.dev` address. Every push to `main` redeploys.

Data comes from `https://raw.githubusercontent.com/denegrijustin/Mlbv9/shadow-data/shadow/`. GitHub caches these files for a few
minutes, so the page can lag the workflow slightly. To point the page at other data (for testing): `?base=/path/to/shadow/`.

## Tuning
Constants at the top of the script in `index.html`: `PROTOCOL_START` (first counted trading day), `MIN_DAYS`, `EXPECTED_POLLS`.
