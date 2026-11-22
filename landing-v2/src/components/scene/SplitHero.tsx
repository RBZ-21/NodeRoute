import { PhoneMissed, Truck } from 'lucide-react';
import { CTA } from '../../lib/utils';

/**
 * Act 1, Recognition. The split is established at 50/50 on the first screen so
 * the visitor reads both sides before scrolling. Each half is layered: photo
 * plate (slow), fog (mid), a real-markup chip in front (fastest).
 */
export function SplitHero({ span }: { span: number }) {
  return (
    <section id="top" className="nr-hero" data-sc-act="pin" data-sc-span={span} aria-label="Introduction">
      <div className="sc-stage nr-stage">
        <div className="nr-half nr-half--old">
          <div className="nr-pane" style={{ overflow: 'clip' }}>
            <img
              className="nr-photo"
              src="/scene/desk.webp"
              srcSet="/scene/desk-m.webp 900w, /scene/desk.webp 2000w"
              sizes="(max-width: 860px) 100vw, 50vw"
              alt="A dispatch desk at 4am: a lit phone on a clipboard of route sheets, a refrigerated truck waiting outside the window."
              data-sc-parallax="0.05"
              fetchPriority="high"
            />
            <div className="nr-hero__scrim" />
          </div>
        </div>

        <div className="nr-half nr-half--new">
          <div className="nr-pane" style={{ overflow: 'clip' }}>
            <img
              className="nr-photo"
              src="/scene/dock.webp"
              srcSet="/scene/dock-m.webp 900w, /scene/dock.webp 2000w"
              sizes="(max-width: 860px) 100vw, 50vw"
              alt="A refrigerated box truck at a seafood dock at dawn, doors open, fish totes on ice beside it."
              data-sc-parallax="0.05"
              fetchPriority="high"
            />
            <div className="nr-fog" data-sc-parallax="-0.16" />
            <div className="nr-hero__scrim" />
          </div>
        </div>

        {/* foreground planes */}
        <div className="nr-chip nr-chip--call" data-sc-parallax="-0.42" aria-hidden>
          <PhoneMissed className="h-4 w-4 text-red-700" />
          <span>
            <b>Missed call · 04:12</b>
            Driver 2, about Harbor Grill
          </span>
        </div>
        <div className="nr-chip nr-chip--route" data-sc-parallax="-0.3" aria-hidden>
          <Truck className="h-4 w-4" style={{ color: 'var(--nr-sky)' }} />
          <span>
            <b>Route 2 · loaded</b>
            14 stops, out at 04:58
          </span>
        </div>

        <div className="nr-hero__chrome">
          <a href="#top" className="nr-wordmark">
            <img src="/noderoute-logo.png" alt="" />
            NodeRoute
          </a>
          <a href={CTA.login} className="nr-login">
            Log in
          </a>
        </div>

        {/* The h1 carries the whole sentence; the left half is its visual twin. */}
        <div className="nr-hero__copy nr-hero__copy--old" aria-hidden>
          <span className="nr-mono nr-inlabel">The usual way</span>
          <p className="nr-h1 nr-h1__old">Your day runs on calls, texts and spreadsheets.</p>
        </div>
        <div className="nr-hero__copy nr-hero__copy--new">
          <span className="nr-mono nr-inlabel" style={{ color: 'var(--nr-sky)' }} aria-hidden>
            On NodeRoute
          </span>
          <h1 className="nr-h1 nr-h1__new">
            <span className="sr-only">Your day runs on calls, texts and spreadsheets. </span>
            Or it runs in one place.
          </h1>
          <p className="nr-body nr-hero__lede">
            Routes, ETAs, drivers, inventory and invoices together, built for seafood and perishable
            wholesale teams.
          </p>
          <div className="nr-hero__ctas">
            <a href="#request" className="nr-btn">
              Request early access
            </a>
            <a href={CTA.founder} className="nr-link">
              Talk to the founder
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Spine() {
  return (
    <div id="spine" className="nr-spine" aria-hidden>
      <div className="nr-spine__line" />
      <span className="nr-mono nr-spine__label nr-spine__label--old">The usual way</span>
      <span className="nr-mono nr-spine__label nr-spine__label--new">On NodeRoute</span>
      <div className="nr-spine__clock">
        <span className="nr-spine__time" data-day-clock>
          04:12
        </span>
        <span className="nr-spine__sample">Sample day</span>
      </div>
    </div>
  );
}
