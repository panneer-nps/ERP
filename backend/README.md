# API setup

For Docker-based local development, run `npm run db:start` from the repository root; its database is bound to localhost only. For the native PostgreSQL 18 service on this machine, run this in PowerShell from the repository root. The script creates the app role/database when missing; if the database already exists, it resets the app password only when the database is already owned by that role:

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -W -h 127.0.0.1 -U postgres -d postgres -f 'backend/setup-database.psql'
```

Enter the PostgreSQL administrator password at the prompt, then enter and confirm a new password for the dedicated `brick_erp_app` role. Run `./backend/set-local-db-password.ps1` to enter that app password securely and update the ignored `backend/.env` file without printing it. Apply versioned migrations with `npm run db:migrate`, and start the API with `npm run dev:api`. Start the frontend separately with `npm run dev:web`. Never expose PostgreSQL to browser/mobile clients or reuse these local settings in production.

The initial migration creates identity, company/branch, action permission, session, and audit foundations. First-time setup is available at `/setup` only while the database has no company; it creates the initial owner and closes after that. The one-time `npm run bootstrap-owner --workspace @brick-erp/api` command remains available as an administrative alternative.

The API exposes `GET /api/health` and session-based `POST /api/auth/login`, `POST /api/auth/logout`, and `GET /api/auth/me`. Protected domain routes should use `requirePermission` with a specific action permission.
