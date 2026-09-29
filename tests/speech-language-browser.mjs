// Report a Problem: the top language switcher (E / த) is the only language control and drives both the UI and
// speech recognition. The browser's SpeechRecognition is replaced by a recorder that notes the `lang` each
// recognition starts with and returns a spoken phrase (no microphone in automated runs).
// Registers one TEST citizen (tag SPL-TEST-<ts>); no complaint is submitted.
//
//   node tests/speech-language-browser.mjs <baseUrl> [--chromium=<path>] [--shots=<dir>]
import { chromium } from 'playwright-core';

const B = process.argv[2] ?? 'http://localhost:3000';
const opt = Object.fromEntries(process.argv.slice(3).filter((a) => a.startsWith('--')).map((a) => a.slice(2).split(/=(.*)/s).slice(0, 2)));
const TS = String(Date.now()).slice(-6); const TAG = `SPL-TEST-${TS}`;
const res = []; const ok = (area, t, p, a = '') => { res.push({ area, t, p: !!p }); console.log(`${p ? '✔' : '✘'} [${area}] ${t} — ${a}`); };
const TAMIL = 'எங்க தெருவுல ரெண்டு நாளா street light எரியல';

const browser = await chromium.launch({ executablePath: opt.chromium ?? '/opt/pw-browsers/chromium' });
const fakeSpeech = () => {
  window.__sr = { langs: [], active: null };
  class FakeSR {
    constructor() { this.lang = ''; }
    start() { window.__sr.langs.push(this.lang); window.__sr.active = this; }
    stop() { const r = this; window.__sr.active = null; setTimeout(() => r.onend?.(), 0); }
    abort() { this.stop(); }
    say(text) { const alt = [{ transcript: text }]; alt.isFinal = true; this.onresult?.({ resultIndex: 0, results: [alt] }); }
  }
  window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR;
};

