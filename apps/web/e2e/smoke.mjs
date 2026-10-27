/**
 * Browser smoke test against a running stack (API :3000 with DEV_LOGIN, web :3001 built with
 * NEXT_PUBLIC_DEV_LOGIN=true, demo seed). Walks the maker-checker flow and saves screenshots.
 *   node e2e/smoke.mjs [screenshotDir]
 */
import { createRequire } from 'node:module';
// Uses the project's playwright if installed, otherwise the machine-wide one.
const { chromium } = createRequire(import.meta.url)('playwright');
import { mkdirSync } from 'node:fs';

const BASE = process.env.WEB_URL ?? 'http://localhost:3001';
const OUT = process.argv[2] ?? 'e2e-screenshots';
mkdirSync(OUT, { recursive: true });
const name = `E2E campaign ${Date.now()}`;

const browser = await chromium.launch();
const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
};

async function signIn(email) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`));
  await page.goto(`${BASE}/login`);
  await page.getByPlaceholder('name@waffarha.com').fill(email);
  await page.getByRole('button', { name: 'Sign in as this user' }).click();
  await page.waitForURL(/\/(admin|portal)/);
  return { context, page };
}

// 1. Manager creates and submits a campaign through the wizard.
{
  const { context, page } = await signIn('manager@waffarha.com');
  await page.getByRole('heading', { name: 'Overview' }).waitFor();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${OUT}/01-overview-en.png`, fullPage: true });

  await page.goto(`${BASE}/admin/campaigns/new`);
  await page.locator('label:has-text("Name") input').first().fill(name);
  await page.getByRole('button', { name: 'Next' }).click(); // → discount
  await page.locator('label:has-text("Percentage off") input').fill('15');
  await page.locator('label:has-text("Maximum discount per payment") input').fill('100');
  await page.getByRole('button', { name: 'Next' }).click(); // → targeting
  await page.getByRole('button', { name: '+ Add BIN range' }).click();
  await page.getByPlaceholder('From').fill('412345');
  await page.getByRole('button', { name: 'Next' }).click(); // → limits
  await page.locator('label:has-text("Total budget") input').fill('5000');
  await page.getByRole('button', { name: 'Next' }).click(); // → funding
  const funder = page
    .locator('select')
    .filter({ has: page.locator('option', { hasText: 'Demo Bank' }) })
    .first();
  await funder.selectOption({ label: 'Demo Bank · Bank' });
  await page.getByRole('button', { name: 'Next' }).click(); // → schedule
  // Start an hour ago in Cairo time (UTC+2 or +3), so approval makes it Active at once.
  const cairoNow = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Africa/Cairo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(Date.now() - 3600_000));
  await page.locator('input[type="datetime-local"]').first().fill(cairoNow.replace(' ', 'T'));
  await page.getByRole('button', { name: 'Next' }).click(); // → experiment
  await page.getByRole('textbox', { name: 'Holdout group' }).fill('10');
  await page.getByLabel('Run an A/B test').check();
  const variantB = page.locator('[data-variant="B"]');
  await variantB.getByRole('button', { name: 'Fixed amount' }).click();
  await variantB.locator('label:has-text("Amount off") input').fill('40');
  await page.screenshot({ path: `${OUT}/02b-wizard-experiment-en.png`, fullPage: true });
  await page.getByRole('button', { name: 'Next' }).click(); // → review
  check((await page.getByText(/B “B” 50%/).count()) > 0, 'review lists the A/B variants');
  await page.screenshot({ path: `${OUT}/02-wizard-review-en.png`, fullPage: true });
  await page.getByRole('button', { name: 'Save and submit' }).click();
  await page.waitForURL(/\/admin\/campaigns\/[0-9a-f-]{36}$/);
  await page.getByText('Pending approval').first().waitFor();
  check(true, 'manager created and submitted the campaign');
  check(
    (await page.getByRole('button', { name: 'Approve' }).count()) === 0,
    'manager cannot approve (role)',
  );
  await context.close();
}

