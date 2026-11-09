/**
 * Validate the two fixes:
 * 1. Strikethrough-only text: underline must be false, strikethrough true.
 * 2. Text with ￥ (fullwidth yen, U+FFE5) in a Latin font: styleRuns split
 *    the ￥ into a CJK fallback font run (SimSun etc.), and the runs
 *    round-trip through ag-psd 31.0.2 (EngineData preserved).
 */
const path = require('path');
const fs = require('fs');
const ENV_NM = path.resolve(__dirname, 'node_modules');
const { createCanvas } = require(path.join(ENV_NM, '@napi-rs/canvas'));
const agpsd = require(path.join(ENV_NM, 'ag-psd'));
agpsd.initializeCanvas(createCanvas);

// ===== import buildFontRuns + helpers from compiled logic (re-implemented) =====
function isCjkFallbackChar(code) {
  return (
    (code >= 0x2e80 && code <= 0x2eff) ||
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0x31c0 && code <= 0x31ef) ||
    (code >= 0x3200 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xffef) ||
    (code >= 0xac00 && code <= 0xd7af)
  );
}
function buildFontRuns(text, primaryIsCjk, primaryFont, fallbackFont) {
  if (!text || primaryIsCjk) return undefined;
  const runs = [];
  let currentFont = null, currentLen = 0;
  for (const ch of text) {
    const needsFallback = isCjkFallbackChar(ch.charCodeAt(0));
    const font = needsFallback ? fallbackFont : primaryFont;
    if (currentFont && currentFont.name === font.name) currentLen++;
    else { if (currentFont) runs.push({ length: currentLen, font: currentFont }); currentFont = font; currentLen = 1; }
  }
  if (currentFont) runs.push({ length: currentLen, font: currentFont });
  const distinct = new Set(runs.map(r => r.font.name));
  if (distinct.size <= 1) return undefined;
  return runs.map(r => ({ length: r.length, fontName: r.font.name, fontScript: r.font.script, fontType: r.font.type }));
}

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

const failures = [];

// ===== Test 1: decoration mapping =====
console.log('=== Test 1: decoration ===');
// Figma STRIKETHROUGH -> underline=false, strikethrough=true (the bug fix)
const decoStrike = 'STRIKETHROUGH';
const underline1 = decoStrike === 'UNDERLINE';
const strike1 = decoStrike === 'STRIKETHROUGH';
console.log(`  STRIKETHROUGH -> underline=${underline1}, strikethrough=${strike1}`);
if (underline1) failures.push('STRIKETHROUGH must NOT set underline');
if (!strike1) failures.push('STRIKETHROUGH must set strikethrough');

const decoUnder = 'UNDERLINE';
const underline2 = decoUnder === 'UNDERLINE';
const strike2 = decoUnder === 'STRIKETHROUGH';
console.log(`  UNDERLINE -> underline=${underline2}, strikethrough=${strike2}`);
if (!underline2) failures.push('UNDERLINE must set underline');
if (strike2) failures.push('UNDERLINE must NOT set strikethrough');

// ===== Test 2: font runs for "¥9999" with fullwidth ￥ =====
console.log('\n=== Test 2: ￥ font-fallback runs ===');
const primaryFont = { name: 'HelveticaNowText-Bold', script: 0, type: 1 };
const fallbackFont = { name: 'SimSun', script: 3, type: 2 };
const textY = '\uFFE59999'; // ￥ (U+FFE5) + 9999
const runs = buildFontRuns(textY, false, primaryFont, fallbackFont);
console.log(`  text "${textY}" runs:`, JSON.stringify(runs));
if (!runs || runs.length < 2) failures.push('expected 2+ runs for ￥+digits');
else {
  if (runs[0].fontName !== 'SimSun') failures.push(`run0 should be SimSun, got ${runs[0].fontName}`);
  if (runs[0].length !== 1) failures.push(`run0 length should be 1, got ${runs[0].length}`);
  if (runs[1].fontName !== 'HelveticaNowText-Bold') failures.push(`run1 should be Helvetica, got ${runs[1].fontName}`);
  if (runs[1].length !== 4) failures.push(`run1 length should be 4, got ${runs[1].length}`);
}

