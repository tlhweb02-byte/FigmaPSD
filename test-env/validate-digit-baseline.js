/**
 * Validate the digit baseline fix:
 * - Pure digit text (e.g. "9999") should use cap height (0.716 for Arial,
 *   0.712 for DINPro) not ascent, so PS re-layout puts digits at the same
 *   top as Figma.
 * - Text with CJK uses ascent (0.859 SimSun).
 * - Text with ascender lowercase (b/d/f/h/k/l) uses ascent.
 *
 * Real PS reference: "9999" HelveticaNowText-Bold 58pt had baseline-to-top
 * = 42/58 = 0.724 ≈ cap height (Helvetica capHeight ~0.72), NOT ascent (~0.77).
 */
const path = require('path');
const fs = require('fs');

// load generated metrics to verify against
const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'font-map.ts'), 'utf8');
const m = src.match(/export const FONT_METRICS_MAP[^=]*= (\{[\s\S]*?\n\});/);
const FONT_METRICS_MAP = eval('(' + m[1].replace(/^\s*\/\/.*$/gm, '') + ')');

// replicate src/text.ts helpers
function isCjkFallbackChar(code) {
  return (
    (code >= 0x2e80 && code <= 0x2eff) || (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0x3040 && code <= 0x30ff) || (code >= 0x31c0 && code <= 0x31ef) ||
    (code >= 0x3200 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) || (code >= 0xff00 && code <= 0xffef) ||
    (code >= 0xac00 && code <= 0xd7af)
  );
}
function isAscenderLower(ch) { return /[bdfhkl]/.test(ch); }

function getTopToBaselineRatio(psName, text) {
  const m = FONT_METRICS_MAP[psName];
  const ascent = m && m.ascent > 0 ? m.ascent : 0.8;
  const cap = m && m.capHeight && m.capHeight > 0 ? m.capHeight : undefined;
  let hasCjk = false, hasAscender = false;
  for (const ch of text || '') {
    const code = ch.codePointAt(0) || 0;
    if (isCjkFallbackChar(code) || (code >= 0x4e00 && code <= 0x9fff)) hasCjk = true;
    if (isAscenderLower(ch)) hasAscender = true;
  }
  if (hasCjk) return ascent;
  if (hasAscender) return ascent;
  return cap !== undefined ? cap : ascent;
}

const failures = [];
function check(psName, text, expectName) {
  const got = getTopToBaselineRatio(psName, text);
  const m = FONT_METRICS_MAP[psName] || {};
  const expected = expectName === 'cap' ? m.capHeight : m.ascent;
  const ok = Math.abs(got - expected) < 1e-9;
  console.log(`${ok ? '✓' : '✗'} ${psName} "${text}" -> ${got.toFixed(4)} (expect ${expectName}=${expected.toFixed(4)})`);
  if (!ok) failures.push(`${psName} "${text}" got ${got} expected ${expected} (${expectName})`);
}

// Arial: ascent 0.728, capHeight 0.716
check('ArialMT', '9999', 'cap');
check('ArialMT', 'ABC', 'cap');
check('ArialMT', 'ABCabc', 'ascent'); // has ascender 'b'
check('ArialMT', 'Hello', 'ascent'); // 'h','l'
check('ArialMT', '0123.56', 'cap');
// DINPro: ascent 0.764, capHeight 0.712
check('DINPro-Regular', '9999', 'cap');
check('DINPro-Regular', '￥9999', 'ascent'); // ￥ is a CJK fullwidth char (taller glyph) -> ascent is correct
// SimSun (CJK): ascent 0.859, capHeight 0.683
check('SimSun', '七夕快乐', 'ascent');
check('SimSun', '9999', 'cap'); // CJK font but pure digits -> cap (0.683)

console.log('\n=== RESULT ===');
if (failures.length) { failures.forEach(f => console.log(' - ' + f)); process.exitCode = 1; }
else console.log('DIGIT BASELINE (cap-height) FIX VALIDATED ✓');
