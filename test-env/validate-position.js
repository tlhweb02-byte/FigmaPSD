/**
 * Validate the position fix: simulate a Figma text node at the same geometry
 * as the real PS file "*不同配色有价格差异" (bounds (47,780)-(198,796),
 * fontSize 16, SourceHanSans-like CJK font, ascentRatio 0.88).
 *
 * Expected (from the REAL PS file): transform = [1,0,0,1, ~47, ~794.2]
 * i.e. baseline y = top + fontSize*ascentRatio = 780 + 16*0.88 = 794.08
 */
const path = require('path');
const fs = require('fs');
const ENV_NM = path.resolve(__dirname, 'node_modules');
const { createCanvas } = require(path.join(ENV_NM, '@napi-rs/canvas'));
const agpsd = require(path.join(ENV_NM, 'ag-psd'));
agpsd.initializeCanvas(createCanvas);

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

// ===== replicate ui.html text-layer construction (point text) =====
function buildTextLayer(layer) {
  const left = Math.round(layer.x);
  const top = Math.round(layer.y);
  const right = left + Math.round(layer.width);
  const bottom = top + Math.round(layer.height);

  const c = layer.textData.color;
  const rVal = c.r <= 1 ? Math.round(c.r * 255) : Math.round(c.r);
  const gVal = c.g <= 1 ? Math.round(c.g * 255) : Math.round(c.g);
  const bVal = c.b <= 1 ? Math.round(c.b * 255) : Math.round(c.b);

  const fontSizePt = layer.textData.fontSize || 16;
  const ascentRatio = (typeof layer.textData.ascentRatio === 'number' && layer.textData.ascentRatio > 0)
    ? layer.textData.ascentRatio
    : 0.88;
  const baselineY = top + Math.round(fontSizePt * ascentRatio);
  const shapeType = layer.textData.shapeType === 'box' ? 'box' : 'point';

  const textObj = {
    text: layer.textData.text,
    left: shapeType === 'box' ? left : 0,
    top: shapeType === 'box' ? top : 0,
    right: shapeType === 'box' ? right : 0,
    bottom: shapeType === 'box' ? bottom : 0,
    transform: shapeType === 'box'
      ? [1, 0, 0, 1, left, top]
      : [1, 0, 0, 1, left, baselineY],
    shapeType: shapeType,
    antiAlias: 'sharp',
    gridding: 'none',
    orientation: 'horizontal',
    index: 0,
    style: {
      font: { name: layer.textData.fontName, script: layer.textData.fontScript || 0, type: layer.textData.fontType || 0, synthetic: 0 },
      fontSize: fontSizePt,
      autoLeading: !layer.textData.lineHeight,
      leading: layer.textData.lineHeight || 0,
      tracking: layer.textData.letterSpacing || 0,
      fauxBold: false, fauxItalic: false, underline: false, strikethrough: false,
      autoKerning: true, kerning: 0, baselineShift: 0,
      fillColor: { r: rVal, g: gVal, b: bVal },
      strokeColor: { r: rVal, g: gVal, b: bVal },
      fillFlag: true, strokeFlag: false, fillFirst: true,
      horizontalScale: 1, verticalScale: 1, ligatures: true,
      baselineDirection: 2, styleRunAlignment: 2, language: 0,
      noBreak: false, yUnderline: 1, outlineWidth: 1,
      characterDirection: 0, hindiNumbers: false, kashida: 1, diacriticPos: 2
    },
    paragraphStyle: {
      justification: layer.textData.align || 'left',
      firstLineIndent: 0, startIndent: 0, endIndent: 0,
      spaceBefore: 0, spaceAfter: 0, autoHyphenate: true,
      hyphenatedWordSize: 6, preHyphen: 2, postHyphen: 2,
      consecutiveHyphens: 8, zone: 36,
      wordSpacing: [0.8, 1, 1.33], letterSpacing: [0, 0, 0], glyphSpacing: [1, 1, 1],
      autoLeading: layer.textData.lineHeight ? 1 : 1.2, leadingType: 0,
      hanging: false, burasagari: false, kinsokuOrder: 0, everyLineComposer: false
    }
  };
  if (shapeType === 'box') {
    textObj.boxBounds = [left, top, right, bottom];
    textObj.pointBase = undefined;
  } else {
    textObj.pointBase = [0, 0];
  }

  return {
    name: layer.name,
    hidden: layer.visible === false,
    blendMode: 'normal',
    left, top, right, bottom,
    text: textObj
  };
}

