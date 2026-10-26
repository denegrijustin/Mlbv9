# shadow-data

Data branch for the shadow-only forward test (see `desk/SHADOW_PROTOCOL.md` on `main`).
A scheduled GitHub Actions workflow appends delayed public quote snapshots for LIT, ALB and SQM to `shadow/*_quotes.csv`
and, after each market close, rebuilds the simulated day-by-day reports in `shadow/reports/`.
Nothing here places orders. Read `shadow/reports/LIT/daily_report.md` (also ALB, SQM) for results.
