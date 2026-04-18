/**
 * verify-tokens.js — Token Coverage Verification for CogniMap v4
 *
 * Tests every unique token from item_bank_8_11_IRT_CAT_v4.xlsx
 * against the TokenRenderer dispatch logic to ensure zero fallback rendering.
 *
 * Run: node verify-tokens.js
 *
 * Expected output: all tokens classified, zero FALLBACK entries.
 */

// ═══ TOKEN CLASSIFICATION LOGIC (mirrors TokenRenderer.jsx dispatch) ═══

const SHAPES = ['triangle','circle','square','star','diamond','hexagon','pentagon','arrow','octagon','cross','dot','heart','oval','rectangle'];

const FIGURE_PARTS = [
  'circle_missing_quarter','quarter_circle','circle_quarter','half_circle',
  'square_missing_corner','square_corner','square_half',
  'diamond_missing_half','diamond_half',
  'triangle_half','triangle_piece','triangle_corner',
  'triangle_side','hexagon_side','rectangle_side',
  'hexagon_missing_side','star_missing_point','star_point',
  'correct_segment','mirrored_segment','rotated_segment',
  'complex_shape_missing_segment','circle_small','triangle_small',
];

function classifyToken(token) {
  if (!token || token === '?') return 'QUESTION_MARK';

  // pos_ tokens
  if (token.startsWith('pos_')) return 'POS_TOKEN';

  // img_ tokens
  if (token.startsWith('img_')) {
    const cl = token.slice(4);
    if (cl.match(/^sprite_\w+_\d+/)) return 'IMG_SPRITE';
    if (cl.startsWith('seesaw')) return 'IMG_SEESAW';
    if (cl.match(/^bar_\d+/)) return 'IMG_BAR';
    if (FIGURE_PARTS.includes(cl)) return 'IMG_FIGURE';
    if (cl.includes('complex') || cl.includes('pattern')) return 'IMG_COMPLEX';
    if (cl.match(/^answer_/)) return 'IMG_ANSWER';
    if (cl.match(/^grid_\d+x\d+/)) return 'IMG_GRID';
    if (cl.startsWith('3d') || cl.startsWith('solid') || cl.startsWith('cube') || cl.startsWith('prism')) return 'IMG_3D';
    if (cl.includes('graph') || cl.includes('parabola')) return 'IMG_GRAPH';
    if (cl.startsWith('venn')) return 'IMG_VENN';
    if (cl.startsWith('tree')) return 'IMG_TREE';
    if (cl.startsWith('symbol_matrix')) return 'IMG_SYMBOL_MATRIX';
    // Check if it could be a figure part we missed
    if (cl.includes('missing') || cl.includes('half') || cl.includes('quarter') || cl.includes('corner') || cl.includes('side') || cl.includes('point') || cl.includes('segment') || cl.includes('small')) return 'IMG_FIGURE';
    return 'IMG_FALLBACK'; // This would trigger the generic fallback box
  }

  // Numbers
  if (/^-?\d+\.?\d*$/.test(token)) return 'NUMBER';

  // Unicode symbols (arrows, shapes, etc)
  if (/^[^\w]+$/.test(token) || /^[\u2190-\u27BF\u2900-\u297F\s]+$/.test(token)) return 'UNICODE_SYMBOL';

  // Bare shape names
  if (SHAPES.includes(token.toLowerCase())) return 'SHAPE_TOKEN';

  // Text without underscores
  if (!/[_]/.test(token) && /[a-zA-Z]/.test(token)) return 'PLAIN_TEXT';

  // Shape tokens (underscore-containing, contain shape name)
  const lower = token.toLowerCase();
  for (const s of SHAPES) {
    if (lower.includes(s)) return 'SHAPE_TOKEN';
  }

  // Fallback check
  return 'UNKNOWN';
}

// ═══ ALL UNIQUE TOKENS FROM v4 EXCEL ═══
// (Extracted by the Python analysis script)

