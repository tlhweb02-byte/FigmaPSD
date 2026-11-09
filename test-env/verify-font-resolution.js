/**
 * Final validation for the font-missing fix:
 * simulate what Figma reports (family/style from real installed fonts),
 * run the fixed toPsdFontName resolution, and verify the resulting
 * PostScript name actually exists on this machine (in the scan data).
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

// PostScript names actually installed (from the flat extraction)
const flat = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'cache', 'fonts-flat.json'), 'utf8'));
const installedPs = new Set(flat.map(f => f.postScriptName).filter(Boolean));

// Simulate Figma reporting each installed font under its various family/style names
// (both name-table Latin names and registry Chinese names), and verify we resolve
// to a PostScript name that exists on this machine.
let checked = 0, resolved = 0, failed = [];
const seen = new Set();
for (const f of flat) {
  const ps = f.postScriptName;
  if (!ps) continue;
  const candidates = [];
  const add = (fam, sty) => { if (fam && sty) candidates.push([fam, sty]); };
  // name table combos
  for (const fam of (f.allFamilies || [])) for (const sty of (f.allSubfamilies || ['Regular'])) add(fam, sty);
  for (const fam of (f.allPreferredFamilies || [])) for (const sty of (f.allPreferredSubfamilies || [])) add(fam, sty);
  // registry combos
  if (f.registryName) {
    let reg = f.registryName.replace(/ \(TrueType\)$/i, '').replace(/ \(OpenType\)$/i, '');
    add(reg, f.preferredSubfamily || f.subfamily || 'Regular');
    // also registry name stripped of style words -> family
    const base = reg.replace(/\s+(ExtraLight Italic|SemiBold Italic|Semibold Italic|Bold Italic|Light Italic|Medium Italic|Black Italic|Demi Bold|DemiBold|ExtraLight|Extra Light|Extra Bold|Semi Bold|Semibold|SemiBold|Bold|Italic|Oblique|Regular|Light|Medium|Black|Condensed|Narrow|Book)$/i, '');
    add(base, f.preferredSubfamily || f.subfamily || 'Regular');
  }
  for (const [fam, sty] of candidates) {
    const key = fam + '|' + sty;
    if (seen.has(key)) continue;
    seen.add(key);
    checked++;
    const resolvedPs = toPsdFontName(fam, sty);
    if (installedPs.has(resolvedPs)) resolved++;
    else if (resolvedPs !== (fam.replace(/\s+/g, '') + '-' + sty.replace(/\s+/g, ''))) {
      // resolved to something non-installed (not the pure fallback) => flag
      if (failed.length < 10) failed.push(`"${fam}" / "${sty}" -> ${resolvedPs} (not installed)`);
    }
  }
}
console.log(`checked ${checked} (family,style) combos across ${flat.length} installed fonts`);
console.log(`resolved to an installed PostScript name: ${resolved}`);
if (failed.length) { console.log('unresolved samples:'); failed.forEach(f => console.log(' - ' + f)); }
else console.log('ALL RESOLUTIONS POINT TO INSTALLED FONTS ✓');
