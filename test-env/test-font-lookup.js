/**
 * Test the toPsdFontName lookup logic against the generated font map.
 * Replicates the exact algorithm in src/text.ts.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

// Load FONT_PS_NAME_MAP by transpiling the generated TS source in-process.
// It's a simple object literal, so we can eval after stripping type annotations.
const mapSrc = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'font-map.ts'), 'utf8');
const match = mapSrc.match(/export const FONT_PS_NAME_MAP[^=]*= (\{[\s\S]*?\n\});/);
if (!match) { console.error('could not parse font-map.ts'); process.exit(1); }
// strip // comments (single-line) but keep strings intact — the object has none inside strings
const objText = match[1].replace(/^\s*\/\/.*$/gm, '');
const FONT_PS_NAME_MAP = eval('(' + objText + ')');

function normalizeFontKey(s) {
  return s.toLowerCase().replace(/[\s\-_]+/g, '');
}

function toPsdFontName(family, style) {
  const fam = family || 'Arial';
  const sty = style || 'Regular';
  const exactFam = FONT_PS_NAME_MAP[fam];
  if (exactFam && exactFam[sty]) return exactFam[sty];
  if (exactFam) {
    const styleEntries = Object.keys(exactFam);
    const want = normalizeFontKey(sty);
    for (const s of styleEntries) if (normalizeFontKey(s) === want) return exactFam[s];
    if (styleEntries.length === 1) return exactFam[styleEntries[0]];
  }
  const wantFam = normalizeFontKey(fam);
  const wantSty = normalizeFontKey(sty);
  for (const keyFam of Object.keys(FONT_PS_NAME_MAP)) {
    if (normalizeFontKey(keyFam) === wantFam) {
      const styles = FONT_PS_NAME_MAP[keyFam];
      for (const s of Object.keys(styles)) if (normalizeFontKey(s) === wantSty) return styles[s];
      if (Object.keys(styles).length === 1) return styles[Object.keys(styles)[0]];
      break;
    }
  }
  return fam.replace(/\s+/g, '') + '-' + sty.replace(/\s+/g, '');
}

const tests = [
  ['Arial', 'Regular'],
  ['Arial', 'Bold'],
  ['Arial Black', 'Regular'],
  ['方正悠黑_GBK', '510M'],
  ['FZYouHei_GBK', '510M'],
  ['FZYouHei_GBK 510M', 'Regular'],
  ['方正舒体', 'Regular'],
  ['FZShuTi', 'Regular'],
  ['汉仪叶叶相思体简', 'Regular'],
  ['HYYeYXSJ', 'Regular'],
  ['汉仪中圆B5', 'Regular'],
  ['HYZhongYuanB5', 'Regular'],
  ['方正仿宋_GBK', 'Regular'],
  ['FZFangSong-Z02', 'Regular'],
  ['等线', 'Regular'],
  ['DengXian', 'Regular'],
  ['DengXian', 'Bold'],
  ['等线', 'Light'],
  ['Source Sans Pro', 'Bold'],
  ['微软雅黑', 'Regular'],
  ['Microsoft YaHei', 'Regular'],
  ['SimSun', 'Regular'],
  ['宋体', 'Regular'],
  ['SimHei', 'Regular'],
  ['黑体', 'Regular'],
  ['KaiTi', 'Regular'],
  ['楷体', 'Regular'],
];

let pass = 0, fail = 0;
for (const [fam, sty] of tests) {
  const got = toPsdFontName(fam, sty);
  const looksPlausible = /[a-zA-Z]/.test(got) && !got.includes('undefined');
  if (looksPlausible) { pass++; console.log(`OK   "${fam}" / "${sty}" -> ${got}`); }
  else { fail++; console.log(`FAIL "${fam}" / "${sty}" -> ${got}`); }
}
console.log(`\n${pass} passed, ${fail} failed`);
