const XLSX = require('xlsx');
const wb = XLSX.readFile('../Gf_B1_ItemBank_v2.xlsx');
const ws = wb.Sheets['Gf_B1_Items'];
const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

// Row 1 is the real header
const headers = data[1];
console.log('COLUMNS:', headers.join(' | '));
console.log('\n--- Sample rows (rows 3-10) ---');
for (let i = 2; i <= 10 && i < data.length; i++) {
  const row = data[i];
  if (!row || !row[0] || String(row[0]).startsWith('▸')) continue;
  const obj = {};
  headers.forEach((h, idx) => { if (row[idx] !== undefined) obj[h] = row[idx]; });
  console.log('\nRow', i, JSON.stringify(obj, null, 2));
}
