# Betting Hub

A React workspace for betting operations, research, and reporting, hosted on DigitalOcean App Platform.

## Workspaces

- **Monitoring:** planned sources, data freshness, model-to-hub delivery stages, run history, and attention items.
- **Active Bets:** Sends draft cards with selected markets and individual play-to prices; Confirms is reserved for future placement reports.
- **Trading Dashboard:** the combined game list, initially backed by League of Legends, with the same market-selection workflow as Sports Dashboards.
- **Sports Dashboards:** Hockey, League of Legends, and NASCAR, each with its own research views.
- **Partner Accounting:** All Partners overview and individual partner tabs with balances, bet reports, and payments. Select a partner tab or name in a ledger to drill in. Add partners with an optional Telegram channel username, `t.me` link (including private invite links), or negative chat ID. Select a partner to add, edit, or remove their channel later. Partner names and channel references persist in the current browser; saving them does not connect Telegram, send messages, or import bets. Bet/payment records and published balances remain awaiting connection and are never inferred from missing data.
- **Analytics:** performance, date/sport/scope filters, breakdowns, and export placeholders.

The League of Legends dashboard reads published model outputs directly from DigitalOcean MySQL. Sends stores draft selections in the app database; financial accounts and confirmed placements remain unconnected.

## League of Legends: Upcoming Games

Open **Sports Dashboards → League of Legends** (`#/sports/lol`). This reproduces only the Shiny app's Upcoming Games tab, using `defaultdb.TREVORFAIRS` instead of local CSV files. The existing LoL model publisher already writes this table; the hub only reads it.

The view includes the 34 Shiny columns plus a leading series-format column, Team A's Map 1/BO3/BO5 prices and probabilities, totals, duration, both player lineups, league and column filters, search, sorting, and pagination (200 rows by default). Repeated map rows with identical lineups and predictions collapse into one match entry. Different lineups or predictions remain separate. BO1/BO3/BO5 is inferred from the count of distinct published map IDs per match before collapsing; unsupported counts show a dash. The corresponding XGB fair price and probability are shaded light grey. The last confirmed lineup filter defaults on, matching Shiny. The visible table shows Eastern Time. Series calculations retain Shiny's assumption of the same independent map win probability throughout the series.

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

## Sends and market selection

Click a LoL game row or its Team A name in Sports Dashboards or Trading Dashboard. A checklist lets you select markets separately for either team or the match: series ML, Map 1–5 winners, team kill totals over/under per map, map handicaps ±1.5/±2.5, total maps over/under, and match kill totals over/under per map. Markets outside a known series format are disabled.

**Add to Sends** creates a card under **Active Bets → Sends**. Enter an American play-to price for each market and a total/line for total markets. Blank fields are allowed while drafting. Select partners/groups from Partner Accounting and add notes in the last table row. **Save changes** saves without sending. **Send to Telegram** saves current edits and sends the bet ID, matchup, start time (ET), selected markets, play-to prices, and notes to each selected partner channel using the connected bot. Prices, totals, and valid destinations are required before sending. Delivery status is persisted per destination; retries skip identical messages already delivered, and only confirmed failures can be retried automatically. Unconfirmed delivery requires checking the partner chat. Confirms stays disabled; sending a card does not place bets.

`GET/POST /api/send-drafts`, `PATCH/DELETE /api/send-drafts/:id`, and `POST /api/send-drafts/:id/send` use the app authentication gate. Mutations require JSON and the `X-Betting-Hub: sends` header. The service uses the existing `LOL_DO_DB_*` connection variables and creates `hub_send_drafts` on first access, requiring `CREATE`, `SELECT`, `INSERT`, `UPDATE`, and `DELETE` permissions on that app table. It does not write to `TREVORFAIRS`. This provides a shared queue across devices after deployment, without relying on browser-local draft storage.

One card is kept per match and lineup combination. Each card displays a permanent six-character Bet ID, such as `KAR145`: the first three letters of the first selected team's name, followed by three digits (000–999). Match-only selections use Team A; names with fewer than three letters are padded with X. The server assigns IDs to existing cards on load and reserves them in `hub_send_ids`, which also requires CREATE/SELECT/INSERT permission. IDs remain reserved after removal; after all 1,000 numbers for a prefix are used, creating another card with that prefix returns an error. Adding more markets merges them into the card without replacing its ID, play-to prices, notes, recipients, or the captured model publication. Revision checks reject stale edits and removals from another screen. Partner names/groups currently come from the browser-local registry; once selected, their recipient snapshots are saved centrally with the draft. Available bookmaker odds, edges, delivery, and confirmation ingestion are later phases.

## Telegram bot connection

Open **Telegram** (`#/telegram`) to save the bot token from BotFather and an optional default chat ID. Saving verifies the token with `getMe`; it does not send a message. The server stores the token, bot identity, and default destination as AES-256-GCM encrypted JSON in the MySQL table `hub_telegram_settings`, shared across browsers and deployments. The table is created on first use, using the existing `LOL_DO_DB_*` connection, which needs permission to create/read/write this table. The saved token is never returned to the browser or stored in browser local storage.

