import { useState } from 'react';
import { moneyCompact, money, monthLabel } from '../lib/format';

// A compact single-series trend. The surrounding card's label names the series.
export function Sparkline({ values, label, width = 96, height = 28 }: { values: number[]; label: string; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (width - 4) + 2;
    const y = height - 3 - ((v - min) / range) * (height - 6);
    return [x, y] as const;
  });
  const [lastX, lastY] = points[points.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="shrink-0">
      <polyline points={points.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" stroke="#4F46E5" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r="2.5" fill="#4F46E5" stroke="#fff" strokeWidth="1.5" />
    </svg>
  );
}

const SERIES = [
  { key: 'invoiced', label: 'Invoiced', color: '#0E8FA8' },
  { key: 'collected', label: 'Collected', color: '#4F46E5' },
] as const;

const niceMax = (value: number) => {
  if (value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * magnitude >= value) return step * magnitude;
  return value;
};

export function RevenueChart({ data }: { data: Array<{ month: string; invoiced: number; collected: number }> }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 720;
  const height = 240;
  const margin = { top: 12, right: 8, bottom: 22, left: 48 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const max = niceMax(Math.max(1, ...data.flatMap((d) => [d.invoiced, d.collected])));
  const band = plotW / Math.max(data.length, 1);
  const barW = Math.min(14, Math.max(4, (band - 8) / 2 - 1));
  const y = (v: number) => margin.top + plotH - (v / max) * plotH;
  const active = hover === null ? null : data[hover];

  return (
    <div>
      <div className="mb-2 flex items-center gap-4 text-xs text-slate-600">
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="Invoiced and collected revenue by month. The same figures are in the table below.">
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line x1={margin.left} x2={width - margin.right} y1={y(max * f)} y2={y(max * f)} stroke={f === 0 ? '#CBD5E1' : '#F1F5F9'} />
              <text x={margin.left - 8} y={y(max * f) + 3.5} textAnchor="end" fontSize="10.5" fill="#64748B" className="num">
                {moneyCompact(max * f)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = margin.left + band * i + band / 2;
            const showLabel = data.length <= 14 || i % 2 === 0;
            return (
              <g key={d.month}>
                {hover === i && <rect x={cx - band / 2} y={margin.top} width={band} height={plotH} fill="#F1F5F9" />}
                {SERIES.map((s, sIndex) => {
                  const value = d[s.key];
                  const barH = Math.max(value > 0 ? 2 : 0, (value / max) * plotH);
                  const x = sIndex === 0 ? cx - barW - 1 : cx + 1;
                  return <rect key={s.key} x={x} y={margin.top + plotH - barH} width={barW} height={barH} rx={Math.min(3, barH / 2)} fill={s.color} />;
                })}
                {showLabel && (
                  <text x={cx} y={height - 6} textAnchor="middle" fontSize="10.5" fill="#64748B">
                    {monthLabel(d.month)}
                  </text>
                )}
                <rect x={cx - band / 2} y={0} width={band} height={height} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
              </g>
            );
          })}
        </svg>
        {active && hover !== null && (
          <div
            className="pointer-events-none absolute top-2 z-10 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-sm"
            style={hover > data.length / 2 ? { right: `${((data.length - hover) / data.length) * 88 + 2}%` } : { left: `${(hover / data.length) * 88 + 12}%` }}
          >
            <p className="mb-1 font-medium text-slate-800">{monthLabel(active.month)}</p>
            {SERIES.map((s) => (
              <p key={s.key} className="flex items-center justify-between gap-4 text-slate-600">
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="size-2 rounded-sm" style={{ background: s.color }} />
                  {s.label}
                </span>
                <span className="num text-slate-900">{money(active[s.key])}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Ranked horizontal bars with every value printed, so nothing depends on reading the bar alone. */
export function BarList({ items, tone = '#4F46E5' }: { items: Array<{ label: string; value: number; display: string; detail?: string; color?: string }>; tone?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.label} title={item.detail ? `${item.label}: ${item.display}, ${item.detail}` : `${item.label}: ${item.display}`}>
          <div className="mb-0.5 flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate text-slate-700">{item.label}</span>
            <span className="num shrink-0 text-slate-900">
              {item.display}
              {item.detail && <span className="ml-1.5 text-slate-500">{item.detail}</span>}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-100">
            <div className="h-full rounded-full" style={{ width: `${item.value > 0 ? Math.max(1.5, (item.value / max) * 100) : 0}%`, background: item.color ?? tone }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
