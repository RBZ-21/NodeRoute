import { useEffect } from 'react';

const DEFAULT_STATUSPAGE_EMBED_SCRIPT = 'https://noderoutesystems1.statuspage.io/embed/script.js';
const SCRIPT_ID = 'noderoute-statuspage-embed';

export function StatuspageEmbed() {
  useEffect(() => {
    if (document.getElementById(SCRIPT_ID)) return;

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = import.meta.env.VITE_STATUSPAGE_EMBED_SCRIPT_URL || DEFAULT_STATUSPAGE_EMBED_SCRIPT;
    script.async = true;
    document.body.appendChild(script);
  }, []);

  return null;
}
