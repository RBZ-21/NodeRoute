import { CTA } from '../../lib/utils';

const TEAMS = [
  'Seafood delivery',
  'Produce distribution',
  'Beverage delivery',
  'Local wholesale routes',
  'Multi-stop delivery teams',
];

/**
 * Act 5, Belonging. The quietest act on the page, on purpose: it is the
 * silence before the collapse. One slow parallax plane, otherwise still text.
 */
export function Fit() {
  return (
    <section id="about" className="nr-flow nr-fit" data-sc-act="flow" aria-labelledby="fit-title">
      <div className="sc-wrap nr-twin">
        <div className="nr-fit__left" data-sc-in>
          <h2 id="fit-title" className="nr-h2">
            Built for operators still holding too much together by hand.
          </h2>
          <p className="nr-body">
            NodeRoute is for small wholesale and local delivery teams that need better visibility
            into routes, ETAs, inventory and follow-through, without adding another complicated
            system to the mix.
          </p>
          <p className="nr-fit__tags">{TEAMS.join(' · ')}</p>
        </div>

        <div className="nr-fit__note" data-sc-in>
          <div className="nr-fit__frame">
            <img src="/scene/desk.webp" alt="" loading="lazy" data-sc-parallax="-0.1" />
          </div>
          <h3 className="nr-h2" style={{ fontSize: 'var(--sc-t-xl)', marginBottom: '1rem' }}>
            Why I’m building NodeRoute.
          </h3>
          <p>
            I’ve seen how messy delivery operations get when important details are spread across
            calls, texts, paper notes and spreadsheets.
          </p>
          <p>
            NodeRoute started from a simple idea: smaller delivery teams deserve a better way to run
            the day without adding more complexity.
          </p>
          <p>
            It’s early-stage, built for operators who need better visibility into routes, inventory,
            ETAs and follow-through.
          </p>
          <div className="nr-fit__sign">
            <span>Ryan, founder of NodeRoute Systems</span>
            <a href={CTA.founder} className="nr-link">
              Talk to the founder
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
