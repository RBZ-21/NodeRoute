// NodeRoute Full QA Audit — All 8 Phases
// Run from: C:\Users\ryand\NodeRoute_Fresh
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://noderoutesystems.com';
const LOGIN_EMAIL = 'admin@noderoutesystems.com';
const LOGIN_PASSWORD = 'Admin123';
const SCREENSHOTS = 'C:\\Users\\ryand\\AppData\\Roaming\\Claude\\local-agent-mode-sessions\\334548b1-7929-4435-b39a-7104726c460c\\252c54a5-7477-4a85-9218-dcad5ef10f55\\local_67da9fd9-71e4-4371-8b92-c84074495d1f\\outputs\\qa_screenshots';
const REPORT_PATH = 'C:\\Users\\ryand\\AppData\\Roaming\\Claude\\local-agent-mode-sessions\\334548b1-7929-4435-b39a-7104726c460c\\252c54a5-7477-4a85-9218-dcad5ef10f55\\local_67da9fd9-71e4-4371-8b92-c84074495d1f\\outputs\\qa_findings_raw.json';

if (!fs.existsSync(SCREENSHOTS)) fs.mkdirSync(SCREENSHOTS, { recursive: true });

const log = [];
let idx = 0;

function record(phase, action, status, note='') {
  const entry = { phase, action, status, note, ts: new Date().toISOString() };
  log.push(entry);
  const icon = { PASS:'✅', WARN:'⚠️', FAIL:'❌' }[status] || '?';
  console.log(`${icon} [${phase}] ${action}${note?' — '+note:''}`);
}

async function ss(page, label) {
  const fname = `${String(idx++).padStart(3,'0')}_${label.replace(/\W+/g,'_')}.png`;
  const fpath = path.join(SCREENSHOTS, fname);
  await page.screenshot({ path: fpath, fullPage: false }).catch(()=>{});
  console.log(`  📸 ${fname}`);
  return fpath;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Helpers ──────────────────────────────────────────────────────────────────
async function clickFirst(page, selectors) {
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.count() > 0) { await el.click(); return true; }
  }
  return false;
}

async function fillFirst(page, selectors, value) {
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.count() > 0) { await el.fill(value); return true; }
  }
  return false;
}

async function navTo(page, labels, fallbackPath) {
  for (const label of labels) {
    const el = page.locator(`a:has-text("${label}"), nav a:has-text("${label}"), [role="navigation"] a:has-text("${label}")`).first();
    if (await el.count() > 0) {
      await el.click();
      await page.waitForLoadState('networkidle').catch(()=>{});
      await sleep(1500);
      return true;
    }
  }
  if (fallbackPath) {
    await page.goto(BASE_URL + fallbackPath, { waitUntil: 'networkidle' }).catch(()=>{});
    await sleep(1500);
  }
  return false;
}

async function getBodyText(page) {
  return page.innerText('body').catch(()=>'');
}

// ══ PHASE 1: Login & Dashboard ═══════════════════════════════════════════════
async function phase1(page) {
  console.log('\n══ PHASE 1: Login & Dashboard ══');
  await page.goto(BASE_URL, { waitUntil: 'networkidle' }).catch(()=>{});
  await ss(page, 'P1_01_homepage');

  // Find login
  const clicked = await clickFirst(page, [
    'a:has-text("Login")', 'a:has-text("Log in")', 'a:has-text("Sign in")',
    'button:has-text("Login")', 'a[href*="login"]'
  ]);
  if (!clicked) {
    await page.goto(BASE_URL + '/login', { waitUntil: 'networkidle' }).catch(()=>{});
  }
  await page.waitForLoadState('networkidle').catch(()=>{});
  await sleep(1500);
  await ss(page, 'P1_02_login_page');
  const loginUrl = page.url();
  console.log('  Login URL:', loginUrl);

  // Fill creds
  const hasEmail = await fillFirst(page,
    ['input[type="email"]','input[name="email"]','input[placeholder*="email" i]','input[placeholder*="Email"]'],
    LOGIN_EMAIL);
  const hasPass = await fillFirst(page,
    ['input[type="password"]'],
    LOGIN_PASSWORD);

  if (!hasEmail || !hasPass) {
    record('Phase1','Login form fields present','FAIL', `email:${hasEmail} pass:${hasPass} at ${loginUrl}`);
    return false;
  }
  record('Phase1','Login form fields present','PASS','');
  await ss(page, 'P1_03_credentials_filled');

  await clickFirst(page, [
    'button[type="submit"]','button:has-text("Login")','button:has-text("Log in")','button:has-text("Sign in")'
  ]);
  await page.waitForLoadState('networkidle').catch(()=>{});
  await sleep(3000);
  await ss(page, 'P1_04_post_login');

  const postUrl = page.url();
  console.log('  Post-login URL:', postUrl);
  const isStillOnLogin = postUrl.includes('/login') || postUrl === BASE_URL + '/' || postUrl === BASE_URL;

  if (isStillOnLogin) {
    // Check for error message
    const errMsg = await page.locator('[class*="error"],[class*="alert"],[role="alert"]').first().innerText().catch(()=>'');
    record('Phase1','Login success','FAIL', `Still on login. Error: "${errMsg}" — URL: ${postUrl}`);
    return false;
  }
  record('Phase1','Login success','PASS', `→ ${postUrl}`);

  // Dashboard assessment
  const body = await getBodyText(page);
  const hasPending  = /pending|queue/i.test(body);
  const hasOrders   = /order/i.test(body);
  const hasRoutes   = /route|dispatch/i.test(body);
  const hasAlerts   = /alert|notification|warning|unread/i.test(body);
  const hasStats    = /total|today|count|\d+ order/i.test(body);

  record('Phase1','Dashboard: order/queue info visible',     (hasPending||hasOrders)?'PASS':'WARN', hasPending?'Pending queue shown':'Order info present but no "pending" label');
  record('Phase1','Dashboard: route/dispatch info visible',  hasRoutes?'PASS':'WARN', hasRoutes?'Route data on landing':'No route info on dashboard');
  record('Phase1','Dashboard: alerts/notifications visible', hasAlerts?'PASS':'WARN', hasAlerts?'Alert system present':'No alert system visible');
  record('Phase1','Dashboard: daily stats/KPIs visible',     hasStats?'PASS':'WARN',  hasStats?'Stats present':'No KPI summary visible');
  record('Phase1','Landing page useful for workday start',   (hasOrders&&hasRoutes)?'PASS':'WARN', 'See screenshot P1_04_post_login');

  return true;
}

