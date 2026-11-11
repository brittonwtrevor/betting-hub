# Betting Hub

A React workspace for betting operations, research, and reporting, hosted on DigitalOcean App Platform.

Run `zsh RUNMODEL.txt` from this checkout to refresh and publish Hockey and League of Legends. See the [Betting Hub refresh runbook](docs/feed-monitoring.md) for the script order, individual jobs, and upload recovery. See [Hockey Future Games](docs/hockey-future-games.md) for publisher setup.

## Workspaces

- **Monitoring:** planned sources, data freshness, model-to-hub delivery stages, run history, and attention items.
- **Active Bets:** Sends draft cards with selected markets and individual play-to prices; Confirms extracts partner fills, supports field corrections, and grades each bet with persisted P/L.
- **Trading Dashboard:** the combined game list, initially backed by League of Legends, with the same market-selection workflow as the sport pages.
- **Hockey, League of Legends, and NASCAR:** direct sidebar links to each sport's research views.
- **Partner Accounting:** All Partners overview and individual partner tabs with balances, bet reports, and payments. Select a partner tab or name in a ledger to drill in. Add partners with an optional Telegram channel username, `t.me` link (including private invite links), or negative chat ID. Select a partner to add, edit, or remove their channel later. Partner names and channel references persist in the current browser; saving them does not connect Telegram, send messages, or import bets. Bet/payment records and published balances remain awaiting connection and are never inferred from missing data.
- **Analytics:** performance, date/sport/scope filters, breakdowns, and export placeholders.

The League of Legends dashboard reads published model outputs directly from DigitalOcean MySQL. Sends and Confirms store drafts, reported fills, and grades centrally. External financial accounts, partner payment balances, and settlement imports remain unconnected.

## League of Legends: Upcoming Games

Open **League of Legends** from the sidebar (`#/sports/lol`). This reproduces only the Shiny app's Upcoming Games tab, using `defaultdb.TREVORFAIRS` instead of local CSV files. The existing LoL model publisher already writes this table; the hub only reads it.

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

Click a LoL game row or its Team A name in League of Legends or Trading Dashboard. A checklist lets you select markets separately for either team or the match: series ML, Map 1–5 winners, team kill totals over/under per map, map handicaps ±1.5/±2.5, total maps over/under, and match kill totals over/under per map. Markets outside a known series format are disabled.

**Add to Sends** creates a card under **Active Bets → Sends**. Enter an American play-to price for each market and a total/line for total markets. Blank fields are allowed while drafting. Select partners/groups from Partner Accounting and add notes in the last table row. **Save changes** saves without sending. **Send to Telegram** saves current edits and sends the bet ID, matchup, start time (ET), selected markets, play-to prices, and notes to each selected partner channel using the connected bot. Prices, totals, and valid destinations are required before sending. Delivery status is persisted per destination; retries skip identical messages already delivered, and only confirmed failures can be retried automatically. Unconfirmed delivery requires checking the partner chat. Sending a card does not place bets.

**Active Bets → Confirms** (`#/bets?tab=confirms`) shows partner fills and refreshes every 10 seconds. Eligible replies must contain a recognized six-character send ID **and** originate in a partner chat listed in that send's archived recipients or resolved delivery chat IDs. Matching uses numeric chat IDs or public usernames, never display titles. Unrelated messages remain archived but do not appear in Confirms. Each reply retains its original raw text and originating partner; each reported fill becomes a separate row with editable **BETID, GAME, TEAM, BET, RISK, ODDS**, a grade, and P/L. Search includes those fields, partner/chat, sender, and message text. Existing `#/telegram` bookmarks open Confirms; no separate Telegram settings tab is needed.

The server extracts context from the original send and uses AI only to interpret the reply. It never substitutes a play-to price for reported odds. Missing or ambiguous fields are left blank and marked for review. **Save** persists field changes and grades; polling preserves unsaved form edits and stale revision checks prevent overwriting changes from another screen. **Reset edits** restores the saved row. Manual entry works even without an AI key. Later Telegram edits flag review and preserve existing bet corrections and grades; AI retries cannot replace saved rows.

Each bet also stores a read-only **Raw response** snapshot of the Telegram text/caption, displayed in Confirms and Raw Bet Data and included in CSV downloads. Existing bets receive their archived reply text on startup. Bet corrections and later Telegram edits preserve the saved snapshot. Explicit shorthand such as `HAR561 Harvard +2.5 and Chiefs ML parlay +300 $2,500.00` is saved as one parlay with both legs, $2,500 risk and +300 combined odds even if AI returns a straight handicap or separate legs. Other replies mentioning a parlay are sent for review if AI drops the parlay label.