async function run(phone) {
  const area = phone ? 'phone' : 'desktop';
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(fakeSpeech);
  // A new TEST citizen who prefers Tamil
  const pin = await (await ctx.request.get(`${B}/api/locations/pincode/638051`)).json();
  const lb = pin.localBodies.find((l) => l.name_en === 'Chennimalai');
  const w = (await (await ctx.request.get(`${B}/api/locations?type=wards&parent=${lb.id}`)).json()).items[0];
  const reg = await ctx.request.post(`${B}/api/auth/register`, { data: { fullName: `${TAG} ${area} TEST Citizen`, dob: '1990-01-01', mobile: `64${TS}${phone ? '11' : '22'}`.slice(0, 10), pincode: '638051', districtId: lb.district_id, localBodyId: lb.id, wardId: w.id, address: 'Test', password: `Spl${TS}pass!x`, consent: true, lang: 'ta' } });
  if (reg.status() !== 200) throw new Error(`register ${reg.status()}`);
  await ctx.addCookies([{ name: 'nu_lang', value: 'ta', url: B }]);
  const p = await ctx.newPage();
  await p.goto(`${B}/report`, { waitUntil: 'networkidle' });
  await p.evaluate(() => { window.__sameDocument = true; });
  const switcher = p.locator('[role=group]').filter({ has: p.locator('button[lang=ta]') }).filter({ visible: true }).first();
  const mic = p.getByRole('button', { name: /^(Speak|பேசுங்கள்|Stop|நிறுத்து)/ }).first();
  const indicator = p.getByTestId('speech-indicator');
  const textarea = p.locator('textarea').first();
  const state = async () => ({ body: await p.evaluate(() => document.body.innerText), ph: await textarea.getAttribute('placeholder'), ind: (await indicator.innerText()).trim(), sl: await indicator.getAttribute('data-speech-lang') });

  // 1. Tamil selected at the top → whole page Tamil, speech Tamil
  let s = await state();
  ok(area, 'Tamil at the top → page in Tamil (greeting, intro, button labels)', s.body.includes('வணக்கம்') && s.body.includes('பேசுங்கள்') && !s.body.includes('What problem are you facing'), 'checked');
  ok(area, 'Tamil placeholder "உங்கள் பிரச்சனையை சொல்லுங்கள்..."', s.ph === 'உங்கள் பிரச்சனையை சொல்லுங்கள்...', s.ph);
  ok(area, 'indicator "🎙️ பேசுங்கள்", speech language ta-IN', s.ind === '🎙️ பேசுங்கள்' && s.sl === 'ta-IN', `${s.ind} · ${s.sl}`);
  // 6. no second language selector in the voice section (or anywhere on the page)
  const card = p.locator('.card').filter({ has: indicator });
  const cardText = await card.innerText();
  ok(area, 'voice section has no language buttons (தமிழ் / English / Speech language)', !/Speech language|பேச்சு மொழி/.test(cardText) && (await card.getByRole('button', { name: /^(தமிழ்|English)$/ }).count()) === 0, 'checked');
  ok(area, 'only one language selector on the page (the top E / த switcher)', (await p.locator('[role=group]').filter({ has: p.locator('button[lang=ta]') }).filter({ visible: true }).count()) === 1, 'checked');

  // 2. Speak → recognition starts with ta-IN
  await mic.click();
  ok(area, 'Speak → SpeechRecognition started with ta-IN', (await p.evaluate(() => window.__sr.langs.at(-1))) === 'ta-IN', await p.evaluate(() => window.__sr.langs.join(',')));
  await mic.click(); await p.waitForTimeout(300); // stop without speaking: nothing is sent

  // 4. Switch to English at the top → page English, speech English, without a reload
  await switcher.locator('button[lang=en]').click();
  await p.waitForFunction(() => document.body.innerText.includes('What problem are you facing'), null, { timeout: 8000 }).catch(() => {});
  s = await state();
  ok(area, 'E at the top → page in English, same page (no reload)', s.body.includes('What problem are you facing') && !s.body.includes('வணக்கம்') && (await p.evaluate(() => window.__sameDocument === true)), 'checked');
  ok(area, 'English placeholder "Describe your problem..."', s.ph === 'Describe your problem...', s.ph);
  ok(area, 'indicator "🎙️ Speak", speech language en-IN', s.ind === '🎙️ Speak' && s.sl === 'en-IN', `${s.ind} · ${s.sl}`);
  // 5. Speak → en-IN
  await mic.click();
  ok(area, 'Speak → SpeechRecognition started with en-IN', (await p.evaluate(() => window.__sr.langs.at(-1))) === 'en-IN', await p.evaluate(() => window.__sr.langs.join(',')));

  // Switching language while listening stops that recognition and drops the half-spoken words
  await p.evaluate(() => window.__sr.active?.say('half spoken english'));
  await switcher.locator('button[lang=ta]').click();
  await p.waitForFunction(() => document.body.innerText.includes('வணக்கம்'), null, { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(500);
  s = await state();
  ok(area, 'switching to த while listening stops recognition; nothing half-spoken is submitted', !(await p.evaluate(() => !!window.__sr.active)) && !s.body.includes('half spoken english') && s.sl === 'ta-IN', `${s.sl}`);

  // 3. Speak Tamil / Tanglish → recognised text captured and sent for understanding
  await mic.click();
  const langNow = await p.evaluate(() => window.__sr.langs.at(-1));
  await p.evaluate((txt) => window.__sr.active?.say(txt), TAMIL);
  await mic.click();
  await p.waitForFunction((txt) => document.body.innerText.includes(`🎙️ ${txt}`), TAMIL, { timeout: 8000 }).catch(() => {});
  const bodyNow = await p.evaluate(() => document.body.innerText); // the page has moved on to the confirm step
  ok(area, 'Tamil / Tanglish speech (ta-IN) captured into the conversation', langNow === 'ta-IN' && bodyNow.includes(`🎙️ ${TAMIL}`), langNow);
  await p.waitForFunction(() => /புரிந்தது|சரியா|Street|தெருவிளக்கு/.test(document.body.innerText), null, { timeout: 10000 }).catch(() => {});
  ok(area, 'captured speech goes through the unchanged understanding step', /தெருவிளக்கு|Street light/i.test(await p.evaluate(() => document.body.innerText)), 'checked');
  if (phone) ok(area, 'no horizontal scroll at 390px', (await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1, 'checked');
  if (opt.shots) {
    const q = await ctx.newPage(); await q.goto(`${B}/report`, { waitUntil: 'networkidle' });
    await q.screenshot({ path: `${opt.shots}/report-${area}-ta.png` });
    await q.locator('[role=group] button[lang=en]').filter({ visible: true }).first().click();
    await q.waitForFunction(() => document.body.innerText.includes('What problem are you facing'), null, { timeout: 8000 }).catch(() => {});
    await q.mouse.move(5, 600); await q.waitForTimeout(600);
    await q.screenshot({ path: `${opt.shots}/report-${area}-en.png` });
  }
  await ctx.close();
}

await run(false);
await run(true);
await browser.close();
const passed = res.filter((x) => x.p).length;
console.log(`\n${passed}/${res.length} passed · ${TAG}`);
if (passed !== res.length) process.exitCode = 1;
