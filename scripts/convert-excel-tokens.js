/**
 * convert-excel-tokens.js
 * Converts [human-readable shape descriptions] in Excel files to token format
 * that TokenRenderer understands (e.g. [large circle] -> circle_lg)
 * 
 * Only modifies: Stimulus Row 1, Stimulus Row 2, Option A, Option B, Option C
 * Does NOT touch: domain, IRT params, difficulty, etc.
 * 
 * Run: node scripts/convert-excel-tokens.js
 * Output: *_tokenized.xlsx files alongside originals
 */

const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const BASE = path.join(__dirname, '../../');

// ── Size mapping ──
const SIZE_MAP = {
  'tiny': 'xs', 'extra small': 'xs', 'xs': 'xs',
  'small': 'sm', 'sm': 'sm',
  'medium': 'md', 'med': 'md', 'md': 'md',
  'large': 'lg', 'lg': 'lg',
  'xl': 'xl', 'extra large': 'xl', 'huge': 'xl', 'big': 'lg',
};

// ── Shape name normalization ──
const SHAPE_MAP = {
  'circle': 'circle', 'circles': 'circle',
  'square': 'square', 'squares': 'square',
  'triangle': 'triangle', 'triangles': 'triangle',
  'star': 'star', 'stars': 'star',
  'diamond': 'diamond', 'diamonds': 'diamond',
  'hexagon': 'hexagon', 'hexagons': 'hexagon',
  'pentagon': 'pentagon', 'pentagons': 'pentagon',
  'arrow': 'arrow', 'arrows': 'arrow',
  'octagon': 'octagon', 'octagons': 'octagon',
  'cross': 'cross', 'crosses': 'cross',
  'heart': 'heart', 'hearts': 'heart',
  'oval': 'oval', 'ovals': 'oval',
  'rectangle': 'rectangle', 'rectangles': 'rectangle',
  'crescent': 'crescent', 'crescents': 'crescent',
  'dot': 'dot', 'dots': 'dot',
};

// ── Color mapping (for colored shapes) ──
const COLOR_MAP = {
  'red': 'red', 'blue': 'blue', 'green': 'green', 'yellow': 'yellow',
  'purple': 'purple', 'orange': 'orange', 'cyan': 'cyan', 'black': 'black',
  'white': 'white', 'dark': 'dark',
};

// ── Fill/hollow mapping ──
const FILL_MAP = {
  'filled': 'filled', 'solid': 'filled', 'shaded': 'filled',
  'hollow': 'hollow', 'empty': 'hollow', 'outline': 'hollow', 'open': 'hollow',
};

/**
 * Convert a single [shape description] to a token string.
 * Examples:
 *   [large circle]        -> circle_lg
 *   [small triangle]      -> triangle_sm
 *   [filled circle]       -> circle_md_filled
 *   [hollow square]       -> square_md_hollow
 *   [filled red circle]   -> red_circle_md_filled
 *   [XL circle]           -> circle_xl
 *   [?]                   -> ?
 *   [small circle] (mirror) -> circle_sm   (strip parenthetical notes)
 */
function descToToken(desc) {
  if (!desc) return desc;
  
  // Strip parenthetical notes like "(mirror)", "(same)", "(color wrong)"
  desc = desc.replace(/\s*\([^)]*\)/g, '').trim();
  
  if (desc === '?') return '?';
  
  const lower = desc.toLowerCase().trim();
  
  // Already a token (no spaces, no brackets) — leave as-is
  if (!lower.includes(' ') && !lower.includes('[')) return desc;
  
  let size = 'md'; // default
  let shape = null;
  let color = null;
  let fill = null;
  
  const words = lower.split(/\s+/);
  
  for (const word of words) {
    if (SIZE_MAP[word]) size = SIZE_MAP[word];
    else if (SHAPE_MAP[word]) shape = SHAPE_MAP[word];
    else if (COLOR_MAP[word]) color = COLOR_MAP[word];
    else if (FILL_MAP[word]) fill = FILL_MAP[word];
    // Handle compound sizes like "extra" + "large" handled by full phrase below
  }
  
  // Handle "extra large" / "extra small" as two-word phrases
  const fullPhrase = lower;
  for (const [phrase, sz] of Object.entries(SIZE_MAP)) {
    if (phrase.includes(' ') && fullPhrase.includes(phrase)) {
      size = sz;
      break;
    }
  }
  
  if (!shape) return desc; // Can't convert — leave as-is
  
  // Build token: [color_]shape_size[_fill]
  const parts = [];
  if (color) parts.push(color);
  parts.push(shape);
  parts.push(size);
  if (fill) parts.push(fill);
  
  return parts.join('_');
}

