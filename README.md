# Betting Hub

A React workspace for betting operations, research, and reporting, hosted on DigitalOcean App Platform.

## Workspaces

- **Monitoring:** planned sources, data freshness, model-to-hub delivery stages, run history, and attention items.
- **Active Bets:** open placements, confirmation tracking, and settled bets.
- **Bet Suggestions:** opportunity queue and planned alert coverage.
- **Sports Dashboards:** Hockey, League of Legends, and NASCAR, each with its own research views.
- **Partner Accounting:** balances, reported bets, and payments.
- **Analytics:** performance, date/sport/scope filters, breakdowns, and export placeholders.

This initial version provides navigation and UI structure. Sources are marked as unconnected, data tables are empty, and external integrations have not been added.

## Local development

With Node and Yarn installed:

```sh
yarn install --frozen-lockfile
yarn dev
```

## Validation

```sh
CI=true yarn test --watchAll=false
yarn build
```

The production build is written to `_static/`. The existing DigitalOcean production build and start commands are preserved.

See [the structure guide](docs/structure.md) for routes, source organization, and future integration boundaries.