New AI-created fills queue a single-sentence Telegram confirmation containing team, market, risk, and odds, ending with "was logged." Telegram receipts omit the partner/bettor names, Bet ID, full matchup, and date; those remain stored with the bet. Saving a changed grade/result sends the same compact details with grade and signed net P/L, ending with ✅ for WIN or ❌ for LOSS. Deletion notices end with 🗑. Clearing a grade sends a sentence saying the bet is now ungraded. Each receipt goes to the original reply's numeric chat ID using its original bot, independent of later partner channel edits. Existing historical fills do not generate retroactive log receipts. Manual row additions and edits that do not change the grade/result do not generate messages.

Receipts are saved transactionally with the bet/grade/deletion in `hub_confirm_notifications` and delivered by the background worker every 10 seconds. The outbox keys each event by bet row/revision/type; refreshes and worker restarts cannot repeat confirmed sends. Confirmed Telegram rejections retry up to three times, one minute apart. Timeouts or interrupted sends are marked **Delivery unconfirmed** and never automatically resent, since Telegram has no delivery idempotency key. The latest log/grade delivery status and sanitized failure message appear in Confirms. Deleting a bet cancels queued log/grade receipts and queues a single-sentence notice ending "was deleted from the bet log" to the original partner chat. Deletion delivery status remains visible below the raw reply after the row is removed. Receipt failures cannot erase saved bets or raw replies. The outbox requires CREATE/SELECT/INSERT/UPDATE permissions on the existing database connection.

Every fill stores its originating partner ID/name, Telegram bot/chat/message and sender ID/name/username, editable **Bettor** and **Bet date (ET)**, original reply and ingestion timestamps, contextual game ID/sport/league/start time, created/updated times, and graded timestamp. Attribution comes from the archived send and Telegram event, not AI. The original sender identity stays fixed when correcting the bettor's display name. The bet date defaults to the reply's Eastern calendar date; timestamps are stored in UTC and displayed in Eastern time. A reply posted anonymously or as a channel cannot identify a human sender; enter the bettor manually when needed.

**Delete bet → Confirm delete** updates that same row with `deleted_at` and a new revision, removes it from active Confirms, and saves a before/after audit entry. It does not erase raw messages or history. Deleted rows must be excluded from reporting (`WHERE deleted_at IS NULL`) and are never automatically re-extracted, including after a restart or Telegram edit. Save or reset unsaved edits before deleting. Edits and grades likewise update the existing row, rather than inserting another fill.

Grades are **UNGRADED**, **VOID**, **WIN**, **LOSS**, and **PARTRETURN**. Ungraded P/L is blank; VOID is zero; LOSS is negative risk; WIN is net profit excluding returned stake, using American odds and rounding to cents. PARTRETURN takes a manually entered **signed net P/L**, directly: `+50` is $50 profit, `-25` is $25 loss, and `0` is break-even. All required bet fields must be complete before grading. The backend calculates P/L and ignores any client-supplied P/L. These records belong to the originating partner; this does not infer sharing agreements or update payment balances.

## Low-cost AI setup

Add **`DO_INFERENCE_API_KEY`** as an encrypted **Runtime** variable in DigitalOcean, using a model access key with access to **Ministral 3 14B Instruct**. This is separate from the Telegram bot token. The default model ID is **`mistral-3-14B`**; override it with `DO_INFERENCE_MODEL` only if needed. Requests go to the fixed DigitalOcean serverless endpoint `https://inference.do-ai.run/v1/chat/completions`. DigitalOcean inference requires available credits. Published model IDs/prices: https://docs.digitalocean.com/products/inference/details/models/ and https://docs.digitalocean.com/products/inference/details/pricing/.

Telegram screenshots are downloaded server-side and sent as inline images alongside the caption and compact send context. Send a photo or a JPG/PNG/WebP image document **with the six-character Bet ID in its caption**. The highest-resolution photo is used, with a 10 MB download limit. The default model supports vision; if overriding the text model with one that does not, set `DO_INFERENCE_VISION_MODEL` to a vision-capable model accessible to the same key. Bot tokens and Telegram file URLs are never sent to inference or the browser. Unsupported/unreadable attachments stay available for review rather than being parsed as caption-only messages. **Retry AI** also retrieves images from older archived events; reposting is unnecessary unless Telegram can no longer provide the file. Existing saved bets remain protected from replacement.

For prediction-market slips, the extraction prompt distinguishes cost, separately charged fees, and total potential payout. Where unambiguous, total risk includes fees and effective odds can be derived from total cost/payout, with a review issue explaining the conversion. A rounded chance percentage alone does not establish exact execution odds. Potential winnings do not grade a bet. Image request format: https://docs.digitalocean.com/products/inference/how-to/use-multimodal-inference/.

