# Security specification and deployment checklist

## Application controls

- PostgreSQL is accessed only by the API; database credentials stay in ignored server configuration. Browser/mobile clients call the API, never PostgreSQL.
- Passwords are scrypt-hashed; sign-in sessions use random opaque bearer tokens with SHA-256 token hashes stored server-side and a configurable expiry.
- Authentication and setup are rate-limited. Setup is one-time; staff sign-up is Owner-controlled. Self-service password changes require the current password, revoke other sessions while preserving the current one, and write an audit event. Owner recovery is a local-only, non-production CLI operation; it refuses TOTP-enabled, inactive or ambiguous Owner accounts and issues a random temporary password that must be changed after sign-in.
- Users may enable optional authenticator-app TOTP at `/account/security`. TOTP secrets are AES-256-GCM encrypted with the stable backend-only `TOTP_ENCRYPTION_KEY`; recovery codes are stored as hashes and are single-use. MFA login challenges are opaque, hashed in PostgreSQL, expire in five minutes and allow five attempts. Enrollment and disable require the current password and an authenticator or recovery code.
- Helmet headers, configured CORS origin allowlisting, server-side Zod validation, action-level permissions and company/branch-scoped SQL constrain requests.
- Financial/stock/profile/security-sensitive actions write audit history. Error responses expose stable safe codes and a request reference, not credentials or raw database details.
- Loading photos and company logos are served through authenticated company/branch-scoped routes. Production should use private object storage with least-privilege access; local development may use PostgreSQL bytes.
- Offline expense/photo payloads are AES-GCM encrypted in IndexedDB with per-user non-exportable Web Crypto keys and session-bound recovery identities. Same-origin running JavaScript can still read decrypted data; this is not protection against a compromised app origin.

## Production configuration required

- TLS at the edge; private/encrypted managed PostgreSQL with network allowlisting; production-only secrets from a secret manager; private object-storage bucket and lifecycle controls.
- Review CORS, proxy trust, session lifetime, rate limits, file size/type policy, logging retention and access roles for the actual deployment.
- If enabling TOTP, generate a random 32-byte hex `TOTP_ENCRYPTION_KEY`, store it in the backend secret manager, back it up securely, and keep it unchanged across restarts and deployments. Loss or replacement of this key makes existing TOTP secrets unreadable; retain account recovery procedures.
- Configure structured log collection, error monitoring, alerting, patching, vulnerability review, incident response and support ownership.
- Configure encrypted backup schedules and separately escrowed keys; enable managed PITR/WAL policy; rehearse restore and agree RPO/RTO/retention.
- Review authorization with the approved role matrix; run dependency/security review and web/API threat review before exposure.
- Do not place production credentials in Git, frontend environment variables, screenshots, test fixtures or audit JSON. Never expose database ports publicly.

Application-level checks exist, but this document is not a penetration-test report or deployment security approval. Production controls and security review remain open in `UAT.md`.
