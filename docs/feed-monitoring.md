# Data Freshness

The Monitoring page reads the authenticated `/api/monitoring/feeds` endpoint. The collector machine writes compact results to `hub_feed_health` in the same DigitalOcean MySQL database as Betting Hub. Existing `LOL_DO_DB_*` settings and TLS configuration are reused. No raw API payloads, local file paths, or credentials are sent to this table.

On the collector Mac, backfill saved PandaScore reports and odds logs, then collect fresh Elite Prospects telemetry:

```sh
cd /Users/trevorbritton/projects/betting-hub
zsh scripts/monitor-feeds.zsh sync
zsh scripts/monitor-feeds.zsh hockey-data
zsh scripts/monitor-feeds.zsh hockey-rosters
```

`sync --preview` shows the records that would be imported. The PandaScore backfill uses the saved report timestamps and leaves duration blank. It imports completed reports, including reports with coverage gaps. Set `LOL_PIPELINE_REPORTS_DIR` if the saved `lol-pipeline-status.*` directories are outside the current user's temporary directory. Run `lol --refresh-only` through the monitor if the reports are unavailable. `hockey-data` runs the games and player game-log collectors. Neither hockey collection command runs the model, deploys, or sends Telegram messages.

Use the monitored entry points from this checkout in place of the existing scheduled commands. Keep the existing output redirections and environment setup. For example, on the collector Mac, with times in its local timezone:

```cron
*/10 * * * * /bin/zsh /Users/trevorbritton/projects/betting-hub/scripts/monitor-feeds.zsh hockey-odds
0 5,17 * * * /bin/zsh /Users/trevorbritton/projects/betting-hub/scripts/monitor-feeds.zsh hockey
0 6,18 * * * /bin/zsh /Users/trevorbritton/projects/betting-hub/scripts/monitor-feeds.zsh lol
0 4 * * 1 /bin/zsh /Users/trevorbritton/projects/betting-hub/scripts/monitor-feeds.zsh hockey-rosters
```

Replace matching job entries to avoid launching duplicate pipelines. These are examples, not jobs installed by the app. The weekly roster wrapper uses the current EP collector, which requests teams playing in the next three days and retains other stored rosters. Widen the source collector's lookahead to cover a full week if the weekly job must refresh all teams on the upcoming seven-day slate.

The full LoL and hockey runners keep their existing publish and Telegram behavior. For LoL local validation use `lol --refresh-only`. The 10-minute odds job scrapes prices and archives quotes. The regular hockey run still performs the join. To backfill odds run timestamps from the existing local odds run log without starting a scraper:

```sh
zsh scripts/monitor-feeds.zsh sync-odds
```

Node 20.12+ and Rscript must be available to the cron job. Use `FEED_MONITOR_NODE` or `FEED_MONITOR_REAL_RSCRIPT` for explicit paths. `HOCKEY_MODEL_ROOT`, `LOL_PROJECT_ROOT`, and `LOL_CONNECTION_ENV_FILE` can override the sibling repo and DB config locations.

The widget uses the last successful check for its age. A clean check with no new data is successful. A failed or partial run leaves the last success intact. Volume and gaps reflect what the collector reports for that run. Blank metrics mean the collector did not supply a measurement. The odds provider timestamps reflect the enclosing run's completion. Odds durations are available for the whole scrape, since the log does not include per-provider durations. Publication freshness remains a separate check.