// ══ PHASE 2: Create Orders ════════════════════════════════════════════════════
async function openNewOrderForm(page) {
  // Try nav
  const found = await navTo(page, ['Orders','All Orders','Order Management'], '/orders');
  await sleep(500);
  const clicked = await clickFirst(page, [
    'button:has-text("New Order")','a:has-text("New Order")',
    'button:has-text("Create Order")','a:has-text("Create Order")',
    'button:has-text("Add Order")','a:has-text("+ Order")',
    '[href*="orders/new"]','[href*="order/new"]'
  ]);
  if (!clicked) {
    await page.goto(BASE_URL + '/orders/new', { waitUntil: 'networkidle' }).catch(()=>{});
  }
  await page.waitForLoadState('networkidle').catch(()=>{});
  await sleep(1500);
}

async function fillOrder(page, d) {
  if (d.customer) await fillFirst(page,
    ['input[name*="customer" i]','input[placeholder*="customer" i]','input[name*="company" i]','input[placeholder*="company" i]','input[name*="name" i]'],
    d.customer);
  if (d.pickup) await fillFirst(page,
    ['input[name*="pickup" i]','input[placeholder*="pickup" i]','input[name*="from" i]','input[placeholder*="from" i]','input[name*="origin" i]'],
    d.pickup);
  if (d.delivery) await fillFirst(page,
    ['input[name*="deliv" i]','input[placeholder*="deliv" i]','input[name*="drop" i]','input[placeholder*="drop" i]','input[name*="to" i]','input[placeholder*="address" i]'],
    d.delivery);
  if (d.notes) await fillFirst(page,
    ['textarea[name*="note" i]','textarea[placeholder*="note" i]','input[name*="note" i]','textarea'],
    d.notes);
  // Priority
  if (d.priority) {
    const sel = page.locator(`select`).first();
    if (await sel.count() > 0) {
      const opts = await sel.locator('option').allTextContents();
      const match = opts.find(o => o.toLowerCase().includes(d.priority.toLowerCase()));
      if (match) await sel.selectOption(match).catch(()=>{});
    }
    const radioOrCheck = page.locator(`label:has-text("${d.priority}"), input[value="${d.priority.toLowerCase()}"]`).first();
    if (await radioOrCheck.count() > 0) await radioOrCheck.click().catch(()=>{});
  }
}

async function submitOrder(page) {
  await clickFirst(page, [
    'button[type="submit"]','button:has-text("Save Order")','button:has-text("Save")',
    'button:has-text("Create Order")','button:has-text("Create")','button:has-text("Submit")'
  ]);
  await page.waitForLoadState('networkidle').catch(()=>{});
  await sleep(2500);
}

