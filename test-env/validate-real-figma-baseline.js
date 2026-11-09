const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const path = require('path'), fs = require('fs');
// 用 Figma 真实渲染校验文字基线定位（画板 12170:4501「直接导出打标PSD」）。
// truth = Figma 字形渲染范围 + PS 原稿同字体字形偏移推算出的真实基线（两种推算一致，误差 <0.1px）。
// 用法：node test-env/validate-real-figma-baseline.js        （需要预装的 Playwright/Chromium）
const root = path.resolve(__dirname, '..');
const fixtures = path.join(__dirname, 'fixtures', 'figma-12170-4501');
const os = require('os');
const b64 = id => fs.readFileSync(path.join(fixtures, id.replace(':', '_') + '.png')).toString('base64');
// 来自 Figma REST API：文本框、渲染范围、样式；truth = 由渲染范围推算的真实基线
const T = [
  { id: '12170:4520', rw: 148.39, rh: 43.21, name: '活动价', text: '9999', box: [72, 702, 154, 53], render: [74.80, 711.18], font: 'HelveticaNowText-Bold', size: 58, lh: 58, align: 'center', shape: 'point', truth: 753.00 },
  { id: '12170:4521', rw: 92.42, rh: 20.86, name: '活动价 划线价', text: '¥9999', box: [235, 732, 93, 24], render: [235.29, 733.81], font: 'HelveticaNowText-Bold', size: 28, lh: 23.1, align: 'center', shape: 'point', truth: 754.00, strike: true },
  { id: '12170:4518', rw: 15.82, rh: 15.55, name: '活动价 起', text: '起', box: [236, 710, 17, 13], render: [236.56, 708.89], font: 'SourceHanSansCN-Regular', size: 16.9, lh: 12.7, align: 'center', shape: 'point', truth: 723.06, cjk: true },
  { id: '12170:4522', rw: 149.61, rh: 14.78, name: '*不同配色有价格差异', text: '*不同配色有价格差异', box: [46, 781, 152, 13], render: [47.29, 779.56], font: 'SourceHanSansCN-Regular', size: 16, lh: 12.1, align: 'center', shape: 'point', truth: 793.03, cjk: true },
  { id: '12170:4532', rw: 55.07, rh: 22.29, name: '当前售价', text: '999', box: [460, 739, 59, 30], render: [461.97, 743.28], font: 'HelveticaNowText-Medium', size: 30, lh: 30, align: 'center', shape: 'point', truth: 765.24 },
  { id: '12171:4540', rw: 164.76, rh: 16.47, name: '时间', text: '活动时间：5.31 - 6.3', box: [495, 680, 167, 16], render: [496.01, 679.95], font: 'SourceHanSansCN-Medium', size: 18, lh: 15.4, align: 'center', shape: 'point', truth: 695.00, cjk: true },
];
async function run(withMeasure) {
  const out = path.join(os.tmpdir(), 'figma-baseline-' + (withMeasure ? 'A' : 'B') + '.psd');
  const browser = await chromium.launch();
  const page = await browser.newPage({ acceptDownloads: true });
  page.on('dialog', d => { console.log('ALERT', d.message()); d.dismiss(); });
  await page.route('**/ag-psd@31.0.2/dist/bundle.js', r => r.fulfill({ path: path.join(root, 'node_modules/ag-psd/dist/bundle.js'), contentType: 'application/javascript' }));
  await page.goto('file://' + path.join(root, 'ui.html'));
  await page.waitForFunction(() => typeof agPsd !== 'undefined');
  const layers = T.map(t => ({
    id: t.id, name: t.name, kind: 'text', isGroup: false, visible: true, opacity: 1, blendMode: 'normal',
    x: t.box[0], y: t.box[1], width: t.box[2], height: t.box[3], parentId: null,
    renderX: Math.round(t.render[0]), renderY: Math.round(t.render[1]), pngBase64: b64(t.id), textBox: { x: t.box[0], y: t.box[1], width: t.box[2], height: t.box[3] }, glyphBox: { x: t.render[0], y: t.render[1], width: t.rw, height: t.rh },
    textData: { text: t.text, fontName: t.font, fontScript: t.cjk ? 3 : 0, fontType: t.cjk ? 2 : 0, fontSize: t.size, fontSizeScaled: t.size,
      ascentRatio: t.cjk ? 0.88 : 0.72, descentRatio: 0.2, fontAscentRatio: 0.9, shapeType: t.shape, autoHeight: false, multiLine: false,
      textAlignVertical: 'top', color: { r: 1, g: 1, b: 1, a: 1 }, align: t.align, lineHeight: t.lh, fauxBold: false, fauxItalic: false,
      underline: false, strikethrough: !!t.strike, fontCaps: 0, ...(withMeasure ? { baselineY: t.truth } : {}) }
  }));
  const dl = page.waitForEvent('download');
  await page.evaluate(({ layers, comp }) => window.postMessage({ pluginMessage: { type: 'export-data', artboardName: 'real', width: 800, height: 800, scale: 1, rootCompositePngBase64: comp, layers } }, '*'), { layers, comp: b64('12170:4501') });
  await (await dl).saveAs(out);
  await browser.close();
  const agp = require(root + '/node_modules/ag-psd');
  agp.initializeCanvas(() => { throw 0; }, (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }));
  const psd = agp.readPsd(fs.readFileSync(out), { skipCompositeImageData: true, skipLayerImageData: true, skipThumbnail: true });
  console.log(withMeasure ? 'A：有 Figma 实测基线' : 'B：无实测，退回像素检测');
  for (const l of psd.children) {
    const t = T.find(x => x.name === l.name);
    const y = l.text.transform[5], x = l.text.transform[4];
    const err = y - t.truth;
    const ok = Math.abs(err) <= 0.5 && Math.abs(x - (t.box[0] + t.box[2] / 2)) <= 0.01;
    if (!ok) failed++;
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${l.name.padEnd(12)} ${l.text.shapeType} 基线=${y.toFixed(2)} 真实=${t.truth.toFixed(2)} 误差=${err.toFixed(2)}px  锚点x=${x} (框中心 ${t.box[0] + t.box[2] / 2})`);
  }
}
let failed = 0;
(async () => {
  await run(true);
  await run(false);
  if (failed) { console.error(`${failed} 项超出 0.5px`); process.exit(1); }
  console.log('全部通过');
})().catch(e => { console.error(e); process.exit(1); });
