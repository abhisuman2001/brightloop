# Brightloop Software

One system to run plans, subscriptions and recurring billing: products and plans, quotations, automatic invoicing, taxes, discounts, payments, a customer portal and revenue reporting.

**Stack:** React, TypeScript, Tailwind CSS and Lucide on the front end. Express and a local SQLite database (`data/brightloop.db`) on the back end. There is no database server to install; the file and its tables are created on first boot.

## Run it

Requires Node.js 20 or newer.

```bash
npm install
npm run seed     # optional: a year of realistic demo data
npm run dev      # http://localhost:5173
```

To run the production build instead:

```bash
npm run build
npm start        # http://localhost:4000
```

Demo logins (after `npm run seed`), all with the password `Brightloop#2026`:

| Role | Email | Sees |
|---|---|---|
| Admin | `admin@brightloop.dev` | Everything, including plans, taxes, discounts and staff |
| Staff | `staff@brightloop.dev` | Day-to-day work: customers, subscriptions, invoices, payments |
| Customer | `customer@brightloop.dev` | Only their own subscriptions and invoices, in the portal |

`npm run seed` replaces the database. It refuses to run when `NODE_ENV=production`.

| Command | Purpose |
|---|---|
| `npm test` | Pricing, billing, API and role tests |
| `npm run typecheck` | TypeScript check |
| `node tests/perf.mjs` | Response times against a running, seeded server |

## How the rules are enforced

- **Nothing billed twice.** A partial unique index on `invoices(subscription_id, period_start)` allows one live invoice per period, so the database refuses a duplicate even if application logic were wrong.
- **Nothing skipped.** Billing works from each subscription's next invoice date and catches up every missed period. Cancelling an invoice reopens its period for the next run. Each subscription bills in its own transaction, so one bad record is reported without stopping the rest.
- **Daily automation.** On boot and then hourly, the server runs the day's job once: activate what has started, bill what is due, close plans set to close on their own, and re-price. Staff can run it sooner, and repeating it is safe.
- **One pricing engine.** `shared/pricing.ts` prices previews and real invoices alike. Money is integer paise, and rounding is allocated so lines always add up to the total.
- **Roles are enforced by the API**, not just hidden in the UI. An admin's Staff view really does remove admin access for that session, and it can only ever lower access.
- **Accounts.** One account per email regardless of case. Passwords need more than 8 characters with upper case, lower case and a special character, and are hashed with scrypt. Reset links are single-use, expire in an hour and sign out other sessions.

## Decisions worth knowing

- **Discounts:** a line gets the single best product rule, then the single best whole-subscription rule applies to the remainder. Each invoice using a rule counts as one use, given back if that invoice is cancelled.
- **Invoices start as drafts.** The team confirms them, one at a time or all at once. Customers only see confirmed ones, and only confirmed invoices can go overdue.
- **Full periods.** Invoices are billed in advance for a full period, without proration. Add-on changes apply from the next invoice.
- **Pausing** skips the periods inside the pause; they are not billed later.
- **Plans past expiry** that do not close on their own stay active but stop billing until renewed or closed. An admin may close a plan marked as not closable early; staff and customers may not.
- **Existing subscriptions keep their price** when a plan's price changes, until their lines are edited.
- **Signing up never links to an existing customer record**, because email ownership is not verified at sign-up. Staff use **Invite to portal**, which sends a link to the address on file.
- **Calendar dates are in Indian time**, so "today" changes at midnight IST on the server and in the browser.
- **Currency is INR only, with GST.** Rules can be limited to sales inside the seller's state (CGST, SGST) or to another state (IGST), decided from the first two digits of the customer's GSTIN. A customer with no GSTIN is treated as inside the state, because place of supply from an address is not worked out.
- **Bank statement matching.** Payments > Match bank statement reads a bank's CSV and pairs each credit with an invoice: by the invoice number in the narration, or by amount when only one open invoice fits. Nothing is recorded until someone reviews it, and matches by amount alone start unticked. A bank reference already recorded is flagged, not paid twice.
- **Reminders.** The daily job emails customers 1, 7, 14 and 30 days after an invoice falls due, and 14, 7 and 1 days before a renewable subscription ends. Each goes out once. Staff can also send one from an invoice.
- **UPI.** Set `UPI_ID` and the portal shows a QR on unpaid invoices, with the amount and invoice number filled in. This is not a payment gateway: the money is confirmed when the bank statement is matched.
- **Renewing.** A plain renewal adds the original term again. Periods after a lapsed expiry are not billed, and a period starting on the expiry day itself is not billed unless it is the first one or the plan is daily.

## Going to production

Copy `.env.example` to `.env` and set at least:

1. `APP_URL`, the public URL used in emailed links.
2. `SMTP_URL`. **Without it, no email is delivered**: messages are recorded in **Settings > Email log**, where an admin can open their links. Invoices are marked sent but do not reach customers, and customers cannot reset passwords on their own.
3. `ADMIN_EMAIL` and `ADMIN_PASSWORD`, which create the first admin on an empty database.
4. `TRUST_PROXY=1` when behind a reverse proxy. Serve over HTTPS; session cookies are `Secure` in production builds.

Things to plan for:

- **Back up `data/brightloop.db`.** Copying the file while the server runs can give a broken copy. Use `sqlite3 data/brightloop.db ".backup backup.db"`, or stop the server first.
- **One server process.** SQLite suits a single server on one machine, with a persistent disk. Running several servers would mean moving to a client-server database such as PostgreSQL.
- **No payment gateway.** Customers can pay by UPI QR, and staff record it or match it from the bank statement. Nothing confirms a payment automatically yet.
- **No email verification at sign-up**, because the brief did not ask for it.
