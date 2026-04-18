const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const BASE = path.resolve(__dirname, '../../');
console.log('BASE:', BASE);

const inFile = path.join(BASE, 'Gs_B1_ItemBank_v1_tokens.xlsx');
console.log('inFile:', inFile);
console.log('exists:', fs.existsSync(inFile));

const outFile = path.join(BASE, 'Gs_B1_test_out.xlsx');
console.log('outFile:', outFile);

try {
  const wb = XLSX.readFile(inFile);
  console.log('Read OK, sheets:', wb.SheetNames);
  XLSX.writeFile(wb, outFile);
  console.log('Write OK');
} catch(e) {
  console.error('ERROR:', e.message);
}
