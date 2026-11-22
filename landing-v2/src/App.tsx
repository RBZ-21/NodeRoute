import { useState } from 'react';
import { FAQ } from './components/FAQ';
import { Footer } from './components/Footer';
import { Collapse } from './components/scene/Collapse';
import { Fit } from './components/scene/Fit';
import { Logbook } from './components/scene/Logbook';
import { Morning } from './components/scene/Morning';
import { SplitHero, Spine } from './components/scene/SplitHero';
import { Turn } from './components/scene/Turn';
import { prefersReducedMotion, useDayline, useScrollCraft } from './lib/useScrollCraft';

/**
 * Split-stage page: "the usual way" and "On NodeRoute" share the screen for
 * the whole scroll, a day clock runs down the divider, and the page resolves
 * when the divider sweeps to the edge.
 */
export function App() {
  // Under reduced motion the pinned acts collapse to one screen each and show
  // their finished state, so there is no long, static pinned scroll.
  const [reduced] = useState(prefersReducedMotion);
  useScrollCraft();
  useDayline();

  return (
    <div className="relative min-h-screen">
      <Spine />
      <main>
        <SplitHero span={reduced ? 1 : 1.6} />
        <Morning span={reduced ? 1 : 3} />
        <Turn />
        <Logbook />
        <Fit />
        <Collapse span={reduced ? 1 : 3.6} />
        <FAQ />
      </main>
      <Footer />
    </div>
  );
}