// 2. Approver approves it from the approvals queue.
let campaignUrl;
{
  const { context, page } = await signIn('approver@waffarha.com');
  await page.goto(`${BASE}/admin/approvals`);
  await page.getByText(name).click();
  await page.waitForURL(/\/admin\/campaigns\//);
  campaignUrl = page.url();
  await page.getByRole('button', { name: 'Approve' }).click();
  await page.getByText('Active', { exact: true }).first().waitFor();
  check(true, 'approver approved; campaign is Active');
  await page.screenshot({ path: `${OUT}/03-campaign-active-en.png`, fullPage: true });

  // 3. Simulator shows the decision for the demo terminal.
  await page.goto(`${BASE}/admin/simulator`);
  await page.locator('label:has-text("Terminal") select').selectOption({ index: 1 });
  await page.locator('label:has-text("Card BIN") input').fill('412345');
  await page.getByRole('button', { name: 'Run simulation' }).click();
  await page.getByText('This payment would get').waitFor();
  check((await page.getByRole('cell', { name }).count()) > 0, 'simulator lists the new campaign');
  await page.screenshot({ path: `${OUT}/04-simulator-en.png`, fullPage: true });

  // 4. Arabic / RTL.
  await page.getByRole('button', { name: 'العربية' }).click();
  await page.goto(campaignUrl);
  await page.getByText('نشطة').first().waitFor();
  check(
    (await page.locator('html').getAttribute('dir')) === 'rtl',
    'Arabic switches the layout to RTL',
  );
  await page.screenshot({ path: `${OUT}/05-campaign-ar.png`, fullPage: true });
  await page.goto(`${BASE}/admin/campaigns/new`);
  await page.getByRole('button', { name: /الخصم/ }).first().click();
  await page.screenshot({ path: `${OUT}/06-wizard-ar.png`, fullPage: true });
  await page.getByRole('button', { name: 'English' }).click();
  await context.close();
}

// 5. A real signed payment as the acquirer, then finance settles the month.
{
  const { createHash, createHmac } = await import('node:crypto');
  const API = process.env.API_URL ?? 'http://localhost:3000';
  const post = async (path, body, idem) => {
    const raw = JSON.stringify(body);
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = createHmac('sha256', 'demo-secret-change-me')
      .update(`${ts}\nPOST\n${path}\n${createHash('sha256').update(raw).digest('hex')}`)
      .digest('hex');
    const headers = {
      'Content-Type': 'application/json',
      'X-Api-Key': 'acq_demo',
      'X-Timestamp': ts,
      'X-Signature': sig,
    };
    if (idem) headers['Idempotency-Key'] = idem;
    return (await fetch(API + path, { method: 'POST', headers, body: raw })).json();
  };
  // 10% of cards are in the holdout and get no discount from this campaign; try a few cards.
  let inq;
  for (let i = 0; i < 10 && !inq?.eligible; i++) {
    const ref = `e2e-${Date.now()}-${i}`;
    inq = await post(
      '/v1/discounts/inquire',
      {
        terminal_id: 'TID0001',
        bin: '412345',
        card_token: `tok_${ref}`,
        scheme: 'VISA',
        amount: 50000,
        currency: 'EGP',
        acquirer_txn_ref: ref,
      },
      ref,
    );
  }
  check(inq.eligible === true, 'acquirer payment got a discount');
  const conf = await post(`/v1/discounts/${inq.redemption_id}/confirm`, {
    charged_amount: inq.final_amount,
  });
  check(conf.status === 'CONFIRMED', 'acquirer confirmed the payment');

  const { context, page } = await signIn('finance@waffarha.com');
  await page.goto(campaignUrl);
  await page.getByTestId('performance').waitFor();
  check(
    (await page.getByText('Holdout (no discount)').count()) > 0 ||
      (await page.getByText(/Cards|Spend per card/).count()) > 0,
    'campaign page shows the performance & experiment card',
  );
  await page.screenshot({ path: `${OUT}/03b-performance-en.png`, fullPage: true });
  await page.goto(`${BASE}/admin/settlements`);
  const month = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
  await page.locator('input[type="month"]').fill(month);
  await page.getByRole('button', { name: 'Build drafts for this month' }).click();
  await page.getByText(/draft documents created/).waitFor();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${OUT}/08-settlements-en.png`, fullPage: true });
  // Open the bank's invoice and issue it.
  await page
    .getByRole('row')
    .filter({ hasText: 'Invoice' })
    .filter({ hasText: 'Draft' })
    .first()
    .click();
  await page.waitForURL(/\/admin\/settlements\//);
  await page.getByRole('button', { name: 'Issue' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Issue' }).click();
  await page
    .getByText(/INV-EG-/)
    .first()
    .waitFor();
  check(true, 'finance issued the invoice with a number');
  await page.screenshot({ path: `${OUT}/09-invoice-en.png`, fullPage: true });
  await context.close();
}

// 6. The bank sees its campaigns, share and the issued invoice in the portal (Arabic).
{
  const { context, page } = await signIn('ops@demobank.example');
  await page.getByText('Your campaigns').waitFor();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${OUT}/10-portal-en.png`, fullPage: true });
  await page.getByRole('link', { name: 'Invoices & statements' }).click();
  await page
    .getByText(/INV-EG-/)
    .first()
    .waitFor();
  check(true, 'bank sees the issued invoice in the portal');
  await page.getByRole('button', { name: 'العربية' }).click();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${OUT}/11-portal-documents-ar.png`, fullPage: true });
  await page.goto(`${BASE}/portal/campaigns/${campaignUrl.split('/').pop()}`);
  await page.getByTestId('performance').waitFor();
  check(
    (await page.getByText('الأداء والتجربة').count()) > 0,
    'bank sees the performance card in Arabic',
  );
  await page.screenshot({ path: `${OUT}/11b-portal-performance-ar.png`, fullPage: true });
  await page.getByRole('button', { name: 'English' }).click();
  await context.close();
}

// 7. Admin flips the kill switch: banner everywhere, acquirer gets KILL_SWITCH, then back on.
{
  const { createHash, createHmac } = await import('node:crypto');
  const API = process.env.API_URL ?? 'http://localhost:3000';
  const inquireOnce = async () => {
    const ref = `kill-${Date.now()}-${Math.random()}`;
    const raw = JSON.stringify({
      terminal_id: 'TID0001',
      bin: '412345',
      card_token: `tok_${ref}`,
      scheme: 'VISA',
      amount: 50000,
      currency: 'EGP',
      acquirer_txn_ref: ref.slice(0, 60),
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = createHmac('sha256', 'demo-secret-change-me')
      .update(
        `${ts}\nPOST\n/v1/discounts/inquire\n${createHash('sha256').update(raw).digest('hex')}`,
      )
      .digest('hex');
    const res = await fetch(`${API}/v1/discounts/inquire`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': 'acq_demo',
        'X-Timestamp': ts,
        'X-Signature': sig,
        'Idempotency-Key': ref.slice(0, 100),
      },
      body: raw,
    });
    return res.json();
  };
  const { context, page } = await signIn('admin@waffarha.com');
  await page.goto(`${BASE}/admin/safety`);
  await page.getByRole('button', { name: 'Stop all discounts' }).click();
  await page.locator('#kill-reason').fill('E2E drill');
  await page.getByRole('dialog').getByRole('button', { name: 'Stop all discounts' }).click();
  await page.getByText('All discounts are stopped').waitFor();
  await page.goto(`${BASE}/admin`);
  await page.getByText(/Kill switch is ON/).waitFor();
  check(true, 'kill switch banner shows across admin');
  await page.screenshot({ path: `${OUT}/12-kill-switch-en.png`, fullPage: true });
  // Settings reach every API instance within seconds.
  let reason;
  for (let i = 0; i < 20 && reason !== 'KILL_SWITCH'; i++) {
    reason = (await inquireOnce()).reason;
    if (reason !== 'KILL_SWITCH') await new Promise((r) => setTimeout(r, 300));
  }
  check(reason === 'KILL_SWITCH', 'acquirer gets KILL_SWITCH while it is on');
  await page.goto(`${BASE}/admin/safety`);
  await page.getByRole('button', { name: 'Resume discounts' }).click();
  await page.locator('#kill-reason').fill('E2E drill over');
  await page.getByRole('dialog').getByRole('button', { name: 'Resume discounts' }).click();
  await page.getByText('Discounts are running').waitFor();
  await page.goto(`${BASE}/admin/alerts`);
  await page
    .getByText(/Kill switch turned/)
    .first()
    .waitFor();
  check(true, 'kill switch changes appear as alerts');
  await page.screenshot({ path: `${OUT}/13-alerts-en.png`, fullPage: true });
  await context.close();
}

// 8. Partner users are kept out of admin.
{
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByPlaceholder('name@waffarha.com').fill('ops@demobank.example');
  await page.getByRole('button', { name: 'Sign in as this user' }).click();
  await page.waitForURL(/\/portal/);
  await page.goto(`${BASE}/admin/campaigns`);
  await page.waitForURL(/\/portal/);
  check(true, 'partner user is redirected from /admin to /portal');
  await page.goto(`${BASE}/login`);
  await page.screenshot({ path: `${OUT}/07-login-en.png` });
  await context.close();
}

await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} failure(s):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('\nE2E smoke passed');
