# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## Ninety API configuration

This app depends on Ninety's own backend (`../ninety-api`) for football fixtures and broadcast channel resolution. It's configured via a single required env var:

- `VITE_NINETY_API_URL` — base URL of the ninety-api server (e.g. `http://localhost:3000` for local dev, or the deployed Railway URL in production). There is no default and no hard-coded fallback — the app will not build football data without it.

### Local dev setup

1. Run `ninety-api` locally (`npm run dev` in that repo, usually serving on `http://localhost:3000`).
2. Copy `.env.example` to `.env` in this repo and set `VITE_NINETY_API_URL` to that local server's URL.
3. `npm run dev` as usual.

If `VITE_NINETY_API_URL` is unset, football fixture requests fail immediately with a clear error, which is surfaced in the Home screen's feed status rather than silently showing zero fixtures.

### GitHub Pages deploy

The Pages workflow (`.github/workflows/deploy.yml`) reads `VITE_NINETY_API_URL` from the **repository variable** of the same name (`vars.VITE_NINETY_API_URL`) at build time — it is not hard-coded in source or in the workflow file.

To configure it: repo Settings → Secrets and variables → Actions → Variables tab → New repository variable → name `VITE_NINETY_API_URL`, value the deployed ninety-api URL (e.g. the Railway URL). Without this set, the deployed Pages build will show a clear "football fixtures unavailable" error instead of silently dropping football data.

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
