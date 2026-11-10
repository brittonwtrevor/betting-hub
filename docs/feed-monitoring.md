# Betting Hub refresh runbook

Run this on the collector Mac, where both model repos, their local databases, R, and the publishing credentials already live:

```sh
cd /Users/trevorbritton/projects/betting-hub
zsh RUNMODEL.txt
```

The runner starts Hockey, then League of Legends. Each uses the existing monitored production pipeline, including its Shiny deployment and Telegram updates. A normal Hockey failure still lets LoL run. The combined command reports both exit codes and exits nonzero if either sport failed. Use `zsh RUNMODEL.txt --full-refresh` when LoL also needs a forced reference, patch, and cleaned minute-fact rebuild. To include an Elite Prospects roster refresh, run `zsh RUNMODEL.txt hockey-rosters` before the combined command.

| Job | Command from `betting-hub` | What it updates |
| --- | --- | --- |
| Hockey production | `zsh RUNMODEL.txt hockey` | Rebuilds and publishes Hockey → Future Games to `hub_hockey_future_games`. |
| LoL production | `zsh RUNMODEL.txt lol` | Rebuilds and publishes LoL Upcoming Games and the LoL data in Trading Dashboard via `TREVORFAIRS`. |
| Hockey odds scrape | `zsh RUNMODEL.txt hockey-odds` | Scrapes and archives DraftKings, Owls Insight, and Caddyshack prices and records Monitoring telemetry. The production Hockey run joins odds into the export the Hub reads. |
| Hockey rosters | `zsh RUNMODEL.txt hockey-rosters` | Refreshes Elite Prospects rosters and telemetry on the weekly cadence. Run it before the Hockey production command when the model should pick up new rosters. The current collector targets teams playing in the next three days. |
| Hockey source data only | `zsh RUNMODEL.txt hockey-data` | Collects EP schedules, results, and game logs and records telemetry. Use the production command to rebuild and publish Future Games. |
| Hockey upload recovery | `zsh RUNMODEL.txt hockey --upload-only` | Publishes the existing `FutureGames.csv` when the export is fresh and a later Shiny or DigitalOcean step failed. |
| LoL local validation | `zsh RUNMODEL.txt lol --refresh-only` | Updates local data, features, and models without publishing to the Hub. |
| Telemetry backfill | `zsh RUNMODEL.txt sync` | Imports saved PandaScore reports and hockey odds run logs into Monitoring. Use `sync-odds` for odds alone or add `--preview` to inspect the records first. |

## What runs inside each pipeline

1. **Hockey** runs the sibling `EP-HOCKEY-DB-MODELS/RUNMODEL.txt`. It collects games, checks and updates game logs (seven-day default), refreshes last-game actives, league names, and NHL draft-player games. It then runs `START_ELO_BY_GAME.R`, `PLAYER_PROJECTED_STATS_ENGINE.R`, and `PLAYER_LEVEL_AGG_MODEL.R`, and validates the lineup scenarios. `RUN_HOCKEY_ODDS.sh --join --wait-for-lock 600` scrapes and joins odds. `DATASAVEFORAPP.R` writes `my-shiny-app/data/FutureGames.csv`. After Shiny deploy and the Telegram attempt, `publish-hockey-future-games.cjs` uploads the export to DigitalOcean. The monitored runner uses UTF-8 for Telegram and logs notification failures while continuing to upload. Running the sibling `RUNMODEL.txt` directly ends before the upload.
2. **League of Legends** runs the sibling `LOL-MODEL-V2/pipelines/full_pipeline.sh`. It refreshes PandaScore references, matches, maps and minute frames, plus Riot patch data. It rebuilds game summaries, cleaned minute facts, and champion and matchup features. `BUILD_SIMPLE_DRAFT_ROLE_MODEL.R` and `LOLMODEL.R` build the draft and pregame outputs. `WRITEFAIRSTOAWS.R` publishes the upcoming-game matrix to DigitalOcean MySQL. The pipeline then deploys Shiny, sends the upcoming-games Telegram summary, and validates the data.

