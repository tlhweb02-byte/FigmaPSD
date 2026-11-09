/**
 * Inspect a user-exported PSD: dump text layer positions, transforms,
 * font sizes and resolution, to diagnose the digit-position offset.
 */
const path = require('path');
const fs = require('fs');
const ENV_NM = path.resolve(__dirname, 'node_modules');
const { createCanvas } = require(path.join(ENV_NM, '@napi-rs/canvas'));
const agpsd = require(path.join(ENV_NM, 'ag-psd'));
agpsd.initializeCanvas(createCanvas);

const file = process.argv[2];
if (!file) { console.error('usage: node inspect-exported.js <file.psd>'); process.exit(1); }
const psd = agpsd.readPsd(fs.readFileSync(file));
console.log('doc:', psd.width + 'x' + psd.height, 'res:', JSON.stringify(psd.imageResources && psd.imageResources.resolutionInfo));

function walk(layers, depth) {
  for (const l of layers || []) {
    const ind = '  '.repeat(depth);
    if (l.text) {
      const t = l.text;
      console.log(ind + 'TEXT "' + l.name + '" bounds=(' + l.left + ',' + l.top + ')-(' + l.right + ',' + l.bottom + ')');
      console.log(ind + '  fontSize=' + t.style.fontSize + ' font=' + (t.style.font && t.style.font.name));
      console.log(ind + '  transform=' + JSON.stringify(t.transform));
      console.log(ind + '  text="' + t.text.slice(0, 30) + '" shapeType=' + t.shapeType);
      console.log(ind + '  styleRuns=' + JSON.stringify(t.styleRuns));
    } else if (l.children) {
      console.log(ind + 'GROUP "' + l.name + '"');
    } else {
      console.log(ind + 'raster "' + l.name + '" bounds=(' + l.left + ',' + l.top + ')-(' + l.right + ',' + l.bottom + ')');
    }
    if (l.children) walk(l.children, depth + 1);
  }
}
walk(psd.children);
console.log('--- done ---');
