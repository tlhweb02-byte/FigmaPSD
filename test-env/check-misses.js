/**
 * Identify which (family, style) combos fall through to the heuristic fallback
 * (i.e. NOT resolved via the map). Verify they're unimportant edge cases.
 */
const fs = require('fs');
const path = require('path');

const mapSrc = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'font-map.ts'), 'utf8');
const match = mapSrc.match(/export const FONT_PS_NAME_MAP[^=]*= (\{[\s\S]*?\n\});/);
const FONT_PS_NAME_MAP = eval('(' + match[1].replace(/^\s*\/\/.*$/gm, '') + ')');

function normalizeFontKey(s) { return s.toLowerCase().replace(/[\s\-_]+/g, ''); }
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

const flat = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'cache', 'fonts-flat.json'), 'utf8'));
const installedPs = new Set(flat.map(f => f.postScriptName).filter(Boolean));

const misses = [];
const seen = new Set();
for (const f of flat) {
  const ps = f.postScriptName;
  if (!ps) continue;
  const candidates = [];
  const add = (fam, sty) => { if (fam && sty) candidates.push([fam, sty]); };
  for (const fam of (f.allFamilies || [])) for (const sty of (f.allSubfamilies || ['Regular'])) add(fam, sty);
  for (const fam of (f.allPreferredFamilies || [])) for (const sty of (f.allPreferredSubfamilies || [])) add(fam, sty);
  if (f.registryName) {
    let reg = f.registryName.replace(/ \(TrueType\)$/i, '').replace(/ \(OpenType\)$/i, '');
    add(reg, f.preferredSubfamily || f.subfamily || 'Regular');
  }
  for (const [fam, sty] of candidates) {
    const key = fam + '|' + sty;
    if (seen.has(key)) continue;
    seen.add(key);
    const resolvedPs = toPsdFontName(fam, sty);
    const fallback = fam.replace(/\s+/g, '') + '-' + sty.replace(/\s+/g, '');
    if (!installedPs.has(resolvedPs) && resolvedPs === fallback) {
      misses.push({ fam, sty, fallback, actual: ps, file: path.basename(f.file) });
    }
  }
}
console.log(`fallback misses: ${misses.length}`);
misses.forEach(m => console.log(`  "${m.fam}" / "${m.sty}" -> fallback "${m.fallback}" (actual PS: ${m.actual}, ${m.file})`));
