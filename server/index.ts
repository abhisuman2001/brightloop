import { todayISO } from '../shared/dates';
import { passwordProblems } from '../shared/schemas';
import { createApp } from './app';
import { hashPassword } from './auth';
import { db, initDb } from './db';
import { runBilling } from './services/billing';
import { emailDeliveryConfigured } from './services/email';

const HOUR_MS = 3_600_000;

try {
  process.loadEnvFile('.env');
} catch {
  // No .env file: configuration comes from the real environment.
}

/** Creates the first admin on an empty database. Only ever an admin can add staff after that. */
async function bootstrapAdmin() {
  const { n } = db().prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin'`).get() as { n: number };
  if (n > 0) return;
  const { ADMIN_EMAIL: email, ADMIN_PASSWORD: password } = process.env;
  if (!email || !password) {
    console.warn(
      process.env.NODE_ENV === 'production'
        ? 'No admin exists. Set ADMIN_EMAIL and ADMIN_PASSWORD and restart to create one.'
        : 'Empty database. Run "npm run seed" for demo data and logins.',
    );
    return;
  }
  const problems = passwordProblems(password);
  if (problems.length) throw new Error(`ADMIN_PASSWORD needs ${problems.join(', ')}.`);
  db()
    .prepare(`INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?, 'Administrator', ?, 'admin', ?)`)
    .run(email.toLowerCase(), await hashPassword(password), new Date().toISOString());
  console.log(`Created admin ${email}.`);
}

/** Runs the daily billing job once per calendar day. Safe to repeat: billing is idempotent per period. */
function runScheduledBilling() {
  const today = todayISO();
  const ran = db().prepare(`SELECT 1 FROM billing_runs WHERE run_date = ? AND trigger = 'scheduled'`).get(today);
  if (ran) return;
  try {
    const result = runBilling({ today, trigger: 'scheduled' });
    console.log(`Billing run ${today}: ${result.created} invoices, ${result.failed} failed, ${result.closed} closed.`);
  } catch (err) {
    console.error('Scheduled billing failed; it will retry within the hour.', err);
  }
}

function purgeExpiredSessions() {
  db().prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
}

async function main() {
  initDb(process.env.DATABASE_PATH ?? './data/brightloop.db');
  await bootstrapAdmin();
  if (!emailDeliveryConfigured()) console.warn('SMTP_URL is not set: emails are recorded in Settings > Email log but not delivered.');

  const port = Number(process.env.PORT ?? 4000);
  const server = createApp().listen(port, () => console.log(`Brightloop API listening on http://localhost:${port}`));

  runScheduledBilling();
  const timer = setInterval(() => {
    runScheduledBilling();
    purgeExpiredSessions();
  }, HOUR_MS);

  const shutdown = () => {
    clearInterval(timer);
    server.close(() => {
      db().close();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
