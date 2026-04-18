const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const BASE = path.join(__dirname, '../../');
const files = fs.readdirSync(BASE).filter(f => f.endsWith('_tokenized.xlsx'));

for (const fname of files) {
  console.log('\n=== ' + fname + ' ===');
  const wb = XLSX.readFile(path.join(BASE, fname));
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1 });
  
  let hIdx = -1;
  for (let i = 0; i < Math.min(5, raw.length); i++) {
    if (raw[i] && raw[i].some(c => c && String(c).toLowerCase().replace(/\s/g,'').includes('itemid'))) { hIdx = i; break; }
  }
  if (hIdx === -1) continue;
  const headers = raw[hIdx];
  const TOKEN_COLS = ['Stimulus Row 1', 'Stimulus Row 2', 'Option A', 'Option B', 'Option C'];
  const colIndices = TOKEN_COLS.map(name => ({ name, idx: headers.indexOf(name) })).filter(x => x.idx !== -1);
  
  let count = 0;
  for (let i = hIdx + 1; i < raw.length && count < 5; i++) {
    const row = raw[i];
    if (!row || !row[0] || String(row[0]).startsWith('▸')) continue;
    const obj = { itemId: row[0] };
    colIndices.forEach(({ name, idx }) => { if (row[idx]) obj[name] = row[idx]; });
    console.log(JSON.stringify(obj));
    count++;
  }
}