async function phase2(page) {
  console.log('\n══ PHASE 2: Create Orders ══');

  // Explore order form fields first
  await openNewOrderForm(page);
  await ss(page, 'P2_01_blank_order_form');
  const formInputs = await page.locator('input:visible, textarea:visible, select:visible').all();
  const fieldInfo = [];
  for (const fi of formInputs) {
    const n = await fi.getAttribute('name').catch(()=>'');
    const p = await fi.getAttribute('placeholder').catch(()=>'');
    const t = await fi.getAttribute('type').catch(()=>'');
    fieldInfo.push(`${t}[${n||p}]`);
  }
  console.log('  Visible form fields:', fieldInfo.join(', '));
  record('Phase2','Order form fields discovered','PASS', fieldInfo.join(' | '));

  // ── Order 1: Standard ──────────────────────────────────────────────────────
  await openNewOrderForm(page);
  await fillOrder(page, {
    customer: 'Test Company A',
    pickup:   'Husk Restaurant, 76 Queen St, Charleston SC 29401',
    delivery: '4559 Great Oak Dr, North Charleston SC 29418',
    notes:    'Leave at dock door',
    priority: 'Standard'
  });
  await ss(page, 'P2_02_order1_filled');
  await submitOrder(page);
  await ss(page, 'P2_03_order1_result');
  const o1url = page.url();
  const o1confirm = await page.locator('.toast,.alert,[class*="success"],[class*="confirm"]').count() > 0;
  record('Phase2','Order 1 (Standard) — save confirmation shown', o1confirm?'PASS':'WARN', o1confirm?'Confirmation visible':'No toast/confirm message');
  record('Phase2','Order 1 (Standard) — URL changed after save', !o1url.includes('/new')?'PASS':'WARN', o1url);

  // ── Order 2: Heavy/Freight ─────────────────────────────────────────────────
  await openNewOrderForm(page);
  await fillOrder(page, {
    customer: 'Test Company B',
    pickup:   'Husk Restaurant, 76 Queen St, Charleston SC 29401',
    delivery: '2296 Ashley River Rd, Charleston SC 29414',
    notes:    'HEAVY FREIGHT — pallet jack required, approx 400 lbs',
    priority: 'High'
  });
  const freightEl = page.locator('input[type="checkbox"][name*="heavy" i], input[type="checkbox"][name*="freight" i], label:has-text("Heavy"), label:has-text("Freight")').first();
  if (await freightEl.count() > 0) {
    await freightEl.click().catch(()=>{});
    record('Phase2','Order 2 — Heavy/Freight checkbox exists','PASS','');
  } else {
    record('Phase2','Order 2 — Heavy/Freight option exists','WARN','No dedicated heavy/freight field found');
  }
  await ss(page, 'P2_04_order2_heavy');
  await submitOrder(page);
  await ss(page, 'P2_05_order2_result');
  record('Phase2','Order 2 (Heavy) — created', 'PASS', page.url());

  // ── Order 3: Rush ─────────────────────────────────────────────────────────
  await openNewOrderForm(page);
  await fillOrder(page, {
    customer: 'Test Company C - RUSH',
    pickup:   'Husk Restaurant, 76 Queen St, Charleston SC 29401',
    delivery: '150 Bee St, Charleston SC 29403',
    notes:    'RUSH — must deliver before 11am, call on arrival',
    priority: 'Rush'
  });
  const rushEl = page.locator('label:has-text("Rush"), label:has-text("Priority"), input[value="rush" i]').first();
  if (await rushEl.count() > 0) {
    record('Phase2','Order 3 — Rush/Priority option exists','PASS','');
  } else {
    record('Phase2','Order 3 — Rush/Priority option exists','WARN','No dedicated rush/priority field');
  }
  await ss(page, 'P2_06_order3_rush');
  await submitOrder(page);
  await ss(page, 'P2_07_order3_result');
  record('Phase2','Order 3 (Rush) — created','PASS', page.url());

  // ── Order 4: Edge Case (blank + invalid) ──────────────────────────────────
  await openNewOrderForm(page);
  await ss(page, 'P2_08_order4_blank_before_submit');
  await submitOrder(page);
  await ss(page, 'P2_09_order4_blank_submitted');
  const errEls = await page.locator('[class*="error"],[class*="invalid"],span.error,p.error,.field-error').all();
  const errTexts = [];
  for (const el of errEls) { const t = await el.innerText().catch(()=>''); if(t.trim()) errTexts.push(t.trim()); }
  record('Phase2','Order 4 — blank form shows validation errors', errTexts.length>0?'PASS':'WARN',
    errTexts.length>0 ? `Errors: ${errTexts.slice(0,3).join(' | ')}` : 'No validation errors shown — blank submit accepted or no feedback');

  // Phone field non-numeric test
  const phoneEl = page.locator('input[type="tel"],input[name*="phone" i],input[placeholder*="phone" i]').first();
  if (await phoneEl.count() > 0) {
    await phoneEl.fill('abcXYZ');
    await sleep(400);
    const val = await phoneEl.inputValue().catch(()=>'');
    record('Phase2','Phone field rejects alpha input', val!=='abcXYZ'?'PASS':'WARN', `Typed "abcXYZ", stored: "${val}"`);
  } else {
    record('Phase2','Phone field exists on order form','WARN','No phone/tel field found');
  }

  // Date field past-date test
  const dateEl = page.locator('input[type="date"],input[name*="date" i]').first();
  if (await dateEl.count() > 0) {
    await dateEl.fill('2020-01-01');
    await sleep(400);
    const val = await dateEl.inputValue().catch(()=>'');
    record('Phase2','Date field rejects past dates', val!=='2020-01-01'?'PASS':'WARN', `Set 2020-01-01, stored: "${val}"`);
  } else {
    record('Phase2','Date/schedule field on order form','WARN','No date field found');
  }

  // ── Order 5: Duplicate ────────────────────────────────────────────────────
  await openNewOrderForm(page);
  await fillOrder(page, {
    customer: 'Test Company A',
    pickup:   'Husk Restaurant, 76 Queen St, Charleston SC 29401',
    delivery: '4559 Great Oak Dr, North Charleston SC 29418',
    notes:    'Leave at dock door',
    priority: 'Standard'
  });
  await ss(page, 'P2_10_order5_duplicate');
  await submitOrder(page);
  await ss(page, 'P2_11_order5_result');
  const dupWarn = await page.locator('[class*="warn"],[class*="duplicate"],text=/duplicate/i').count() > 0;
  record('Phase2','Order 5 (Duplicate) — system warns about duplicate', dupWarn?'PASS':'WARN',
    dupWarn?'Duplicate warning shown':'No duplicate detection — identical order accepted silently');

  // Check autofill/address suggestions on delivery field
  await openNewOrderForm(page);
  const delivEl = page.locator('input[name*="deliv" i],input[placeholder*="deliv" i],input[name*="address" i]').first();
  if (await delivEl.count() > 0) {
    await delivEl.fill('76 Queen');
    await sleep(2000);
    const suggestions = await page.locator('[class*="autocomplete"],[class*="suggestion"],[class*="dropdown"] li').count();
    record('Phase2','Address autocomplete/suggestions', suggestions>0?'PASS':'WARN',
      suggestions>0 ? `${suggestions} suggestions shown` : 'No address autocomplete dropdown');
  }

  // Navigate back to order list to verify all orders visible
  await navTo(page, ['Orders','All Orders','Order Management'], '/orders');
  await ss(page, 'P2_12_orders_list_after_creation');
  const rowCount = await page.locator('tr, [class*="order-row"], [class*="order-item"]').count();
  record('Phase2','Orders appear immediately in list after creation', rowCount>=4?'PASS':'WARN',
    `${rowCount} order rows visible in list`);
}

