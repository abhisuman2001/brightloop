import { useMutation } from '@tanstack/react-query';
import { Download, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReconcileResult, ReconcileRow } from '../../shared/types';
import { api, refreshAll } from '../lib/api';
import { date, money, number } from '../lib/format';
import { Badge, Button, FormError, Modal, TD, TH, cx, useToast, type Tone } from './ui';

const MATCH: Record<ReconcileRow['match'], { label: string; tone: Tone }> = {
  invoice: { label: 'Invoice number', tone: 'emerald' },
  amount: { label: 'Exact amount', tone: 'sky' },
  duplicate: { label: 'Already recorded', tone: 'slate' },
  none: { label: 'Needs a person', tone: 'amber' },
};

const isMatched = (row: ReconcileRow) => row.match === 'invoice' || row.match === 'amount';

/** Upload a bank statement, review what it pays, and record the matches in one step. */
export function ReconcileDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [result, setResult] = useState<ReconcileResult | null>(null);
  const [fileName, setFileName] = useState('');
  const [chosen, setChosen] = useState<Set<number>>(new Set());

  const preview = useMutation({
    mutationFn: (csv: string) => api.post<ReconcileResult>('/payments/reconcile/preview', { csv }),
    onSuccess: (data) => {
      setResult(data);
      setChosen(new Set(data.rows.filter((r) => isMatched(r) && r.match === 'invoice').map((r) => r.line)));
    },
  });
  const apply = useMutation({
    mutationFn: (items: object[]) => api.post<{ recorded: number; failed: Array<{ message: string }> }>('/payments/reconcile/apply', { items }),
    onSuccess: ({ recorded, failed }) => {
      refreshAll();
      if (failed.length) toast(`${number(recorded)} recorded, ${number(failed.length)} failed: ${failed[0].message}`, 'error');
      else toast(`${number(recorded)} payments recorded from the statement`);
      onClose();
    },
  });

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setFileName('');
    setChosen(new Set());
    preview.reset();
    apply.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    preview.mutate(await file.text());
  };
  const toggle = (line: number) =>
    setChosen((current) => {
      const next = new Set(current);
      if (!next.delete(line)) next.add(line);
      return next;
    });
  const selected = result?.rows.filter((r) => chosen.has(r.line)) ?? [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Match a bank statement"
      description="Upload the CSV from your bank. Nothing is recorded until you review the matches."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={selected.length === 0}
            loading={apply.isPending}
            onClick={() => apply.mutate(selected.map((r) => ({ invoiceId: r.invoiceId, amount: r.amount, paymentDate: r.paymentDate, method: r.method, reference: r.reference, description: r.description })))}
          >
            Record {number(selected.length)} payment{selected.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[13px] font-medium text-slate-700 focus-within:ring-2 focus-within:ring-accent hover:bg-slate-50">
            <Upload className="size-3.5" aria-hidden />
            Choose CSV file
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => {
                void readFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          {fileName && <span className="truncate text-xs text-slate-500">{fileName}</span>}
          <a href="/api/payments/reconcile/sample.csv" className="ml-auto inline-flex items-center gap-1 text-xs text-accent hover:underline">
            <Download className="size-3" aria-hidden />
            Download a sample statement
          </a>
        </div>
        <FormError error={preview.error} />
        <FormError error={apply.error} />
        {preview.isPending && <p className="text-xs text-slate-500">Reading the statement…</p>}
        {result && (
          <>
            <p className="text-xs text-slate-600">
              <span className="num font-medium text-slate-900">{number(result.summary.matched)}</span> of <span className="num">{number(result.summary.credits)}</span> credits matched, worth <span className="num font-medium text-slate-900">{money(result.summary.matchedAmount)}</span>. Matches by amount alone start unticked, so a person confirms them.
            </p>
            <div className="overflow-x-auto rounded-md border border-slate-200">
              <table className="w-full min-w-[680px] text-[13px]">
                <thead>
                  <tr>
                    <th className={TH}>
                      <span className="sr-only">Record</span>
                    </th>
                    <th className={TH}>Date</th>
                    <th className={TH}>Narration</th>
                    <th className={TH}>Result</th>
                    <th className={cx(TH, 'text-right')}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => (
                    <tr key={row.line} className={cx(!isMatched(row) && 'text-slate-500')}>
                      <td className={cx(TD, 'w-8')}>
                        {isMatched(row) && <input type="checkbox" aria-label={`Record ${money(row.amount)} against ${row.invoiceNumber}`} checked={chosen.has(row.line)} onChange={() => toggle(row.line)} className="size-3.5 accent-[var(--color-accent)]" />}
                      </td>
                      <td className={cx(TD, 'num whitespace-nowrap')}>{date(row.paymentDate)}</td>
                      <td className={cx(TD, 'max-w-64')}>
                        <span className="block truncate" title={row.description}>
                          {row.description || row.reference || '—'}
                        </span>
                      </td>
                      <td className={TD}>
                        <Badge tone={MATCH[row.match].tone}>{MATCH[row.match].label}</Badge>
                        <span className="mt-0.5 block text-xs">{isMatched(row) ? <span className="num">{row.invoiceNumber} · {row.customerName}</span> : row.problem}</span>
                      </td>
                      <td className={cx(TD, 'num text-right whitespace-nowrap')}>{money(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