/**
 * Convert a full cell value (may contain multiple [tokens] and arrows/pipes)
 * Examples:
 *   "[tiny circle] → [small circle] → [medium circle] → ?"
 *   -> "circle_xs → circle_sm → circle_md → ?"
 *
 *   "Row 1: [large triangle] | [small triangle]"
 *   -> "Row 1: triangle_lg | triangle_sm"
 *
 *   "[filled circle]"
 *   -> "circle_md_filled"
 */
function convertCellValue(val) {
  if (!val || typeof val !== 'string') return val;
  
  // If already in token format (no brackets), return as-is
  if (!val.includes('[')) return val;
  
  // Replace all [description] patterns
  return val.replace(/\[([^\]]+)\]/g, (match, inner) => {
    const converted = descToToken(inner.trim());
    return converted;
  });
}

/**
 * Process a single Excel file, converting token columns only.
 * Returns the modified workbook.
 */
function processFile(filePath) {
  const wb = XLSX.readFile(filePath);
  let totalConverted = 0;
  
  for (const sheetName of wb.SheetNames) {
    const lower = sheetName.toLowerCase();
    if (lower.includes('summary') || lower.includes('metadata') || lower.includes('legend') || lower.includes('distribution')) continue;
    
    const ws = wb.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1 });
    
    // Find header row
    let hIdx = -1;
    for (let i = 0; i < Math.min(5, raw.length); i++) {
      if (raw[i] && raw[i].some(c => c && String(c).toLowerCase().replace(/\s/g, '').includes('itemid'))) {
        hIdx = i; break;
      }
    }
    if (hIdx === -1) continue;
    
    const headers = raw[hIdx];
    
    // Find columns to convert
    const TOKEN_COLS = ['Stimulus Row 1', 'Stimulus Row 2', 'Option A', 'Option B', 'Option C'];
    const colIndices = TOKEN_COLS.map(name => headers.indexOf(name)).filter(i => i !== -1);
    
    if (colIndices.length === 0) continue;
    
    // Convert each data row
    for (let rowIdx = hIdx + 1; rowIdx < raw.length; rowIdx++) {
      const row = raw[rowIdx];
      if (!row) continue;
      
      for (const colIdx of colIndices) {
        const original = row[colIdx];
        if (!original || typeof original !== 'string') continue;
        if (!original.includes('[')) continue; // Already clean
        
        const converted = convertCellValue(original);
        if (converted !== original) {
          // Update the cell in the worksheet
          const cellAddr = XLSX.utils.encode_cell({ r: rowIdx, c: colIdx });
          if (ws[cellAddr]) {
            ws[cellAddr].v = converted;
            ws[cellAddr].w = converted; // formatted value
          } else {
            ws[cellAddr] = { t: 's', v: converted, w: converted };
          }
          totalConverted++;
        }
      }
    }
  }
  
  return { wb, totalConverted };
}

// ── Main ──
const files = fs.readdirSync(BASE).filter(f => (f.endsWith('.xlsx') || f.endsWith('.xls')) && !f.toLowerCase().includes('updated') && !f.startsWith('~'));

console.log('Files to process:', files);
console.log('');

for (const fname of files) {
  const inPath = path.join(BASE, fname);
  const outName = fname.replace(/\.xlsx?$/, '_tokenized.xlsx');
  const outPath = path.join(BASE, outName);
  
  console.log(`Processing: ${fname}`);
  const { wb, totalConverted } = processFile(inPath);
  
  if (totalConverted > 0) {
    XLSX.writeFile(wb, outPath);
    console.log(`  ✓ Converted ${totalConverted} cells → ${outName}`);
  } else {
    console.log(`  — No bracket tokens found, skipping output`);
  }
}

console.log('\nDone.');
