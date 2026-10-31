import type { ReactNode } from 'react';

// Hand-drawn isometric scene. Each card is laid out flat in its own coordinates, then projected,
// so the text stays sharp at any size and the figures below are illustrative, not live data.
const ORIGIN_X = 132;
const ORIGIN_Y = 342;
const COS = 0.866;
const SIN = 0.5;
const INDIGO = '#4f46e5';
const EMERALD = '#10b981';
const INK = '#0f172a';
const MUTED = '#64748b';

// Text and charts run up and to the right, so a rising line still looks like it is rising.
const project = (x: number, y: number, z: number) => `matrix(${COS} ${-SIN} ${COS} ${SIN} ${ORIGIN_X + (x + y) * COS} ${ORIGIN_Y + (y - x) * SIN - z})`;

function Panel({ x, y, z, w, h, fill = 'url(#hero-glass)', lift = 26, children }: { x: number; y: number; z: number; w: number; h: number; fill?: string; lift?: number; children: ReactNode }) {
  return (
    <g>
      <g transform={project(x + 6, y + 6, z - lift)}>
        <rect width={w} height={h} rx={14} fill="#312e81" opacity={0.2} filter="url(#hero-soft)" />
      </g>
      <g transform={project(x, y, z - 5)}>
        <rect width={w} height={h} rx={14} fill="url(#hero-edge)" />
      </g>
      <g transform={project(x, y, z)}>
        <rect width={w} height={h} rx={14} fill={fill} stroke="#ffffff" strokeWidth={1.5} />
        <rect x={0.75} y={0.75} width={w - 1.5} height={h - 1.5} rx={13.5} fill="none" stroke="url(#hero-sheen)" strokeWidth={1} />
        {children}
      </g>
    </g>
  );
}

function Pill({ x, y, label, tone }: { x: number; y: number; label: string; tone: 'emerald' | 'indigo' | 'sky' }) {
  const colors = { emerald: ['#d1fae5', '#047857'], indigo: ['#e0e7ff', '#4338ca'], sky: ['#e0f2fe', '#0369a1'] }[tone];
  const width = label.length * 6.1 + 16;
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect y={-11} width={width} height={20} rx={10} fill={colors[0]} />
      <text x={width / 2} y={3} textAnchor="middle" fontSize={10.5} fontWeight={600} fill={colors[1]}>
        {label}
      </text>
    </g>
  );
}

const ROWS: Array<[string, string, string, string, 'emerald' | 'indigo' | 'sky']> = [
  ['SUB-02491', 'Growth Annual', '₹74,997', 'Active', 'emerald'],
  ['SUB-02488', 'Scale-Up', '₹47,992', 'Quotation', 'indigo'],
  ['SUB-02473', 'Enterprise', '₹5,99,990', 'Paid', 'sky'],
  ['SUB-02465', 'Growth', '₹12,495', 'Active', 'emerald'],
];

function SubscriptionTable() {
  return (
    <Panel x={0} y={0} z={0} w={450} h={272} fill="url(#hero-table)" lift={30}>
      <text x={22} y={36} fontSize={16} fontWeight={650} fill={INK}>
        Subscriptions
      </text>
      <text x={428} y={35} textAnchor="end" fontSize={11} fontWeight={500} fill={MUTED}>
        2,207 active
      </text>
      <g fontSize={10} fontWeight={600} fill="#94a3b8" letterSpacing={0.5}>
        <text x={22} y={66}>NUMBER</text>
        <text x={132} y={66}>PLAN</text>
        <text x={330} y={66} textAnchor="end">AMOUNT</text>
        <text x={346} y={66}>STATUS</text>
      </g>
      <line x1={22} x2={428} y1={76} y2={76} stroke="#cbd5e1" strokeWidth={0.75} />
      {ROWS.map(([number, plan, amount, status, tone], i) => {
        const y = 106 + i * 42;
        return (
          <g key={number}>
            <text className="num" x={22} y={y} fontSize={12.5} fill={INK}>
              {number}
            </text>
            <text x={132} y={y} fontSize={12.5} fill="#334155">
              {plan}
            </text>
            <text className="num" x={330} y={y} textAnchor="end" fontSize={12.5} fontWeight={600} fill={INK}>
              {amount}
            </text>
            <Pill x={346} y={y - 4} label={status} tone={tone} />
            {i < ROWS.length - 1 && <line x1={22} x2={428} y1={y + 19} y2={y + 19} stroke="#e2e8f0" strokeWidth={0.75} />}
          </g>
        );
      })}
    </Panel>
  );
}

function RevenueCard() {
  const line = 'M18 112 C 50 106, 66 96, 92 92 S 132 82, 152 68 S 196 58, 216 42 S 254 30, 282 20';
  return (
    <Panel x={46} y={-176} z={70} w={300} h={150} fill="#ffffff">
      <text x={18} y={28} fontSize={11.5} fontWeight={500} fill={MUTED}>
        Monthly recurring revenue
      </text>
      <text className="num" x={18} y={58} fontSize={26} fontWeight={700} fill={INK}>
        ₹9,84,940
      </text>
      <path d={`${line} L282 134 L18 134 Z`} fill="url(#hero-area)" />
      <path d={line} fill="none" stroke={EMERALD} strokeWidth={3} strokeLinecap="round" />
      <circle cx={282} cy={20} r={5} fill={EMERALD} stroke="#ffffff" strokeWidth={2} />
      <g transform="translate(18 72)">
        <rect width={52} height={18} rx={9} fill="#d1fae5" />
        <text x={26} y={13} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="#047857">
          +8.0%
        </text>
      </g>
    </Panel>
  );
}

