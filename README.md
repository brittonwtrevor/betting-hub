# Betting Hub

A React workspace for betting operations, research, and reporting, hosted on DigitalOcean App Platform.

## Workspaces

- **Monitoring:** planned sources, data freshness, model-to-hub delivery stages, run history, and attention items.
- **Active Bets:** open placements, confirmation tracking, and settled bets.
- **Bet Suggestions:** opportunity queue and planned alert coverage.
- **Sports Dashboards:** Hockey, League of Legends, and NASCAR, each with its own research views.
- **Partner Accounting:** All Partners overview and individual partner tabs with balances, bet reports, and payments. Select a partner tab or name in a ledger to drill in. Add partners with an optional Telegram channel username, `t.me` link (including private invite links), or negative chat ID. Select a partner to add, edit, or remove their channel later. Partner names and channel references persist in the current browser; saving them does not connect Telegram, send messages, or import bets. Bet/payment records and published balances remain awaiting connection and are never inferred from missing data.
- **Analytics:** performance, date/sport/scope filters, breakdowns, and export placeholders.

The League of Legends dashboard reads published model outputs directly from DigitalOcean MySQL. Other workspaces currently provide navigation and UI structure with unconnected sources and empty data tables.

## League of Legends: Upcoming Games

Open **Sports Dashboards → League of Legends** (`#/sports/lol`). This reproduces only the Shiny app's Upcoming Games tab, using `defaultdb.TREVORFAIRS` instead of local CSV files. The existing LoL model publisher already writes this table; the hub only reads it.

The view includes all 34 Shiny columns, Team A's Map 1/BO3/BO5 prices and probabilities, totals, duration, both player lineups, league and column filters, search, sorting, and pagination (200 rows by default). The last confirmed lineup filter defaults on, matching Shiny. The visible table shows Eastern Time. Series calculations retain Shiny's assumption of the same independent map win probability throughout the series.

Add these **Runtime** environment variables to the DigitalOcean web service, alongside the app authentication variables below. Keep database values server-side; do not use a `REACT_APP_` prefix.

| Key | Value |
| --- | --- |
| `LOL_DO_DB_HOST` | Managed MySQL cluster hostname |
| `LOL_DO_DB_PORT` | `25060` |
| `LOL_DO_DB_USER` | Database username |
| `LOL_DO_DB_PASSWORD` | Database password; select **Encrypt** |
| `LOL_DO_DB_NAME` | `defaultdb` |
| `LOL_DO_DB_SSL_CA` | Cluster CA certificate PEM, downloaded from the database's Connection Details |

The connection requires TLS with certificate verification. Set `LOL_DO_DB_SSL_CA` for this cluster's private CA; either a multiline PEM or a PEM with literal `\n` separators works. Make sure the web service is an allowed trusted source for the database. Credentials and connection errors are never included in the browser bundle or API response.

`GET /api/lol/upcoming-games` uses the same password gate as the app. It performs a fixed `SELECT` from `TREVORFAIRS`, with no database writes. Fetching the dashboard or clicking **Refresh data** rereads the table; it does not run the model. The source publication timestamp and fetch time are displayed separately. As in Shiny, rows are not removed based on today's date, so an old model publication remains visible with its original timestamp. When a refresh fails, old results are cleared and an error is shown.

## Production password protection

The production `start` command runs `server/index.cjs`, which requires HTTP Basic authentication before serving the app, its assets, and deep links. The browser presents the sign-in prompt. Credentials are checked on the server and are never bundled into React.

Before deploying this change, configure these variables in DigitalOcean under the web service's **Settings → Environment Variables**:

| Key | Value | Scope |
| --- | --- | --- |
| `APP_AUTH_USERNAME` | Your chosen username | Runtime |
| `APP_AUTH_PASSWORD` | Your chosen password; select **Encrypt** | Runtime |

Save the variables, then deploy the new code. If the service has an explicit Run Command, set it to `yarn start` or `npm start`. A command that directly runs `serve` bypasses the password gate.

The server refuses to start when credentials are missing. Existing deployments are not protected until the new server is deployed successfully. `/healthz` is the only unauthenticated endpoint and returns only `ok` for platform health checks.

Production traffic requires HTTPS through DigitalOcean's proxy. For a local preview of the built app only, set `APP_ALLOW_HTTP=true` alongside test credentials. Keep that option unset in DigitalOcean. The `yarn dev` development server is separate from the production password gate.

## Local development

With Node and Yarn installed:

```sh
yarn install --frozen-lockfile
yarn dev
```

For the LoL data view, also run `yarn dev:api` in another terminal with the authentication and database environment variables set. The React development server proxies `/api` requests to port 8080. The API continues to require the app credentials; the development API accepts local HTTP. Production continues to require HTTPS.

## Validation

```sh
CI=true yarn test --watchAll=false
yarn test:server
yarn build
```

The production build is written to `_static/`. The build command is unchanged; the production start command serves that directory and the data API through the authenticated Node server. MySQL access uses `mysql2`; server tests use Node's built-in test runner.

See [the structure guide](docs/structure.md) for routes, source organization, and future integration boundaries.