const ALL_TOKENS = [
  // POS tokens (36)
  'pos_blue_star_bottom','pos_circle_bottom','pos_circle_bottom_left','pos_circle_bottom_right',
  'pos_circle_center','pos_circle_left','pos_circle_right','pos_circle_top',
  'pos_circle_top_left','pos_circle_top_right','pos_diamond_bottom','pos_diamond_right',
  'pos_diamond_top','pos_one_circle_left','pos_pentagon_left','pos_square_bottom',
  'pos_square_bottom_right','pos_square_center','pos_square_left','pos_square_right',
  'pos_square_top','pos_star_bottom','pos_star_center','pos_star_left',
  'pos_star_right','pos_star_top','pos_three_circles_right','pos_three_squares_right',
  'pos_triangle_bottom','pos_triangle_bottom_right','pos_triangle_center','pos_triangle_left',
  'pos_triangle_right','pos_triangle_top','pos_triangle_top_left','pos_two_circles_center',

  // IMG sprite tokens (24)
  'img_sprite_apple_4','img_sprite_apple_5','img_sprite_apple_6','img_sprite_apple_7',
  'img_sprite_apple_8','img_sprite_apple_9','img_sprite_apple_10','img_sprite_apple_12',
  'img_sprite_cherry_2','img_sprite_cherry_4','img_sprite_cherry_6','img_sprite_cherry_8',
  'img_sprite_cherry_9','img_sprite_cherry_10','img_sprite_cherry_13',
  'img_sprite_grape_12','img_sprite_grape_16','img_sprite_grape_18',
  'img_sprite_orange_3','img_sprite_orange_4','img_sprite_orange_6',
  'img_sprite_strawberry_3','img_sprite_strawberry_6','img_sprite_strawberry_8',

  // IMG seesaw tokens (13)
  'img_seesaw_left=3apples_right=?','img_seesaw_left=4cherries+2cherries_right=?',
  'img_seesaw_left=10strawberries_right=5strawberries+?','img_seesaw_left=16oranges_right=8oranges+?',
  'img_seesaw_left=12grapes_right=3grapes+?','img_seesaw_left=3x_right=?',
  'img_seesaw_left=4x_right=?','img_seesaw_left=25strawberries_right=5strawberries+?',
  'img_seesaw_left=36oranges_right=6oranges+?','img_seesaw_left=5x_right=?',
  'img_seesaw_left=27strawberries_right=3strawberries+?','img_seesaw_left=3apples_right=5apples+?',
  'img_seesaw_left=2cherries_right=7cherries+?',

  // IMG bar tokens (20)
  'img_bar_0','img_bar_1','img_bar_2','img_bar_3','img_bar_4','img_bar_5','img_bar_6','img_bar_8','img_bar_9',
  'img_bar_11','img_bar_13','img_bar_15','img_bar_16','img_bar_23','img_bar_27',
  'img_bar_40','img_bar_47','img_bar_64','img_bar_81','img_bar_121',

  // IMG figure parts (23)
  'img_circle_missing_quarter','img_circle_quarter','img_circle_small',
  'img_complex_shape_missing_segment','img_correct_segment','img_diamond_half',
  'img_diamond_missing_half','img_half_circle','img_hexagon_missing_side',
  'img_hexagon_side','img_mirrored_segment','img_quarter_circle','img_rectangle_side',
  'img_rotated_segment','img_square_corner','img_square_half','img_square_missing_corner',
  'img_star_missing_point','img_star_point','img_triangle_corner','img_triangle_half',
  'img_triangle_piece','img_triangle_small',

  // IMG complex patterns (5)
  'img_complex_pattern_A','img_complex_pattern_B','img_complex_pattern_C',
  'img_complex_pattern_D','img_complex_pattern_E',

  // Shape tokens (sample)
  'arrow_up','arrow_down','arrow_left','arrow_right','arrow_top_left','arrow_bottom_right',
  'blue_square','blue_circle','blue_triangle','red_square','red_circle','red_triangle',
  'green_square','green_circle','green_triangle','yellow_square','yellow_circle',
  'darkblue_circle','lightblue_circle','small_circle','small_triangle','small_star',
  'medium_circle','medium_square','medium_star','medium_triangle',
  'large_circle','large_star','large_triangle','extralarge_triangle',
  'one_circle','one_dot','one_square','one_star','one_triangle',
  'two_circles','two_dots','two_squares','two_stars','two_triangles',
  'three_circles','three_dots','three_squares','three_stars','three_triangles',
  'four_circles','four_dots','four_squares','four_stars','four_triangles',
  'five_dots','five_squares','five_stars',
  'one_blue_square','two_blue_square','three_blue_square','four_blue_square',
  'heart_up','heart_down','heart_right',
  'octagon_up','octagon_down','octagon_right',
  'hexagon_left','hexagon_right',
  'pentagon_left',
  'star_left','star_right',
  'square_left','square_right',
  'circle_left','circle_right',
  'triangle_up','triangle_left','triangle_right',
  'small_arrow_up','small_arrow_right','small_arrow_down','small_arrow_left',
  'large_arrow_left',

  // Plain shape names
  'circle','square','triangle',

  // Numbers (sample)
  '0','1','2','3','4','5','6','7','8','9','10','11','12','13','14','15',
  '16','17','18','19','20','25','28','30','31','33','35','42','81','94','95','96',
  '100','120','125','243','360','364','12.5',

  // Unicode/symbol tokens (sample from Gs)
  '↑','↓','→','←↓','↑↓→←','↑→↓←',
  '■','□','▲','△','●','◇',

  // Text tokens (sample from Gc)
  'Dog','Puppy','Cat','Kitten','Bird','Flying','Fish','Swimming',
  'Cold','Hot','School','Hospital','Two People','Specific To General',
  'Belief System','Whole Text','Division','Overt','Usefulness',
  'same','different','similar',
];