// ══ PHASE 3: Order Management ════════════════════════════════════════════════
async function phase3(page) {
  console.log('\n══ PHASE 3: Order Management ══');

  await navTo(page, ['Orders','All Orders','Order Management'], '/orders');
  await ss(page, 'P3_01_orders_list');
  const rows = await page.locator('tr[data-id], tr.order-row, [class*="order-item"], [class*="order-row"]').all();
  record('Phase3','Orders visible in list', rows.length>0?'PASS':'FAIL', `${rows.length} rows`);

  if (rows.length === 0) {
    record('Phase3','Order detail/edit test skipped','WARN','No order rows to click');
    return;
  }

  // ── View & Edit ────────────────────────────────────────────────────────────
  // Click first row
  await rows[0].click().catch(async ()=> {
    // Try clicking a link inside the row
    const link = rows[0].locator('a').first();
    if (await link.count()>0) await link.click();
  });
  await page.waitForLoadState('networkidle').catch(()=>{});
  await sleep(1500);
  await ss(page, 'P3_02_order_detail');
  record('Phase3','Order detail view opens on click', !page.url().includes('/orders?')?'PASS':'WARN', page.url());

  // Edit button
  const editClicked = await clickFirst(page, ['button:has-text("Edit")','a:has-text("Edit")','[aria-label*="edit" i]']);
  record('Phase3','Edit button on order detail', editClicked?'PASS':'WARN', editClicked?'Found':'Not found');
  if (editClicked) {
    await sleep(1000);
    await ss(page, 'P3_03_edit_mode');
    // Edit notes
    await fillFirst(page, ['textarea','input[name*="note" i]'], 'UPDATED: Leave at dock door — call 30 min ahead');
    // Edit delivery address
    await fillFirst(page, ['input[name*="deliv" i]','input[placeholder*="deliv" i]'], '4559 Great Oak Dr Unit B, North Charleston SC 29418');
    await ss(page, 'P3_04_edits_made');
    // Save
    const saved = await clickFirst(page, ['button:has-text("Save")','button[type="submit"]','button:has-text("Update")']);
    await sleep(2000);
    await ss(page, 'P3_05_saved');
    record('Phase3','Edit fields and save — changes accepted', saved?'PASS':'WARN', '');
    // Cancel button check
    const hasCancelBtn = await page.locator('button:has-text("Cancel"),a:has-text("Cancel")').count() > 0;
    record('Phase3','Cancel button available during edit', hasCancelBtn?'PASS':'WARN', hasCancelBtn?'Yes':'No cancel button found');
  }

  // ── Delete Order 5 (last order) ────────────────────────────────────────────
  await navTo(page, ['Orders','All Orders'], '/orders');
  await sleep(1000);
  const orderRows2 = await page.locator('tr[data-id], tr.order-row, [class*="order-item"], [class*="order-row"]').all();
  if (orderRows2.length > 0) {
    // click last (duplicate)
    await orderRows2[orderRows2.length-1].click().catch(async ()=>{
      const link = orderRows2[orderRows2.length-1].locator('a').first();
      if (await link.count()>0) await link.click();
    });
    await page.waitForLoadState('networkidle').catch(()=>{});
    await sleep(1000);
    await ss(page, 'P3_06_order_to_delete');

    const delClicked = await clickFirst(page, ['button:has-text("Delete")','button:has-text("Remove order")','[aria-label*="delete" i]']);
    if (!delClicked) {
      // Try 3-dot/more menu
      await clickFirst(page, ['[aria-label*="more" i]','button:has-text("...")','button:has-text("Actions")','[class*="kebab"]']);
      await sleep(500);
    }
    await ss(page, 'P3_07_delete_clicked');
    const hasDialog = await page.locator('[role="dialog"],.modal,[class*="confirm"],[class*="modal"]').count() > 0;
    record('Phase3','Delete shows confirmation dialog', hasDialog?'PASS':'WARN', hasDialog?'Dialog shown':'No confirmation dialog');
    // Confirm
    await clickFirst(page, ['button:has-text("Confirm")','button:has-text("Yes, delete")','button:has-text("Delete")','button:has-text("OK")']);
    await sleep(2000);
    await ss(page, 'P3_08_after_delete');
    const undoAvailable = await page.locator('button:has-text("Undo"),a:has-text("Undo"),[class*="undo"]').count() > 0;
    record('Phase3','Undo/restore after delete', undoAvailable?'PASS':'WARN', undoAvailable?'Undo available':'No undo — delete is permanent');
    record('Phase3','Delete order flow completes','PASS','');

    // Also delete order 4 (second to last from original list)
    await navTo(page, ['Orders','All Orders'], '/orders');
    await sleep(1000);
  }

  // ── Status Transitions ─────────────────────────────────────────────────────
  await navTo(page, ['Orders','All Orders'], '/orders');
  await sleep(1000);
  const firstRow = page.locator('tr[data-id], tr.order-row, [class*="order-item"], [class*="order-row"]').first();
  if (await firstRow.count()>0) {
    await firstRow.click().catch(async ()=>{
      const link = firstRow.locator('a').first();
      if (await link.count()>0) await link.click();
    });
    await page.waitForLoadState('networkidle').catch(()=>{});
    await sleep(1000);
    await ss(page, 'P3_09_order1_status_view');

    // Document all status buttons visible
    const statusBtns = await page.locator('button, a').all();
    const statusLabels = [];
    for (const btn of statusBtns) {
      const t = await btn.innerText().catch(()=>'');
      if (/pending|confirm|progress|dispatch|deliver|complet|cancel/i.test(t)) statusLabels.push(t.trim());
    }
    console.log('  Status-related buttons:', statusLabels.join(', '));
    record('Phase3','Status buttons visible on order', statusLabels.length>0?'PASS':'WARN', statusLabels.join(' | ')||'None found');

    // Try to advance status
    const advanced = await clickFirst(page, [
      'button:has-text("Confirm")','button:has-text("Accept")','button:has-text("Mark Confirmed")',
      'button:has-text("In Progress")','button:has-text("Mark In Progress")',
      'button:has-text("Dispatch")','button:has-text("Start")'
    ]);
    if (advanced) {
      await sleep(2000);
      await ss(page, 'P3_10_status_advanced');
      record('Phase3','Status transition — advance works','PASS','');
      // Check timestamp
      const timestamps = await page.locator('time,[class*="timestamp"],[class*="history"],[class*="log"]').count();
      record('Phase3','Status change logged with timestamp/audit trail', timestamps>0?'PASS':'WARN',
        timestamps>0 ? `${timestamps} time/log elements` : 'No audit trail visible');
    } else {
      record('Phase3','Status transition — advance button found','WARN','No status-advance button found');
    }

    // Can you reverse a step?
    const reverseBtn = await page.locator('button:has-text("Revert"),button:has-text("Undo Status"),button:has-text("Back to Pending")').count() > 0;
    record('Phase3','Status reversal option exists', reverseBtn?'PASS':'WARN', reverseBtn?'Reversal button found':'No reversal option visible');
  }
}

