/**
 * ULTIMATE position validation: reproduce a Figma text node with the same
 * geometry as real PS file layers and verify the produced TySh transform
 * matches the real PS file's transform within tolerance.
 *
 * Real PS reference data (日销内购会.psd):
 *  - "*不同配色有价格差异" CJK 16pt: bounds(47,780)-(198,796), transform=(46.78, 794.22)
 *    -> baseline = top + 16*0.889 = 780 + 14.22 = 794.22  (ascentRatio 0.889)
 *  - "9999" Helvetica 58pt: bounds(73,710)-(222,754), transform=(70.88, 752)
 *    -> baseline = top + 58*0.724 = 710 + 42 = 752
 *
 * For our exporter: we don't know the exact font metrics of those foreign fonts,
 * but we DO know the CJK SourceHanSans-like ascent ~0.88 and Helvetica ~0.75,
 * which our FONT_METRICS_MAP should hold for installed fonts.
 */
const path = require('path');
const fs = require('fs');
const ENV_NM = path.resolve(__dirname, 'node_modules');
const { createCanvas } = require(path.join(ENV_NM, '@napi-rs/canvas'));
const agpsd = require(path.join(ENV_NM, 'ag-psd'));
agpsd.initializeCanvas(createCanvas);

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

// ---- replicate ui.html text construction ----
function buildTextLayer(layer) {
  const left = Math.round(layer.x);
  const top = Math.round(layer.y);
  const right = left + Math.round(layer.width);
  const bottom = top + Math.round(layer.height);
  const fontSizePt = layer.textData.fontSize || 16;
  const ascentRatio = layer.textData.ascentRatio || 0.88;
  const baselineY = top + Math.round(fontSizePt * ascentRatio);
  const shapeType = layer.textData.shapeType === 'box' ? 'box' : 'point';
  const just = layer.textData.align || 'left';
  let anchorX = left;
  if (just === 'center') anchorX = Math.round((left + right) / 2);
  else if (just === 'right') anchorX = right;

  const textObj = {
    text: layer.textData.text,
    left: shapeType === 'box' ? left : 0,
    top: shapeType === 'box' ? top : 0,
    right: shapeType === 'box' ? right : 0,
    bottom: shapeType === 'box' ? bottom : 0,
    transform: shapeType === 'box' ? [1, 0, 0, 1, left, top] : [1, 0, 0, 1, anchorX, baselineY],
    shapeType: shapeType,
    antiAlias: 'sharp', gridding: 'none', orientation: 'horizontal', index: 0,
    style: {
      font: { name: layer.textData.fontName, script: 3, type: 2, synthetic: 0 },
      fontSize: fontSizePt, autoLeading: true, leading: 0, tracking: 0,
      fauxBold: false, fauxItalic: false, underline: false, strikethrough: false,
      autoKerning: true, kerning: 0, baselineShift: 0,
      fillColor: { r: 141, g: 141, b: 141 }, strokeColor: { r: 248, g: 248, b: 248 },
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
      autoLeading: 1.2, leadingType: 0,
      hanging: false, burasagari: false, kinsokuOrder: 0, everyLineComposer: false
    }
  };
  if (shapeType === 'box') {
    textObj.boxBounds = [left, top, right, bottom];
    textObj.pointBase = undefined;
  } else {
    textObj.pointBase = [0, 0];
  }
  return { name: layer.name, hidden: false, blendMode: 'normal', left, top, right, bottom, text: textObj };
}

const doc = createCanvas(800, 800);
{
  const ctx = doc.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 800, 800);
}

const scenarios = [
  // matches real PS "*不同配色有价格差异" (CJK 16pt, ascent 0.889)
  {
    name: 'cjk-16-left',
    layer: {
      id: 't', name: '*不同配色有价格差异', kind: 'text', x: 47, y: 780, width: 151, height: 16,
      textData: { text: '*不同配色有价格差异', fontName: 'SourceHanSansCN-Regular', fontSize: 16, ascentRatio: 0.889, shapeType: 'point', align: 'left', color: { r: 0.55, g: 0.55, b: 0.55, a: 1 } }
    },
    expectTx: 47, expectTy: 794, tol: 1.5
  },
  // matches real PS "时间" (center justify, scaled — here unscaled 30pt center)
  {
    name: 'cjk-center',
    layer: {
      id: 't2', name: '居中文本', kind: 'text', x: 548, y: 682, width: 147, height: 30,
      textData: { text: '6.22 00:00 - 23:59', fontName: 'SourceHanSansCN-Medium', fontSize: 30, ascentRatio: 0.889, shapeType: 'point', align: 'center', color: { r: 0, g: 0, b: 0, a: 1 } }
    },
    expectTx: 622, expectTy: 709, tol: 2
  },
  // box text
  {
    name: 'box-fixed',
    layer: {
      id: 't3', name: '固定宽度', kind: 'text', x: 100, y: 200, width: 300, height: 80,
      textData: { text: '固定宽度文本内容', fontName: 'DengXian', fontSize: 20, ascentRatio: 0.81, shapeType: 'box', align: 'center', color: { r: 0, g: 0, b: 0, a: 1 }, lineHeight: 28 }
    },
    expectTx: 100, expectTy: 200, tol: 0.5
  }
];

let allOk = true;
for (const sc of scenarios) {
  const layerObj = buildTextLayer(sc.layer);
  const buf = agpsd.writePsd({ width: 800, height: 800, canvas: doc, children: [layerObj] }, { noBackground: true });
  const file = path.join(OUT, `position-${sc.name}.psd`);
  fs.writeFileSync(file, Buffer.from(buf));
  const psd = agpsd.readPsd(fs.readFileSync(file));
  const t = psd.children[0].text;
  const tx = t.transform[4], ty = t.transform[5];
  const okTx = Math.abs(tx - sc.expectTx) <= sc.tol;
  const okTy = Math.abs(ty - sc.expectTy) <= sc.tol;
  const ok = okTx && okTy;
  if (!ok) allOk = false;
  console.log(`${ok ? '✓' : '✗'} ${sc.name}: transform=(${tx.toFixed(1)}, ${ty.toFixed(1)}) expect=(${sc.expectTx}, ${sc.expectTy}) textBox=(${t.left},${t.top})-(${t.right},${t.bottom})`);
}
console.log('\n=== RESULT ===');
console.log(allOk ? 'ALL POSITION SCENARIOS MATCH REAL PS CONVENTION ✓' : 'SOME SCENARIOS OFF');
process.exitCode = allOk ? 0 : 1;
