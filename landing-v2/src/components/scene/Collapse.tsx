import { ALL_EVENTS, AFTERNOON, MORNING, closeAt, fileAt, fmtClock, DAY } from '../../lib/day';
import { CTA } from '../../lib/utils';
import { WaitlistForm } from '../WaitlistForm';
import { LogLine, PileCard } from './Pile';

const N = ALL_EVENTS.length;
// File the newest cards first: they sit on top of the pile.
const fileOrder = (i: number) => fileAt(N - 1 - i, N);

/**
 * Act 6, the peak. The afternoon adds two more cards, then the divider sweeps
 * to the edge and every card on the pile is filed across into the log. The
 * NodeRoute side takes the whole frame and the ask lives there.
 * --p and --split are written by useDayline; [data-resolved] gates the form.
 */
export function Collapse({ span }: { span: number }) {
  return (
    <section id="early" data-sc-act="pin" data-sc-span={span} aria-labelledby="close-title">
      {/* Jump target for "Request early access": the scroll position where the
          collapse has fully resolved (about 88% of the pinned travel). */}
      <span id="request" className="nr-anchor" style={{ top: `calc(${(span - 1) * 0.88 * 100}vh)` }} />

      <div className="sc-stage nr-stage">
        <div className="nr-half nr-half--old">
          <div className="nr-pane">
            <img className="nr-photo nr-photo--ghost" src="/scene/desk-m.webp" alt="" loading="lazy" />
            <div className="nr-pane__head">
              <span className="nr-mono nr-inlabel">The usual way</span>
              <p className="nr-h2" aria-hidden>
                Afternoon. The pile keeps growing.
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
              <p className="nr-h2" aria-hidden>
                Same afternoon. Nothing waiting.
              </p>
            </div>
          </div>
        </div>

        <div className="nr-pile" aria-hidden>
          {MORNING.map((e, i) => (
            <PileCard key={e.t} event={e} index={i} at={-1} fileAt={fileOrder(i)} />
          ))}
          {AFTERNOON.map((e, j) => {
            const i = MORNING.length + j;
            return <PileCard key={e.t} event={e} index={i} at={closeAt(e.t) - 0.03} fileAt={fileOrder(i)} />;
          })}
        </div>

        <ol className="nr-log" aria-hidden>
          {MORNING.map((e, i) => (
            <LogLine key={e.t} event={e} at={-1} fileAt={fileOrder(i)} />
          ))}
          {AFTERNOON.map((e, j) => {
            const i = MORNING.length + j;
            return <LogLine key={e.t} event={e} at={closeAt(e.t) - 0.03} fileAt={fileOrder(i)} />;
          })}
        </ol>

        <div className="nr-final">
          <img className="nr-photo" src="/scene/dock.webp" alt="" loading="lazy" />
          <div className="nr-final__scrim" />
          <div className="nr-final__grid">
            <div className="nr-final__copy">
              <h2 id="close-title" className="nr-h2" style={{ fontSize: 'clamp(2rem, 1.2rem + 3vw, 4rem)' }}>
                Same day. Nothing left on the pile.
              </h2>
              <p className="nr-body">
                NodeRoute is early, on purpose. I’m working with a small number of delivery teams
                who deal with real coordination problems and want to help shape the product.
              </p>
              <WaitlistForm source="early-access" />
              <p className="nr-body" style={{ fontSize: '0.88rem' }}>
                Prefer email?{' '}
                <a href={CTA.founder} style={{ color: 'var(--nr-sky)' }}>
                  Talk directly to the founder.
                </a>
              </p>
            </div>

            <aside className="nr-manifest" aria-label="The sample day, filed">
              <div className="nr-manifest__head nr-mono">
                <span>Day filed</span>
                <span>Sample day</span>
              </div>
              <ol>
                {ALL_EVENTS.map((e) => (
                  <li key={e.t}>
                    <time>{fmtClock(e.t)}</time>
                    <span>{e.log}</span>
                  </li>
                ))}
              </ol>
              <div className="nr-manifest__foot">{fmtClock(DAY.end)} · Books closed. Invoices ready.</div>
            </aside>
          </div>
        </div>
      </div>
    </section>
  );
}