function BillingCard() {
  return (
    <Panel x={-126} y={226} z={52} w={188} h={104}>
      <g transform="translate(16 18)">
        <rect width={32} height={32} rx={9} fill={INDIGO} />
        <path d="M9 14a7.5 7.5 0 0 1 13-3l2 2m0-5v5h-5M23 18a7.5 7.5 0 0 1-13 3l-2-2m0 5v-5h5" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <text x={58} y={31} fontSize={12.5} fontWeight={650} fill={INK}>
        Billing cycle
      </text>
      <text x={58} y={47} fontSize={10.5} fill={MUTED}>
        Runs every day
      </text>
      <text className="num" x={16} y={80} fontSize={15} fontWeight={700} fill={INK}>
        248 invoices
      </text>
      <text x={16} y={94} fontSize={10} fill={MUTED}>
        created automatically
      </text>
    </Panel>
  );
}

function GstCard() {
  return (
    <Panel x={150} y={292} z={44} w={186} h={126}>
      <text x={16} y={28} fontSize={12.5} fontWeight={650} fill={INK}>
        GST invoice
      </text>
      <Pill x={118} y={23} label="Ready" tone="emerald" />
      <g fontSize={11} fill={MUTED}>
        <text x={16} y={54}>CGST 9%</text>
        <text x={16} y={74}>SGST 9%</text>
      </g>
      <g className="num" fontSize={11} fill={INK} textAnchor="end">
        <text x={170} y={54}>₹2,249</text>
        <text x={170} y={74}>₹2,249</text>
      </g>
      <line x1={16} x2={170} y1={85} y2={85} stroke="#cbd5e1" strokeWidth={0.75} />
      <text x={16} y={108} fontSize={12} fontWeight={650} fill={INK}>
        Total
      </text>
      <text className="num" x={170} y={108} textAnchor="end" fontSize={14} fontWeight={700} fill={INDIGO}>
        ₹29,488
      </text>
    </Panel>
  );
}

function BankCard() {
  return (
    <Panel x={392} y={128} z={84} w={204} h={112}>
      <text x={16} y={28} fontSize={12.5} fontWeight={650} fill={INK}>
        Bank match
      </text>
      <g transform="translate(164 12)">
        <circle cx={12} cy={12} r={12} fill={EMERALD} />
        <path d="M7 12.5l3.4 3.4L17 9" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <text x={16} y={54} fontSize={10.5} fill={MUTED}>
        UPI/Kestrel Health/INV-00128
      </text>
      <text className="num" x={16} y={82} fontSize={17} fontWeight={700} fill={INK}>
        ₹10,320.87
      </text>
      <text x={16} y={99} fontSize={10.5} fontWeight={600} fill="#047857">
        Matched to INV-00128
      </text>
    </Panel>
  );
}

/** Decorative: the same ideas are described in text beside it and in the features below. */
export function HeroIllustration({ className }: { className?: string }) {
  return (
    <svg data-hero-illustration viewBox="0 0 900 590" className={className} role="img" aria-label="Illustration of floating dashboard cards: a rising monthly recurring revenue chart in rupees, a subscription table with Active, Quotation and Paid statuses, and cards for automatic billing, GST invoices and bank payment matching.">
      <defs>
        <linearGradient id="hero-glass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#f5f6ff" />
        </linearGradient>
        <linearGradient id="hero-table" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity={0.94} />
          <stop offset="1" stopColor="#eef2ff" stopOpacity={0.82} />
        </linearGradient>
        <linearGradient id="hero-edge" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c7d2fe" />
          <stop offset="1" stopColor="#818cf8" />
        </linearGradient>
        <linearGradient id="hero-sheen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.5" stopColor="#c7d2fe" stopOpacity={0.7} />
          <stop offset="1" stopColor="#a7f3d0" stopOpacity={0.8} />
        </linearGradient>
        <linearGradient id="hero-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={EMERALD} stopOpacity={0.28} />
          <stop offset="1" stopColor={EMERALD} stopOpacity={0} />
        </linearGradient>
        <radialGradient id="hero-glow-indigo">
          <stop offset="0" stopColor="#6366f1" stopOpacity={0.26} />
          <stop offset="1" stopColor="#6366f1" stopOpacity={0} />
        </radialGradient>
        <radialGradient id="hero-glow-emerald">
          <stop offset="0" stopColor="#34d399" stopOpacity={0.22} />
          <stop offset="1" stopColor="#34d399" stopOpacity={0} />
        </radialGradient>
        <radialGradient id="hero-glow-pink">
          <stop offset="0" stopColor="#e879f9" stopOpacity={0.14} />
          <stop offset="1" stopColor="#e879f9" stopOpacity={0} />
        </radialGradient>
        <filter id="hero-soft" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation={14} />
        </filter>
      </defs>
      <ellipse cx={450} cy={295} rx={400} ry={270} fill="url(#hero-glow-indigo)" />
      <ellipse cx={240} cy={150} rx={210} ry={130} fill="url(#hero-glow-emerald)" />
      <ellipse cx={720} cy={440} rx={160} ry={120} fill="url(#hero-glow-pink)" />
      <SubscriptionTable />
      <RevenueCard />
      <BillingCard />
      <GstCard />
      <BankCard />
    </svg>
  );
}