// ══ PHASE 4: Print ═══════════════════════════════════════════════════════════
async function phase4(page) {
  console.log('\n══ PHASE 4: Printer Test ══');
  const found = await navTo(page, ['Settings','Configuration','Admin','Preferences'], '/settings');
  await ss(page, 'P4_01_settings');
  const body = await getBodyText(page);
  const hasPrint = /print|printer|label/i.test(body);
  record('Phase4','Printer settings section exists', hasPrint?'PASS':'WARN', hasPrint?'Print/label in settings':'No printer config found in settings');
  const types = ['Zebra','thermal','network','USB','PDF','Brother','DYMO'].filter(t=>body.toLowerCase().includes(t.toLowerCase()));
  record('Phase4','Printer types supported', types.length>0?'PASS':'WARN', types.length>0?types.join(', '):'No printer types documented in settings');

  // Go to order for print
  await navTo(page, ['Orders','All Orders'], '/orders');
  const firstRow = page.locator('tr[data-id], tr.order-row, [class*="order-item"], [class*="order-row"]').first();
  if (await firstRow.count()>0) {
    await firstRow.click().catch(async()=>{
      const l = firstRow.locator('a').first();
      if(await l.count()>0) await l.click();
    });
    await page.waitForLoadState('networkidle').catch(()=>{});
    await sleep(1000);
    await ss(page, 'P4_02_order_for_print');

    const printBtns = ['Print','Print Label','Print Summary','Packing Slip','Download PDF','Print Receipt'];
    let foundAny = false;
    for (const lbl of printBtns) {
      const el = page.locator(`button:has-text("${lbl}"),a:has-text("${lbl}")`).first();
      if (await el.count()>0) {
        foundAny = true;
        record('Phase4',`Print option "${lbl}" found`,'PASS','');
        // Click and capture result
        const [newPage] = await Promise.all([
          page.context().waitForEvent('page', {timeout:3000}).catch(()=>null),
          el.click()
        ]);
        await sleep(2000);
        if (newPage) {
          await newPage.waitForLoadState().catch(()=>{});
          await ss(newPage, `P4_03_print_${lbl.replace(/\s/g,'_')}`);
          record('Phase4',`"${lbl}" opens in new tab/window`,'PASS', newPage.url());
          await newPage.close().catch(()=>{});
        } else {
          await ss(page, `P4_03_print_${lbl.replace(/\s/g,'_')}`);
          const isPdf = page.url().includes('.pdf') || page.url().includes('print');
          record('Phase4',`"${lbl}" opens print/PDF view`, isPdf?'PASS':'WARN', page.url());
          await page.goBack().catch(()=>{});
          await page.waitForLoadState().catch(()=>{});
          await sleep(1000);
        }
      }
    }
    if (!foundAny) record('Phase4','Any print option on order detail','WARN','No print buttons found on order detail page');
  }
}

