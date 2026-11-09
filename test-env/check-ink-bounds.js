/**
 * 检查每个文本层 PNG 的 ink bounds
 */
const path = require('path');
const fs = require('fs');
const ENV_NM = path.resolve(__dirname, 'node_modules');
const { createCanvas, Image } = require(path.join(ENV_NM, '@napi-rs/canvas'));
const agpsd = require(path.join(ENV_NM, 'ag-psd'));
agpsd.initializeCanvas(createCanvas);

const file = process.argv[2];
const psd = agpsd.readPsd(fs.readFileSync(file));

function detectTextInk(canvas) {
  try {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const data = ctx.getImageData(0, 0, w, h).data;
    let top = h, left = w, right = -1, bottom = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const a = data[(y * w + x) * 4 + 3];
        if (a > 0) {
          if (y < top) top = y;
          if (y > bottom) bottom = y;
          if (x < left) left = x;
          if (x > right) right = x;
        }
      }
    }
    if (bottom < 0) return null;
    return { top, left, right, bottom, w, h };
  } catch (e) {
    return null;
  }
}

function walk(layers, depth = 0) {
  for (const layer of layers || []) {
    if (layer.text) {
      const t = layer.text;
      const layerW = layer.right - layer.left;
      const layerH = layer.bottom - layer.top;
      const textW = t.right - t.left;
      const textH = t.bottom - t.top;
      const tx = t.transform?.[4];
      const ty = t.transform?.[5];
      const fontSize = t.style?.fontSize;
      const fontName = t.style?.font?.name;
      const shapeType = t.shapeType || 'point';

      // canvas is the PNG preview
      if (layer.canvas) {
        const ink = detectTextInk(layer.canvas);
        console.log(`\n=== ${layer.name} ===`);
        console.log(`  font=${fontName}, fontSize=${fontSize}pt, shape=${shapeType}`);
        console.log(`  canvas: ${layer.canvas.width}x${layer.canvas.height}`);
        console.log(`  layerBounds: (${layer.left},${layer.top})-(${layer.right},${layer.bottom})  h=${layerH}`);
        console.log(`  textBounds:  (${t.left},${t.top})-(${t.right},${t.bottom})  h=${textH}`);
        console.log(`  transform e,f: (${tx}, ${ty})`);
        if (ink) {
          console.log(`  ink: top=${ink.top} bottom=${ink.bottom} left=${ink.left} right=${ink.right}  (ink h=${ink.bottom - ink.top})`);
          console.log(`  ink.bottom relative to layer top: ${ink.bottom} (PNG top is 0, layer.top=${layer.top})`);
          if (shapeType === 'point') {
            const hasDescender = /[gjpqy]/.test(t.text || '');
            console.log(`  hasDescender: ${hasDescender}`);
            if (hasDescender) {
              const descenderPx = Math.round(fontSize * 2 * 0.2); // descentRatio 0.2
              console.log(`  estimated descender: ${descenderPx}px`);
              const baselineFromInk = layer.top + ink.bottom;
              const baselineFromInkNoDesc = layer.top + ink.bottom - descenderPx;
              console.log(`  baseline from ink (no desc): ${baselineFromInk}`);
              console.log(`  baseline from ink (with desc): ${baselineFromInkNoDesc}`);
            } else {
              console.log(`  baseline from ink: ${layer.top + ink.bottom}`);
            }
          }
        } else {
          console.log(`  ink: NONE`);
        }
      }
    }
    if (layer.children) walk(layer.children, depth + 1);
  }
}
walk(psd.children);