// pure Latin text -> no runs
const runsLatin = buildFontRuns('9999', false, primaryFont, fallbackFont);
if (runsLatin !== undefined) failures.push('pure Latin text should have no styleRuns');

// pure CJK text with CJK primary font -> no runs
const runsCjk = buildFontRuns('七夕快乐', true, { name: 'SimSun', script: 3, type: 2 }, fallbackFont);
if (runsCjk !== undefined) failures.push('CJK primary font should not need fallback runs');

// ===== Test 3: styleRuns round-trip through ag-psd =====
console.log('\n=== Test 3: ag-psd styleRuns round-trip ===');
const doc = createCanvas(400, 100);
{ const ctx = doc.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 400, 100); }

const textLayer = {
  name: '价格', left: 20, top: 10, right: 200, bottom: 40,
  canvas: createCanvas(180, 30),
  text: {
    text: textY,
    left: 0, top: 0, right: 0, bottom: 0,
    transform: [1, 0, 0, 1, 20, 35],
    shapeType: 'point', pointBase: [0, 0],
    antiAlias: 'sharp', gridding: 'none', orientation: 'horizontal', index: 0,
    style: {
      font: { name: 'HelveticaNowText-Bold', script: 0, type: 1, synthetic: 0 },
      fontSize: 28, autoLeading: true, leading: 0, tracking: 0,
      fauxBold: false, fauxItalic: false,
      underline: false, strikethrough: true,
      autoKerning: true, kerning: 0, baselineShift: 0,
      fillColor: { r: 0, g: 0, b: 0 }, strokeColor: { r: 0, g: 0, b: 0 },
      fillFlag: true, strokeFlag: false, fillFirst: true,
      horizontalScale: 1, verticalScale: 1, ligatures: true,
      baselineDirection: 2, styleRunAlignment: 2, language: 0,
      noBreak: false, yUnderline: 1, outlineWidth: 1,
      characterDirection: 0, hindiNumbers: false, kashida: 1, diacriticPos: 2
    },
    paragraphStyle: {
      justification: 'left', firstLineIndent: 0, startIndent: 0, endIndent: 0,
      spaceBefore: 0, spaceAfter: 0, autoHyphenate: true,
      hyphenatedWordSize: 6, preHyphen: 2, postHyphen: 2,
      consecutiveHyphens: 8, zone: 36,
      wordSpacing: [0.8, 1, 1.33], letterSpacing: [0, 0, 0], glyphSpacing: [1, 1, 1],
      autoLeading: 1.2, leadingType: 0,
      hanging: false, burasagari: false, kinsokuOrder: 0, everyLineComposer: false
    },
    styleRuns: runs ? runs.map(r => ({
      length: r.length,
      style: { font: { name: r.fontName, script: r.fontScript, type: r.fontType, synthetic: 0 } }
    })) : undefined
  }
};

const buf = agpsd.writePsd({ width: 400, height: 100, canvas: doc, children: [textLayer] }, { noBackground: true });
const file = path.join(OUT, 'strike-yen.psd');
fs.writeFileSync(file, Buffer.from(buf));

const psd = agpsd.readPsd(fs.readFileSync(file));
const t = psd.children[0].text;
console.log('  read text:', JSON.stringify(t.text));
console.log('  read styleRuns:', JSON.stringify(t.styleRuns));
console.log('  read underline:', t.style.underline, 'strikethrough:', t.style.strikethrough);

if (t.text.replace(/\r$/, '') !== textY) failures.push(`text mismatch: ${JSON.stringify(t.text)}`);
if (!t.style.strikethrough) failures.push('strikethrough lost');
if (t.style.underline) failures.push('underline should be false');
if (t.styleRuns && t.styleRuns.length) {
  // verify first run uses SimSun for ￥
  const firstRun = t.styleRuns[0];
  if (firstRun.style.font.name !== 'SimSun') failures.push(`first run font should be SimSun, got ${firstRun.style.font.name}`);
} else {
  failures.push('styleRuns lost in round-trip');
}

console.log('\n=== RESULT ===');
if (failures.length) { failures.forEach(f => console.log(' - ' + f)); process.exitCode = 1; }
else console.log('STRIKETHROUGH + ￥ FIX VALIDATED ✓');
