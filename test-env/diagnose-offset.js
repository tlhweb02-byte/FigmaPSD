/**
 * 诊断文本层位置偏移：
 * 1. 读取已导出 PSD 的实际 transform/boxBounds
 * 2. 模拟 Figma 导出逻辑计算期望值（用 fallback 度量）
 * 3. 对比偏移方向和像素数
 * 4. 用 PS 真实度量重新计算，看能否对齐
 */
const path = require('path');
const fs = require('fs');
const ENV_NM = path.resolve(__dirname, 'node_modules');
const { createCanvas } = require(path.join(ENV_NM, '@napi-rs/canvas'));
const agpsd = require(path.join(ENV_NM, 'ag-psd'));
agpsd.initializeCanvas(createCanvas);

const PSD_FILE = process.argv[2] || String.raw`C:\Users\jm038153\Desktop\直接导出打标PSD.psd`;

// ---- font metrics fallback (same as text.ts) ----
function isCjkFont(family) {
  return /[\u4e00-\u9fff]/.test(family) || /^(PingFang|Source Han|思源|微软雅黑|Microsoft YaHei|SimSun|SimHei|宋体|黑体|等线|DengXian|方正|FZ|汉仪|HY)/i.test(family);
}

function getAscentFallback(family) {
  return isCjkFont(family) ? 0.88 : 0.8;
}
function getCapHeightFallback() { return 0.72; } // generic

// PS 真实度量（来自手测或 Real PS 参考文件）
const KNOWN_METRICS = {
  'HelveticaNowText-Bold':  { ascent: 0.724, descent: 0.213, capHeight: 0.535 },
  'HelveticaNowText-Medium':{ ascent: 0.724, descent: 0.213, capHeight: 0.535 },
  'SourceHanSansCN-Regular':{ ascent: 0.889, descent: 0.111, capHeight: 0.710 },
  'SourceHanSansCN-Medium': { ascent: 0.889, descent: 0.111, capHeight: 0.710 },
};

function getTopToBaseline(family, text) {
  const psName = family; // simplified: family = PS name in our dump
  const m = KNOWN_METRICS[psName];
  let ascent = m ? m.ascent : getAscentFallback(family);
  let cap = m ? m.capHeight : getCapHeightFallback();
  // 数字/大写文本用 cap height
  const hasCjk = /[\u4e00-\u9fff]/.test(text);
  const hasAscender = /[bdfhkl]/.test(text);
  if (hasCjk || hasAscender) return ascent;
  return cap || ascent;
}

function getDescent(family) {
  const m = KNOWN_METRICS[family];
  return m ? m.descent : (isCjkFont(family) ? 0.12 : 0.2);
}

// ---- 读取 PSD ----
const psd = agpsd.readPsd(fs.readFileSync(PSD_FILE));
console.log(`\n=== PSD: ${psd.width}x${psd.height} ===\n`);
console.log('根据 ui.html 导出逻辑，比较每层的 transform e,f（基线锚点）：\n');

const scale = 2; // 从 dump-text-position.js 结果推断

function walk(layers) {
  for (const layer of layers || []) {
    if (layer.text) {
      const t = layer.text;
      const layerLR = `(${layer.left},${layer.top})-(${layer.right},${layer.bottom})`;
      const w = layer.right - layer.left;
      const h = layer.bottom - layer.top;
      const textLR = t.left !== undefined
        ? `(${t.left},${t.top})-(${t.right},${t.bottom})`
        : 'N/A';
      const tx = t.transform ? t.transform[4] : '?';
      const ty = t.transform ? t.transform[5] : '?';
      const shape = t.shapeType || 'point';
      const boxB = t.boxBounds ? JSON.stringify(t.boxBounds) : 'none';
      const fontName = t.style?.font?.name || '?';
      const fontSize = t.style?.fontSize || '?';
      const text = t.text || '';

      console.log(`--- ${layer.name} ---`);
      console.log(`  layerBounds: ${layerLR}  (w=${w}, h=${h})`);
      console.log(`  textBounds:  ${textLR}`);
      console.log(`  transform:   [1,0,0,1, ${tx}, ${ty}]`);
      console.log(`  shapeType:   ${shape}`);
      console.log(`  boxBounds:   ${boxB}`);
      console.log(`  font:        ${fontName}, fontSize=${fontSize}pt`);
      console.log(`  text:        "${text.slice(0, 30)}"`);

      // ---- 重新计算期望值 ----
      const left = layer.left;
      const top = layer.top;
      const fontSizeNum = parseFloat(fontSize) || 16;
      const fontSizeScaled = fontSizeNum * scale;

      if (shape === 'point') {
        const ascentRatio = getTopToBaseline(fontName, text);
        const expectedBaselineY = top + Math.round(fontSizeScaled * ascentRatio);
        const align = t.paragraphStyle?.justification || 'left';
        let expectedAnchorX = left;
        if (align === 'center') expectedAnchorX = Math.round((left + layer.right) / 2);
        else if (align === 'right') expectedAnchorX = layer.right;

        const deltaY = parseFloat(ty) - expectedBaselineY;
        const deltaX = parseFloat(tx) - expectedAnchorX;
        console.log(`  [期望计算]  ascentRatio=${ascentRatio.toFixed(4)}  fontSizeScaled=${fontSizeScaled}`);
        console.log(`              expectedBaselineY=${expectedBaselineY}  actual ty=${ty}  deltaY=${deltaY > 0 ? '+' : ''}${deltaY.toFixed(1)}`);
        console.log(`              expectedAnchorX=${expectedAnchorX}  actual tx=${tx}  deltaX=${deltaX > 0 ? '+' : ''}${deltaX.toFixed(1)}`);
      } else {
        // box 文本：transform=[1,0,0,1,0,0]，boxBounds 应是绝对坐标
        const boxBoundsCorrect = t.boxBounds &&
          t.boxBounds[0] === left && t.boxBounds[1] === top;
        console.log(`  [box 检查]  transform 为单位阵: ${tx === 0 && ty === 0 ? '✓' : '✗ (e=' + tx + ',f=' + ty + ')'}`);
        console.log(`              boxBounds 起点与 layerBounds 一致: ${boxBoundsCorrect ? '✓' : '✗'}`);
        if (t.boxBounds) {
          console.log(`              boxBounds 底部=${t.boxBounds[3]}, layerBounds 底部=${layer.bottom}  差=${t.boxBounds[3] - layer.bottom}`);
        }
      }
      console.log('');
    }
    if (layer.children) walk(layer.children);
  }
}
walk(psd.children);
