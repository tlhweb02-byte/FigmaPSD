/**
 * Read a REAL Photoshop-created PSD and dump ALL layer names + text details.
 */
const path = require('path');
const fs = require('fs');
const ENV_NM = path.resolve(__dirname, 'node_modules');
const { createCanvas } = require(path.join(ENV_NM, '@napi-rs/canvas'));
const agpsd = require(path.join(ENV_NM, 'ag-psd'));
agpsd.initializeCanvas(createCanvas);

const file = process.argv[2];
if (!file) { console.error('usage: node dump-psd-text.js <file.psd>'); process.exit(1); }
let psd;
try {
  psd = agpsd.readPsd(fs.readFileSync(file));
} catch (e) {
  console.error('READ FAILED:', e.message);
  process.exit(1);
}
console.log('doc:', psd.width, 'x', psd.height, 'children:', (psd.children || []).length);

let textCount = 0;
function walk(layers, depth = 0) {
  for (const layer of layers || []) {
    const ind = '  '.repeat(depth);
    if (layer.text) {
      textCount++;
      console.log(`${ind}★ TEXT "${layer.name}" bounds=(${layer.left},${layer.top})-(${layer.right},${layer.bottom})`);
      console.log(`${ind}  text="${layer.text.text}"`);
      console.log(`${ind}  transform=${JSON.stringify(layer.text.transform)}`);
      console.log(`${ind}  shapeType=${layer.text.shapeType} pointBase=${JSON.stringify(layer.text.pointBase)} boxBounds=${JSON.stringify(layer.text.boxBounds)}`);
      console.log(`${ind}  style=${JSON.stringify(layer.text.style)}`);
      console.log(`${ind}  styleRuns=${JSON.stringify(layer.text.styleRuns)}`);
      console.log(`${ind}  paragraphStyle=${JSON.stringify(layer.text.paragraphStyle)}`);
      console.log(`${ind}  paragraphStyleRuns=${JSON.stringify(layer.text.paragraphStyleRuns)}`);
      console.log(`${ind}  antiAlias=${layer.text.antiAlias} gridding=${layer.text.gridding} orientation=${layer.text.orientation}`);
    } else {
      const isGroup = !!layer.children;
      console.log(`${ind}${isGroup ? 'GROUP' : 'layer'} "${layer.name}"`);
    }
    if (layer.children) walk(layer.children, depth + 1);
  }
}
walk(psd.children);
console.log('text layers found:', textCount);
console.log('--- done ---');
