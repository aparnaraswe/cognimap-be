const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const BASE = path.join(__dirname, '../../');
const files = fs.readdirSync(BASE).filter(f => f.startsWith('Gv_') && f.endsWith('.xlsx') && !f.startsWith('~'));
console.log('Gv files:', files);

const wb = XLSX.readFile(path.join(BASE, files[0]));
const ws = wb.Sheets[wb.SheetNames[0]];
const raw = XLSX.utils.sheet_to_json(ws, { header: 1 });

let hIdx = -1;
for (let i = 0; i < 5; i++) {
  if (raw[i] && raw[i].some(c => c && String(c).toLowerCase().replace(/\s/g,'').includes('itemid'))) { hIdx = i; break; }
}
const headers = raw[hIdx];
const cols = ['Stimulus Row 1','Stimulus Row 2','Option A','Option B','Option C','Template','Prompt Text'];
const colIdx = cols.map(n => ({ n, i: headers.indexOf(n) })).filter(x => x.i !== -1);

// Collect ALL unique token-like values
const allTokens = new Set();
const BUILT_IN = ['triangle','circle','square','star','diamond','hexagon','pentagon','arrow','octagon','cross','dot','heart','oval','rectangle','crescent'];

console.log('\n--- ALL ITEMS ---');
for (let i = hIdx + 1; i < raw.length; i++) {
  const row = raw[i];
  if (!row || !row[0] || String(row[0]).startsWith('▸') || String(row[0]).startsWith('CogniMap')) continue;
  const obj = { itemId: row[0] };
  colIdx.forEach(({ n, i: ci }) => { if (row[ci] !== undefined && row[ci] !== '') obj[n] = row[ci]; });
  console.log(JSON.stringify(obj));

  // Extract all values from stimulus/option cols and check if they're tokens or text
  ['Stimulus Row 1','Stimulus Row 2','Option A','Option B','Option C'].forEach(col => {
    const val = obj[col];
    if (!val) return;
    // Split by →, |, ::, :
    val.split(/\s*(?:→|->|\||::|:)\s*/).forEach(part => {
      const t = part.trim().replace(/\s*\([^)]*\)/g,'').trim();
      if (!t || t === '?' || t.length > 60) return;
      allTokens.add(t);
    });
  });
}

console.log('\n--- UNIQUE TOKEN VALUES ---');
for (const t of [...allTokens].sort()) {
  const isBuiltIn = BUILT_IN.some(s => t.toLowerCase().includes(s));
  const isImg = t.startsWith('img_');
  const isPos = t.startsWith('pos_');
  const isText = t.includes(' ') || t.length > 40;
  const status = isImg ? 'img_token' : isPos ? 'pos_token' : isBuiltIn ? 'shape_token_ok' : isText ? 'PLAIN_TEXT' : 'UNKNOWN_TOKEN';
  console.log(`  [${status}] ${t}`);
}
