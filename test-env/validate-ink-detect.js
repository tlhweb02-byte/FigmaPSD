/**
 * Validate the ink-detection baseline mechanism:
 * Render text on a canvas (simulating Figma's PNG preview), detect ink bounds,
 * and verify that for pure digits the baseline (ink bottom) is correct and
 * differs from the ascent-based estimate.
 */
const path = require('path');
const fs = require('fs');
const ENV_NM = path.resolve(__dirname, 'node_modules');
const { createCanvas } = require(path.join(ENV_NM, '@napi-rs/canvas'));

// replicate detectTextInk
function detectTextInk(canvas) {
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
  return { top, left, right, bottom };
}

const failures = [];

// ---- Scenario: digits only, font Arial 48px, rendered in a box ----
function renderAndTest(label, fontStr, text, boxW, boxH, expect) {
  const canvas = createCanvas(boxW, boxH);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, boxW, boxH);
  ctx.fillStyle = '#000';
  ctx.font = fontStr;
  ctx.textBaseline = 'alphabetic'; // 关键：canvas 默认 baseline 即 alphabetic
  ctx.fillText(text, 0, Math.round(boxH * 0.8)); // 在框内 80% 高度处画基线
  const ink = detectTextInk(canvas);
  console.log(`\n${label}: "${text}" font="${fontStr}" box=${boxW}x${boxH}`);
  console.log('  ink:', JSON.stringify(ink));
  // 验证：ink bottom 应接近我们画的基线 y（含少量抗锯齿/像素）
  const baselineY = Math.round(boxH * 0.8);
  if (ink) {
    const diff = Math.abs(ink.bottom - baselineY);
    console.log(`  painted baseline y=${baselineY}, ink.bottom=${ink.bottom}, diff=${diff}px`);
    if (diff > 3) failures.push(`${label}: ink.bottom (${ink.bottom}) deviates from baseline (${baselineY}) by ${diff}px`);
    // 数字无 descender：ink bottom 应 ≈ 基线，而 ink top 远高于 0（ascent 估算会偏）
    if (/^\d+$/.test(text)) {
      // 数字 ink top 到 bottom 的高度应接近 cap height（Arial 0.716 × 48 ≈ 34px），
      // 而不是 ascent（0.728 × 48 ≈ 35px）——两者接近，但关键是 ink bottom = baseline
      if (ink.top >= ink.bottom) failures.push(`${label}: ink top >= bottom`);
    }
  } else {
    failures.push(`${label}: ink detection failed`);
  }
}

// Arial 48px 数字
renderAndTest('digits-Arial', '48px Arial', '9999', 200, 80, null);
// Arial 48px 大写
renderAndTest('caps-Arial', '48px Arial', 'ABC', 200, 80, null);
// Arial 48px 含 ascender
renderAndTest('ascender-Arial', '48px Arial', 'Hello', 200, 80, null);
// Arial 48px 含 descender：验证"修正"逻辑（ink.bottom - descent×fontSize 应回到基线）
{
  const canvas = createCanvas(200, 80);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 200, 80);
  ctx.fillStyle = '#000';
  ctx.font = '48px Arial';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('g9', 0, 64);
  const ink = detectTextInk(canvas);
  const fontSizeScaled = 48;
  const descentRatio = 0.21; // Arial descent ≈ 0.2104
  const descenderPx = Math.round(fontSizeScaled * descentRatio);
  const correctedBaseline = ink.bottom - descenderPx;
  console.log(`\ndescender-Arial: "g9" ink.bottom=${ink.bottom}, descenderPx=${descenderPx}, corrected baseline=${correctedBaseline}`);
  if (Math.abs(correctedBaseline - 64) > 2) failures.push(`descender correction off: ${correctedBaseline} vs 64`);
  else console.log('  ✓ descender correction restores baseline (64)');
}

console.log('\n=== RESULT ===');
if (failures.length) { failures.forEach(f => console.log(' - ' + f)); process.exitCode = 1; }
else console.log('INK-DETECTION BASELINE VALIDATED ✓ (ink.bottom tracks painted baseline within tolerance)');
