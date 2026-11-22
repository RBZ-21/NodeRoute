// Act 4, Confidence. Dense, factual, two-sided. Each row names one job and how
// it goes each way. Capability wording comes from the previous Solution and
// Comparison sections; nothing new is claimed here.
const ROWS = [
  {
    label: 'Route visibility',
    old: 'Call the driver to find out where the route stands.',
    now: 'See where every active route stands without the check-in call.',
  },
  {
    label: 'ETAs',
    old: 'Guess, promise a callback, then chase the driver.',
    now: 'Track timing stop by stop and answer when a customer asks.',
  },
  {
    label: 'Driver coordination',
    old: 'Group texts, and the one update nobody saw.',
    now: 'Handoffs and day-of changes live on the route itself.',
  },
  {
    label: 'Inventory',
    old: 'Walk to the cooler, then call the office back.',
    now: 'Order and product details stay tied to the delivery.',
  },
  {
    label: 'Catch weight',
    old: 'Requested weight on the ticket, actual weight on a scrap of paper.',
    now: 'Requested and actual weights carried through to the invoice.',
  },
  {
    label: 'Lot traceability',
    old: 'Shellfish tags in a binder somewhere.',
    now: 'Lot-aware receiving, with lots forwarded onto invoices.',
  },
  {
    label: 'Cold chain',
    old: 'Temperatures on a clipboard in the truck.',
    now: 'Temperature logs tied to routes and stops, exportable for review.',
  },
  {
    label: 'Invoices',
    old: 'The end-of-day scramble.',
    now: 'Cleaner delivery records and invoices ready to close.',
  },
];

export function Logbook() {
  return (
    <section id="how" className="nr-flow nr-logbook" data-sc-act="flow" aria-labelledby="logbook-title">
      <div className="sc-wrap">
        <h2 id="logbook-title" className="nr-h2 nr-logbook__title" data-sc-in>
          From ticket to invoice, line by line.
        </h2>

        <div className="nr-twin nr-logbook__heads nr-mono" aria-hidden>
          <span>The usual way</span>
          <span>On NodeRoute</span>
        </div>

        <dl data-sc-in data-sc-stagger="70" style={{ margin: 0 }}>
          {ROWS.map((r) => (
            <div key={r.label} className="nr-twin nr-row">
              <dt className="nr-row__old">
                <span className="nr-mono nr-row__label">{r.label}</span>
                {r.old}
              </dt>
              <dd className="nr-row__new" style={{ margin: 0 }}>
                {r.now}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
