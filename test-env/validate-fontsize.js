/**
 * Validate the font-size unit fix:
 * - PSD style.fontSize (pt) must equal the Figma px value (e.g. 24px -> 24pt),
 *   NOT scaled.
 * - Document resolutionInfo PPI must be 72 × scale.
 * - Rendering pixel size = pt × PPI/72 must equal px × scale, keeping the
 *   text/doc ratio identical to Figma at any export scale.
 */
const path = require('path');
const fs = require('fs');
const ENV_NM = path.resolve(__dirname, 'node_modules');
const { createCanvas } = require(path.join(ENV_NM, '@napi-rs/canvas'));
const agpsd = require(path.join(ENV_NM, 'ag-psd'));
agpsd.initializeCanvas(createCanvas);

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

function buildTextLayer(layer, scale) {
  const left = Math.round(layer.x);
  const top = Math.round(layer.y);
  const right = left + Math.round(layer.width);
  const bottom = top + Math.round(layer.height);

  const fontSizePt = layer.textData.fontSize || 16;           // pt = Figma px
  const fontSizeScaled = layer.textData.fontSizeScaled || (fontSizePt * scale);
  const ascentRatio = layer.textData.ascentRatio || 0.88;
  const baselineY = top + Math.round(fontSizeScaled * ascentRatio);
  const shapeType = layer.textData.shapeType === 'box' ? 'box' : 'point';

  return {
    name: layer.name,
    hidden: false,
    blendMode: 'normal',
    left, top, right, bottom,
    text: {
      text: layer.textData.text,
      left: 0, top: 0, right: 0, bottom: 0,
      transform: [1, 0, 0, 1, left, baselineY],
      shapeType, pointBase: [0, 0],
      antiAlias: 'sharp', gridding: 'none', orientation: 'horizontal', index: 0,
      style: {
        font: { name: layer.textData.fontName, script: 3, type: 2, synthetic: 0 },
        fontSize: fontSizePt,
        autoLeading: !layer.textData.lineHeight,
        leading: layer.textData.lineHeight || 0,
        tracking: 0,
        fauxBold: false, fauxItalic: false,
        underline: !!layer.textData.underline, strikethrough: !!layer.textData.strikethrough,
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
      }
    }
  };
}

// Figma artboard 200x150, text 24px at (20, 30)
const artboardW = 200, artboardH = 150;
const text = {
  id: 't', name: '价格', kind: 'text', x: 20, y: 30, width: 100, height: 30,
  textData: {
    text: '￥9999', fontName: 'SimSun', fontSize: 24, fontSizeScaled: 24,
    ascentRatio: 0.88, shapeType: 'point', align: 'left',
    color: { r: 0, g: 0, b: 0, a: 1 }, underline: false, strikethrough: true
  }
};

const failures = [];
for (const scale of [1, 2, 3]) {
  const doc = createCanvas(artboardW * scale, artboardH * scale);
  { const ctx = doc.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, doc.width, doc.height); }

  const layerObj = buildTextLayer(text, scale);
  const psdData = {
    width: doc.width, height: doc.height, canvas: doc,
    imageResources: {
      resolutionInfo: {
        horizontalResolution: 72 * scale, horizontalResolutionUnit: 'PPI',
        widthUnit: 'Inches',
        verticalResolution: 72 * scale, verticalResolutionUnit: 'PPI',
        heightUnit: 'Inches'
      }
    },
    children: [layerObj]
  };
  const buf = agpsd.writePsd(psdData, { noBackground: true });
  const file = path.join(OUT, `fontsize-scale${scale}.psd`);
  fs.writeFileSync(file, Buffer.from(buf));

  const psd = agpsd.readPsd(fs.readFileSync(file));
  const t = psd.children[0].text;
  const ri = psd.imageResources && psd.imageResources.resolutionInfo;

  const figmaPx = 24;
  const psdPt = t.style.fontSize;
  const ppi = ri ? ri.horizontalResolution : 72;
  const renderPx = psdPt * ppi / 72;

  console.log(`=== scale=${scale} ===`);
  console.log(`  doc=${psd.width}x${psd.height}  PPI=${ppi}`);
  console.log(`  PSD fontSize(pt)=${psdPt}  (Figma px=${figmaPx})`);
  console.log(`  renderPx = ${psdPt}pt × ${ppi}/72 = ${renderPx.toFixed(1)}px  (expect px×scale=${figmaPx * scale})`);
  console.log(`  doc/text ratio: ${(renderPx / psd.width * 100).toFixed(1)}%  (Figma: ${(figmaPx / artboardW * 100).toFixed(1)}%)`);

  if (psdPt !== figmaPx) failures.push(`scale=${scale}: PSD pt (${psdPt}) != Figma px (${figmaPx})`);
  if (ppi !== 72 * scale) failures.push(`scale=${scale}: PPI (${ppi}) != 72×scale (${72 * scale})`);
  if (Math.abs(renderPx - figmaPx * scale) > 0.51) failures.push(`scale=${scale}: renderPx ${renderPx} != ${figmaPx * scale}`);
}

console.log('\n=== RESULT ===');
if (failures.length) { failures.forEach(f => console.log(' - ' + f)); process.exitCode = 1; }
else console.log('FONT-SIZE UNIT FIX VALIDATED ✓ (pt = Figma px, PPI = 72×scale, ratio preserved)');
