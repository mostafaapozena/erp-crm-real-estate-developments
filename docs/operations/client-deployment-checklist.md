# Client deployment checklist

For the engineer standing up the product for one client company (ADR-0027: one deployment, one
database, one company). Work top to bottom; every box is a gate. Nothing here is automated away on
purpose — each step is where a wrong deployment would otherwise become real.

Related: [client data-intake checklist](client-data-intake-checklist.md) ·
[migrations and upgrades](migrations-and-upgrades.md) ·
[backup, restore and retention](backup-restore-and-retention.md) ·
[environments](../architecture/environments.md)

## 1. Before anything is installed

- [ ] The client's data-intake checklist is complete and signed off by the client's named owner.
- [ ] The open stakeholder decisions this client's go-live depends on are closed in the
      [business decision register](../decisions/business-decision-register.md) — at minimum the
      approval levels, discount thresholds and document numbering. Anything left open is written down
      as "not configured" and the client has accepted it.
- [ ] **`SEC-033` status is known.** Until a KMS adapter exists, staging and production cannot store an
      MFA secret or a provider credential. Administrators need MFA, so a production deployment is
      blocked until the adapter is built. Do not work around this with the development key: the
      configuration loader refuses it outside development.
- [ ] A private object store for documents exists (or the deployment is accepted without document
      uploads — the development disk store refuses staging and production).

## 2. Infrastructure

- [ ] A MongoDB replica set (transactions are required) and a database name **without** `prod` in
      any non-production environment; a least-privilege application user with `readWrite` on that
      database only.
- [ ] Redis with a password, reachable only from the application network.
- [ ] Secrets in the platform's secret store, never in a file in the image: `AUTH_TOKEN_SIGNING_SECRET`
      (≥ 32 random bytes), database and Redis credentials, `KMS_KEY_ID`.
- [ ] `APP_ENV` set to `staging` or `production` — this is what turns on every production refusal.
- [ ] `ORG_TIMEZONE`, `DEFAULT_LOCALE`, `CORS_ALLOWED_ORIGINS` (the exact origin, no wildcard),
      `TRUST_PROXY_HOPS` matching the real proxy chain.
- [ ] `AUTH_LOGIN_IP_MAX_ATTEMPTS` left at its default (120) or lower; the loader refuses higher.
- [ ] `PUBLIC_APP_URL` set to the address customers will reach — it is printed in every issued PDF's
      QR code, so **changing it later breaks every printed code** (ADR-0033). Record it in the
      deployment record. `VERIFY_RATE_LIMIT_PER_MINUTE` left at 20 unless there is a reason.
- [ ] The web server answers `/verify/<token>` with the application (single-page fallback), so a
      scanned code opens the verification page rather than a 404.
- [ ] **Issued PDFs need private object storage** (`PLAT-017`). Until that adapter exists, staging and
      production refuse to store a file, so they cannot issue documents at all.
- [ ] Backups configured and **one restore rehearsed** before any real data is entered
      ([backup, restore and retention](backup-restore-and-retention.md)).

## 3. First start

- [ ] `npm run db:migrate:status` → shows every migration pending, nothing `changed` or `unknown`.
- [ ] `npm run db:migrate -- --confirm` → `databaseVersion` equals the build's last migration.
- [ ] `npm run client:init -- --file <client.json> --check` → the file is valid.
- [ ] `npm run client:init -- --file <client.json>` → every item `created`. Run it a second time:
      every item `exists`. Keep the file with the deployment's records, **not** in the repository.
- [ ] `npm run bootstrap:admin` with the client administrator's e-mail → hand the activation token
      over in person or through the client's approved secure channel; it is shown once.
- [ ] The administrator activates, enrols a second factor, and signs in.
- [ ] `GET /health/ready` answers `ready` with `transactions: true`.

## 4. Configuration in the product (each change is audited)

- [ ] Company profile reviewed: names in both languages, registration numbers, contact details,
      logo and favicon, brand colour (the product refuses a colour that fails contrast).
- [ ] Organization: departments, teams, job titles, placements and reporting lines — escalation
      follows them.
- [ ] Roles and grants per the approved `SD-01`/`SD-02` design; the bootstrap role replaced.
- [ ] Settings: fiscal-year start, reservation validity, quiet hours, escalation delay — each left
      `null` until decided, never guessed.
- [ ] Number sequences activated for every document type in use.
- [ ] Approved legal wording (contract, reservation form, receipt) published in the template registry
      if the client provides it; until then issued PDFs print data only and say so.
- [ ] `document.generate`, `document.view` and `document.download` granted only to the roles that
      issue or hand out documents; `document.revoke` (administrative) to as few people as possible.
- [ ] Reference data imported (`/imports`) or entered; bound lists relabelled if the client's wording
      differs.
- [ ] Feature flags reviewed. `feature.notifications.externalDelivery` stays **off** until a provider
      is connected and approved.

## 5. Before the client uses it

- [ ] No demonstration data: the database has no `demoSeedLedger` collection
      (`client:init` refuses one; check anyway).
- [ ] The demonstration notice does not appear on the sign-in screen (it shows only when
      `APP_ENV` is development or test).
- [ ] Arabic and English both render; Arabic right-to-left; dates in `dd/MM/yyyy` with Western digits.
- [ ] A test user in a branch scope cannot see another branch's records.
- [ ] Issue one test document, scan its QR code from a phone that is not signed in, and see
      "valid"; then revoke it and see "revoked".
- [ ] The operations contact knows where the audit trail, backups and this checklist are.

Record the date, the build version, the database version and who performed each section in the
deployment record.
