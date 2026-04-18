const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const BASE = path.join(__dirname, '../../');
const files = fs.readdirSync(BASE).filter(f => f.endsWith('.xlsx') || f.endsWith('.xls'));

// For each non-updated file, show option/stimulus columns of first few data rows
for (const fname of files) {
  if (fname.toLowerCase().includes('updated')) continue;
  console.log('\n\n========== FILE:', fname, '==========');
  const wb = XLSX.readFile(path.join(BASE, fname));
  for (const sheetName of wb.SheetNames) {
    const lower = sheetName.toLowerCase();
    if (lower.includes('summary') || lower.includes('metadata') || lower.includes('legend') || lower.includes('distribution')) continue;
    const ws = wb.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1 });
    // Find header row (row with 'Item ID' or 'itemId')
    let hIdx = -1;
    for (let i = 0; i < Math.min(5, raw.length); i++) {
      if (raw[i] && raw[i].some(c => c && String(c).toLowerCase().replace(/\s/g,'').includes('itemid'))) { hIdx = i; break; }
    }
    if (hIdx === -1) { console.log('Sheet:', sheetName, '— no header row found, raw[0]:', JSON.stringify(raw[0])); continue; }
    const headers = raw[hIdx];
    // Find stimulus/option/sequence columns
    const cols = headers.map((h, i) => ({ h: String(h||''), i })).filter(x =>
      x.h.toLowerCase().includes('option') || x.h.toLowerCase().includes('stimulus') ||
      x.h.toLowerCase().includes('sequence') || x.h.toLowerCase().includes('correct')
    );
    console.log('Sheet:', sheetName, '| Cols:', cols.map(c => c.h).join(' | '));
    // Print first 4 data rows
    let count = 0;
    for (let i = hIdx + 1; i < raw.length && count < 4; i++) {
      const row = raw[i];
      if (!row || !row[0] || String(row[0]).startsWith('▸') || String(row[0]).startsWith('CogniMap')) continue;
      const obj = { itemId: row[0] };
      cols.forEach(({ h, i: ci }) => { if (row[ci] !== undefined && row[ci] !== '') obj[h] = row[ci]; });
      console.log(' ', JSON.stringify(obj));
      count++;
    }
  }
}
