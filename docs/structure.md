# Betting Hub structure

This version provides the interface and navigation for six workspaces. League of Legends Upcoming Games reads published outputs from DigitalOcean MySQL; Sends stores draft selections centrally; confirmed placements and financial-account integrations remain placeholders.

| Workspace | URL |
| --- | --- |
| Monitoring (home) | `#/` |
| Active Bets | `#/bets` |
| Trading Dashboard | `#/suggestions` |
| Hockey | `#/sports/hockey` |
| League of Legends | `#/sports/lol` |
| NASCAR | `#/sports/nascar` |
| Partner Accounting | `#/partners` |
| Analytics | `#/analytics` |

Hash-based navigation works with the password-protected production server, including refreshes, bookmarks, and browser back/forward. Unknown routes provide a link back to Monitoring.

## Source organization

- `src/app/`: shared sidebar, header, navigation configuration, and route handling.
- `src/components/`: reusable UI, icons, tables, filters, status badges, and accessible drawers.
- `src/features/`: independent monitoring, bets, suggestions, sports, partners, and analytics modules.
- `src/features/monitoring/sources.js`: the planned connection inventory. All entries are explicitly unconnected.
- `src/features/sports/config.js`: the views, table columns, and input coverage for each sport.
- `src/App.css` and `src/index.css`: shared responsive layout and visual styles, without external CSS dependencies.
- `server/index.cjs`: production static serving with server-side HTTP Basic authentication. Credentials come from runtime environment variables; `/healthz` exposes no app content.
- `server/sends.cjs`: central draft persistence, merge/deduplication, market validation, and revision checks.
- `server/telegram.cjs`: encrypted bot credentials and server-side Telegram API calls.
- `server/telegram-receiver.cjs`: 10-second background polling, transactional raw-update persistence, durable cursors, send-ID links, and the saved inbox.
- `src/features/bets/`: shared market catalog, game-market checklist, Sends provider and editable cards.
- `server/lol.cjs`: read-only `TREVORFAIRS` adapter, Shiny-equivalent formatting/series calculations, and verified MySQL TLS configuration.
- `src/features/sports/lol/`: Upcoming Games table, filters, pagination, and Eastern Time display.

Navigation, category filters, search over planned sources, source details, workspace view switches, sports sub-tabs, and the alerts inbox work locally. League of Legends metrics and Upcoming Games use the authenticated `/api/lol/upcoming-games` endpoint. Other data-dependent metrics show dashes and actions, such as export, remain disabled with an explanation. Financial tables contain empty states.

## Development and checks

Use the existing Yarn lockfile and a Node installation:

```sh
yarn install --frozen-lockfile
yarn dev
```

```sh
CI=true yarn test --watchAll=false
yarn test:server
yarn build
```

The production build is written to `_static/`. The `start` command runs the authenticated Node server; configure `APP_AUTH_USERNAME` and `APP_AUTH_PASSWORD` as runtime variables before deployment. The `dev` command runs the local React development server without the production authentication gate. See the README for deployment setup.

The application tests cover the default monitoring state, navigation/deep links, sports routes, source filtering, drawers, LoL filtering/sorting/pagination, error recovery, and timezones. Server tests cover authentication, API access/error handling, prediction calculations, and the fixed read-only query.

## Adding integrations later

Extend the existing authenticated backend with source adapters when integrating more data. Keep source timestamps, successful model completion, output publication, and hub ingestion as separate fields. The planned Monitoring source inventory still needs real health records; a successful LoL fetch does not establish the health of other integrations.

Suggestions, placements, partner reports, settlements, and payments should retain their own identities and link to each other. Confirmed placements determine exposure; sending a recommendation alone does not establish a placed bet.
