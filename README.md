# Esure Backend

The API and scenario runner for Esure, an open-source testing toolkit for
Stellar payments.

## Requirements

- Node.js 20 or newer
- Network access to Stellar Testnet for live runs

## Setup

```bash
npm install
copy .env.example .env
npm run dev
```

The API listens on `http://localhost:3001` by default.

## Commands

```bash
npm run dev        # start with file watching
npm run build      # compile TypeScript
npm test           # run unit/API tests
npm run typecheck  # check types without emitting files
npm run check      # typecheck and test
```

## Initial endpoints

- `GET /health`
- `GET /api/v1/scenarios`
- `GET /api/v1/scenarios/:scenarioId`
- `POST /api/v1/runs`
- `GET /api/v1/runs/:runId`
- `GET /api/v1/runs/:runId/report`

Start a live Testnet run:

```bash
curl -X POST http://localhost:3001/api/v1/runs \
  -H "content-type: application/json" \
  -d '{"scenarioId":"issued-asset-payment","inputs":{}}'
```

Run state is currently stored in memory and is lost when the process restarts.
Generated Testnet secret keys are held only during execution and are never
included in responses or reports.

## Safety

The MVP accepts only bundled scenarios and is locked to Stellar Testnet. It
does not accept secret keys, arbitrary transaction envelopes, URLs, or code in
API requests.