After publication, click **Refresh data** on the sport page and check **Published** and **Model export** for Hockey or **Model published** for LoL. The button rereads DigitalOcean. Use **Monitoring** to check source collection timestamps separately from model publication. If the terminal reports `Feed telemetry could not be saved`, check Monitoring even when the production run exits successfully. LoL publishes before Shiny, Telegram, and final validation, so check the app timestamp if a later LoL step fails.

NASCAR and Hockey views other than Future Games are placeholders in the Hub. The NASCAR repo's `NASCARRUN.txt` deploys its separate Shiny app. Game-day Flashscore/HockeyTech lineup watchers and LoL live draft alerts are separate jobs. Confirms use the app's Telegram worker, and Analytics reads those saved confirms.

## Collector telemetry and scheduling

The Monitoring page reads the authenticated `/api/monitoring/feeds` endpoint. The collector machine writes compact results to `hub_feed_health` in the same DigitalOcean MySQL database as Betting Hub. Existing `LOL_DO_DB_*` settings and TLS configuration are reused. No raw API payloads, local file paths, or credentials are sent to this table.

For telemetry recovery on the collector Mac, preview and backfill saved PandaScore reports and odds logs. Use the two Hockey commands if you also need fresh Elite Prospects data and roster telemetry:

```sh
cd /Users/trevorbritton/projects/betting-hub
zsh RUNMODEL.txt sync --preview
zsh RUNMODEL.txt sync
zsh RUNMODEL.txt hockey-data
zsh RUNMODEL.txt hockey-rosters
```

`sync --preview` shows the records that would be imported. The PandaScore backfill uses the saved report timestamps and leaves duration blank. It imports completed reports, including reports with coverage gaps. Set `LOL_PIPELINE_REPORTS_DIR` if the saved `lol-pipeline-status.*` directories are outside the current user's temporary directory. Run `lol --refresh-only` through the monitor if the reports are unavailable. `hockey-data` runs the games and player game-log collectors. Neither hockey collection command runs the model, deploys, or sends Telegram messages.

The [Betting Hub cron block](../config/betting-hub.cron) schedules Hockey odds every 10 minutes, Hockey production at 5:00 a.m. and 3:00 p.m., LoL production at 6:00 a.m. and 6:00 p.m., and Hockey rosters at 4:00 a.m. on Mondays. Cron uses the collector Mac's local time (Eastern on this Mac). In Terminal, copy the block and open your current crontab:

```sh
mkdir -p "$HOME/Library/Logs"
pbcopy < /Users/trevorbritton/projects/betting-hub/config/betting-hub.cron && EDITOR=nano crontab -e
```

Replace any existing scheduled entries for these four jobs, including jobs that call the original model scripts directly. Preserve unrelated jobs and environment settings. Paste the block at the end, save, and run `crontab -l` to verify it. Each job writes its own `betting-hub-*.log` file in `~/Library/Logs`. The Mac must be awake at the scheduled time. `caffeinate` keeps it awake while the command runs.

The weekly roster job uses the current Elite Prospects collector, which refreshes teams playing in the next three days and retains other stored rosters. A league-wide weekly refresh requires a change in the hockey collector.

The full LoL and hockey runners keep their existing publish and Telegram behavior. For LoL local validation use `lol --refresh-only`. The 10-minute odds job scrapes prices and archives quotes. The regular hockey run still performs the join. To backfill odds run timestamps from the existing local odds run log without starting a scraper:

```sh
zsh RUNMODEL.txt sync-odds
```

Node 20.12+ and Rscript must be available to the cron job. Use `FEED_MONITOR_NODE` or `FEED_MONITOR_REAL_RSCRIPT` for explicit paths. `HOCKEY_MODEL_ROOT`, `LOL_PROJECT_ROOT`, and `LOL_CONNECTION_ENV_FILE` can override the sibling repo and DB config locations.

The widget uses the last successful check for its age. A clean check with no new data is successful. A failed or partial run leaves the last success intact. Volume and gaps reflect what the collector reports for that run. Blank metrics mean the collector did not supply a measurement. The odds provider timestamps reflect the enclosing run's completion. Odds durations are available for the whole scrape, since the log does not include per-provider durations. Publication freshness remains a separate check.
