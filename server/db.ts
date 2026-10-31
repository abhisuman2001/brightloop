import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type DB = Database.Database;

const MIGRATIONS: string[] = [
  `
  CREATE TABLE customers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    company TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL COLLATE NOCASE,
    phone TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    tax_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_customers_name ON customers(name);
  CREATE INDEX idx_customers_email ON customers(email);

  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT,
    role TEXT NOT NULL CHECK (role IN ('admin','staff','customer')),
    customer_id INTEGER REFERENCES customers(id),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    view_as_role TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);

  CREATE TABLE password_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );

  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('software','addon','service','goods')),
    sales_price INTEGER NOT NULL CHECK (sales_price >= 0),
    cost_price INTEGER NOT NULL CHECK (cost_price >= 0),
    notes TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE product_variants (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id),
    attribute TEXT NOT NULL,
    value TEXT NOT NULL,
    extra_price INTEGER NOT NULL DEFAULT 0 CHECK (extra_price >= 0),
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX idx_variants_product ON product_variants(product_id);

  CREATE TABLE plans (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    product_id INTEGER NOT NULL REFERENCES products(id),
    price INTEGER NOT NULL CHECK (price >= 0),
    billing_period TEXT NOT NULL CHECK (billing_period IN ('daily','weekly','monthly','yearly')),
    min_quantity INTEGER NOT NULL DEFAULT 1 CHECK (min_quantity >= 1),
    start_date TEXT,
    end_date TEXT,
    auto_close INTEGER NOT NULL DEFAULT 0,
    closable INTEGER NOT NULL DEFAULT 1,
    pausable INTEGER NOT NULL DEFAULT 1,
    renewable INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE quotation_templates (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    plan_id INTEGER NOT NULL REFERENCES plans(id),
    validity_days INTEGER NOT NULL,
    payment_term_days INTEGER NOT NULL,
    plan_quantity INTEGER NOT NULL DEFAULT 1,
    plan_variant_id INTEGER REFERENCES product_variants(id),
    lines_json TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE tax_rules (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    rate_bps INTEGER NOT NULL CHECK (rate_bps BETWEEN 0 AND 10000),
    product_type TEXT,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE discounts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('percent','fixed')),
    value INTEGER NOT NULL CHECK (value > 0),
    min_purchase INTEGER NOT NULL DEFAULT 0,
    min_quantity INTEGER NOT NULL DEFAULT 0,
    start_date TEXT,
    end_date TEXT,
    usage_limit INTEGER,
    used_count INTEGER NOT NULL DEFAULT 0,
    scope TEXT NOT NULL CHECK (scope IN ('product','subscription')),
    product_ids_json TEXT NOT NULL DEFAULT '[]',
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);

  CREATE TABLE subscriptions (
    id INTEGER PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    plan_id INTEGER NOT NULL REFERENCES plans(id),
    template_id INTEGER REFERENCES quotation_templates(id),
    start_date TEXT NOT NULL,
    expiry_date TEXT,
    payment_term_days INTEGER NOT NULL DEFAULT 30,
    validity_days INTEGER NOT NULL DEFAULT 30,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','quotation','confirmed','active','closed')),
    quote_valid_until TEXT,
    next_invoice_date TEXT,
    paused_at TEXT,
    activated_at TEXT,
    closed_at TEXT,
    closed_reason TEXT,
    notes TEXT NOT NULL DEFAULT '',
    recurring_amount INTEGER NOT NULL DEFAULT 0,
    monthly_amount INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_subs_status ON subscriptions(status, next_invoice_date);
  CREATE INDEX idx_subs_customer ON subscriptions(customer_id);
  CREATE INDEX idx_subs_plan ON subscriptions(plan_id);

  CREATE TABLE subscription_lines (
    id INTEGER PRIMARY KEY,
    subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    variant_id INTEGER REFERENCES product_variants(id),
    quantity INTEGER NOT NULL CHECK (quantity >= 1),
    unit_price INTEGER NOT NULL,
    variant_extra INTEGER NOT NULL DEFAULT 0,
    is_plan_line INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_sub_lines_sub ON subscription_lines(subscription_id);

  CREATE TABLE invoices (
    id INTEGER PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    subscription_id INTEGER NOT NULL REFERENCES subscriptions(id),
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    customer_name TEXT NOT NULL,
    customer_company TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    customer_address TEXT NOT NULL,
    customer_tax_id TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    issue_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','paid','cancelled')),
    subtotal INTEGER NOT NULL,
    discount_total INTEGER NOT NULL,
    tax_total INTEGER NOT NULL,
    total INTEGER NOT NULL,
    amount_paid INTEGER NOT NULL DEFAULT 0,
    sent_at TEXT,
    created_at TEXT NOT NULL
  );
  -- The guarantee behind "nothing is billed twice": one live invoice per subscription per period.
  CREATE UNIQUE INDEX idx_invoices_one_per_period ON invoices(subscription_id, period_start) WHERE status <> 'cancelled';
  CREATE INDEX idx_invoices_subscription ON invoices(subscription_id, status, due_date);
  CREATE INDEX idx_invoices_status_due ON invoices(status, due_date);
  CREATE INDEX idx_invoices_customer ON invoices(customer_id);
  CREATE INDEX idx_invoices_issue ON invoices(issue_date);

  CREATE TABLE invoice_lines (
    id INTEGER PRIMARY KEY,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id),
    product_name TEXT NOT NULL,
    variant_label TEXT,
    quantity INTEGER NOT NULL,
    unit_price INTEGER NOT NULL,
    variant_extra INTEGER NOT NULL DEFAULT 0,
    discount_amount INTEGER NOT NULL DEFAULT 0,
    discount_name TEXT,
    tax_amount INTEGER NOT NULL DEFAULT 0,
    tax_label TEXT,
    line_total INTEGER NOT NULL
  );
  CREATE INDEX idx_invoice_lines_invoice ON invoice_lines(invoice_id);

  CREATE TABLE invoice_discounts (
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    discount_id INTEGER NOT NULL REFERENCES discounts(id),
    PRIMARY KEY (invoice_id, discount_id)
  );

  CREATE TABLE payments (
    id INTEGER PRIMARY KEY,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id),
    method TEXT NOT NULL CHECK (method IN ('bank_transfer','card','cash','cheque','upi')),
    amount INTEGER NOT NULL CHECK (amount > 0),
    payment_date TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    voided_at TEXT,
    recorded_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_payments_invoice ON payments(invoice_id);
  CREATE INDEX idx_payments_date ON payments(payment_date);

  CREATE TABLE billing_runs (
    id INTEGER PRIMARY KEY,
    run_date TEXT NOT NULL,
    created INTEGER NOT NULL,
    skipped INTEGER NOT NULL,
    failed INTEGER NOT NULL,
    total_amount INTEGER NOT NULL,
    closed INTEGER NOT NULL DEFAULT 0,
    activated INTEGER NOT NULL DEFAULT 0,
    errors_json TEXT NOT NULL DEFAULT '[]',
    trigger TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE activity_log (
    id INTEGER PRIMARY KEY,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE email_log (
    id INTEGER PRIMARY KEY,
    recipient TEXT NOT NULL,
    subject TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    link TEXT,
    created_at TEXT NOT NULL
  );
  `,
];

let instance: DB | null = null;

function migrate(database: DB) {
  const version = database.pragma('user_version', { simple: true }) as number;
  MIGRATIONS.slice(version).forEach((sql, i) => {
    database.transaction(() => {
      database.exec(sql);
      database.pragma(`user_version = ${version + i + 1}`);
    })();
  });
}

export function initDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  instance?.close();
  instance = new Database(file);
  instance.pragma('journal_mode = WAL');
  instance.pragma('synchronous = NORMAL');
  instance.pragma('foreign_keys = ON');
  migrate(instance);
  return instance;
}

export function db(): DB {
  if (!instance) throw new Error('Database not initialised');
  return instance;
}

export function nextNumber(name: 'SUB' | 'INV'): string {
  const row = db()
    .prepare(
      `INSERT INTO counters (name, value) VALUES (?, 1)
       ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value`,
    )
    .get(name) as { value: number };
  return `${name}-${String(row.value).padStart(5, '0')}`;
}
