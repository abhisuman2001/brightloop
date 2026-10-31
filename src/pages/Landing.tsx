import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  BellRing,
  Check,
  ChevronDown,
  Download,
  FileText,
  History,
  Layers,
  Menu,
  Percent,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  UserCog,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { BillingPeriod } from '../../shared/dates';
import type { PublicPlan } from '../../shared/types';
import { HeroIllustration } from '../components/HeroIllustration';
import { Logo } from '../components/Layout';
import { cx } from '../components/ui';
import { api } from '../lib/api';
import { PERIOD_LABEL, PERIOD_UNIT, moneyWhole, number } from '../lib/format';

const SECTIONS = [
  { href: '#features', label: 'Features' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
];

const PRIMARY = 'inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-accent px-5 text-[15px] font-medium text-white transition-colors hover:bg-accent-hover';
const SECONDARY = 'inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-5 text-[15px] font-medium text-slate-800 transition-colors hover:bg-slate-50';

function Header() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-4 sm:px-6">
        <Link to="/" aria-label="Brightloop home">
          <Logo />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-6 md:flex">
          {SECTIONS.map((s) => (
            <a key={s.href} href={s.href} className="text-sm font-medium text-slate-600 hover:text-slate-900">
              {s.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-2 md:flex">
          <Link to="/login" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
            Sign in
          </Link>
          <Link to="/signup" className="inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-sm font-medium text-white hover:bg-accent-hover">
            Get started
          </Link>
        </div>
        <button type="button" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen((v) => !v)} className="ml-auto inline-flex size-10 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 md:hidden">
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      {open && (
        <nav aria-label="Mobile" className="border-t border-slate-200 bg-white px-4 py-3 md:hidden">
          {SECTIONS.map((s) => (
            <a key={s.href} href={s.href} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2.5 text-[15px] font-medium text-slate-700 hover:bg-slate-100">
              {s.label}
            </a>
          ))}
          <Link to="/login" className="block rounded-lg px-3 py-2.5 text-[15px] font-medium text-slate-700 hover:bg-slate-100">
            Sign in
          </Link>
          <Link to="/signup" className={cx(PRIMARY, 'mt-2 w-full')}>
            Get started
          </Link>
        </nav>
      )}
    </header>
  );
}

function Screenshot({ src, alt, width, height, eager }: { src: string; alt: string; width: number; height: number; eager?: boolean }) {
  return (
    <figure className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_20px_50px_-24px_rgba(15,23,42,0.35)]">
      <div aria-hidden className="flex h-7 items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-3">
        <span className="size-2 rounded-full bg-slate-300" />
        <span className="size-2 rounded-full bg-slate-300" />
        <span className="size-2 rounded-full bg-slate-300" />
      </div>
      <img src={src} alt={alt} width={width} height={height} loading={eager ? 'eager' : 'lazy'} decoding="async" className="block h-auto w-full" />
    </figure>
  );
}

function Hero() {
  return (
    <section className="border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 pt-14 sm:px-6 lg:pt-20">
        <div className="grid items-center gap-6 lg:grid-cols-2">
          <div>
          <p className="text-sm font-medium text-accent">Subscription billing for Indian businesses</p>
          <h1 className="mt-4 text-[40px] leading-[1.08] font-semibold tracking-tight text-balance text-slate-950 sm:text-6xl lg:text-[44px] xl:text-[52px]">
            <span className="block">Every renewal billed.</span>
            <span className="block">Every rupee matched.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-pretty text-slate-600">
            Run plans, quotations, GST invoices, payments and revenue reports in one place. Billing day stops being a spreadsheet job, and you always know what you are owed.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link to="/signup" className={PRIMARY}>
              Create your account
              <ArrowRight className="size-4" aria-hidden />
            </Link>
            <a href="#how-it-works" className={SECONDARY}>
              See how it works
            </a>
          </div>
          </div>
          <HeroIllustration className="hidden h-auto w-full sm:block" />
        </div>
        <div className="relative mt-12 lg:mt-16">
          <div className="-mb-px overflow-hidden rounded-t-xl">
            <Screenshot eager src="/landing/dashboard.png" width={2160} height={1200} alt="Brightloop dashboard showing monthly recurring revenue, active subscriptions, overdue invoices, collection rate and a list of subscriptions." />
          </div>
        </div>
      </div>
    </section>
  );
}

const BEFORE_AFTER = [
  { area: 'Subscriptions', before: 'Tracked in a spreadsheet', after: 'One record for each, from draft to closed' },
  { area: 'Renewals', before: 'Remembered by whoever notices first', after: 'Flagged for staff, with reminders sent to customers' },
  { area: 'Invoices', before: 'Typed up by hand every month', after: 'Created from the subscription on billing day' },
  { area: 'Payments', before: 'Found by scrolling through bank statements', after: 'Matched from the bank statement you upload' },
  { area: 'Revenue reports', before: 'Built by hand each quarter', after: 'Live, with filters and CSV export' },
];

function BeforeAfter() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
      <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-balance text-slate-950 sm:text-4xl">The month-end scramble, replaced</h2>
      <div className="mt-10 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="hidden grid-cols-[180px_1fr_1fr] border-b border-slate-200 bg-slate-50 px-5 py-3 text-xs font-medium tracking-wide text-slate-500 uppercase md:grid">
          <span>Job</span>
          <span>Today</span>
          <span>With Brightloop</span>
        </div>
        <dl className="divide-y divide-slate-200">
          {BEFORE_AFTER.map((row) => (
            <div key={row.area} className="grid gap-1 px-5 py-4 text-[15px] md:grid-cols-[180px_1fr_1fr] md:gap-0">
              <dt className="font-medium text-slate-900">{row.area}</dt>
              <dd className="text-slate-500">{row.before}</dd>
              <dd className="flex gap-2 font-medium text-slate-900">
                <Check className="mt-1 size-4 shrink-0 text-emerald-600" aria-hidden />
                {row.after}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function Feature({ kicker, title, children, points, image, flip }: { kicker: string; title: string; children: ReactNode; points: string[]; image: ReactNode; flip?: boolean }) {
  return (
    <div className="grid items-center gap-8 lg:grid-cols-5 lg:gap-14">
      <div className={cx('lg:col-span-2', flip && 'lg:order-2')}>
        <p className="text-sm font-medium text-accent">{kicker}</p>
        <h3 className="mt-2 text-2xl font-semibold tracking-tight text-balance text-slate-950 sm:text-3xl">{title}</h3>
        <p className="mt-3 text-base leading-relaxed text-pretty text-slate-600">{children}</p>
        <ul className="mt-5 space-y-2.5">
          {points.map((point) => (
            <li key={point} className="flex gap-2.5 text-[15px] text-slate-700">
              <Check className="mt-1 size-4 shrink-0 text-accent" aria-hidden />
              {point}
            </li>
          ))}
        </ul>
      </div>
      <div className={cx('min-w-0 lg:col-span-3', flip && 'lg:order-1')}>{image}</div>
    </div>
  );
}

function Features() {
  return (
    <section id="features" className="scroll-mt-16 border-y border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl space-y-20 px-4 py-16 sm:px-6 lg:space-y-28 lg:py-24">
        <Feature
          kicker="Billing"
          title="Billing day runs itself"
          points={['Customer details, lines, taxes and totals filled in', 'Missed days catch up, so no period is skipped', 'The database refuses a second invoice for the same period', 'Confirm, send, print or cancel, one at a time or all at once']}
          image={<Screenshot src="/landing/invoices.png" width={2160} height={1200} alt="The invoices page with a billing panel, status tabs and a list of invoices." />}
        >
          Every day Brightloop activates what has started, invoices what is due and closes what has ended. Your team reviews the drafts instead of typing them.
        </Feature>
        <Feature
          flip
          kicker="Payments"
          title="Upload the bank statement. The matching is done."
          points={['Reads the invoice number in the narration', 'Falls back to the amount only when one invoice fits', 'Flags a bank reference that was already recorded', 'Nothing is recorded until your team has reviewed it']}
          image={<Screenshot src="/landing/matching.png" width={1152} height={800} alt="A bank statement review showing four credits matched to invoices by number and one marked as needing a person." />}
        >
          Export a CSV from your bank and drop it in. Each credit is paired with the invoice it pays, and anything unclear is left for a person to decide.
        </Feature>
        <Feature
          kicker="Customer portal"
          title="Customers help themselves"
          points={['Accept quotations and request new plans', 'Switch add-ons on and off', 'Pause, renew or cancel, as each plan allows', 'Pay by UPI QR with the amount and invoice number filled in']}
          image={<Screenshot src="/landing/portal.png" width={1536} height={999} alt="A customer's invoice in the portal with line items, totals and a UPI QR code for paying the balance." />}
        >
          Each customer gets their own login and sees only their own subscriptions and invoices, so a simple change no longer needs an email to your team.
        </Feature>
        <Feature
          flip
          kicker="GST"
          title="GST invoices without the manual work"
          points={['CGST and SGST inside your state, IGST across states', 'Chosen automatically from the customer’s GSTIN', 'HSN or SAC code on every line', 'Print or save as PDF from your browser']}
          image={<Screenshot src="/landing/invoice.png" width={1152} height={867} alt="A printable tax invoice with seller and customer GSTIN, an HSN code, IGST at 18 percent and totals." />}
        >
          Set your tax rules once and every invoice applies them on its own. Rates can change without touching invoices you have already issued.
        </Feature>
        <Feature
          kicker="Reports"
          title="Know your numbers today, not at quarter-end"
          points={['MRR, new and churned revenue, and subscription churn', 'Invoiced against collected, month by month', 'What is owed, sorted by how late it is', 'Filter by date or plan, and export to CSV']}
          image={<Screenshot src="/landing/reports.png" width={2160} height={1200} alt="The reports page with revenue totals, churn figures, a monthly invoiced and collected chart, and outstanding amounts by age." />}
        >
          How many subscriptions are active? How much came in, and how much is still owed? The answers are one page away, for the whole business or a single plan.
        </Feature>
      </div>
    </section>
  );
}

const MORE: Array<{ icon: LucideIcon; title: string; text: string }> = [
  { icon: FileText, title: 'Quotation templates', text: 'Start an offer with the plan, lines and validity already set.' },
  { icon: Layers, title: 'Product variants', text: 'Sell by brand or edition, with an extra price for each.' },
  { icon: SlidersHorizontal, title: 'Rules for each plan', text: 'Decide which plans can pause, renew, close early or end on their own.' },
  { icon: Percent, title: 'Discount rules', text: 'Set a minimum, dates and a usage limit. They apply and stop by themselves.' },
  { icon: BellRing, title: 'Automatic reminders', text: 'Emails go out before a renewal and after an invoice falls overdue.' },
  { icon: UserCog, title: 'Roles and access', text: 'Admin, staff and customer access is enforced by the server, not just hidden.' },
  { icon: History, title: 'Activity log', text: 'See who confirmed, sent, paid or changed what, and when.' },
  { icon: Search, title: 'Search everything', text: 'Press Ctrl K to jump to any subscription, customer or invoice.' },
  { icon: Download, title: 'CSV exports', text: 'Take subscriptions, invoices, payments and reports with you.' },
];

function MoreFeatures() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
      <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-balance text-slate-950 sm:text-4xl">And the details that save you the follow-up</h2>
      <div className="mt-10 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
        {MORE.map(({ icon: Icon, title, text }) => (
          <div key={title} className="flex gap-3.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <Icon className="size-[18px]" aria-hidden />
            </span>
            <div>
              <h3 className="text-[15px] font-semibold text-slate-900">{title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">{text}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const STEPS = [
  { name: 'Draft', text: 'Build it yourself, or start from a quotation template.' },
  { name: 'Quotation', text: 'Send it to the customer. It stays valid for the days you set.' },
  { name: 'Confirmed', text: 'The customer accepts, or your team confirms the order.' },
  { name: 'Active', text: 'It starts on its date and invoices on schedule, without anyone remembering.' },
  { name: 'Closed', text: 'It ends on its term or when cancelled, with the reason on record.' },
];

function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-16 border-y border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
        <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-balance text-slate-950 sm:text-4xl">Everyone can see where a subscription stands</h2>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-600">Each one has its own number and moves through the same five stages, from first offer to final invoice.</p>
        <ol className="mt-12 grid gap-6 md:grid-cols-5 md:gap-4">
          {STEPS.map((step, i) => (
            <li key={step.name} className="relative flex gap-4 md:block">
              {i < STEPS.length - 1 && <span aria-hidden className="absolute top-4 left-1/2 hidden h-px w-full bg-slate-300 md:block" style={{ left: '2rem', width: 'calc(100% - 1rem)' }} />}
              <span className="num relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white">{i + 1}</span>
              <div className="md:mt-4">
                <h3 className="text-[15px] font-semibold text-slate-900">{step.name}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const PROOF: Array<{ value: string; label: string }> = [
  { value: '102 ms', label: 'Slowest API response in our speed test, with 2,500 subscriptions and 15,000 invoices' },
  { value: '1', label: 'Live invoice per period, enforced by the database itself' },
  { value: '100+', label: 'Automated tests covering pricing, billing, payments and access' },
];

function Reliability() {
  return (
    <section className="bg-slate-950 text-white">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:py-24">
        <div>
          <ShieldCheck className="size-7 text-indigo-300" aria-hidden />
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">Built for the day hundreds of invoices go out at once</h2>
          <p className="mt-4 text-base leading-relaxed text-slate-300">Billing is the one job you cannot get wrong. Money is stored as whole paise, so lines always add up to the total, and one bad record is reported without stopping the rest of the run.</p>
          <ul className="mt-6 space-y-2.5 text-[15px] text-slate-200">
            {['Passwords are hashed with scrypt', 'Reset links work once and expire within an hour', 'Customers can only ever reach their own records'].map((item) => (
              <li key={item} className="flex gap-2.5">
                <Check className="mt-1 size-4 shrink-0 text-indigo-300" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <dl className="divide-y divide-white/15 self-center">
          {PROOF.map((item) => (
            <div key={item.label} className="grid gap-1 py-5 first:pt-0 last:pb-0 sm:grid-cols-[150px_1fr] sm:items-center sm:gap-6">
              <dt className="num order-1 text-4xl font-semibold tracking-tight">{item.value}</dt>
              <dd className="order-2 text-[15px] leading-relaxed text-slate-300">{item.label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function planPoints(plan: PublicPlan): string[] {
  return [
    plan.minQuantity > 1 ? `Minimum ${number(plan.minQuantity)} units` : 'No minimum quantity',
    plan.pausable ? 'Pause when you need to' : '',
    plan.renewable ? 'Renew from your portal' : '',
    plan.closable ? 'Cancel at any time' : 'Fixed term',
  ].filter(Boolean);
}

const PERIOD_ORDER: BillingPeriod[] = ['monthly', 'yearly', 'weekly', 'daily'];

function Pricing() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['public', 'plans'], queryFn: () => api.get<PublicPlan[]>('/public/plans') });
  const periods = PERIOD_ORDER.filter((period) => data?.some((plan) => plan.billingPeriod === period));
  const [chosen, setChosen] = useState<BillingPeriod | null>(null);
  const period = chosen && periods.includes(chosen) ? chosen : periods[0];
  const plans = data?.filter((plan) => plan.billingPeriod === period) ?? [];
  return (
    <section id="pricing" className="mx-auto max-w-6xl scroll-mt-16 px-4 py-16 sm:px-6 lg:py-24">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight text-balance text-slate-950 sm:text-4xl">Plans that bill the way you buy</h2>
          <p className="mt-3 text-base leading-relaxed text-slate-600">Create an account, pick a plan and get a quotation. Nothing is billed until you accept it. Prices are before GST.</p>
        </div>
        {periods.length > 1 && (
          <div role="group" aria-label="Billing period" className="inline-flex flex-wrap rounded-lg border border-slate-200 bg-white p-1">
            {periods.map((p) => (
              <button key={p} type="button" aria-pressed={p === period} onClick={() => setChosen(p)} className={cx('rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors', p === period ? 'bg-accent text-white' : 'text-slate-600 hover:bg-slate-100')}>
                {PERIOD_LABEL[p]}
              </button>
            ))}
          </div>
        )}
      </div>
      {isLoading && (
        <div aria-hidden className="mt-10 grid gap-5 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-80 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      )}
      {(isError || data?.length === 0) && (
        <div className="mt-10 rounded-xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-[15px] text-slate-700">{isError ? 'Pricing could not be loaded just now.' : 'New plans are on the way.'} Create an account to see what is on sale.</p>
          <Link to="/signup" className={cx(PRIMARY, 'mt-4')}>
            Create your account
          </Link>
        </div>
      )}
      {plans.length > 0 && (
        <div className={cx('mt-10 grid gap-5', plans.length === 1 ? 'max-w-sm' : plans.length === 2 ? 'max-w-2xl md:grid-cols-2' : 'md:grid-cols-3')}>
          {plans.map((plan) => (
            <article key={plan.id} className="flex flex-col rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-lg font-semibold text-slate-950">{plan.name}</h3>
              <p className="text-sm text-slate-500">{plan.productName}</p>
              <p className="mt-4 text-slate-950">
                <span className="num text-4xl font-semibold tracking-tight">{moneyWhole(plan.price)}</span>
                <span className="text-sm text-slate-500"> /{PERIOD_UNIT[plan.billingPeriod]}</span>
              </p>
              {plan.notes && <p className="mt-3 text-sm leading-relaxed text-slate-600">{plan.notes}</p>}
              <ul className="mt-5 mb-6 flex-1 space-y-2">
                {planPoints(plan).map((point) => (
                  <li key={point} className="flex gap-2 text-sm text-slate-700">
                    <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                    {point}
                  </li>
                ))}
              </ul>
              <Link to="/signup" aria-label={`Get started with ${plan.name}`} className={cx(SECONDARY, 'w-full')}>
                Get started
              </Link>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

const FAQS = [
  { q: 'Does it handle GST?', a: 'Yes. Add your CGST, SGST and IGST rules once, and each invoice picks the right ones from the customer’s GSTIN. A customer with no GSTIN is treated as inside your state. Invoices show the HSN or SAC code and a breakdown of the tax.' },
  { q: 'Can my customers pay online?', a: 'They can pay any unpaid invoice by UPI, using a QR code with the amount and invoice number filled in. There is no card gateway yet, so a payment counts as received once your team records it or matches it from the bank statement.' },
  { q: 'Could a customer be billed twice?', a: 'No. The database allows only one live invoice for each subscription and period, even if a billing run repeats. If an invoice is cancelled, that period is billed again correctly on the next run.' },
  { q: 'What happens to existing customers when I change a price?', a: 'They keep their current price until their subscription lines are edited. New subscriptions use the new price straight away. Invoices already issued never change.' },
  { q: 'What does each person get to see?', a: 'Admins control everything, including plans, taxes, discounts and staff. Staff handle customers, subscriptions, invoices and payments. Customers see only their own subscriptions and invoices.' },
  { q: 'Can I get my data out?', a: 'Yes. Subscriptions, invoices, payments and the revenue report all export to CSV, using whatever filters you have set.' },
];

function Faq() {
  return (
    <section id="faq" className="scroll-mt-16 border-t border-slate-200 bg-white">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-3 lg:py-24">
        <h2 className="text-3xl font-semibold tracking-tight text-balance text-slate-950 sm:text-4xl">Questions, answered</h2>
        <div className="divide-y divide-slate-200 border-y border-slate-200 lg:col-span-2">
          {FAQS.map((item) => (
            <details key={item.q} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-[15px] font-medium text-slate-900 [&::-webkit-details-marker]:hidden">
                {item.q}
                <ChevronDown className="size-4 shrink-0 text-slate-500 transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <p className="pb-5 text-[15px] leading-relaxed text-slate-600">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="bg-accent">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-4 py-14 sm:px-6 lg:flex-row lg:items-center">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight text-balance text-white">Make this the last month you bill by hand</h2>
          <p className="mt-2 text-base text-indigo-100">Create an account and get your first quotation in minutes.</p>
        </div>
        <Link to="/signup" className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg bg-white px-5 text-[15px] font-medium text-accent transition-colors hover:bg-indigo-50">
          Create your account
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 text-sm text-slate-600 sm:px-6 md:flex-row md:items-start md:justify-between">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs leading-relaxed">Plans, subscriptions and recurring billing in one place.</p>
        </div>
        <div className="flex gap-16">
          <nav aria-label="Product">
            <p className="font-medium text-slate-900">Product</p>
            <ul className="mt-3 space-y-2">
              {SECTIONS.map((link) => (
                <li key={link.href}>
                  <a href={link.href} className="hover:text-slate-900">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-label="Account">
            <p className="font-medium text-slate-900">Account</p>
            <ul className="mt-3 space-y-2">
              <li>
                <Link to="/login" className="hover:text-slate-900">
                  Sign in
                </Link>
              </li>
              <li>
                <Link to="/signup" className="hover:text-slate-900">
                  Create an account
                </Link>
              </li>
              <li>
                <Link to="/forgot-password" className="hover:text-slate-900">
                  Reset your password
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      </div>
      <p className="mx-auto max-w-6xl px-4 pb-8 text-xs text-slate-500 sm:px-6">© {new Date().getFullYear()} Brightloop Software</p>
    </footer>
  );
}

/** The public face of the product, shown at the root to anyone not signed in. */
export default function Landing() {
  return (
    <div className="min-h-screen bg-surface text-sm">
      <a href="#main" className="sr-only rounded-lg bg-white px-3 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50">
        Skip to content
      </a>
      <Header />
      <main id="main">
        <Hero />
        <BeforeAfter />
        <Features />
        <MoreFeatures />
        <HowItWorks />
        <Reliability />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