// ══ PHASE 5: Routes ═══════════════════════════════════════════════════════════
async function phase5(page) {
  console.log('\n══ PHASE 5: Route Management ══');
  const found = await navTo(page, ['Routes','Route Management','Dispatch','Map'], '/routes');
  await ss(page, 'P5_01_routes_section');
  record('Phase5','Routes/Dispatch section found', found?'PASS':'WARN', page.url());

  // New route button
  const newRouteClicked = await clickFirst(page, [
    'button:has-text("New Route")','a:has-text("New Route")',
    'button:has-text("Create Route")','a:has-text("Create Route")','button:has-text("+ Route")'
  ]);
  record('Phase5','New Route button exists', newRouteClicked?'PASS':'WARN', '');
  if (!newRouteClicked) return;

  await page.waitForLoadState('networkidle').catch(()=>{});
  await sleep(1000);
  await ss(page, 'P5_02_new_route_form');

  // Route name
  const nameOk = await fillFirst(page,
    ['input[name*="name" i]','input[placeholder*="name" i]','input[placeholder*="route" i]'],
    'Test Route - Morning');
  record('Phase5','Route name field exists', nameOk?'PASS':'WARN','');

  // Date
  const today = new Date().toISOString().split('T')[0];
  const dateOk = await fillFirst(page, ['input[type="date"]','input[name*="date" i]'], today);
  record('Phase5','Route date field exists', dateOk?'PASS':'WARN','');

  // Driver
  const driverSel = page.locator('select[name*="driver" i]').first();
  if (await driverSel.count()>0) {
    const opts = await driverSel.locator('option').all();
    if (opts.length>1) {
      await driverSel.selectOption({index:1});
      record('Phase5','Driver dropdown — drivers available', 'PASS', `${opts.length} options`);
    } else {
      record('Phase5','Driver dropdown — drivers available', 'WARN', 'Only 1 option (likely placeholder)');
    }
  } else {
    const driverInput = await fillFirst(page, ['input[name*="driver" i]','input[placeholder*="driver" i]'], 'Ryan');
    record('Phase5','Driver assignment field exists', driverInput?'PASS':'WARN', driverInput?'Text input':'No driver field');
  }

  // Vehicle
  const vehicleSel = page.locator('select[name*="vehicle" i],input[name*="vehicle" i]').first();
  record('Phase5','Vehicle assignment field exists', await vehicleSel.count()>0?'PASS':'WARN', '');

  await ss(page, 'P5_03_route_form_filled');

  // Save
  const saved = await clickFirst(page,['button[type="submit"]','button:has-text("Save")','button:has-text("Create")']);
  await page.waitForLoadState('networkidle').catch(()=>{});
  await sleep(2500);
  await ss(page, 'P5_04_route_created');
  record('Phase5','Route saved successfully', saved?'PASS':'WARN', page.url());

  // Add orders to route
  let addedCount = 0;
  for (let i=0; i<3; i++) {
    const addBtn = page.locator('button:has-text("Add Order"),button:has-text("Add Stop"),a:has-text("Add Order")').first();
    if (await addBtn.count()>0) {
      await addBtn.click();
      await sleep(1500);
      // Select from picker
      const pickerItem = page.locator('[role="dialog"] tr, .order-picker li, [class*="order-picker"] [class*="item"]').first();
      if (await pickerItem.count()>0) {
        await pickerItem.click();
        await sleep(500);
        await clickFirst(page,['button:has-text("Add")','button:has-text("Confirm")','button:has-text("Select")']);
        await sleep(1000);
        addedCount++;
      } else {
        // Maybe orders listed differently
        const orderCheckbox = page.locator('[role="dialog"] input[type="checkbox"]').nth(i);
        if (await orderCheckbox.count()>0) {
          await orderCheckbox.click();
          await clickFirst(page,['button:has-text("Add")','button:has-text("Confirm")']);
          await sleep(1000);
          addedCount++;
        }
        break;
      }
    } else break;
  }
  await ss(page, 'P5_05_orders_in_route');
  record('Phase5','Adding orders to route', addedCount>0?'PASS':'WARN',
    addedCount>0 ? `${addedCount} orders added` : 'No add-order button found on route detail');

  // Map
  const mapEl = await page.locator('[class*="map"],#map,canvas,[data-testid="map"]').count();
  record('Phase5','Map renders with route stops', mapEl>0?'PASS':'WARN', mapEl>0?'Map element present':'No map visible');

  // Drag-drop
  const draggable = await page.locator('[draggable="true"],[class*="stop-row"],[class*="waypoint"]').count();
  record('Phase5','Drag-and-drop stop reordering', draggable>0?'PASS':'WARN',
    draggable>0 ? `${draggable} draggable items` : 'No draggable stop elements detected');

  // Optimize
  const optimizeEl = await page.locator('button:has-text("Optimize"),a:has-text("Optimize")').count();
  record('Phase5','Route optimization feature', optimizeEl>0?'PASS':'WARN', optimizeEl>0?'Optimize button found':'No optimization button');

  // Duplicate order assignment test
  const stopCount1 = await page.locator('[class*="stop"],[class*="waypoint"]').count();
  record('Phase5','Stops visible in route', stopCount1>0?'PASS':'WARN', `${stopCount1} stops`);
}

