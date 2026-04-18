const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const BASE = path.join(__dirname, '../../');
const files = fs.readdirSync(BASE).filter(f => 
  (f.startsWith('Gs_') || f.startsWith('Gv_')) && f.endsWith('.xlsx') && !f.startsWith('~')
);

console.log('Files:', files);

for (const fname of files) {
  console.log('\n\n========== ' + fname + ' ==========');
  const wb = XLSX.readFile(path.join(BASE, fname));
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1 });

  // Find header row
  let hIdx = -1;
  for (let i = 0; i < Math.min(5, raw.length); i++) {
    if (raw[i] && raw[i].some(c => c && String(c).toLowerCase().replace(/\s/g,'').includes('itemid'))) { hIdx = i; break; }
  }
  if (hIdx === -1) { console.log('No header row found'); continue; }

  const headers = raw[hIdx];
  console.log('All columns:', headers.filter(Boolean).join(' | '));

  const cols = ['Stimulus Row 1','Stimulus Row 2','Option A','Option B','Option C','Template','Display','Format'];
  const colIdx = cols.map(n => ({ n, i: headers.indexOf(n) })).filter(x => x.i !== -1);

  let count = 0;
  for (let i = hIdx + 1; i < raw.length && count < 8; i++) {
    const row = raw[i];
    if (!row || !row[0] || String(row[0]).startsWith('▸') || String(row[0]).startsWith('CogniMap')) continue;
    const obj = { itemId: row[0] };
    colIdx.forEach(({ n, i: ci }) => { if (row[ci] !== undefined && row[ci] !== '') obj[n] = row[ci]; });
    console.log(JSON.stringify(obj));
    count++;
  }
}
