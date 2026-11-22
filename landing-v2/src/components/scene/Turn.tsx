const STATS = [
  { label: 'Active stops', value: '12' },
  { label: 'Routes in progress', value: '3' },
  { label: 'ETA updates pending', value: '2' },
  { label: 'Invoices ready to close', value: '1' },
];

/**
 * Act 3, Relief. A wipe on the right column: the pile side goes quiet, the
 * other side resolves into one board. Figures are a labelled sample.
 */
export function Turn() {
  return (
    <section className="nr-flow nr-turn" data-sc-act="flow" aria-labelledby="turn-new">
      <div className="sc-wrap nr-twin">
        <div className="nr-turn__old" data-sc-in>
          <h2 className="nr-h2">By late morning, one side has a pile.</h2>
          <p className="nr-body" style={{ marginTop: '1rem' }}>
            Every card on it is a call someone still has to return, a weight someone has to fix, or
            a spreadsheet someone has to reconcile before the trucks come back.
          </p>
        </div>

        <div>
          <h2 id="turn-new" className="nr-h2" data-sc-in>
            The other side has a board.
          </h2>
          <figure className="nr-board" data-sc-reveal="left" data-sc-reveal-at="0.12 0.42">
            <img className="nr-photo" src="/scene/dock.webp" alt="" loading="lazy" style={{ objectPosition: '62% 50%' }} />
            <div className="nr-board__scrim" />
            <div className="nr-board__panel">
              <div className="nr-board__top nr-mono">
                <span>Live operations</span>
                <span>Sample day · 11:30</span>
              </div>
              <div className="nr-board__stats">
                {STATS.map((s) => (
                  <div key={s.label}>
                    <b>{s.value}</b>
                    <span>{s.label}</span>
                  </div>
                ))}
              </div>
            </div>
            <figcaption className="sr-only">
              A sample live operations view: 12 active stops, 3 routes in progress, 2 ETA updates
              pending, 1 invoice ready to close.
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
