import { useEffect } from 'react';
import '../vendor/scrollcraft/scrollcraft.js';
import { DAY, CLOSE_CLOCK, SWEEP, fmtClock } from './day';

/**
 * Mounts the vendored scrollcraft engine on the page. The engine is used
 * unmodified; everything bespoke to NodeRoute lives in useDayline below.
 */
export function useScrollCraft() {
  useEffect(() => {
    const api = window.ScrollCraft?.mount(document);
    return () => api?.destroy();
  }, []);
}

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (x: number) => x * x * (3 - 2 * x);

/**
 * The signature move. One rAF loop turns page scroll into a delivery day:
 *  - `--p` on the morning and close acts (their pinned progress),
 *  - `--split` on the close act and the spine (where the divider sits, 0.5 -> 0),
 *  - the clock text in every [data-day-clock] element.
 * Everything visual is CSS reading those variables, so motion stays on
 * transform / opacity / clip-path only.
 */
export function useDayline() {
  useEffect(() => {
    const morning = document.getElementById('product');
    const close = document.getElementById('early');
    const spine = document.getElementById('spine');
    const clocks = Array.from(document.querySelectorAll<HTMLElement>('[data-day-clock]'));
    if (!morning || !close) return;

    const reduced = prefersReducedMotion();
    let frame = 0;
    let lastClock = '';

    const pinned = (el: HTMLElement, vh: number) => {
      const r = el.getBoundingClientRect();
      const travel = r.height - vh;
      return travel > 0 ? clamp(-r.top / travel) : r.top <= 0 ? 1 : 0;
    };

    const tick = () => {
      frame = requestAnimationFrame(tick);
      const vh = window.innerHeight;
      const y = window.scrollY;

      const pm = reduced ? 1 : pinned(morning, vh);
      const pc = reduced ? 1 : pinned(close, vh);

      // Clock: morning act, then the gap between acts, then the close act.
      const mr = morning.getBoundingClientRect();
      const cr = close.getBoundingClientRect();
      const morningEndY = y + mr.bottom - vh;
      const closeStartY = y + cr.top;
      let minutes: number;
      if (y <= morningEndY) {
        minutes = DAY.start + (DAY.morningEnd - DAY.start) * pm;
      } else if (y < closeStartY) {
        const f = clamp((y - morningEndY) / Math.max(1, closeStartY - morningEndY));
        minutes = DAY.morningEnd + (DAY.closeStart - DAY.morningEnd) * f;
      } else {
        minutes =
          DAY.closeStart + (DAY.end - DAY.closeStart) * clamp(pc / CLOSE_CLOCK);
      }

      const split = 0.5 * (1 - smooth(clamp((pc - SWEEP.from) / (SWEEP.to - SWEEP.from))));

      morning.style.setProperty('--p', pm.toFixed(4));
      close.style.setProperty('--p', pc.toFixed(4));
      close.style.setProperty('--split', split.toFixed(4));
      // The form and links in the resolved frame only become reachable once it
      // is actually on screen (keeps invisible inputs out of the tab order).
      close.toggleAttribute('data-resolved', reduced || pc > 0.7);

      if (spine) {
        // Reduced motion: the close act shows its resolved frame, but the spine
        // stays centred for the split acts above it.
        spine.style.setProperty('--split', (reduced ? 0.5 : split).toFixed(4));
        // The spine is chrome for the split acts only. It leaves once the
        // collapse has resolved, before the FAQ.
        const resolvedY = y + cr.top + (cr.height - vh) * SWEEP.to;
        const fade = clamp((resolvedY - y) / (vh * 0.25));
        spine.style.setProperty('--spine-o', fade.toFixed(3));
        spine.toggleAttribute('data-gone', fade <= 0.01);
      }

      const text = fmtClock(minutes);
      if (text !== lastClock) {
        lastClock = text;
        for (const c of clocks) c.textContent = text;
      }
    };

    // Keyboard users reach the form by Tab before the collapse has played. Jump
    // straight to the resolved frame so the focused field is actually visible.
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('.nr-final') || close.hasAttribute('data-resolved')) return;
      document.getElementById('request')?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
    };
    close.addEventListener('focusin', onFocusIn);

    tick();
    return () => {
      cancelAnimationFrame(frame);
      close.removeEventListener('focusin', onFocusIn);
    };
  }, []);
}
