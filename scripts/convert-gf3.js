const XLSX = require('xlsx');
const path = require('path');

const BASE = path.join(__dirname, '../../');
const inFile = path.join(BASE, 'Gf_B1_ItemBank_v3.xlsx');
const outFile = path.join(BASE, 'Gf_B1_ItemBank_v3_tokenized.xlsx');

// Size mapping
const SIZE_MAP = {
  'tiny': 'xs', 'extra small': 'xs', 'xs': 'xs',
  'small': 'sm', 'sm': 'sm',
  'medium': 'md', 'med': 'md', 'md': 'md',
  'large': 'lg', 'lg': 'lg',
  'xl': 'xl', 'extra large': 'xl', 'huge': 'xl', 'big': 'lg',
};

const SHAPE_MAP = {
  'circle': 'circle', 'circles': 'circle',
  'square': 'square', 'squares': 'square',
  'triangle': 'triangle', 'triangles': 'triangle',
  'star': 'star', 'stars': 'star',
  'diamond': 'diamond', 'diamonds': 'diamond',
  'hexagon': 'hexagon', 'pentagon': 'pentagon',
  'arrow': 'arrow', 'octagon': 'octagon',
  'cross': 'cross', 'heart': 'heart',
  'oval': 'oval', 'rectangle': 'rectangle',
  'crescent': 'crescent', 'dot': 'dot',
};

const COLOR_MAP = {
  'red': 'red', 'blue': 'blue', 'green': 'green', 'yellow': 'yellow',
  'purple': 'purple', 'orange': 'orange', 'cyan': 'cyan',
  'black': 'black', 'white': 'white', 'dark': 'dark',
};

const FILL_MAP = {
  'filled': 'filled', 'solid': 'filled', 'shaded': 'filled',
  'hollow': 'hollow', 'empty': 'hollow', 'outline': 'hollow', 'open': 'hollow',
};

function descToToken(desc) {
  if (!desc) return desc;
  // Strip parenthetical notes
  desc = desc.replace(/\s*\([^)]*\)/g, '').trim();
  if (desc === '?') return '?';

  const lower = desc.toLowerCase().trim();
  // Already a token (no spaces) — leave as-is
  if (!lower.includes(' ')) return desc;

  let size = 'md';
  let shape = null;
  let color = null;
  let fill = null;

  // Check two-word size phrases first
  for (const [phrase, sz] of Object.entries(SIZE_MAP)) {
    if (phrase.includes(' ') && lower.includes(phrase)) { size = sz; break; }
  }

  const words = lower.split(/\s+/);
  for (const word of words) {
    if (SIZE_MAP[word] && !word.includes(' ')) size = SIZE_MAP[word];
    else if (SHAPE_MAP[word]) shape = SHAPE_MAP[word];
    else if (COLOR_MAP[word]) color = COLOR_MAP[word];
    else if (FILL_MAP[word]) fill = FILL_MAP[word];
  }

  if (!shape) return desc; // Can't convert

  const parts = [];
  if (color) parts.push(color);
  parts.push(shape);
  parts.push(size);
  if (fill) parts.push(fill);
  return parts.join('_');
}

function convertCell(val) {
  if (!val || typeof val !== 'string') return val;
  if (!val.includes('[')) return val;
  return val.replace(/\[([^\]]+)\]/g, (_, inner) => descToToken(inner.trim()));
}

const wb = XLSX.readFile(inFile);
let total = 0;

for (const sheetName of wb.SheetNames) {
  const lower = sheetName.toLowerCase();
  if (lower.includes('summary') || lower.includes('metadata') || lower.includes('legend') || lower.includes('distribution')) continue;

  const ws = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1 });

  // Find header row
  let hIdx = -1;
  for (let i = 0; i < Math.min(5, raw.length); i++) {
    if (raw[i] && raw[i].some(c => c && String(c).toLowerCase().replace(/\s/g,'').includes('itemid'))) { hIdx = i; break; }
  }
  if (hIdx === -1) continue;

  const headers = raw[hIdx];
  const TOKEN_COLS = ['Stimulus Row 1', 'Stimulus Row 2', 'Option A', 'Option B', 'Option C'];
  const colIndices = TOKEN_COLS.map(name => headers.indexOf(name)).filter(i => i !== -1);

  for (let rowIdx = hIdx + 1; rowIdx < raw.length; rowIdx++) {
    const row = raw[rowIdx];
    if (!row) continue;
    for (const colIdx of colIndices) {
      const original = row[colIdx];
      if (!original || typeof original !== 'string' || !original.includes('[')) continue;
      const converted = convertCell(original);
      if (converted !== original) {
        const cellAddr = XLSX.utils.encode_cell({ r: rowIdx, c: colIdx });
        if (ws[cellAddr]) { ws[cellAddr].v = converted; ws[cellAddr].w = converted; }
        else ws[cellAddr] = { t: 's', v: converted, w: converted };
        total++;
      }
    }
  }
}

XLSX.writeFile(wb, outFile);
console.log('Converted', total, 'cells');
console.log('Output:', outFile);

// Verify — print first 10 data rows
console.log('\n--- Sample output ---');
const ws2 = wb.Sheets[wb.SheetNames[0]];
const raw2 = XLSX.utils.sheet_to_json(ws2, { header: 1 });
let hIdx2 = -1;
for (let i = 0; i < 5; i++) {
  if (raw2[i] && raw2[i].some(c => c && String(c).toLowerCase().replace(/\s/g,'').includes('itemid'))) { hIdx2 = i; break; }
}
const headers2 = raw2[hIdx2];
const cols2 = ['Stimulus Row 1','Stimulus Row 2','Option A','Option B','Option C'].map(n => ({ n, i: headers2.indexOf(n) })).filter(x => x.i !== -1);
let shown = 0;
for (let i = hIdx2 + 1; i < raw2.length && shown < 10; i++) {
  const row = raw2[i];
  if (!row || !row[0] || String(row[0]).startsWith('▸')) continue;
  const obj = { itemId: row[0] };
  cols2.forEach(({ n, i: ci }) => { if (row[ci]) obj[n] = row[ci]; });
  const hasBracket = Object.values(obj).join(' ').includes('[');
  console.log((hasBracket ? '⚠ STILL HAS BRACKETS: ' : '✓ ') + JSON.stringify(obj));
  shown++;
}
