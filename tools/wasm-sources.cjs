// Keeps wasm-src/*.wat in sync with the WebAssembly modules embedded in
// index.html as base64 constants.
//
//   node tools/wasm-sources.cjs            verify (exit 1 on mismatch)
//   node tools/wasm-sources.cjs --extract  regenerate wasm-src/*.wat
//   node tools/wasm-sources.cjs --build    print base64 assembled from the WAT
//
// The embedded binaries were compiled from C with clang 17; that C source is
// not in the repository. Each WAT file is the disassembly of one module and
// assembles back to the same bytes for every non-custom section. Custom
// sections (name, producers, target_features) do not affect execution and are
// not part of the comparison.
//
// Requires the wabt package (npm install).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'wasm-src');
const MODULES = {
  VM_WASM_DSP_BASE64: 'dsp.wat',
  VM_CLIPSTATS_WASM_BASE64: 'clipstats.wat',
  VM_ANALYSIS_STATS_WASM_BASE64: 'analysis-stats.wat',
  VM_SAMPLE_PEAK_WASM_BASE64: 'sample-peak.wat',
  VM_LUFS_WASM_BASE64: 'lufs.wat',
  VM_HQ_RESAMPLER_WASM_BASE64: 'hq-resampler.wat',
  VM_TRUE_PEAK_WASM_BASE64: 'true-peak.wat'
};

function embeddedModules() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const found = {};
  for (const m of html.matchAll(/const (VM_[A-Z0-9_]*WASM[A-Z0-9_]*BASE64)\s*=\s*'([A-Za-z0-9+/=]+)'/g)) {
    found[m[1]] = new Uint8Array(Buffer.from(m[2], 'base64'));
  }
  return found;
}

function readLeb(bytes, offset) {
  let value = 0, shift = 0, byte;
  do { byte = bytes[offset++]; value |= (byte & 127) << shift; shift += 7; } while (byte & 128);
  return [value >>> 0, offset];
}

function sections(bytes) {
  const out = [];
  let offset = 8;
  while (offset < bytes.length) {
    const start = offset, id = bytes[offset++];
    let length;
    [length, offset] = readLeb(bytes, offset);
    offset += length;
    out.push({ id, bytes: bytes.subarray(start, offset) });
  }
  return out;
}

// Header plus non-custom sections, i.e. everything that affects execution.
function coreBytes(bytes) {
  const parts = [bytes.subarray(0, 8), ...sections(bytes).filter(s => s.id !== 0).map(s => s.bytes)];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}

function header(name, bytes) {
  return `;; ${name} (embedded in index.html)\n` +
    `;; Disassembled by tools/wasm-sources.cjs --extract. Original C source is not in the repository.\n` +
    `;; Embedded module: ${bytes.length} bytes; executable sections: ${coreBytes(bytes).length} bytes.\n`;
}

(async () => {
  const wabt = await require('wabt')();
  const embedded = embeddedModules();
  const mode = process.argv[2] || '--verify';
  let failed = false;

  const missing = Object.keys(MODULES).filter(k => !embedded[k]);
  const unknown = Object.keys(embedded).filter(k => !MODULES[k]);
  if (missing.length || unknown.length) {
    console.error('Module list out of date. Missing:', missing.join(', ') || '-', 'Unknown:', unknown.join(', ') || '-');
    process.exit(1);
  }

  for (const [name, file] of Object.entries(MODULES)) {
    const bytes = embedded[name];
    const watPath = path.join(srcDir, file);
    if (mode === '--extract') {
      // wabt reads the whole backing ArrayBuffer of a view, so pass a copy.
      const mod = wabt.readWasm(coreBytes(bytes).slice(), { readDebugNames: false });
      // Recover function names from the name section for readability.
      const named = wabt.readWasm(bytes.slice(), { readDebugNames: true });
      named.generateNames(); named.applyNames();
      mod.destroy();
      const text = named.toText({ foldExprs: true, inlineExport: false });
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(watPath, header(name, bytes) + text);
      console.log('wrote', path.relative(root, watPath));
      continue;
    }
    const text = fs.readFileSync(watPath, 'utf8');
    const parsed = wabt.parseWat(file, text, {});
    parsed.validate();
    const built = parsed.toBinary({}).buffer;
    if (mode === '--build') {
      console.log(name, Buffer.from(built).toString('base64'));
      continue;
    }
    const expected = coreBytes(bytes);
    const same = built.length === expected.length && built.every((b, i) => b === expected[i]);
    console.log(`${same ? 'OK  ' : 'DIFF'} ${file} (${expected.length} bytes) = ${name}`);
    if (!same) failed = true;
  }
  if (failed) {
    console.error('wasm-src/*.wat does not match the modules embedded in index.html');
    process.exitCode = 1;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