// ===== scenario 1: match real PS file geometry (CJK point text) =====
const doc1 = createCanvas(800, 800);
{
  const ctx = doc1.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 800, 800);
}
const layer1 = buildTextLayer({
  id: 't1', name: '*不同配色有价格差异', kind: 'text',
  x: 47, y: 780, width: 151, height: 16,
  textData: {
    text: '*不同配色有价格差异',
    fontName: 'SourceHanSansCN-Regular', fontScript: 3, fontType: 2,
    fontSize: 16, ascentRatio: 0.88, shapeType: 'point',
    color: { r: 0.55, g: 0.55, b: 0.55, a: 1 }, align: 'left'
  }
});
const buf1 = agpsd.writePsd({ width: 800, height: 800, canvas: doc1, children: [layer1] }, { noBackground: true });
const file1 = path.join(OUT, 'position-fix-cjk.psd');
fs.writeFileSync(file1, Buffer.from(buf1));

const r1 = agpsd.readPsd(fs.readFileSync(file1));
const t1 = r1.children[0].text;
console.log('=== CJK point text (target: transform ~ [1,0,0,1,47,794]) ===');
console.log('  written transform:', JSON.stringify(layer1.text.transform));
console.log('  read transform:', JSON.stringify(t1.transform));
console.log('  read text box:', `(${t1.left},${t1.top})-(${t1.right},${t1.bottom})`);

// ===== scenario 2: box text with exact bounds =====
const layer2 = buildTextLayer({
  id: 't2', name: '固定宽度文本', kind: 'text',
  x: 100, y: 200, width: 300, height: 80,
  textData: {
    text: '固定宽度文本内容', fontName: 'DengXian', fontScript: 3, fontType: 2,
    fontSize: 20, ascentRatio: 0.86, shapeType: 'box', textAlignVertical: 'top',
    color: { r: 0, g: 0, b: 0, a: 1 }, align: 'center', lineHeight: 28
  }
});
const buf2 = agpsd.writePsd({ width: 800, height: 800, canvas: doc1, children: [layer2] }, { noBackground: true });
const file2 = path.join(OUT, 'position-fix-box.psd');
fs.writeFileSync(file2, Buffer.from(buf2));
const r2 = agpsd.readPsd(fs.readFileSync(file2));
const t2 = r2.children[0].text;
console.log('\n=== Box text (boxBounds=[100,200,400,280]) ===');
console.log('  written boxBounds:', JSON.stringify(layer2.text.boxBounds));
console.log('  read boxBounds:', JSON.stringify(t2.boxBounds));
console.log('  read text box:', `(${t2.left},${t2.top})-(${t2.right},${t2.bottom})`);
console.log('  read transform:', JSON.stringify(t2.transform));

// ===== assertions =====
const failures = [];
if (Math.abs(t1.transform[4] - 47) > 1) failures.push(`CJK tx wrong: ${t1.transform[4]}`);
if (Math.abs(t1.transform[5] - 794) > 1.5) failures.push(`CJK baseline y wrong: ${t1.transform[5]} (expect ~794)`);
if (t1.left !== 0 || t1.top !== 0) failures.push('CJK text box should be 0,0');
if (!t2.boxBounds || t2.boxBounds[0] !== 100 || t2.boxBounds[1] !== 200 || t2.boxBounds[2] !== 400 || t2.boxBounds[3] !== 280) {
  failures.push('box bounds wrong: ' + JSON.stringify(t2.boxBounds));
}
console.log('\n=== RESULT ===');
if (failures.length) { failures.forEach(f => console.log(' - ' + f)); process.exitCode = 1; }
else console.log('POSITION FIX VALIDATED ✓');
