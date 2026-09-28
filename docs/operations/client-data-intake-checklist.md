# Client data-intake checklist

What to collect from a client before their deployment, and in what form. Send it to the client's
named project owner; each item names who decides it. **Personal data is collected only when it is
needed and only in the form below** — no national-ID scans, bank statements or passwords by e-mail.

The answers become two things: the client initialization file
([example](client-init.example.json)) and the configuration entered in the product afterwards. Keep
both with the deployment's records, never in this repository.

## 1. Company (decides: client management)

| Item | Form | Used for |
|---|---|---|
| Legal name, Arabic and English | Text, exactly as registered | Company profile, documents |
| Trade name and short name, both languages | Text; short name ≤ 40 characters | Screens, browser tab, authenticator app |
| Commercial registration number, tax registration number | Text | Documents (`SD-10`) |
| Registered address, phone, e-mail, website | Text | Documents |
| Country, base currency | ISO codes (e.g. `EG`, `EGP`) | Money, documents |
| Organization timezone | IANA name (e.g. `Africa/Cairo`) | Every date the product shows |
| Default and supported languages | Arabic, English, or both | Starting language, language switch |
| Logo and favicon | PNG or JPEG, ≤ 512 KiB, transparent background preferred | Branding |
| Brand colour | One hex colour; the product derives the rest and refuses one that fails contrast | Branding |
| Document footer text, both languages | Text ≤ 600 characters | Generated documents |

## 2. Organization (decides: client management, HR)

| Item | Form |
|---|---|
| Legal entities | Code (capitals, digits, `-`), names in both languages, currency, timezone |
| Branches per entity | Code, names and city in both languages, optional cost-centre code |
| Departments, teams, job titles | Codes and names in both languages |
| People who will sign in | Name, work e-mail, branch, department, team, job title, direct manager |
| Reporting lines | Who each person reports to — escalations follow this |

## 3. Access (decides: client management; `SD-01`, `SD-02`)

- Roles the client needs and what each may do and see (own records, team, branch, company).
- Who administers the system. Every administrator needs an authenticator app on a phone.
- Segregation-of-duty rules: who may not approve what they created.

## 4. Business rules (decides: client management; see the business decision register)

Each item is an entry in the [business decision register](../decisions/business-decision-register.md).
Collect the client's answer or record "not yet decided" — the product stores `null`, never a guess.

- Reservation validity and deposit, discount thresholds and approval levels, cancellation and refund
  rules, grace period and late fees, payment allocation order, commission rules, taxes, fiscal-year
  start, document numbering formats, data retention periods, quiet hours, escalation timing,
  WhatsApp consent wording.

## 5. Reference data (decides: sales and finance leads)

Prepared as a CSV or Excel file with columns
`list, code, label_ar, label_en, description_ar, description_en, sort_order`, one row per item, for
the open lists: loss reasons, reservation reasons, cancellation reasons, document types, tax codes.
Lists the product owns (unit types, lead sources, pipeline stages, payment methods) can be
relabelled but not extended.

## 6. Existing data (decides: client management; migration is Business Master Prompt work)

- Which records exist today (projects, units, customers, contracts, instalments, receipts), where, and
  how many. Do not send the data itself at this stage.
- Who owns its accuracy and who signs off a migrated balance.

## 7. Integrations (decides: client management; nothing is connected by default)

- WhatsApp Business account, approved message templates and the customer consent wording (`SD-20`).
- E-mail and SMS providers, Meta advertising accounts, payment gateway, e-invoicing — each needs its
  own account owned by the client, and each stays off until its adapter is built and approved.

## 8. Operations (decides: client IT)

- Where the deployment runs; who holds the database and backup credentials.
- Backup frequency and how long backups are kept; the recovery-time and data-loss targets.
- The named contacts for incidents, security questions and access requests.
