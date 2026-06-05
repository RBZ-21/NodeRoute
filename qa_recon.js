// NodeRoute UI Reconnaissance — map real selectors before full audit
const { chromium } = require('@playwright/test');
const fs = require('fs');

const BASE = 'https://noderoutesystems.com';
const SS = 'C:\\Users\\ryand\\NodeRoute_Fresh\\recon_shots';
if (!fs.existsSync(SS)) fs.mkdirSync(SS, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitForApp(page) {
  // Wait for React/Vue to hydrate
  await page.waitForLoadState('networkidle').catch(()=>{});
  await sleep(3000);
  // Wait for any loading spinner to disappear
  await page.waitForFunction(() => {
    const spinners = document.querySelectorAll('[class*="loading"],[class*="spinner"],[class*="skeleton"]');
    return spinners.length === 0;
  }, {timeout: 8000}).catch(()=>{});
}

async function dumpPageInfo(page, label) {
  await page.screenshot({ path: `${SS}/${label}.png`, fullPage: true });

  // Get all interactive elements
  const elements = await page.evaluate(() => {
    const results = [];
    const els = document.querySelectorAll('a, button, input, textarea, select, [role="button"], [onclick]');
    for (const el of els) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        results.push({
          tag: el.tagName,
          type: el.type || '',
          name: el.name || '',
          id: el.id || '',
          class: el.className?.toString().slice(0, 60) || '',
          placeholder: el.placeholder || '',
          text: el.innerText?.trim().slice(0, 50) || '',
          href: el.href?.replace(location.origin,'') || '',
          'data-*': Object.keys(el.dataset).join(','),
          visible: rect.top >= 0 && rect.bottom <= window.innerHeight
        });
      }
    }
    return results;
  });

  fs.writeFileSync(`${SS}/${label}_elements.json`, JSON.stringify(elements, null, 2));
  console.log(`  [${label}] ${elements.length} elements found`);

  // Get nav links
  const navLinks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('nav a, [role="navigation"] a, aside a, header a'))
      .filter(a => a.getBoundingClientRect().width > 0)
      .map(a => ({ text: a.innerText.trim(), href: a.pathname || a.href }));
  });
  console.log(`  Nav links: ${navLinks.map(l=>l.text+':'+l.href).join(' | ')}`);

  return { elements, navLinks };
}

(async () => {
  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();

  // ── Login ──────────────────────────────────────────────────────────────────
  console.log('\n=== Logging in ===');
  await page.goto(BASE + '/login');
  await waitForApp(page);
  await dumpPageInfo(page, '01_login_page');

  // Fill login
  const emailSel = await page.evaluate(() => {
    const inputs = document.querySelectorAll('input');
    return Array.from(inputs).map(i => ({
      type: i.type, name: i.name, id: i.id, placeholder: i.placeholder,
      'aria-label': i.getAttribute('aria-label') || '',
      'data-testid': i.dataset.testid || ''
    }));
  });
  console.log('  Login inputs:', JSON.stringify(emailSel));

  await page.fill('input[type="email"]', 'admin@noderoutesystems.com').catch(async () => {
    // Try any input that could be email
    const inputs = await page.locator('input').all();
    if (inputs.length > 0) await inputs[0].fill('admin@noderoutesystems.com');
  });
  await page.fill('input[type="password"]', '***REDACTED***').catch(()=>{});
  await page.screenshot({ path: `${SS}/01b_login_filled.png` });

  // Submit
  await page.click('button[type="submit"]').catch(async () => {
    await page.keyboard.press('Enter');
  });
  await waitForApp(page);
  console.log('  Post-login URL:', page.url());
  await dumpPageInfo(page, '02_dashboard');

  // ── Explore Navigation ──────────────────────────────────────────────────────
  console.log('\n=== Exploring Navigation ===');
  const info = await dumpPageInfo(page, '03_nav_state');

  // Find Orders page
  console.log('\n=== Orders Section ===');
  const orderLink = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a'));
    const orderLink = links.find(a => /order/i.test(a.innerText) && a.getBoundingClientRect().width > 0);
    return orderLink ? { text: orderLink.innerText, href: orderLink.pathname } : null;
  });
  console.log('  Orders link:', JSON.stringify(orderLink));

  if (orderLink) {
    await page.click(`a[href="${orderLink.href}"]`).catch(() => page.goto(BASE + orderLink.href));
    await waitForApp(page);
    await dumpPageInfo(page, '04_orders_page');

    // Find new order button
    const newOrderEl = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, a'));
      const btn = btns.find(b => /new|create|add/i.test(b.innerText) && /order/i.test(b.innerText));
      return btn ? { tag: btn.tagName, text: btn.innerText, href: btn.href || '', selector: btn.id ? '#'+btn.id : '.' + btn.className?.split(' ')[0] } : null;
    });
    console.log('  New order button:', JSON.stringify(newOrderEl));

    // Open new order form
    if (newOrderEl) {
      if (newOrderEl.href) await page.goto(newOrderEl.href);
      else await page.click(newOrderEl.selector).catch(() => {});
      await waitForApp(page);
      await dumpPageInfo(page, '05_new_order_form');

      // Deep inspect form fields
      const formFields = await page.evaluate(() => {
        const fields = document.querySelectorAll('input, textarea, select, [contenteditable]');
        return Array.from(fields).map(f => {
          const label = f.labels?.[0]?.innerText || f.getAttribute('aria-label') || '';
          const rect = f.getBoundingClientRect();
          return {
            tag: f.tagName, type: f.type || '', name: f.name || '', id: f.id || '',
            placeholder: f.placeholder || '', label, visible: rect.width > 0,
            class: f.className?.toString().slice(0,80),
            'aria-label': f.getAttribute('aria-label') || ''
          };
        });
      });
      console.log('\n  Order form fields:');
      formFields.forEach(f => console.log(`    ${f.tag}[type=${f.type}][name=${f.name}][label="${f.label}"][placeholder="${f.placeholder}"]`));
      fs.writeFileSync(`${SS}/05_order_form_fields.json`, JSON.stringify(formFields, null, 2));
    }
  }

  // ── Routes ─────────────────────────────────────────────────────────────────
  console.log('\n=== Routes Section ===');
  const routeLink = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a'));
    const link = links.find(a => /route|dispatch/i.test(a.innerText) && a.getBoundingClientRect().width > 0);
    return link ? { text: link.innerText, href: link.pathname } : null;
  });
  console.log('  Routes link:', JSON.stringify(routeLink));

  if (routeLink) {
    await page.click(`a[href="${routeLink.href}"]`).catch(() => page.goto(BASE + routeLink.href));
    await waitForApp(page);
    await dumpPageInfo(page, '06_routes_page');
  }

  // ── Settings ───────────────────────────────────────────────────────────────
  console.log('\n=== Settings ===');
  await page.goto(BASE + '/settings').catch(()=>{});
  await waitForApp(page);
  await dumpPageInfo(page, '07_settings');

  console.log('\n✅ Recon complete. Files in:', SS);
  await browser.close();
})();
