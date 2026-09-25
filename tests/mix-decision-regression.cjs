// M3 golden test for the MIX decision layer (src/decision/mix-decision.js):
// getMixRulesForPreset() and decideChain() must return exactly the recorded
// rules and processing chains for recorded analysis results.
//
//   node tests/mix-decision-regression.cjs           verify in Node (no browser)
//   node tests/mix-decision-regression.cjs --record  re-record the fixture from
//     the app in Chromium (needs the local server on port 8765)
//
// Re-record only when a decision change is intended.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const fixturePath = path.join(__dirname, 'fixtures', 'mix-decision.json');
const baseUrl = process.env.VM_SMOKE_BASE_URL || 'http://127.0.0.1:8765/';

const INPUTS = {
  baseline: {},
  buriedSibilant: { vocalGain: 0.3, sibilance: 0.4, hiss: 0.004, instGain: 1.8 },
  boxyForward: { vocalGain: 1.8, boxiness: 0.08, instGain: 0.4 },
  clipped: { vocalGain: 3.2 }
};

// Arguments of getMixRulesForPreset(preset, distance, air, sectionBalance,
// breath, ducking, multiband, parallel, recordingSource, reverbAuto,
// thickenDelay, reverbTailGate, clipRepair).
function rulesCases() {
  const base = ['natural', 'natural', false, false, false, false, false, false, false, true, false, false, false];
  const cases = [base];
  for (const p of ['tight', 'ballad', 'rock', 'wide']) cases.push([p, ...base.slice(1)]);
  for (const d of ['veryClose', 'close', 'far']) cases.push([base[0], d, ...base.slice(2)]);
  for (let i = 2; i < base.length; i++) {
    const c = base.slice(); c[i] = !c[i]; cases.push(c);
  }
  cases.push(['rock', 'veryClose', true, true, true, true, true, true, true, true, true, true, true]);
  cases.push(['ballad', 'far', true, false, true, false, true, false, true, false, true, false, true]);
  return cases;
}

// JSON with typed arrays and non-finite numbers preserved.
const ENCODE = `(function encode(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : { __num: String(v) };
  if (v == null || typeof v !== 'object') return v;
  if (ArrayBuffer.isView(v)) return { __typed: v.constructor.name, data: Array.from(v, encode) };
  if (Array.isArray(v)) return v.map(encode);
  const out = {};
  for (const k of Object.keys(v)) if (v[k] !== undefined && typeof v[k] !== 'function') out[k] = encode(v[k]);
  return out;
})`;
const encode = eval(ENCODE);
function decode(v) {
  if (v == null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(decode);
  if (v.__num) return Number(v.__num);
  if (v.__typed) return new globalThis[v.__typed](v.data.map(decode));
  const out = {};
  for (const k of Object.keys(v)) out[k] = decode(v[k]);
  return out;
}

async function record() {
  let playwright;
  try { playwright = require('playwright'); }
  catch (_) { playwright = require(path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'playwright')); }
  const { syntheticInputs } = require('./baseline-metrics.cjs');
  const browser = await playwright.chromium.launch({ headless: true });
  const fixture = { recordedWith: `chromium ${browser.version()}`, inputs: {} };
  try {
    for (const [name, opts] of Object.entries(INPUTS)) {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('dialog', d => d.accept());
      await page.goto(baseUrl);
      await page.waitForFunction(async () => {
        document.querySelector('.tab-btn[data-screen="upload"]')?.click();
        await new Promise(r => setTimeout(r, 100));
        return document.body.dataset.screen === 'upload';
      }, null, { timeout: 30000, polling: 250 });
      const inputs = syntheticInputs(44100, 12, opts);
      await page.locator('#fileVocal').setInputFiles({ name: 'vocal.wav', mimeType: 'audio/wav', buffer: inputs.vocal });
      await page.locator('#fileInst').setInputFiles({ name: 'inst.wav', mimeType: 'audio/wav', buffer: inputs.inst });
      await page.waitForFunction(() => !document.querySelector('#btnAnalyze').disabled, null, { timeout: 60000 });
      await page.locator('#btnAnalyze').click();
      await page.waitForFunction(() => document.body.dataset.screen === 'analysis' && !state.isAnalyzing && state.rel, null, { timeout: 180000 });
      const captured = await page.evaluate(`(() => {
        const encode = ${ENCODE};
        const cases = ${JSON.stringify(rulesCases())};
        return {
          analysis: encode(state.vocalAnalysis),
          rel: encode(state.rel),
          cases: cases.map(args => {
            const rules = getMixRulesForPreset(...args);
            const chain = decideChain(structuredClone(state.vocalAnalysis), structuredClone(state.rel), rules);
            return { args, rules: encode(rules), chain: encode(chain) };
          })
        };
      })()`);
      assert.deepEqual(errors, [], `page errors while recording ${name}`);
      fixture.inputs[name] = { opts, ...captured };
      console.log('recorded', name, 'chain lengths', captured.cases.map(c => c.chain.length).join(','));
      await context.close();
    }
  } finally { await browser.close(); }
  fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
  fs.writeFileSync(fixturePath, JSON.stringify(fixture) + '\n');
  console.log('wrote', path.relative(root, fixturePath));
}

function verify() {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const source = fs.readFileSync(path.join(root, 'src', 'decision', 'mix-decision.js'), 'utf8');
  const context = { structuredClone };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.api = { getMixRulesForPreset, decideChain };`, context);
  const { getMixRulesForPreset, decideChain } = context.api;
  let checked = 0;
  const distinct = new Set();
  for (const [name, input] of Object.entries(fixture.inputs)) {
    for (const c of input.cases) {
      const label = `${name} ${c.args.slice(0, 2).join('/')} ${c.args.slice(2).map(Number).join('')}`;
      const rules = getMixRulesForPreset(...c.args);
      // Compare via JSON so results from the vm realm and the fixture use the
      // same object shapes.
      assert.deepEqual(JSON.parse(JSON.stringify(encode(rules))), c.rules, `rules differ: ${label}`);
      const chain = decideChain(decode(input.analysis), decode(input.rel), rules);
      assert.deepEqual(JSON.parse(JSON.stringify(encode(chain))), c.chain, `chain differs: ${label}`);
      distinct.add(JSON.stringify(c.chain.map(s => s.name)));
      checked++;
    }
  }
  assert.ok(distinct.size > 3, 'fixture covers too few distinct chains');
  console.log(`MIX decision regression PASS (${checked} cases, ${Object.keys(fixture.inputs).length} inputs, ${distinct.size} distinct chains)`);
}

if (process.argv.includes('--record')) record().catch(e => { console.error(e); process.exitCode = 1; });
else try { verify(); } catch (e) { console.error(e); process.exitCode = 1; }
