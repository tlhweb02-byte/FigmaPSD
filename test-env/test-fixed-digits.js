/**
 * End-to-end: generate a PSD matching the user's 111.psd scenario
 * (point digits + box digits) using the FIXED transform logic, and
 * verify positions are correct.
 */
const path = require('path');
const fs = require('fs');
const ENV_NM = path.resolve(__dirname, 'node_modules');
const { createCanvas } = require(path.join(ENV_NM, '@napi-rs/canvas'));
const agpsd = require(path.join(ENV_NM, 'ag-psd'));
agpsd.initializeCanvas(createCanvas);

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

// scenario from user's 111.psd (72 PPI doc, 800x800)
const doc = createCanvas(800, 800);
{ const ctx = doc.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 800, 800); }

function makeTextObj(opts) {
  const isBox = opts.shapeType === 'box';
  const t = {
    text: opts.text,
    left: isBox ? opts.left : 0,
    top: isBox ? opts.top : 0,
    right: isBox ? opts.right : 0,
    bottom: isBox ? opts.bottom : 0,
    transform: isBox ? [1, 0, 0, 1, 0, 0] : [1, 0, 0, 1, opts.anchorX, opts.baselineY],
    shapeType: isBox ? 'box' : 'point',
    antiAlias: 'sharp', gridding: 'none', orientation: 'horizontal', index: 0,
    style: {
      font: { name: opts.font, script: opts.script || 0, type: opts.type || 1, synthetic: 0 },
      fontSize: opts.fontSize, autoLeading: true, leading: 0, tracking: 0,
      fauxBold: false, fauxItalic: false, underline: false, strikethrough: !!opts.strike,
      autoKerning: true, kerning: 0, baselineShift: 0,
      fillColor: { r: 0, g: 0, b: 0 }, strokeColor: { r: 0, g: 0, b: 0 },
      fillFlag: true, strokeFlag: false, fillFirst: true,
      horizontalScale: 1, verticalScale: 1, ligatures: true,
      baselineDirection: 2, styleRunAlignment: 2, language: 0,
      noBreak: false, yUnderline: 1, outlineWidth: 1,
      characterDirection: 0, hindiNumbers: false, kashida: 1, diacriticPos: 2
    },
    paragraphStyle: {
      justification: opts.align || 'left', firstLineIndent: 0, startIndent: 0, endIndent: 0,
      spaceBefore: 0, spaceAfter: 0, autoHyphenate: true,
      hyphenatedWordSize: 6, preHyphen: 2, postHyphen: 2,
      consecutiveHyphens: 8, zone: 36,
      wordSpacing: [0.8, 1, 1.33], letterSpacing: [0, 0, 0], glyphSpacing: [1, 1, 1],
      autoLeading: 1.2, leadingType: 0,
      hanging: false, burasagari: false, kinsokuOrder: 0, everyLineComposer: false
    }
  };
  if (isBox) {
    t.boxBounds = [opts.left, opts.top, opts.right, opts.bottom];
    t.pointBase = undefined;
  } else {
    t.pointBase = [0, 0];
  }
  return t;
}

const layers = [
  // point digits "999" (like 当前售价): baseline = top + 30*0.8
  { name: '当前售价', left: 460, top: 739, right: 516, bottom: 762, text: makeTextObj({ text: '999', font: 'HelveticaNowText-Medium', fontSize: 30, shapeType: 'point', left: 460, top: 739, right: 516, bottom: 762, anchorX: 488, baselineY: 739 + Math.round(30 * 0.8), align: 'center' }) },
  // box digits "9999" (like 活动价): fixed width box
  { name: '活动价', left: 72, top: 702, right: 226, bottom: 755, text: makeTextObj({ text: '9999', font: 'HelveticaNowText-Bold', fontSize: 58, shapeType: 'box', left: 72, top: 702, right: 226, bottom: 755, align: 'center' }) },
  // point strikethrough "¥9999" (like 活动价 划线价)
  { name: '活动价 划线价', left: 235, top: 732, right: 328, bottom: 753, text: makeTextObj({ text: '¥9999', font: 'HelveticaNowText-Bold', fontSize: 28, shapeType: 'point', left: 235, top: 732, right: 328, bottom: 753, anchorX: 281, baselineY: 732 + Math.round(28 * 0.8), align: 'center', strike: true }) }
];

const children = layers.map(l => ({
  name: l.name, hidden: false, blendMode: 'normal',
  left: l.left, top: l.top, right: l.right, bottom: l.bottom,
  canvas: (() => { const c = createCanvas(l.right - l.left, l.bottom - l.top); const x = c.getContext('2d'); x.clearRect(0, 0, c.width, c.height); return c; })(),
  text: l.text
}));

const buf = agpsd.writePsd({
  width: 800, height: 800, canvas: doc,
  imageResources: { resolutionInfo: { horizontalResolution: 72, horizontalResolutionUnit: 'PPI', widthUnit: 'Inches', verticalResolution: 72, verticalResolutionUnit: 'PPI', heightUnit: 'Inches' } },
  children
}, { noBackground: true });

const file = path.join(OUT, 'fixed-digits.psd');
fs.writeFileSync(file, Buffer.from(buf));
console.log('wrote fixed-digits.psd', buf.length, 'bytes');

// read back
const psd = agpsd.readPsd(fs.readFileSync(file));
for (const l of psd.children || []) {
  const t = l.text;
  console.log(`"${l.name}" shape=${t.shapeType} transform=${JSON.stringify(t.transform)} boxBounds=${JSON.stringify(t.boxBounds)}`);
}
