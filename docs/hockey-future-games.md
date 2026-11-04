# Hockey Future Games

The hockey dashboard reads `hub_hockey_future_games` from DigitalOcean MySQL through authenticated `GET /api/hockey/future-games`. It uses the app's existing `LOL_DO_DB_*` runtime connection variables, including verified TLS and the cluster CA. No additional app environment variables are required.

The source is the finished `EP-HOCKEY-DB-MODELS/my-shiny-app/data/FutureGames.csv` produced by `DATASAVEFORAPP.R`. Every goalie scenario is retained in export order, including missing odds. Model moneylines, regulation prices, totals and sportsbook odds are copied directly; total edges follow Shiny's quoted-total calculation. Edges are probability differences in percentage points, with the quoted sportsbook vig retained. They are not expected returns. Dates display in Eastern time, preserving the source timezone offset; missing times remain unknown.

The dashboard includes league, date range, search, home/away B2B, optional goalie experience/recency filters, column filters, sorting, pagination, and publication/source timestamps. Goalie filters apply to both teams and exclude missing experience/recency values. Filters start unrestricted so missing-goalie data is visible. Rows represent goalie scenarios, not confirmed starters. The view shows both unique game and scenario counts.

## Initial publication or upload only

From betting-hub, after the hockey export completes:

```sh
node scripts/publish-hockey-future-games.cjs --dry-run
zsh scripts/run-hockey-pipeline.zsh --upload-only
```

The uploader automatically reads the shared `LOL-MODEL-V2/.env` connection settings (`LOL_DO_DB_*`) from the adjacent LoL repository, without copying or printing credentials. This is the same database connection used by the LoL publisher and app. Explicit environment variables take priority. The upload-only command detects Node even when it is absent from PATH and does not run the hockey model, deploy Shiny, or send Telegram messages.

Use `--env-file PATH` with the Node publisher or set `LOL_CONNECTION_ENV_FILE` to select another shared connection file. Alternatively supply `LOL_DO_DB_HOST`, `LOL_DO_DB_PORT`, `LOL_DO_DB_USER`, `LOL_DO_DB_PASSWORD`, `LOL_DO_DB_NAME`, and `LOL_DO_DB_SSL_CA` directly. `DO_DB_*` aliases and `DO_DB_CA_CERT` (CA file path) are also supported. TLS certificate and hostname verification remain enabled. For the existing `db-mysql-nyc3-65249` cluster, the uploader defaults to `config/digitalocean-mysql-ca.pem`, the public project CA copied from the deployed app's `LOL_DO_DB_SSL_CA`; explicit CA settings take priority. A different cluster requires its own CA. The optional legacy `--use-hockey-connection` flag falls back to the old hockey replication configuration only when the shared connection is unavailable. Use `--hockey-root PATH` or `HOCKEY_MODEL_ROOT` if the hockey repository is not adjacent to betting-hub. Use `--csv PATH` for a separately staged export.

Only `hub_hockey_future_games` is created or changed. It contains `row_number`, `record_json` (the full exported row), `published_at`, and `source_modified_at`. Row zero stores publication metadata, including for an intentional empty schedule. The uploader needs CREATE/SELECT/INSERT/DELETE permissions on that table; the app only SELECTs it. Concurrent publishers use a MySQL advisory lock. Snapshot deletion, all insert batches and row-count verification commit in one transaction. Failed uploads roll back. An empty export is rejected unless explicitly requested with `--allow-empty`.

## Full pipeline with automatic upload

```sh
zsh /Users/trevorbritton/projects/betting-hub/scripts/run-hockey-pipeline.zsh
```

This wrapper runs the existing `EP-HOCKEY-DB-MODELS/RUNMODEL.txt` unchanged, including Shiny deployment and Telegram, then uploads the CSV using the shared LoL connection only after that pipeline succeeds. Existing jobs that call the original `RUNMODEL.txt` do not automatically start publishing; point the job at this wrapper to enable the upload. `HOCKEY_NODE_BIN` can specify a Node executable for cron; the wrapper also detects the desktop runtime when Node is absent from PATH.

Neither the original runner, model scripts, SQLite database, Shiny code, CSV files, nor Shiny's bet/notes storage is changed. A DigitalOcean outage cannot stop the existing Shiny deployment because the upload runs afterward. The wrapper reports a nonzero status if its final upload fails; the last committed hockey publication remains available. If an earlier Shiny or Telegram step fails, the wrapper skips publication and can be followed by the upload-only command once the export is known to be complete.

Deploy the betting-hub changes through the existing app deployment flow. A missing publication returns an actionable 503 response. Check **Hockey → Future Games → Refresh data** after uploading. The publication timestamp and original model-export timestamp are shown separately, so uploading an older export is visible.
