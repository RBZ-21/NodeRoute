import { useState } from 'react';
import { useDriverApp } from '@/hooks/useDriverApp';
import { formatDateTime } from '@/lib/utils';

export function InvoicesPage() {
  const { openInvoicePdf, routeInvoices } = useDriverApp();
  const [loadingInvoiceId, setLoadingInvoiceId] = useState<string | null>(null);

  async function viewInvoice(invoiceId: string) {
    setLoadingInvoiceId(invoiceId);
    try {
      await openInvoicePdf(invoiceId);
    } finally {
      setLoadingInvoiceId(null);
    }
  }

  return (
    <section className="space-y-4">
      {routeInvoices.length ? (
        routeInvoices.map((invoice) => (
          <article key={invoice.id} className="rounded-[2rem] bg-white p-5 shadow-card">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              {invoice.invoice_number || `Invoice ${invoice.id.slice(0, 6)}`}
            </p>
            <h2 className="mt-2 text-xl font-semibold text-ink">{invoice.customer_name || 'Customer invoice'}</h2>
            <p className="mt-2 text-sm text-slate-600">{invoice.customer_address || 'Address unavailable'}</p>
            <div className="mt-4 space-y-2 rounded-3xl bg-slate-50 p-4 text-sm text-slate-700">
              <p>Status: {invoice.status || 'pending'}</p>
              <p>Signed: {invoice.signed_at ? formatDateTime(invoice.signed_at) : 'Not signed yet'}</p>
              <p>
                Proof photo:{' '}
                {invoice.proof_of_delivery_uploaded_at ? formatDateTime(invoice.proof_of_delivery_uploaded_at) : 'Not uploaded yet'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void viewInvoice(invoice.id)}
              disabled={loadingInvoiceId === invoice.id}
              className="mt-4 min-h-12 w-full rounded-2xl bg-ocean px-4 py-3 text-base font-semibold text-white disabled:opacity-60"
            >
              {loadingInvoiceId === invoice.id ? 'Opening PDF...' : 'View PDF'}
            </button>
          </article>
        ))
      ) : (
        <div className="rounded-3xl bg-white p-6 text-sm text-slate-600 shadow-card">
          No invoices are linked to the current route.
        </div>
      )}
    </section>
  );
}
