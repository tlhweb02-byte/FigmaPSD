/**
 * Test harness v2: compare ag-psd 2.1.0 (plugin's current) vs 31.0.2 (fix).
 * Also test text layers WITH a raster canvas (recommended: keeps editable
 * text AND gives the layer real pixel bounds/content).
 */
const path = require('path');
const fs = require('fs');
const ROOT_NM = path.resolve(__dirname, '..', 'node_modules');
const ENV_NM = path.resolve(__dirname, 'node_modules');
const { createCanvas } = require(path.join(ENV_NM, '@napi-rs/canvas'));

let agpsdOld = null;
try {
  const pkg = require(path.join(ROOT_NM, 'ag-psd', 'package.json'));
  agpsdOld = require(path.join(ROOT_NM, 'ag-psd'));
  console.log('OLD ag-psd version:', pkg.version);
} catch (e) {
  console.log('no old ag-psd:', e.message);
}
const agpsdNew = require(path.join(ENV_NM, 'ag-psd'));
console.log('NEW ag-psd version:', require(path.join(ENV_NM, 'ag-psd', 'package.json')).version);
agpsdNew.initializeCanvas(createCanvas);

const OUT_DIR = path.join(__dirname, 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });

function makeImageCanvas(w, h) {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#ff8800');
  grad.addColorStop(1, '#0044ff');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  return c;
}

function makeTextCanvas(w, h) {
  // simulate the raster preview Figma would export for a text node
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ff0000';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('七夕快乐', 2, 24);
  return c;
}

function makeCompositeCanvas(w, h) {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#cccccc';
  ctx.fillRect(10, 10, w - 20, h - 20);
  return c;
}

const docW = 200, docH = 150;

// --- 2.1.0 write: what the plugin currently produces ---
if (agpsdOld) {
  const oldData = {
    width: docW, height: docH,
    canvas: makeCompositeCanvas(docW, docH),
    children: [
      {
        name: '标题(Text)',
        left: 20, top: 10, right: 120, bottom: 50,
        text: { text: '七夕快乐', style: { font: [{ name: 'SimSun', sizes: [24], colors: [{ r: 255, g: 0, b: 0, a: 255 }] }] } }
      },
      {
        name: '图片(Image)',
        left: 20, top: 60, right: 180, bottom: 140,
        canvas: makeImageCanvas(160, 80)
      }
    ]
  };
  try {
    const buf = agpsdOld.writePsd(oldData, { generateThumbnail: false });
    fs.writeFileSync(path.join(OUT_DIR, 'old-2.1.0.psd'), Buffer.from(buf));
    console.log('wrote old-2.1.0.psd', buf.byteLength, 'bytes');
  } catch (e) {
    console.log('OLD 2.1.0 write FAILED:', e.message);
  }
}

// --- 31.0.2 write A: text WITHOUT canvas (same as plugin's text-only payload) ---
const dataNoCanvas = {
  width: docW, height: docH,
  canvas: makeCompositeCanvas(docW, docH),
  children: [
    {
      name: '标题(Text-no-canvas)',
      left: 20, top: 10, right: 120, bottom: 50,
      text: {
        text: '七夕快乐',
        left: 20, top: 10, right: 120, bottom: 50,
        style: { font: { name: 'SimSun', script: 0, type: 0, synthetic: 0 }, fontSize: 24, fillColor: { r: 255, g: 0, b: 0 }, leading: 28 },
        paragraphStyle: { justification: 'left' },
        shapeType: 'point', pointBase: [20, 10]
      }
    },
    {
      name: '图片(Image)',
      left: 20, top: 60, right: 180, bottom: 140,
      canvas: makeImageCanvas(160, 80)
    }
  ]
};
const bufNoCanvas = agpsdNew.writePsd(dataNoCanvas, { generateThumbnail: false });
fs.writeFileSync(path.join(OUT_DIR, 'new-31.0.2-nocanvas.psd'), Buffer.from(bufNoCanvas));
console.log('wrote new-31.0.2-nocanvas.psd', bufNoCanvas.byteLength, 'bytes');

// --- 31.0.2 write B: text WITH raster canvas + TySh (recommended) ---
const dataWithCanvas = {
  width: docW, height: docH,
  canvas: makeCompositeCanvas(docW, docH),
  children: [
    {
      name: '标题(Text+canvas)',
      left: 20, top: 10, right: 120, bottom: 50,
      canvas: makeTextCanvas(100, 40),
      text: {
        text: '七夕快乐',
        left: 20, top: 10, right: 120, bottom: 50,
        style: { font: { name: 'SimSun', script: 0, type: 0, synthetic: 0 }, fontSize: 24, fillColor: { r: 255, g: 0, b: 0 }, leading: 28 },
        paragraphStyle: { justification: 'left' },
        shapeType: 'point', pointBase: [20, 10]
      }
    },
    {
      name: '图片(Image)',
      left: 20, top: 60, right: 180, bottom: 140,
      canvas: makeImageCanvas(160, 80)
    }
  ]
};
const bufWithCanvas = agpsdNew.writePsd(dataWithCanvas, { generateThumbnail: false });
fs.writeFileSync(path.join(OUT_DIR, 'new-31.0.2-withcanvas.psd'), Buffer.from(bufWithCanvas));
console.log('wrote new-31.0.2-withcanvas.psd', bufWithCanvas.byteLength, 'bytes');

// --- inspect all ---
function inspect(file) {
  const psd = agpsdNew.readPsd(fs.readFileSync(file));
  console.log(`\n=== ${path.basename(file)} (${psd.width}x${psd.height}) ===`);
  for (const layer of psd.children || []) {
    let info = `bounds=(${layer.left},${layer.top})-(${layer.right},${layer.bottom})`;
    if (layer.text) info += ` | TEXT="${layer.text.text}"`;
    if (layer.canvas) {
      const img = layer.canvas.getContext('2d').getImageData(0, 0, layer.canvas.width, layer.canvas.height);
      let opaque = 0;
      for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 0) opaque++;
      info += ` | canvas ${layer.canvas.width}x${layer.canvas.height} opaque=${opaque}`;
    } else {
      info += ' | NO canvas';
    }
    console.log(`- "${layer.name}" ${info}`);
  }
}

for (const f of fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.psd'))) {
  try { inspect(path.join(OUT_DIR, f)); } catch (e) { console.log('inspect failed', f, e.message); }
}
