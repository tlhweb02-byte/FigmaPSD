/**
 * Dump the FULL TySh positioning data from a real Photoshop text layer:
 * - layer record bounds (what ag-psd writes as layer.top/left/right/bottom)
 * - text.transform (baseline origin matrix)
 * - text.left/top/right/bottom (the 4 floats in the TySh descriptor)
 */
const path = require('path');
const fs = require('fs');
const ENV_NM = path.resolve(__dirname, 'node_modules');
const { createCanvas } = require(path.join(ENV_NM, '@napi-rs/canvas'));
const agpsd = require(path.join(ENV_NM, 'ag-psd'));
agpsd.initializeCanvas(createCanvas);

const file = process.argv[2];
const psd = agpsd.readPsd(fs.readFileSync(file));
console.log('doc:', psd.width, 'x', psd.height);

function walk(layers, depth = 0) {
  for (const layer of layers || []) {
    const ind = '  '.repeat(depth);
    if (layer.text) {
      const t = layer.text;
      console.log(`${ind}★ "${layer.name}"`);
      console.log(`${ind}  layerRecord bounds=(${layer.left},${layer.top})-(${layer.right},${layer.bottom})  (w=${layer.right - layer.left}, h=${layer.bottom - layer.top})`);
      console.log(`${ind}  text.left/top/right/bottom=(${t.left},${t.top})-(${t.right},${t.bottom})  (w=${t.right - t.left}, h=${t.bottom - t.top})`);
      console.log(`${ind}  transform=${JSON.stringify(t.transform)}`);
      console.log(`${ind}  shapeType=${t.shapeType} pointBase=${JSON.stringify(t.pointBase)} boxBounds=${JSON.stringify(t.boxBounds)}`);
      console.log(`${ind}  fontSize=${t.style && t.style.fontSize} font=${t.style && t.style.font && t.style.font.name}`);
      console.log(`${ind}  styleRuns=${JSON.stringify(t.styleRuns)}`);
    } else if (layer.children) {
      console.log(`${ind}GROUP "${layer.name}"`);
    }
    if (layer.children) walk(layer.children, depth + 1);
  }
}
walk(psd.children);
