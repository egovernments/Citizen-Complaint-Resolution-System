# DIGIT Studio Configurator

Web UI for configuring and managing DIGIT platform tenants — onboard cities, set up departments, designations, complaint types, employees, and boundaries through a guided wizard or a full CRUD management interface.

## Prerequisites

- Node.js 20+ and npm
- [DIGIT-MCP](https://github.com/ChakshuGautam/DIGIT-MCP) repo cloned as a sibling to this repository's root (provides `@digit-mcp/data-provider`)

Expected directory layout:

```
parent/
├── Citizen-Complaint-Resolution-System/   # this repo
└── DIGIT-MCP/                             # data-provider dependency
    └── packages/data-provider/
```

## Quick Start (Dev Mode)

```bash
# 1. Build the data-provider dependency
cd ../../../../../DIGIT-MCP/packages/data-provider
npm install && npm run build

# 2. Install dependencies from repo root (npm workspaces)
cd /path/to/Citizen-Complaint-Resolution-System
npm install

# 3. Start dev server
cd utilities/crs_dataloader/ui-mockup
npm run dev
```

The app will be available at `http://localhost:5173`.

## Production Build & Deploy

Use the setup script from the repo root:

```bash
# Build only
./scripts/setup-configurator.sh

# Build and deploy to /var/www/configurator
./scripts/setup-configurator.sh --deploy

# Build and deploy to custom path
./scripts/setup-configurator.sh --deploy --web-root /var/www/my-configurator
```

The script handles cloning DIGIT-MCP (if missing), building the data-provider, installing workspace dependencies, building the UI, and optionally copying the output to a web root. It also prints an nginx config snippet for serving the SPA.

## How the DIGIT API URL Works

The app does **not** use a backend server — it's a pure SPA that calls DIGIT APIs directly from the browser.

The environment list is defined in `src/api/config.ts`:

```ts
export const ENVIRONMENTS: Environment[] = [
  {
    name: 'Chakshu Dev',
    url: 'https://api.egov.theflywheel.in',
    description: 'Chakshu development environment',
  },
];
```

To add a new environment, add an entry to this array. The user selects an environment at login, and all API calls go to that URL for the session.

## Project Structure

```
src/
├── api/            # API client, types, config, domain services
├── components/     # Shared UI components (Radix-based)
├── pages/          # Route pages (Login, Phase 1–4, Complete)
├── providers/      # react-admin data/auth provider bridge
├── resources/      # CRUD pages for each DIGIT entity type
├── lib/            # Utilities
└── App.tsx         # Root component, routes, state management
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | TypeScript check + Vite production build |
| `npm run preview` | Preview production build locally |
| `npm run test` | Run unit tests (vitest) |
| `npm run test:e2e` | Run end-to-end tests (Playwright) |
| `npm run lint` | Run ESLint |
