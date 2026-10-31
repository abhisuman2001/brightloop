// Measures API response times against a running server with seeded data: node tests/perf.mjs
const base = process.env.BASE_URL ?? 'http://localhost:4000';
const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@brightloop.dev', password: 'Brightloop#2026' }),
});
if (!login.ok) throw new Error(`Login failed: ${login.status}`);
const cookie = login.headers.get('set-cookie').split(';')[0];

const paths = [
  '/api/dashboard',
  '/api/subscriptions?page=1&pageSize=25',
  '/api/subscriptions?page=50&pageSize=25',
  '/api/subscriptions?q=north&pageSize=25',
  '/api/subscriptions?overdue=1&pageSize=25',
  '/api/subscriptions?billing=yearly&status=active&sort=amount&dir=desc',
  '/api/invoices?page=1&pageSize=25',
  '/api/invoices?status=overdue',
  '/api/invoices?q=harbor',
  '/api/payments?page=1',
  '/api/customers?page=1',
  '/api/customers?q=lumen',
  '/api/reports/finance',
  '/api/search?q=north',
  '/api/notifications',
  '/api/plans',
  '/api/products',
  '/api/subscriptions/export.csv',
];

let worst = 0;
for (const path of paths) {
  const runs = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    const res = await fetch(base + path, { headers: { cookie } });
    await res.text();
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    runs.push(performance.now() - start);
  }
  const max = Math.max(...runs);
  worst = Math.max(worst, max);
  console.log(`${max.toFixed(0).padStart(6)} ms  ${path}`);
}
console.log(`\nSlowest: ${worst.toFixed(0)} ms (limit 2000 ms)`);
process.exit(worst < 2000 ? 0 : 1);
