/**
 * Analyze the real PS file to derive the transform-anchor rule:
 * for point text, how does tx depend on justification (left/center/right)?
 * Also dump text.bounds / boundingBox (UnitsBounds) presence.
 */
const path = require('path');
const fs = require('fs');
const ENV_NM = path.resolve(__dirname, 'node_modules');
const { createCanvas } = require(path.join(ENV_NM, '@napi-rs/canvas'));
const agpsd = require(path.join(ENV_NM, 'ag-psd'));
agpsd.initializeCanvas(createCanvas);

const file = process.argv[2] || "C:\\Users\\jm038153\\Desktop\\打标源文件\\日销\\日销内购会.psd";
const psd = agpsd.readPsd(fs.readFileSync(file));

function walk(layers) {
  for (const layer of layers || []) {
    if (layer.text) {
      const t = layer.text;
      const just = (t.paragraphStyle && t.paragraphStyle.justification) || (t.paragraphStyleRuns && t.paragraphStyleRuns[0] && t.paragraphStyleRuns[0].style.justification) || '?';
      const cx = (layer.left + layer.right) / 2;
      console.log(`"${layer.name}"`);
      console.log(`  bounds=(${layer.left},${layer.top})-(${layer.right},${layer.bottom}) centerX=${cx.toFixed(1)}`);
      console.log(`  transform=(${t.transform[4].toFixed(2)}, ${t.transform[5].toFixed(2)})`);
      console.log(`  justification=${just}`);
      console.log(`  fontSize=${t.style && t.style.fontSize}`);
      console.log(`  has bounds field: ${!!t.bounds}  has boundingBox: ${!!t.boundingBox}`);
      if (t.bounds) console.log(`  bounds=`, JSON.stringify(t.bounds));
      if (t.boundingBox) console.log(`  boundingBox=`, JSON.stringify(t.boundingBox));
      console.log('');
    }
    if (layer.children) walk(layer.children);
  }
}
walk(psd.children);