No model key or actual inference call was used during automated tests. After deployment, the app clearly reports missing AI configuration; adding the key enables background extraction of existing and new eligible replies. Set `DO_INFERENCE_ENABLED=false` to pause paid parsing while preserving receiving and manual editing. The worker checks every 10 seconds, processes up to five queued messages per pass, shares one database lock across instances, and retries transient failures up to three times with a one-minute backoff. Refreshing the browser reads saved results and does not itself invoke the LLM.

The AI receives only reply text and compact send/game/market context. Bot tokens, database credentials, partner contact data, and full Telegram events are not sent to the model. Validated output is persisted transactionally; extraction never grades bets. Input/output token counts and model ID are recorded for completed parses. This phase handles text only; screenshots retain raw metadata and require manual entry.

The service automatically creates `hub_confirm_sources` (one durable job per Telegram bot/chat/message), `hub_confirm_bets` (editable fills and grades), and `hub_confirm_history` (before/after changes, grades, deletion, and actor). All three use the existing `LOL_DO_DB_*` connection and require CREATE/SELECT/INSERT/UPDATE permissions; the bet schema migration also requires ALTER and INDEX. Existing fills receive attribution/date metadata on startup without replacing bet details or grades. `hub_confirm_bets` exposes typed, stored generated columns (`bet_id`, `game`, `team`, `bet`, `risk`, `odds`, `grade`, `pl`, partner/bettor/Telegram identity fields, date fields, sport/league/game ID) from its current JSON record, with indexes for partner/date and sender/date reporting. Updating the JSON record automatically updates these columns in the same database write. Telegram intake and its acknowledgement cursor stay separate from model calls, so AI outages cannot block raw message preservation. Original and edited Telegram events remain in `hub_telegram_inbox`.

`GET /api/confirms`, `PATCH/DELETE /api/confirms/bets/:rowId`, and `POST /api/confirms/sources/:sourceId/manual|retry` require the app authentication and HTTPS. Writes additionally require same-site JSON with `X-Betting-Hub: confirms` and saved revision checks. A corrected BETID must refer to an existing reserved Sends ID; manually corrected game/team/market text is retained independently of the raw reply.

`GET/POST /api/send-drafts`, `PATCH/DELETE /api/send-drafts/:id`, and `POST /api/send-drafts/:id/send` use the app authentication gate. Mutations require JSON and the `X-Betting-Hub: sends` header. The service uses the existing `LOL_DO_DB_*` connection variables and creates `hub_send_drafts` on first access, requiring `CREATE`, `SELECT`, `INSERT`, `UPDATE`, and `DELETE` permissions on that app table. It does not write to `TREVORFAIRS`. This provides a shared queue across devices after deployment, without relying on browser-local draft storage.

One card is kept per match and lineup combination. Each card displays a permanent six-character Bet ID, such as `KAR145`: the first three letters of the first selected team's name, followed by three digits (000–999). Match-only selections use Team A; names with fewer than three letters are padded with X. The server assigns IDs to existing cards on load and reserves them in `hub_send_ids`, which also requires CREATE/SELECT/INSERT permission. IDs remain reserved after removal; after all 1,000 numbers for a prefix are used, creating another card with that prefix returns an error. Adding more markets merges them into the card without replacing its ID, play-to prices, notes, recipients, or the captured model publication. Revision checks reject stale edits and removals from another screen. Partners/groups are read from the shared database registry. Saving/sending a card uses current saved partner channel details, while prior delivery snapshots remain preserved.

Partner Accounting saves partners centrally in `hub_partners` using the existing DigitalOcean `LOL_DO_DB_*` connection (CREATE/SELECT/INSERT/UPDATE). Records include a stable ID, name, Telegram channel, revision, and created/updated timestamps. Additions and channel edits are acknowledged only after database commit. Partners persist across browser refreshes, different devices, deployments, and app restarts. **Refresh partners** reloads the shared registry; **Refresh Sends** also reloads destinations. Partner changes do not send Telegram messages by themselves or alter historical bets/payment balances.

The first visit to Partner Accounting or Sends imports legacy browser partners, retaining their IDs. A stale browser backup never overwrites a newer saved channel. If another browser used a different ID for the same name, `hub_partner_aliases` retains that old ID for historical joins and Sends resolves it to the central partner. Local backups are removed only after successful import and readback; failed imports keep the backup. New partner records are not stored only in local storage. `GET/HEAD/POST /api/partners`, `PATCH /api/partners/:id`, and `POST /api/partners/import` require authentication and HTTPS; writes require same-site JSON and `X-Betting-Hub: partners`, and updates reject stale revisions.

