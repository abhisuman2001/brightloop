import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import type { InvoiceDetail } from '../../shared/types';
import { InvoiceLinesTable, InvoiceTotals } from '../components/InvoiceDrawer';
import { Logo } from '../components/Layout';
import { Button, ErrorState, Skeleton } from '../components/ui';
import { api } from '../lib/api';
import { date } from '../lib/format';
import { useUser } from '../lib/hooks';

/** A clean page for the browser's print dialog, which also saves as PDF. */
export default function PrintInvoice() {
  const { id } = useParams();
  const me = useUser();
  const path = me.role === 'customer' ? `/portal/invoices/${id}` : `/invoices/${id}`;
  const { data: invoice, isLoading, isError, error } = useQuery({ queryKey: ['print-invoice', path], queryFn: () => api.get<InvoiceDetail>(path) });

  useEffect(() => {
    if (invoice) document.title = `${invoice.number} · Brightloop Software`;
  }, [invoice]);

  if (isLoading) return <Skeleton className="m-8 h-96" />;
  if (isError || !invoice) return <ErrorState error={error} />;
  return (
    <div className="print-sheet mx-auto my-6 max-w-3xl rounded-lg border border-slate-200 bg-white p-8">
      <div className="no-print mb-6 flex justify-end">
        <Button variant="primary" icon={<Printer className="size-3.5" />} onClick={() => window.print()}>
          Print
        </Button>
      </div>
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <Logo />
          <div className="mt-2 text-xs text-slate-600">
            {invoice.seller.address && <p>{invoice.seller.address}</p>}
            {invoice.seller.gstin && <p className="num">GSTIN {invoice.seller.gstin}</p>}
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs tracking-wide text-slate-500 uppercase">{invoice.status === 'draft' ? 'Draft invoice' : invoice.status === 'cancelled' ? 'Cancelled invoice' : 'Tax invoice'}</p>
          <p className="num text-lg font-semibold text-slate-900">{invoice.number}</p>
          {invoice.status === 'paid' && <p className="text-xs font-medium text-emerald-700">Paid</p>}
        </div>
      </div>
      <div className="mb-6 grid grid-cols-2 gap-6 text-[13px]">
        <div>
          <p className="mb-1 text-xs text-slate-500">Bill to</p>
          <p className="font-medium text-slate-900">{invoice.customerName}</p>
          {invoice.company && <p className="text-slate-700">{invoice.company}</p>}
          <p className="text-slate-700">{invoice.customerEmail}</p>
          {invoice.customerAddress && <p className="whitespace-pre-line text-slate-700">{invoice.customerAddress}</p>}
          {invoice.customerTaxId && <p className="num text-slate-700">GSTIN {invoice.customerTaxId}</p>}
        </div>
        <dl className="grid grid-cols-2 content-start gap-y-1">
          <dt className="text-slate-500">Issued</dt>
          <dd className="num text-right">{date(invoice.issueDate)}</dd>
          <dt className="text-slate-500">Due</dt>
          <dd className="num text-right">{date(invoice.dueDate)}</dd>
          <dt className="text-slate-500">Period start</dt>
          <dd className="num text-right">{date(invoice.periodStart)}</dd>
          <dt className="text-slate-500">Period end</dt>
          <dd className="num text-right">{date(invoice.periodEnd)}</dd>
          <dt className="text-slate-500">Subscription</dt>
          <dd className="num text-right">{invoice.subscriptionNumber}</dd>
        </dl>
      </div>
      <InvoiceLinesTable invoice={invoice} />
      <div className="mt-4">
        <InvoiceTotals invoice={invoice} />
      </div>
    </div>
  );
}
