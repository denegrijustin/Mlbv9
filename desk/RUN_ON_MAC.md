# Running the shadow test on a Mac

Needs Python 3.9 or newer (tested on 3.9 and 3.13). Nothing else to install; everything here is free.

1. Open Terminal and run `python3 --version`.
   - If it prints 3.9 or higher, you are set.
   - If macOS offers to install "command line developer tools", accept (free); that provides `python3`. Or install Python from python.org/downloads.
2. Put the project folder in your home directory (for example `~/Mlbv9`), **not** on the Desktop or in Documents. macOS restricts what scheduled jobs can read in those folders.
3. Test: `cd ~/Mlbv9 && python3 -m desk.shadow record LIT:etf ALB SQM --dir shadow`
   - Outside market hours: `not_open:Closed` for each symbol (this is correct).
   - During market hours: `ok`, and `shadow/LIT_quotes.csv` appears.
4. Schedule it: run `crontab -e` and add these lines (Mac in US Eastern time; otherwise shift the hours to match 9:30 am to 4 pm Eastern):
   ```
   */5 9-16 * * 1-5  cd ~/Mlbv9 && python3 -m desk.shadow record LIT:etf ALB SQM --dir shadow >> shadow/cron.log 2>&1
   35 16 * * 1-5     cd ~/Mlbv9 && python3 -m desk.shadow report LIT ALB SQM --dir shadow >> shadow/cron.log 2>&1
   ```
   If `python3` is not found by cron, use the full path from `which python3`.
   Run `mkdir -p ~/Mlbv9/shadow` first so the log file can be created.
5. Keep the Mac awake and plugged in during market hours. A sleeping Mac runs no jobs, and missed polls leave no entry in the gaps log, only fewer rows that day. In System Settings, look for the option to prevent automatic sleeping when the display is off (wording varies by macOS version), or run `caffeinate -i` in a Terminal window you leave open.
6. Read results in `shadow/reports/LIT/daily_report.md` (also `ALB`, `SQM`). Check `shadow/gaps.log` for failed polls.

The first week is a rehearsal and does not count toward the test (see `SHADOW_PROTOCOL.md`).
