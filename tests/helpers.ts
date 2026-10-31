import request from 'supertest';
import { createApp } from '../server/app';
import { hashPassword } from '../server/auth';
import { db, initDb } from '../server/db';

export const PASSWORD = 'Correct#Horse1';

export async function freshApp() {
  process.env.NODE_ENV = 'test';
  initDb(':memory:');
  const hash = await hashPassword(PASSWORD);
  const now = new Date().toISOString();
  const insertUser = db().prepare('INSERT INTO users (email, name, password_hash, role, customer_id, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  insertUser.run('admin@test.dev', 'Admin', hash, 'admin', null, now);
  insertUser.run('staff@test.dev', 'Staff', hash, 'staff', null, now);
  const app = createApp();
  const login = async (email: string, password = PASSWORD) => {
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/login').send({ email, password });
    if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
    return agent;
  };
  return { app, login, admin: await login('admin@test.dev'), staff: await login('staff@test.dev') };
}

/** A product, monthly plan, 10% tax and a customer: the minimum needed to bill something. */
export function seedCatalog() {
  const product = db().prepare(`INSERT INTO products (name, type, sales_price, cost_price) VALUES ('Cloud', 'software', 10000, 2000)`).run().lastInsertRowid as number;
  const addon = db().prepare(`INSERT INTO products (name, type, sales_price, cost_price) VALUES ('Support', 'addon', 5000, 1000)`).run().lastInsertRowid as number;
  const variant = db().prepare(`INSERT INTO product_variants (product_id, attribute, value, extra_price) VALUES (?, 'Brand', 'Odoo', 56000)`).run(product).lastInsertRowid as number;
  const plan = db().prepare(`INSERT INTO plans (name, product_id, price, billing_period, min_quantity) VALUES ('Monthly', ?, 10000, 'monthly', 2)`).run(product).lastInsertRowid as number;
  db().prepare(`INSERT INTO tax_rules (name, rate_bps, product_type) VALUES ('Tax', 1000, NULL)`).run();
  const customer = db().prepare(`INSERT INTO customers (name, company, email, created_at) VALUES ('Dana', 'Acme', 'dana@acme.test', '2026-01-01')`).run().lastInsertRowid as number;
  return { product: Number(product), addon: Number(addon), variant: Number(variant), plan: Number(plan), customer: Number(customer) };
}