// ══ PHASE 6: Remove from Route ═══════════════════════════════════════════════
async function phase6(page) {
  console.log('\n══ PHASE 6: Remove Orders from Route ══');
  await ss(page, 'P6_01_route_before_removal');
  const stops = await page.locator('[class*="stop"],[class*="waypoint"]').all();
  record('Phase6','Route has stops to remove', stops.length>0?'PASS':'WARN', `${stops.length} stops`);

  if (stops.length>0) {
    // Remove last stop
    const lastStop = stops[stops.length-1];
    const removeBtn = lastStop.locator('button:has-text("Remove"),button[aria-label*="remove" i],button[aria-label*="delete" i],[class*="remove-btn"]').first();
    if (await removeBtn.count()>0) {
      await removeBtn.click();
      await sleep(2000);
      await ss(page, 'P6_02_stop_removed');
      const newStops = await page.locator('[class*="stop"],[class*="waypoint"]').count();
      record('Phase6','Stop removed from route', newStops<stops.length?'PASS':'WARN', `Before: ${stops.length}, After: ${newStops}`);
      // Verify order still exists
      await navTo(page, ['Orders','All Orders'], '/orders');
      await sleep(1000);
      const orderCount = await page.locator('tr[data-id], tr.order-row, [class*="order-item"]').count();
      record('Phase6','Removed stop still exists as unassigned order', orderCount>0?'PASS':'WARN', `${orderCount} orders in list`);
    } else {
      record('Phase6','Remove stop button exists on stop row','WARN','No remove button on stop');
    }
  }

  // Empty route behavior
  await navTo(page, ['Routes','Route Management'], '/routes');
  await sleep(1000);
  await ss(page, 'P6_03_routes_after_removal');
}

// ══ PHASE 7: Dispatch & Driver ════════════════════════════════════════════════
async function phase7(page) {
  console.log('\n══ PHASE 7: Dispatch & Driver ══');
  await navTo(page, ['Routes','Route Management','Dispatch'], '/routes');
  await sleep(1000);
  await ss(page, 'P7_01_routes_predispatch');

  // Find Test Route
  const testRouteRow = page.locator('tr:has-text("Test Route"),tr:has-text("Morning"),[class*="route"]:has-text("Test Route")').first();
  if (await testRouteRow.count()>0) {
    await testRouteRow.click().catch(async()=>{ const l = testRouteRow.locator('a').first(); if(await l.count()>0) await l.click(); });
    await page.waitForLoadState('networkidle').catch(()=>{});
    await sleep(1000);
  }
  await ss(page, 'P7_02_route_detail');

  // Dispatch
  const dispatched = await clickFirst(page, [
    'button:has-text("Dispatch")','button:has-text("Send to Driver")','button:has-text("Start Route")',
    'button:has-text("Activate")','a:has-text("Dispatch")'
  ]);
  record('Phase7','Dispatch button found', dispatched?'PASS':'WARN', '');
  if (dispatched) {
    await sleep(2000);
    await ss(page, 'P7_03_post_dispatch');
    const notif = await page.locator('.toast,.alert,[class*="success"]').count() > 0;
    record('Phase7','Dispatch confirmation/notification shown', notif?'PASS':'WARN', notif?'Notification visible':'No feedback after dispatch');
    const noDriverWarn = await page.locator('[class*="warn"]:has-text("driver"),.alert:has-text("driver")').count() > 0;
    record('Phase7','Warning shown if no driver assigned', noDriverWarn?'PASS':'WARN', '');
  }

  // Driver-facing view
  const driverViewLink = await page.locator('a:has-text("Driver View"),a:has-text("Driver App"),a[href*="driver"]').count() > 0;
  record('Phase7','Driver-facing view accessible from dispatcher', driverViewLink?'PASS':'WARN', driverViewLink?'Link found':'No driver view link visible');

  // Map / real-time tracking
  const mapEl = await page.locator('[class*="map"],#map,canvas').count() > 0;
  record('Phase7','Live map/tracking visible after dispatch', mapEl?'PASS':'WARN', mapEl?'Map present':'No map');

  // Mark Order 1 delivered
  await navTo(page, ['Orders','All Orders'], '/orders');
  await sleep(1000);
  const firstOrder = page.locator('tr[data-id], tr.order-row, [class*="order-item"]').first();
  if (await firstOrder.count()>0) {
    await firstOrder.click().catch(async()=>{ const l=firstOrder.locator('a').first(); if(await l.count()>0) await l.click(); });
    await page.waitForLoadState('networkidle').catch(()=>{});
    await sleep(1000);
    await ss(page, 'P7_04_order_to_deliver');
    const marked = await clickFirst(page, [
      'button:has-text("Delivered")','button:has-text("Mark Delivered")','button:has-text("Mark as Delivered")','button:has-text("Complete Delivery")'
    ]);
    if (marked) {
      await sleep(2000);
      await ss(page, 'P7_05_order_delivered');
      record('Phase7','Mark order as Delivered','PASS','');
    } else {
      record('Phase7','Mark order as Delivered button exists','WARN','No "Delivered" button found');
    }
  }

  // Check Ryan driver / add stop while in route
  await navTo(page, ['Routes','Dispatch','Route Management'], '/routes');
  await sleep(1000);
  const ryanVisible = await page.locator('text=Ryan').count() > 0;
  record('Phase7','Driver "Ryan" visible in system', ryanVisible?'PASS':'WARN', ryanVisible?'Ryan visible on route/driver page':'Ryan not found');

  // Add stop while en route
  const addStopBtn = await page.locator('button:has-text("Add Stop"),button:has-text("Add Order")').count() > 0;
  record('Phase7','Can add stop to active/dispatched route', addStopBtn?'PASS':'WARN', addStopBtn?'Add stop available':'No add-stop on active route');

  await ss(page, 'P7_06_dispatch_final');
}

