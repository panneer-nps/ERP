# Brick Chamber ERP

Brick Chamber ERP is a bilingual (English/Tamil), responsive web ERP for brick-chamber operations. The Next.js web app uses a TypeScript API and PostgreSQL as its system of record. The current implementation covers setup and access control, masters, production, stock/FIFO valuation, sales and returns, loading/delivery, purchases, expenses, people/payroll, accounting, approvals, audit, reports, offline expense/photo recovery, and an Owner read-only assistant.

The approved product blueprint is [`docs/MASTER_PRD.md`](docs/MASTER_PRD.md). Architecture, database, accounting/business rules, API, UI/mobile, AI, security, test and UAT specifications are under [`docs/`](docs/).

## Start the app on Windows

Run commands from the repository root: `D:\my data\ERP Solution\ERP`. PowerShell may block the `npm.ps1` script; use `npm.cmd` in the commands below. Password prompts in `psql` and secure PowerShell prompts do not echo characters while typing.

1. Install dependencies once:

   ```powershell
   npm.cmd install
   ```

2. Start PostgreSQL. If Docker Desktop is running, use `npm.cmd run db:start`. If using the installed PostgreSQL service, start that service in Windows Services and use the local configuration in `backend/.env`. Never share or commit that file.

3. Check the current schema without changing data, then back up any database with existing company records. Apply pending migrations only after confirming the database target and backup:

   ```powershell
   npm.cmd run db:status
   npm.cmd run db:migrate
   ```

4. In a first PowerShell terminal, start the API:

   ```powershell
   npm.cmd run dev:api
   ```

5. In a second terminal at the repository root, start the web app:

   ```powershell
   npm.cmd run dev:web
   ```

6. Open [http://localhost:3000](http://localhost:3000).

The browser sends API calls to the same origin (`/api`). Next.js forwards them to the API server using `ERP_API_INTERNAL_URL` (default `http://127.0.0.1:4000`), so the browser and installed mobile app do not need a hard-coded `localhost` API address or a cross-origin CORS exception. Set this server-side variable to the private API origin when the web and API servers are on different hosts. Keep PostgreSQL reachable by the API server only; do not expose PostgreSQL to the browser or public internet.

For native PostgreSQL database setup and encrypted backup/restore instructions, see [`backend/README.md`](backend/README.md).

## Deploy the API on Render

Use the repository root as the service working directory (leave Render's **Root Directory** empty). The API is an npm workspace and uses the root `package-lock.json`.

| Setting | Value |
| --- | --- |
| Build Command | `npm ci --include=dev && npm run build:api` |
| Start Command | `npm run start --workspace @brick-erp/api` |

The build must compile TypeScript before startup. It generates `backend/dist/server.js`; `dist/` is intentionally ignored by Git. Installing dependencies alone does not generate this file and causes `MODULE_NOT_FOUND` at startup. `--include=dev` installs the TypeScript compiler even when `NODE_ENV=production` is set. After saving these settings, deploy the commit containing the build command.

Configure the API environment using `backend/.env.example` as the reference, including the production database connection and secrets. Set `NODE_ENV=production` and `API_HOST=0.0.0.0` (the example file uses loopback for local development). Render supplies `PORT`, which the API already reads. Configure the separately hosted web app's `ERP_API_INTERNAL_URL` to point to the deployed API origin. Database initialization and migrations remain a separate operation; compiling the API does not apply migrations.

## First login and company setup

- `/setup` is available only when the database contains no company. It creates the company and its first Owner account; public sign-up closes after that.
- Sign in as Owner. Use **User access** (`/admin/users`) to create staff accounts, assign a least-privilege role (Manager, Cashier, Accountant, Auditor, Sales, Production, Loading, Loading Verifier or Store), choose branch access, and set the initial password. The Owner shares each password securely with the staff member.
- Use **Company profile** (`/admin/company`) to change the display/legal details and upload or remove the company logo. Profile changes are audited.
- Use the language selector to switch between English and Tamil. The app adapts to desktop and phone screen sizes.

If the company is already initialized, `/setup` will not create another Owner. Sign in with the existing Owner account instead.

## Development checks

```powershell
npm.cmd run build
npx.cmd tsc --noEmit -p frontend/tsconfig.json
node frontend/scripts/verify-offline-outbox.mjs
node frontend/scripts/verify-service-worker-shell.mjs
npm.cmd run verify:bank-import
npm.cmd run verify:localization
git diff --check
```

Database-backed scenarios and remaining manual sign-off items are tracked in [`docs/TEST_PLAN.md`](docs/TEST_PLAN.md) and [`docs/UAT.md`](docs/UAT.md). Production launch still requires the company’s business-rule, accounting/tax, security, backup/RPO/RTO, and real-device UAT approvals.
# Run a fresh local ERP workspace on Windows

If the installed PostgreSQL Windows service cannot be started, the project can use a separate development database without changing that service or `backend/.env`:

```powershell
npm.cmd run local:start
```

This initializes a project-local PostgreSQL 18 cluster under the ignored `.local` directory on `127.0.0.1:5434`, creates `brick_erp_local`, applies the migrations, and starts an isolated API on port 4001 and web app on port 3002. The separate web build directory lets it run alongside another local Next.js server. The new database uses local-only `trust` authentication for development; it has no database password and must not be exposed beyond the computer or used for production. Open `http://localhost:3002/setup` to create the first company Owner with a password you choose. After setup, add Manager/Cashier accounts under **User access** and set the company name/logo under **Company profile**.

If a default port or the default PostgreSQL log path is unavailable, set alternate values in the same PowerShell window before starting:

```powershell
$env:ERP_LOCAL_DB_PORT = '15432'
$env:ERP_LOCAL_API_PORT = '14001'
$env:ERP_LOCAL_WEB_PORT = '13003'
$env:ERP_LOCAL_PG_LOG = 'tmp/postgres-local-runtime.log'
$env:ERP_LOCAL_NEXT_DIST_DIR = '.next-local-13003'
npm.cmd run local:start
```

The defaults remain 5434, 4001 and 3002. Stop with `npm.cmd run local:stop`; the command stops the tracked local API/web processes and PostgreSQL data directory while preserving its database files.

Stop only these project-local processes with:

```powershell
npm.cmd run local:stop
```

The stop command leaves `.local/postgres/data` intact. The old PostgreSQL service and database are left untouched. Keep the project folder and `.local` directory backed up if you enter business data; this local development database does not replace encrypted production backups.
