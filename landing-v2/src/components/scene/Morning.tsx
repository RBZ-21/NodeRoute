import { MORNING, morningAt } from '../../lib/day';
import { LogLine, PileCard } from './Pile';

/**
 * Act 2, Unease. The stage holds while the clock runs 04:12 to 11:30. Each
 * event lands twice: as a card on the left pile and as one resolved line on
 * the right. Both are driven by --p, written by useDayline.
 */
export function Morning({ span }: { span: number }) {
  return (
    <section id="product" data-sc-act="pin" data-sc-span={span} aria-labelledby="morning-old morning-new">
      <div className="sc-stage nr-stage">
        <div className="nr-half nr-half--old">
          <div className="nr-pane">
            <img className="nr-photo nr-photo--ghost" src="/scene/desk-m.webp" alt="" loading="lazy" />
            <div className="nr-pane__head">
              <span className="nr-mono nr-inlabel">The usual way</span>
              <h2 id="morning-old" className="nr-h2">
                Delivery gets messy fast.
              </h2>
              <p className="nr-body">
                When routes, ETAs, inventory and invoicing live in different places, every change
                turns into a call, a text, or a tab someone has to find.
              </p>
            </div>
          </div>
        </div>

        <div className="nr-half nr-half--new">
          <div className="nr-pane">
            <div className="nr-pane__head">
              <span className="nr-mono nr-inlabel" style={{ color: 'var(--nr-sky)' }}>
                On NodeRoute
              </span>
              <h2 id="morning-new" className="nr-h2">
                The same morning, in one place.
              </h2>
              <p className="nr-body">
                Each change lands on the route it belongs to, so the answer is already there when
                someone asks.
              </p>
            </div>
          </div>
        </div>

        <div className="nr-pile">
          {MORNING.map((e, i) => (
            <PileCard key={e.t} event={e} index={i} at={morningAt(e.t) - 0.04} />
          ))}
        </div>

        <ol className="nr-log" aria-label="The morning on NodeRoute (sample day)">
          {MORNING.map((e) => (
            <LogLine key={e.t} event={e} at={morningAt(e.t) - 0.04} />
          ))}
        </ol>
      </div>
    </section>
  );
}
