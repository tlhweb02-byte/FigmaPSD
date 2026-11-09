/**
 * Deep-dive a specific text layer in the user's exported PSD:
 * dump full text object incl. boxBounds, bounds, leading.
 */
const path = require('path');
const fs = require('fs');
const ENV_NM = path.resolve(__dirname, 'node_modules');
const { createCanvas } = require(path.join(ENV_NM, '@napi-rs/canvas'));
const agpsd = require(path.join(ENV_NM, 'ag-psd'));
agpsd.initializeCanvas(createCanvas);

const file = process.argv[2];
const nameFilter = process.argv[3];
const psd = agpsd.readPsd(fs.readFileSync(file));

function walk(layers) {
  for (const l of layers || []) {
    if (l.text && (!nameFilter || l.name.includes(nameFilter))) {
      const t = l.text;
      console.log('=== "' + l.name + '" ===');
      console.log('layerRecord bounds:', `(${l.left},${l.top})-(${l.right},${l.bottom}) w=${l.right-l.left} h=${l.bottom-l.top}`);
      console.log('text.left/top/right/bottom:', `(${t.left},${t.top})-(${t.right},${t.bottom})`);
      console.log('transform:', JSON.stringify(t.transform));
      console.log('shapeType:', t.shapeType, 'pointBase:', JSON.stringify(t.pointBase), 'boxBounds:', JSON.stringify(t.boxBounds));
      console.log('fontSize:', t.style.fontSize, 'leading:', t.style.leading, 'autoLeading:', t.style.autoLeading);
      console.log('justification:', t.paragraphStyle && t.paragraphStyle.justification);
      console.log('underline:', t.style.underline, 'strikethrough:', t.style.strikethrough);
    }
    if (l.children) walk(l.children);
  }
}
walk(psd.children);