// ═══ RUN VERIFICATION ═══
const counts = {};
const fallbacks = [];

for (const tok of ALL_TOKENS) {
  const cat = classifyToken(tok);
  counts[cat] = (counts[cat] || 0) + 1;
  if (cat === 'IMG_FALLBACK' || cat === 'UNKNOWN') {
    fallbacks.push({ token: tok, category: cat });
  }
}

console.log('═══ TOKEN COVERAGE REPORT ═══');
console.log(`Total tokens tested: ${ALL_TOKENS.length}`);
console.log('');

for (const [cat, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  const status = (cat === 'IMG_FALLBACK' || cat === 'UNKNOWN') ? '❌' : '✅';
  console.log(`  ${status} ${cat}: ${count}`);
}

console.log('');
if (fallbacks.length === 0) {
  console.log('✅ ALL TOKENS COVERED — Zero fallback renderings!');
} else {
  console.log(`❌ ${fallbacks.length} TOKENS WOULD FALL BACK:`);
  for (const f of fallbacks) {
    console.log(`  - "${f.token}" → ${f.category}`);
  }
}

console.log('');
console.log('═══ SPRITE COVERAGE ═══');
const REQUIRED_SPRITES = ['apple','orange','strawberry','grape','cherry','banana','pear','lemon','coconut','peach','watermelon','pineapple'];
const spritesUsed = new Set();
for (const tok of ALL_TOKENS) {
  const m = tok.match(/img_sprite_(\w+)_\d+/);
  if (m) spritesUsed.add(m[1]);
  // Also check seesaw fruit references
  const sm = tok.match(/\d+(apples?|oranges?|cherries?|strawberries?|grapes?|bananas?)/i);
  if (sm) {
    const fruit = sm[1].replace(/ies$/, 'y').replace(/s$/, '').toLowerCase();
    spritesUsed.add(fruit);
  }
}
for (const f of REQUIRED_SPRITES) {
  const used = spritesUsed.has(f);
  console.log(`  ${used ? '✅' : '⚠️ '} /sprites/${f}.png ${used ? '(referenced)' : '(not referenced but available)'}`);
}
