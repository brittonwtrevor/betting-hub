# Betting Hub structure

This version provides the interface and navigation for six workspaces. It makes no external API requests and stores no bets or account information.

| Workspace | URL |
| --- | --- |
| Monitoring (home) | `#/` |
| Active Bets | `#/bets` |
| Bet Suggestions | `#/suggestions` |
| Hockey | `#/sports/hockey` |
| League of Legends | `#/sports/lol` |
| NASCAR | `#/sports/nascar` |
| Partner Accounting | `#/partners` |
| Analytics | `#/analytics` |

Hash-based navigation works with the current DigitalOcean static server, including refreshes, bookmarks, and browser back/forward. Unknown routes provide a link back to Monitoring.

## Source organization

- `src/app/`: shared sidebar, header, navigation configuration, and route handling.
- `src/components/`: reusable UI, icons, tables, filters, status badges, and accessible drawers.
- `src/features/`: independent monitoring, bets, suggestions, sports, partners, and analytics modules.
- `src/features/monitoring/sources.js`: the planned connection inventory. All entries are explicitly unconnected.
- `src/features/sports/config.js`: the views, table columns, and input coverage for each sport.
- `src/App.css` and `src/index.css`: shared responsive layout and visual styles, without external CSS dependencies.

Navigation, category filters, search over planned sources, source details, workspace view switches, sports sub-tabs, and the alerts inbox work locally. Data-dependent metrics show dashes and data-dependent actions, such as export, remain disabled with an explanation. Financial tables contain empty states.

## Development and checks

Use the existing Yarn lockfile and a Node installation:

```sh
yarn install --frozen-lockfile
yarn dev
```

```sh
CI=true yarn test --watchAll=false
yarn build
```

The existing production `start` and `build` commands are preserved for DigitalOcean. The production build is written to `_static/`. The new `dev` command runs the React development server.

The application tests cover the default monitoring state, navigation/deep links, sports routes, source filtering, and opening/closing drawers.

## Adding integrations later

Add source adapters and the authenticated backend when integrating actual data. Keep source timestamps, successful model completion, output publication, and hub ingestion as separate fields. The planned source inventory should then be backed by real health records.

Suggestions, placements, partner reports, settlements, and payments should retain their own identities and link to each other. Confirmed placements determine exposure; sending a recommendation alone does not establish a placed bet.
