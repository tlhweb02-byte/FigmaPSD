/**
 * Verify how ag-psd 31.0.2 writes point vs box text and whether the
 * transform baseline / boxBounds survive round-trip, using real metrics
 * (SourceHanSansCN: typoAscender 880/1000=0.88em baseline offset).
 */
const path = require('path');
const fs = require('fs');
const ENV_NM = path.resolve(__dirname, 'node_modules');
const { createCanvas } = require(path.join(ENV_NM, '@napi-rs/canvas'));
const agpsd = require(path.join(ENV_NM, 'ag-psd'));
agpsd.initializeCanvas(createCanvas);

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

// Simulate: text at doc coords (left=47, top=780), fontSize 16, ascent 0.88em
// -> baseline = top + 16*0.88 = 794.08 (real PS file: 794.22, close)
const left = 47, top = 780, right = 198, bottom = 796;
const fontSize = 16;
const ascent = 14.08;
const baselineY = top + ascent;

function makeTextCanvas(w, h) {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8d8d8d';
  ctx.font = '16px sans-serif';
  ctx.fillText('*不同配色有价格差异', 0, 14);
  return c;
}

function buildPsd(shapeType) {
  const doc = createCanvas(800, 800);
  const ctx = doc.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 800, 800);

  const textLayer = {
    name: 'text-' + shapeType,
    left: left, top: top, right: right, bottom: bottom,
    canvas: makeTextCanvas(right - left, bottom - top),
    text: {
      text: '*不同配色有价格差异',
      left: 0, top: 0, right: 0, bottom: 0,
      transform: [1, 0, 0, 1, left, baselineY],
      shapeType: shapeType,
      antiAlias: 'sharp',
      gridding: 'none',
      orientation: 'horizontal',
      index: 0,
      style: {
        font: { name: 'SourceHanSansCN-Regular', script: 3, type: 2, synthetic: 0 },
        fontSize: fontSize,
        autoLeading: true,
        leading: 0,
        tracking: 0,
        fauxBold: false, fauxItalic: false,
        fillColor: { r: 141, g: 141, b: 141 },
        strokeColor: { r: 248, g: 248, b: 248 },
      },
      paragraphStyle: { justification: 'left', autoLeading: 1.2, leadingType: 0 },
    }
  };
  if (shapeType === 'box') {
    textLayer.text.boxBounds = [left, top, right, bottom];
    textLayer.text.pointBase = undefined;
  } else {
    textLayer.text.pointBase = [0, 0];
  }

  const buf = agpsd.writePsd({ width: 800, height: 800, canvas: doc, children: [textLayer] }, { noBackground: true });
  const file = path.join(OUT, `position-${shapeType}.psd`);
  fs.writeFileSync(file, Buffer.from(buf));
  return file;
}

for (const st of ['point', 'box']) {
  const file = buildPsd(st);
  const psd = agpsd.readPsd(fs.readFileSync(file));
  const t = psd.children[0].text;
  console.log(`=== ${st} ===`);
  console.log('  layerRecord bounds:', `(${psd.children[0].left},${psd.children[0].top})-(${psd.children[0].right},${psd.children[0].bottom})`);
  console.log('  text.left/top/right/bottom:', `(${t.left},${t.top})-(${t.right},${t.bottom})`);
  console.log('  transform:', JSON.stringify(t.transform));
  console.log('  shapeType:', t.shapeType, 'pointBase:', JSON.stringify(t.pointBase), 'boxBounds:', JSON.stringify(t.boxBounds));
}
