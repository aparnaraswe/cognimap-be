const XLSX = require('xlsx');
const path = require('path');

const BASE = path.join(__dirname, '../../');
const wb = XLSX.readFile(path.join(BASE, 'Gf_B1_ItemBank_v3_tokenized.xlsx'));
const ws = wb.Sheets[wb.SheetNames[0]];
const raw = XLSX.utils.sheet_to_json(ws, { header: 1 });

// Find header row
let hIdx = -1;
for (let i = 0; i < Math.min(5, raw.length); i++) {
  if (raw[i] && raw[i].some(c => c && String(c).toLowerCase().replace(/\s/g,'').includes('itemid'))) { hIdx = i; break; }
}
const headers = raw[hIdx];
const cols = ['Stimulus Row 1','Stimulus Row 2','Option A','Option B','Option C'];
const colIdx = cols.map(n => ({ n, i: headers.indexOf(n) })).filter(x => x.i !== -1);

// Print ALL data rows
let count = 0;
for (let i = hIdx + 1; i < raw.length; i++) {
  const row = raw[i];
  if (!row || !row[0] || String(row[0]).startsWith('▸') || String(row[0]).startsWith('CogniMap')) continue;
  const obj = { itemId: row[0] };
  colIdx.forEach(({ n, i: ci }) => { if (row[ci] !== undefined && row[ci] !== '') obj[n] = row[ci]; });
  // Flag any remaining bracket tokens
  const vals = Object.values(obj).join(' ');
  const hasBracket = vals.includes('[');
  console.log((hasBracket ? '⚠ ' : '✓ ') + JSON.stringify(obj));
  count++;
}
console.log('\nTotal items:', count);
