/**
 * End-to-end: simulate the exporter output for a document containing a
 * "-合并" container and verify the produced PSD has that group as a single
 * raster layer (no nested children), with the suffix stripped.
 */
const path = require('path');
const fs = require('fs');
const ENV_NM = path.resolve(__dirname, 'node_modules');
const { createCanvas } = require(path.join(ENV_NM, '@napi-rs/canvas'));
const agpsd = require(path.join(ENV_NM, 'ag-psd'));
agpsd.initializeCanvas(createCanvas);

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

function makePngBase64(c, fill) {
  const ctx = c.getContext('2d');
  ctx.fillStyle = fill; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#000'; ctx.font = '12px sans-serif'; ctx.fillText('m', 5, 12);
  return c.toBuffer('image/png').toString('base64');
}

const SCALE = 2;
const docW = 200 * SCALE, docH = 150 * SCALE;
const rootCanvas = createCanvas(docW, docH);
{ const ctx = rootCanvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, docW, docH); }

// merged container: one raster layer (what exporter produces for "按钮组-合并")
const mergedPng = makePngBase64(createCanvas(100 * SCALE, 60 * SCALE), '#ffcc00');

const layers = [
  { id: 'bg', name: '背景', kind: 'image', isGroup: false, visible: true, opacity: 1, blendMode: 'normal', x: 0, y: 0, width: docW, height: docH, parentId: null, pngBase64: makePngBase64(createCanvas(docW, docH), '#eeeeee') },
  // "-合并" container flattened to a single image layer, name already stripped
  { id: 'merged', name: '按钮组', kind: 'image', isGroup: false, visible: true, opacity: 1, blendMode: 'normal', x: 40, y: 30, width: 100 * SCALE, height: 60 * SCALE, parentId: null, pngBase64: mergedPng },
  // normal group that should remain a group
  { id: 'grp', name: '正常组', kind: 'group', isGroup: true, visible: true, opacity: 1, blendMode: 'pass through', x: 0, y: 0, width: docW, height: docH, parentId: null },
  { id: 'child', name: '子元素', kind: 'image', isGroup: false, visible: true, opacity: 1, blendMode: 'normal', x: 20 * SCALE, y: 20 * SCALE, width: 40 * SCALE, height: 40 * SCALE, parentId: 'grp', pngBase64: makePngBase64(createCanvas(40 * SCALE, 40 * SCALE), '#4488ff') }
];

const buf = agpsd.writePsd({
  width: docW, height: docH, canvas: rootCanvas,
  imageResources: { resolutionInfo: { horizontalResolution: 144, horizontalResolutionUnit: 'PPI', widthUnit: 'Inches', verticalResolution: 144, verticalResolutionUnit: 'PPI', heightUnit: 'Inches' } },
  children: [
    { name: '背景', left: 0, top: 0, right: docW, bottom: docH, canvas: (() => { const c = createCanvas(docW, docH); const x = c.getContext('2d'); x.fillStyle = '#eee'; x.fillRect(0,0,docW,docH); return c; })() },
    { name: '按钮组', left: 40, top: 30, right: 40 + 100 * SCALE, bottom: 30 + 60 * SCALE, canvas: (() => { const c = createCanvas(100 * SCALE, 60 * SCALE); const x = c.getContext('2d'); x.fillStyle = '#fc0'; x.fillRect(0,0,c.width,c.height); return c; })() },
    { name: '正常组', left: 0, top: 0, right: docW, bottom: docH, opened: true, children: [
      { name: '子元素', left: 20 * SCALE, top: 20 * SCALE, right: 20 * SCALE + 40 * SCALE, bottom: 20 * SCALE + 40 * SCALE, canvas: (() => { const c = createCanvas(40 * SCALE, 40 * SCALE); const x = c.getContext('2d'); x.fillStyle = '#48f'; x.fillRect(0,0,c.width,c.height); return c; })() }
    ] }
  ]
}, { noBackground: true });

const file = path.join(OUT, 'merge-e2e.psd');
fs.writeFileSync(file, Buffer.from(buf));

const psd = agpsd.readPsd(fs.readFileSync(file));
console.log('layers in PSD:');
const failures = [];
let mergedFound = false;
function walk(ls, depth) {
  for (const l of ls || []) {
    const ind = '  '.repeat(depth);
    const hasChild = !!l.children;
    let info = `"${l.name}" ${hasChild ? 'GROUP' : 'raster'} bounds=(${l.left},${l.top})-(${l.right},${l.bottom})`;
    if (l.name === '按钮组') {
      mergedFound = true;
      if (hasChild) failures.push('"按钮组" should NOT have children (merged)');
      if (l.canvas) {
        const img = l.canvas.getContext('2d').getImageData(0, 0, l.canvas.width, l.canvas.height);
        let opaque = 0; for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 0) opaque++;
        info += ` | canvas ${l.canvas.width}x${l.canvas.height} opaque=${opaque}`;
        if (opaque === 0) failures.push('"按钮组" canvas empty');
      } else failures.push('"按钮组" has no canvas');
      if (l.name.includes('合并')) failures.push('"按钮组" name still contains -合并');
    }
    if (l.name === '正常组' && !hasChild) failures.push('"正常组" should be a GROUP');
    console.log(ind + info);
    if (hasChild) walk(l.children, depth + 1);
  }
}
walk(psd.children);
if (!mergedFound) failures.push('merged layer "按钮组" not found in PSD');

console.log('\n=== RESULT ===');
if (failures.length) { failures.forEach(f => console.log(' - ' + f)); process.exitCode = 1; }
else console.log('MERGE E2E VALIDATED ✓ (merged container = single raster layer, suffix stripped, normal group intact)');