Before using this page, add **`TELEGRAM_CREDENTIALS_KEY`** as an **encrypted Runtime** environment variable on the DigitalOcean service. Generate its 64-character hex value once with:

```sh
openssl rand -hex 32
```

Keep this key stable and backed up; replacing it prevents the server from decrypting saved credentials. Do not use a `REACT_APP_` prefix or commit the token/key. Database and Telegram failures are sanitized before returning them to the browser. All Telegram routes require the existing app authentication and HTTPS; writes also require same-site JSON requests and the app's custom header.

Alternatively, provision the bot with an encrypted **Runtime** variable named `TELEGRAM_BOT_TOKEN`. On first connection, when no saved bot exists, the backend verifies this token and saves it encrypted in MySQL. Existing in-app settings take priority; the environment variable never overwrites a later change made through the Telegram page. Runtime values are not bundled into the frontend. This provisioning path requires deployment of the Telegram backend code.

- **Test connection** checks bot identity, group privacy mode, and whether a webhook is already active. It never changes a webhook.
- **Refresh saved messages** reads the latest 100 messages from the permanent MySQL inbox, including recognized bet IDs and receiver errors. It does not contact Telegram or advance the polling cursor.
- **Send message** sends plain text only when the user submits the composer. Use a numeric chat ID (positive for a private chat, commonly negative for a group/channel) or public `@channel` username. Invite links are not send destinations. The bot must have access and posting permission. Start a private conversation with `/start`, wait for receiving, then refresh saved messages to find its chat ID.

Manual messaging, Sends card delivery, and background receiving use the same saved bot connection. AI parsing and creating confirmed bets remain separate work. Tests use mocked Telegram responses and never send live messages.

## Raw Telegram receiving

The Node server starts a receiver immediately and checks for updates every **10 seconds**, independently of the browser. It uses the saved bot (connect `@bettingtasks_bot` on the Telegram page), the existing encrypted credentials, and the existing `LOL_DO_DB_*` MySQL connection. No AI API or additional package is needed. It automatically creates these InnoDB/utf8mb4 tables, requiring `CREATE`, `SELECT`, `INSERT`, and `UPDATE` permissions:

| Table | Stored data |
| --- | --- |
| `hub_telegram_inbox` | Exact message text/caption, bot/update/chat/message/sender IDs, receipt time, candidate bet IDs, and the full raw Telegram update JSON. |
| `hub_telegram_message_bets` | Recognized bet IDs, permanent draft IDs, and a snapshot of the send's context at receipt. One message can reference multiple sends. |
| `hub_telegram_poll_state` | Per-bot cursor, most recent successful poll and incoming update time, and sanitized receiver errors. |

For example, `BOS145 ML -110 $500 -1.5 +150 200` is saved unchanged and linked to `BOS145` if it exists in `hub_send_ids`. Matching is case-insensitive and requires a complete six-character token; unknown IDs and messages without IDs are still saved. This phase does not extract odds/risk or create Confirms. Existing ID reservations remain recognizable after draft deletion, although their deleted draft context is unavailable; previously archived context is retained. Send/partner context is reference metadata, not proof that a sender placed a bet.

The Bot API returns a bot-wide stream, so every message delivered to this bot is preserved, including partner channels such as `trevor_partner`, group messages, and direct messages. There is no per-channel polling call or dependency on browser-local partner records. Add the bot to each intended chat. For channels, grant administrator access. For plain text in groups, make the bot an administrator or disable its privacy mode through BotFather. Comments on a channel post arrive in its linked discussion group, where the bot also needs access.

Raw events, bet links, and the cursor commit in one transaction **before** a subsequent request acknowledges those updates to Telegram. A failed write leaves the committed cursor unchanged for retry. `(bot_id, update_id)` deduplicates retries; new edit events append without replacing the original. A MySQL session lock prevents competing receivers across app instances/rolling deployments. Backlogs drain in batches of 100, up to 1,000 updates per polling pass. A cursor older than a week without incoming updates is reset because Telegram can randomize subsequent update IDs.

Use this app as the bot's only polling consumer. An existing webhook blocks polling and is left intact; the saved inbox reports the conflict. Set `TELEGRAM_POLLING_ENABLED=false` on a server that should not receive updates (for example, a development copy sharing production credentials). Otherwise receiving starts automatically after deploying this code with a valid database connection and saved bot. The receiver pauses and retries if configuration or the database is unavailable.

Telegram retains unreceived updates for at most **24 hours** and cannot return arbitrary prior chat history. Preserved text and JSON stay in MySQL until explicitly removed. Media messages preserve captions and file metadata, but image/file bytes are not downloaded in this phase. These Bot API behaviors are documented at https://core.telegram.org/bots/api#getting-updates.

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