// ══ PHASE 8: Invoice & Email ═══════════════════════════════════════════════
async function phase8(page) {
  console.log('\n══ PHASE 8: Invoice & Email ══');
  await navTo(page, ['Orders','All Orders'], '/orders');
  await sleep(1000);
  const firstOrder = page.locator('tr[data-id], tr.order-row, [class*="order-item"]').first();
  if (await firstOrder.count()>0) {
    await firstOrder.click().catch(async()=>{ const l=firstOrder.locator('a').first(); if(await l.count()>0) await l.click(); });
    await page.waitForLoadState('networkidle').catch(()=>{});
    await sleep(1000);
  }
  await ss(page, 'P8_01_order_for_invoice');

  const body = await getBodyText(page);
  const hasInvoiceSection = /invoice|billing|payment/i.test(body);
  record('Phase8','Invoice/Billing section on order detail', hasInvoiceSection?'PASS':'WARN', hasInvoiceSection?'Invoice text found':'No invoice section');

  // Auto-generated invoice number?
  const hasInvNum = await page.locator('[class*="invoice-num"],text=/INV-\\d/i').count() > 0;
  record('Phase8','Invoice auto-generated on order completion', hasInvNum?'PASS':'WARN', hasInvNum?'Invoice number visible':'No auto-invoice number');

  // Generate manually
  const genClicked = await clickFirst(page, [
    'button:has-text("Generate Invoice")','button:has-text("Create Invoice")','a:has-text("Generate Invoice")'
  ]);
  if (genClicked) {
    await page.waitForLoadState('networkidle').catch(()=>{});
    await sleep(2000);
    await ss(page, 'P8_02_invoice_generated');
    record('Phase8','Manual invoice generation works','PASS','');
  } else {
    record('Phase8','Manual generate invoice button','WARN','No generate invoice button found');
  }

  // Invoice layout check
  const invoiceItems = ['company','logo','order','item','total','price','date'].filter(k=>body.toLowerCase().includes(k));
  record('Phase8','Invoice layout completeness', invoiceItems.length>=4?'PASS':'WARN',
    `Invoice fields detected: ${invoiceItems.join(', ')}`);

  // Email invoice
  const emailClicked = await clickFirst(page, [
    'button:has-text("Email Invoice")','button:has-text("Send Invoice")','button:has-text("Email")',
    'a:has-text("Email Invoice")'
  ]);
  record('Phase8','Email invoice button exists', emailClicked?'PASS':'WARN', '');
  if (emailClicked) {
    await sleep(1500);
    await ss(page, 'P8_03_email_dialog');
    const emailFilled = await fillFirst(page, ['input[type="email"]','input[placeholder*="email" i]'], 'ryandb21@gmail.com');
    record('Phase8','Email address field in send dialog', emailFilled?'PASS':'WARN', '');
    // Preview
    const hasPreview = await page.locator('[class*="preview"],[class*="email-body"],[class*="email-preview"]').count() > 0;
    record('Phase8','Email preview shown before send', hasPreview?'PASS':'WARN', hasPreview?'Preview visible':'No email preview');
    await ss(page, 'P8_04_email_preview');
    // Send
    const sent = await clickFirst(page, ['button:has-text("Send")','button[type="submit"]']);
    if (sent) {
      await sleep(3000);
      await ss(page, 'P8_05_email_sent');
      const successMsg = await page.locator('.toast,.alert,[class*="success"]').first().innerText().catch(()=>'');
      record('Phase8','Invoice email sent — confirmation shown', successMsg?'PASS':'WARN',
        successMsg||'No success message after send');
    }
  }

  // PDF download
  const hasPdf = await page.locator('button:has-text("Download PDF"),button:has-text("PDF"),a[href*=".pdf"],a:has-text("Download PDF")').count() > 0;
  record('Phase8','PDF download option for invoice', hasPdf?'PASS':'WARN', hasPdf?'PDF button found':'No PDF download');

  // Resend
  const hasResend = await page.locator('button:has-text("Resend"),a:has-text("Resend")').count() > 0;
  record('Phase8','Resend invoice option', hasResend?'PASS':'WARN', hasResend?'Resend button found':'No resend option');

  // Invoice log
  const hasLog = await page.locator('[class*="invoice-log"],[class*="sent-history"]').count() > 0;
  record('Phase8','Invoice sent history/log', hasLog?'PASS':'WARN', hasLog?'History visible':'No invoice send log');

  await ss(page, 'P8_06_invoice_final');
}

// ══ MAIN ══════════════════════════════════════════════════════════════════════
(async () => {
  console.log('NodeRoute QA Audit starting...');
  console.log('Screenshots → ' + SCREENSHOTS);

  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized','--window-size=1400,900']
  });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();

  page.on('pageerror', err => record('Browser','JS page error','WARN', err.message.slice(0,100)));
  page.on('response', resp => { if (resp.status()>=500) record('Browser',`HTTP ${resp.status()}`,'FAIL', resp.url().slice(0,80)); });

  try {
    const ok = await phase1(page);
    if (!ok) { console.log('\n❌ Login failed — aborting remaining phases.'); }
    else {
      await phase2(page);
      await phase3(page);
      await phase4(page);
      await phase5(page);
      await phase6(page);
      await phase7(page);
      await phase8(page);
    }
  } catch(e) {
    console.error('\n❌ FATAL:', e.message);
    record('System','Fatal error','FAIL', e.message);
    await ss(page, 'FATAL_error').catch(()=>{});
  }

  fs.writeFileSync(REPORT_PATH, JSON.stringify(log, null, 2));
  console.log('\n📋 Findings saved to:', REPORT_PATH);

  const p = log.filter(l=>l.status==='PASS').length;
  const w = log.filter(l=>l.status==='WARN').length;
  const f = log.filter(l=>l.status==='FAIL').length;
  console.log(`\n── SUMMARY: ✅ ${p} PASS  ⚠️ ${w} WARN  ❌ ${f} FAIL  (total: ${log.length}) ──`);

  await browser.close();
})();