## Telegram bot connection

Set **`TELEGRAM_BOT_TOKEN`** as an encrypted **Runtime** variable in DigitalOcean to provision `@bettingtasks_bot`. On first connection, when no saved bot exists, the backend verifies the token with `getMe` and saves the connection automatically. The server stores bot credentials as AES-256-GCM encrypted JSON in `hub_telegram_settings`, shared across browsers and deployments. Existing saved settings take priority over the bootstrap environment variable. There is no credential-entry form in the app. The table is created on first use with the existing `LOL_DO_DB_*` connection. Tokens are never returned to the browser or stored in browser local storage.

Also set **`TELEGRAM_CREDENTIALS_KEY`** as an **encrypted Runtime** environment variable on the DigitalOcean service. Generate its 64-character hex value once with:

```sh
openssl rand -hex 32
```

Keep this key stable and backed up; replacing it prevents the server from decrypting saved credentials. Do not use a `REACT_APP_` prefix or commit the token/key. Database and Telegram failures are sanitized before returning them to the browser. All Telegram routes require the existing app authentication and HTTPS; writes also require same-site JSON requests and the app's custom header.

**Refresh replies** in Confirms reads only saved matching partner messages and receiver status. It never contacts Telegram or advances the cursor. Sending from Sends and background receiving use the same saved bot connection. Tests use mocked Telegram responses and never send live messages.

## Raw Telegram receiving

The Node server starts a receiver immediately and checks for updates every **10 seconds**, independently of the browser. It uses the saved bot provisioned from DigitalOcean runtime settings, the existing encrypted credentials, and the existing `LOL_DO_DB_*` MySQL connection. No AI API or additional package is needed. It automatically creates these InnoDB/utf8mb4 tables, requiring `CREATE`, `SELECT`, `INSERT`, and `UPDATE` permissions:

| Table | Stored data |
| --- | --- |
| `hub_telegram_inbox` | Exact message text/caption, bot/update/chat/message/sender IDs, receipt time, candidate bet IDs, and the full raw Telegram update JSON. |
| `hub_telegram_message_bets` | Recognized bet IDs, permanent draft IDs, and a snapshot of the send's context at receipt. One message can reference multiple sends. |
| `hub_telegram_poll_state` | Per-bot cursor, most recent successful poll and incoming update time, and sanitized receiver errors. |

For example, `BOS145 ML -110 $500 -1.5 +150 200` is saved unchanged and linked to `BOS145` if it exists in `hub_send_ids`. Matching is case-insensitive and requires a complete six-character token; unknown IDs and messages without IDs are still saved. Confirms queues eligible partner replies for extraction after their raw data is durable. Existing ID reservations remain recognizable after draft deletion, although deleted draft context may be unavailable; previously archived context is retained. A raw reply or AI extraction alone is not an independently verified bookmaker receipt.

The Bot API returns a bot-wide stream, so every message delivered to this bot is preserved, including partner channels such as `trevor_partner`, group messages, and direct messages. There is no per-channel polling call or dependency on browser-local partner records. Add the bot to each intended chat. For channels, grant administrator access. For plain text in groups, make the bot an administrator or disable its privacy mode through BotFather. Comments on a channel post arrive in its linked discussion group, where the bot also needs access.

Raw events, bet links, and the cursor commit in one transaction **before** a subsequent request acknowledges those updates to Telegram. A failed write leaves the committed cursor unchanged for retry. `(bot_id, update_id)` deduplicates retries; new edit events append without replacing the original. A MySQL session lock prevents competing receivers across app instances/rolling deployments. Backlogs drain in batches of 100, up to 1,000 updates per polling pass. A cursor older than a week without incoming updates is reset because Telegram can randomize subsequent update IDs.

Use this app as the bot's only polling consumer. An existing webhook blocks polling and is left intact; the saved inbox reports the conflict. Set `TELEGRAM_POLLING_ENABLED=false` on a server that should not receive updates (for example, a development copy sharing production credentials). Otherwise receiving starts automatically after deploying this code with a valid database connection and saved bot. The receiver pauses and retries if configuration or the database is unavailable.

Telegram retains unreceived updates for at most **24 hours** and cannot return arbitrary prior chat history. Preserved text and JSON stay in MySQL until explicitly removed. Media messages preserve captions and file metadata. Supported screenshots are downloaded on demand for AI parsing; image bytes are not stored in confirmation payloads. These Bot API behaviors are documented at https://core.telegram.org/bots/api#getting-updates and https://core.telegram.org/bots/api#getfile.

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
