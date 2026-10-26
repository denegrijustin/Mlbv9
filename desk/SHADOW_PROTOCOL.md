# Shadow-only forward test: protocol (freeze before day 1)

No broker, no keys, no orders. Live quotes are recorded; the desk's Gambler runs over them inside the process;
daily reports show the simulated result. Purpose: find out whether there is **any** edge on data collected
after the code was frozen. This is the question the historical tests could not answer.

## Freeze list (changing any of these restarts the clock)
- Symbols: LIT, ALB, SQM. Poll cadence: every 5 minutes during US market hours.
- `desk/policy.py`, `desk/risk.py`, `desk/judge.py` (MockJudge, version `mock-0.1`), `desk/state.py`, `desk/questions.py`.
- Scoring horizon: 5 ticks (about 25 minutes). Report definitions in `desk/daily_report.py`.
- Record the git commit hash and freeze date in the first report.

## Hypotheses (decided now)
- **H1 (the only pass/fail test):** the judge's `buy_pressure` probability beats the base rate in Brier score, with a
  block-bootstrap 95% CI (blocks = one trading day) excluding zero, **per symbol**, on at least 15 trading days.
  Also report AUC with its CI. Three symbols = three tests: require the CI to exclude zero after a Bonferroni
  correction (use a 98.3% interval) before calling it a signal.
- **H2 (reported, not pass/fail):** simulated PnL after fees. Fewer than 60 trading days cannot separate skill from luck;
  the daily report's verdict line enforces this.

## Data quality gates (the month is void if these fail)
- At least 90% of expected polls captured on at least 90% of trading days.
- Share of `book` ticks (real bid/ask) reported. If most ticks are `proxy`, H1 is a test of the proxy, not of order
  flow, and the result must be labelled that way.
- Gaps are logged and never imputed.

## What the outcomes mean
- H1 fails or data gates fail: no execution work. Stop, or change the hypothesis and restart (a new, separate test).
- H1 passes: still only a candidate. Run a second, independent month before any execution layer, then the paper-broker
  stage from `AUTOMATION_PLAN.md`.
- Expected outcome given the historical tests: no signal.

## Sample-size reality
About 78 ticks per symbol per day x ~21 days is ~1,600 rows, but 5-tick targets overlap heavily, so the effective sample is
a few hundred independent observations. That can detect a sizeable edge (AUC around 0.58 or more) and cannot detect a small one.
A null result means "no large edge visible", not "no edge".
