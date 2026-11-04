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

## Validation

```sh
CI=true yarn test --watchAll=false
yarn test:server
yarn build
```

The production build is written to `_static/`. The build command is unchanged; the production start command now serves that directory through the authenticated Node server. The server and its tests use Node's built-in modules, with no additional packages.

See [the structure guide](docs/structure.md) for routes, source organization, and future integration boundaries.
