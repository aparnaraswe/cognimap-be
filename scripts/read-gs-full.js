const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const BASE = path.join(__dirname, '../../');
const files = fs.readdirSync(BASE).filter(f => f.startsWith('Gs_') && f.endsWith('.xlsx') && !f.startsWith('~'));
console.log('Files:', files);

const wb = XLSX.readFile(path.join(BASE, files[0]));
const ws = wb.Sheets[wb.SheetNames[0]];
const raw = XLSX.utils.sheet_to_json(ws, { header: 1 });

let hIdx = -1;
for (let i = 0; i < 5; i++) {
  if (raw[i] && raw[i].some(c => c && String(c).toLowerCase().replace(/\s/g,'').includes('itemid'))) { hIdx = i; break; }
}
const headers = raw[hIdx];
console.log('Headers:', JSON.stringify(headers));
console.log('\n--- ALL ROWS ---');
for (let i = hIdx + 1; i < raw.length; i++) {
  const row = raw[i];
  if (!row || !row[0]) continue;
  const obj = {};
  headers.forEach((h, ci) => { if (row[ci] !== undefined && row[ci] !== '') obj[h] = row[ci]; });
  if (Object.keys(obj).length > 1) console.log(JSON.stringify(obj));
}
