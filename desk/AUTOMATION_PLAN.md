# Automation plan: background operation, agent control, one-month test

Status: draft for review. Nothing here places a live order. The `desk/` code is paper-only.

## 0. What the research says (this drives the plan)

Free-data, out-of-sample tests found **no demonstrated trading edge**:
- Lithium / battery-metal ETFs and miners (LIT, ALB, SQM): no feature group beats the base rate (AUC CIs include 0.5).
- CAISO power: the only strong signal is real-time persistence, unusable for the day-ahead decision. A causal model adds $0.01/day (CI -2.5 to +1.7). Intraday band rules lose to simply following the day-ahead schedule; model vs persistence is not significant at any band.

So the one-month run is an **operations and forward-validation test, not a profit test**. The default decision at the end of the month is **no-go for real money**. Going live needs a signal that passes a pre-registered forward test (section 5).

## 1. The Fidelity question

As far as I could find (vendor blogs, not Fidelity's own documents, so verify with Fidelity): Fidelity has **no public retail trading API**. Third-party aggregators exist (e.g. SnapTrade) but they are an intermediary, not an official order API, and I haven't verified what they permit.

Options, in order of recommendation:
1. **Run the month on a broker with a real paper-trading API** (Alpaca paper is free and already used for quotes; same code path as live). Do not use Fidelity for the test.
2. **Fidelity at go-live as human-in-the-loop:** the desk emits order tickets (symbol, side, size, limit, reason, expiry); a person places them in Fidelity. The article's rule holds: "a human signs anything irreversible."
3. **If full automation matters:** move to an API-first broker (Alpaca, Interactive Brokers, Tradier). Check each one's account, fee and data terms first.
4. **Do not** automate Fidelity by scripting the website or storing login credentials. It likely violates their terms, risks account lockout, and puts credentials where an agent could reach them.

Note: frequent day trading in a margin account under $25k triggers pattern-day-trader limits. Check account type before any automated frequency is chosen.

## 2. Architecture: the runtime is boring, agents sit beside it

```
                    +-------------------------------+
 market data  --->  |  desk runtime (deterministic) |  ---> broker adapter (paper now)
 (Alpaca/IEX)       |  state -> judge -> policy ->  |        PaperBroker | AlpacaPaperBroker
                    |  risk veto -> execution       |        (later: live adapter, human-gated)
                    +---------------+---------------+
                                    | append-only logs, positions, reports
                                    v
              +---------------------+----------------------+
              |  read-only "desk" connector (MCP + CLI)    |
              |  status, positions, vetoes, calibration,   |
              |  daily summary, kill-switch state          |
              +---------------------+----------------------+
                                    ^
                     Claude / Codex (operator role)
```

Rules:
- **No LLM in the order path.** The runtime is a plain process (systemd/cron/container). If every agent is offline, it keeps running and the risk engine still overrules everything.
- **Agents are operators and analysts, not traders.** They read status, run reports, review the daily summary, and **propose** changes as pull requests to `policy.py` / `risk.py`. They cannot place orders, hold broker keys, or change a risk limit.
- **Agent-agnostic interface.** One connector (an MCP server plus an equivalent CLI) so Claude, Codex or a human use the same read-only surface. Anything that moves funds or changes a risk limit returns "needs human approval" and writes a ticket.
- **Scheduled review.** A daily job produces the summary (decisions, trades, PnL after fees, every veto fired, data gaps). A weekly job reruns calibration and the research scripts and flags drift. These can be Claude scheduled tasks or plain cron.
- **Judge service pattern** (already designed): model keys live only on the judge service; the runtime holds a separate desk secret.

## 3. What needs building (in order)

1. `AlpacaPaperBroker` implementing the existing broker interface (paper endpoint only; refuses any non-paper URL).
2. Runtime daemon: live quote loop on `desk/live.py` data, the Gambler loop, one-position-at-a-time book, restart-safe state store.
3. Reconciliation: after every fill, compare broker positions/cash to the desk's own ledger; any mismatch halts and alerts.
4. Fallback ladder in code: data stale -> hold; API down -> flatten to safe state; repeated errors -> halt and notify; rate limit -> back off; malformed request -> never retry.
5. Kill switch: a file/flag any process (or a human on a phone) can set; the runtime checks it before every order.
6. Alerts: halt, veto storm, data gap, reconciliation mismatch, daily-loss limit.
7. Read-only connector (MCP + CLI) over logs and state.
8. Daily and weekly report jobs.

## 4. The one-month test

What a month **can** show: uptime, restart safety, reconciliation, data-gap handling, fill and latency realism vs the simulation, risk vetoes firing correctly, calibration drift.
What it **cannot** show: edge. About 20 trading days gives far too few independent decisions to distinguish skill from luck (our own lithium tests needed ~750 days for CIs this wide).

Pre-registered pass criteria (operations):
- Uptime >= 99% of market hours; every outage recovered without manual repair.
- Zero unreconciled position or cash mismatches.
- Zero risk-limit breaches; every veto logged with its reason.
- 100% of data gaps logged, none imputed.
- Paper fills within an agreed tolerance of simulated fills (set tolerance before the month starts).

Pre-registered performance reporting (no pass/fail on PnL): Brier score and reliability table vs base rate, trades taken, PnL after fees, and a comparison to buy-and-hold. Log the model version string on every decision; if it changes mid-month, the month restarts.

Protocol: freeze `policy.py`, `risk.py` and thresholds on day 1. Changes during the month restart the clock. Shadow mode for week 1, paper execution weeks 2-4.

## 5. Go-live gate (a separate decision, not part of the month)

All of the following, decided by a human after reading the month's report:
1. Operations criteria passed.
2. A signal with **forward** out-of-sample evidence: Brier gain over the right baseline with a CI excluding zero, on data collected after the code was frozen.
3. Economics check: expected edge per trade exceeds fees, spread and slippage with margin.
4. Start at a size you can lose entirely; fractional sizing only after calibration is verified; never raise size and change strategy in the same week.
5. Trading-only credentials, withdrawals disabled, hard daily-loss limit, kill switch tested, human approval for every risk-limit change.
6. For Fidelity: human-in-the-loop tickets only (section 1).

## 6. Decisions needed

- Which broker for the paper month (recommendation: Alpaca paper).
- What to forward-test: the lithium Gambler (no edge found) or a pure pipeline test with a trivial strategy. Recommendation: the pipeline test first; use the lithium Gambler only as a shadow-mode forward check.
- Where the runtime lives (small VM or container; needs to survive reboots and have alerting).
- Who receives alerts and holds the kill switch.
