/**
 * Generate box-text PSD variants to find the correct transform semantics:
 * A) transform=identity + boxBounds (PS should position by boxBounds alone)
 * B) transform=(left,top) + boxBounds (what we currently write - suspected ×2 bug)
 * C) transform=(left,top), NO boxBounds, text box = box bounds
 */
const path = require('path');
const fs = require('fs');
const ENV_NM = path.resolve(__dirname, 'node_modules');
const { createCanvas } = require(path.join(ENV_NM, '@napi-rs/canvas'));
const agpsd = require(path.join(ENV_NM, 'ag-psd'));
agpsd.initializeCanvas(createCanvas);

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

const left = 72, top = 702, right = 226, bottom = 755;
const fontName = 'HelveticaNowText-Bold';
const fontSize = 58;
const text = '9999';

function buildBox(variant) {
  const doc = createCanvas(800, 800);
  { const ctx = doc.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 800, 800); }

  const textObj = {
    text: text,
    left: 0, top: 0, right: 0, bottom: 0,
    shapeType: 'box',
    antiAlias: 'sharp', gridding: 'none', orientation: 'horizontal', index: 0,
    style: {
      font: { name: fontName, script: 0, type: 1, synthetic: 0 },
      fontSize: fontSize, autoLeading: true, leading: 0, tracking: 0,
      fauxBold: false, fauxItalic: false,
      underline: false, strikethrough: false,
      autoKerning: true, kerning: 0, baselineShift: 0,
      fillColor: { r: 0, g: 0, b: 0 }, strokeColor: { r: 0, g: 0, b: 0 },
      fillFlag: true, strokeFlag: false, fillFirst: true,
      horizontalScale: 1, verticalScale: 1, ligatures: true,
      baselineDirection: 2, styleRunAlignment: 2, language: 0,
      noBreak: false, yUnderline: 1, outlineWidth: 1,
      characterDirection: 0, hindiNumbers: false, kashida: 1, diacriticPos: 2
    },
    paragraphStyle: {
      justification: 'center', firstLineIndent: 0, startIndent: 0, endIndent: 0,
      spaceBefore: 0, spaceAfter: 0, autoHyphenate: true,
      hyphenatedWordSize: 6, preHyphen: 2, postHyphen: 2,
      consecutiveHyphens: 8, zone: 36,
      wordSpacing: [0.8, 1, 1.33], letterSpacing: [0, 0, 0], glyphSpacing: [1, 1, 1],
      autoLeading: 1.2, leadingType: 0,
      hanging: false, burasagari: false, kinsokuOrder: 0, everyLineComposer: false
    }
  };

  if (variant === 'A') {
    // transform identity, boxBounds absolute
    textObj.transform = [1, 0, 0, 1, 0, 0];
    textObj.boxBounds = [left, top, right, bottom];
    textObj.left = left; textObj.top = top; textObj.right = right; textObj.bottom = bottom;
  } else if (variant === 'B') {
    // transform=(left,top), boxBounds absolute (current code)
    textObj.transform = [1, 0, 0, 1, left, top];
    textObj.boxBounds = [left, top, right, bottom];
    textObj.left = left; textObj.top = top; textObj.right = right; textObj.bottom = bottom;
  } else if (variant === 'C') {
    // transform=(left,top), no boxBounds, text box absolute
    textObj.transform = [1, 0, 0, 1, left, top];
    textObj.boxBounds = undefined;
    textObj.left = left; textObj.top = top; textObj.right = right; textObj.bottom = bottom;
  } else if (variant === 'D') {
    // transform identity, no boxBounds, text box absolute
    textObj.transform = [1, 0, 0, 1, 0, 0];
    textObj.boxBounds = undefined;
    textObj.left = left; textObj.top = top; textObj.right = right; textObj.bottom = bottom;
  }

  const layer = {
    name: 'box-' + variant,
    hidden: false, blendMode: 'normal',
    left: left, top: top, right: right, bottom: bottom,
    canvas: (() => { const c = createCanvas(right - left, bottom - top); const x = c.getContext('2d'); x.fillStyle = 'rgba(0,0,0,0)'; x.clearRect(0,0,c.width,c.height); return c; })(),
    text: textObj
  };

  const buf = agpsd.writePsd({ width: 800, height: 800, canvas: doc, children: [layer] }, { noBackground: true });
  const file = path.join(OUT, `box-variant-${variant}.psd`);
  fs.writeFileSync(file, Buffer.from(buf));
  console.log('wrote', path.basename(file), buf.length, 'bytes');

  // read back to confirm what we wrote
  const r = agpsd.readPsd(fs.readFileSync(file));
  const t = r.children[0].text;
  console.log('  read back: transform=' + JSON.stringify(t.transform) + ' boxBounds=' + JSON.stringify(t.boxBounds) + ' textBox=(' + t.left + ',' + t.top + ')-(' + t.right + ',' + t.bottom + ')');
}

for (const v of ['A', 'B', 'C', 'D']) buildBox(v);
