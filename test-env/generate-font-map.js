/**
 * Generate src/font-map.ts from the extracted installed-font data.
 *
 * Strategy: preferred family/subfamily (name IDs 16/17) is what modern apps
 * (incl. Figma) report, so it takes priority. Legacy family/subfamily (IDs 1/2)
 * and Windows registry display names are added only as fallback aliases for
 * fonts that lack preferred names. This avoids collisions like Arial Black
 * (preferred "Arial/Black") clobbering Arial Regular ("Arial/Regular").
 *
 * Also emits FONT_METRICS_MAP: PostScript name -> layout metrics
 * (ascent/descent as fractions of the em), used to compute the text baseline
 * position that Photoshop's TySh transform expects.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const CACHE_DIR = path.resolve(__dirname, 'cache');
const FLAT_PATH = process.argv[2] || path.join(CACHE_DIR, 'fonts-flat.json');
const OUT_PATH = process.argv[3] || path.resolve(__dirname, '..', 'src', 'font-map.ts');

const flat = JSON.parse(fs.readFileSync(FLAT_PATH, 'utf8'));
const metricsPath = path.join(CACHE_DIR, 'fonts-metrics.json');
const metricsByFile = fs.existsSync(metricsPath) ? JSON.parse(fs.readFileSync(metricsPath, 'utf8')) : {};

// map: family -> style -> postScriptName
const map = new Map();
// psName -> { ascent, descent } (fractions of em)
const metrics = new Map();

function setEntry(family, style, ps, overwrite) {
  if (!family || !style || !ps) return;
  const famKey = String(family).trim();
  const styleKey = String(style).trim();
  if (!famKey || !styleKey || !ps) return;
  if (!map.has(famKey)) map.set(famKey, new Map());
  const styleMap = map.get(famKey);
  if (!styleMap.has(styleKey) || overwrite) styleMap.set(styleKey, String(ps).trim());
}

function ascentRatio(m) {
  if (!m || m.unitsPerEm <= 0) return undefined;
  const upe = m.unitsPerEm;
  const typo = m.os2TypoAscender > 0 ? m.os2TypoAscender : undefined;
  const hhea = m.hheaAscender > 0 ? m.hheaAscender : undefined;
  const v = typo || hhea;
  return v ? v / upe : undefined;
}
function capHeightRatio(m) {
  if (!m || m.unitsPerEm <= 0) return undefined;
  const upe = m.unitsPerEm;
  if (m.os2CapHeight && m.os2CapHeight > 0) return m.os2CapHeight / upe;
  return undefined;
}
function descentRatio(m) {
  if (!m || m.unitsPerEm <= 0) return undefined;
  const upe = m.unitsPerEm;
  const typo = m.os2TypoDescender !== 0 ? Math.abs(m.os2TypoDescender) : undefined;
  const hhea = m.hheaDescender !== 0 ? Math.abs(m.hheaDescender) : undefined;
  const v = typo || hhea;
  return v ? v / upe : undefined;
}

function cleanRegistryName(name) {
  if (!name) return '';
  let s = name.replace(/ \(TrueType\)$/i, '')
             .replace(/ \(OpenType\)$/i, '')
             .replace(/ & .*$/, '');
  return s.trim();
}

// Known style/weight tokens to strip from registry display names to recover the
// base family name. Ordered longest-first to avoid partial matches.
const STYLE_TOKENS = [
  'ExtraLight Italic', 'SemiBold Italic', 'Semibold Italic', 'Extra Bold Italic',
  'Bold Italic', 'Light Italic', 'Medium Italic', 'Black Italic', 'Demi Bold',
  'DemiBold', 'ExtraLight', 'Extra Light', 'Extra Bold', 'Semi Bold', 'Semibold',
  'SemiBold', 'Bold', 'Italic', 'Oblique', 'Regular', 'Light', 'Medium', 'Black',
  'Condensed', 'Narrow', 'Book',
];

function stripStyleSuffix(name) {
  let s = name.trim();
  for (const tok of STYLE_TOKENS) {
    // match " Token" at end (case-insensitive) repeatedly
    const re = new RegExp('\\s+' + tok.replace(/ /g, '\\s+') + '$', 'i');
    s = s.replace(re, '');
  }
  return s.trim();
}

// Pass 1: authoritative preferred names (name IDs 16/17), all language variants
for (const f of flat) {
  const ps = f.postScriptName;
  if (!ps) continue;
  const fams = (f.allPreferredFamilies && f.allPreferredFamilies.length) ? f.allPreferredFamilies : (f.preferredFamily ? [f.preferredFamily] : []);
  const subs = (f.allPreferredSubfamilies && f.allPreferredSubfamilies.length) ? f.allPreferredSubfamilies : (f.preferredSubfamily ? [f.preferredSubfamily] : []);
  if (fams.length) {
    for (const fam of fams) {
      if (subs.length) {
        for (const sub of subs) setEntry(fam, sub, ps, true);
      } else {
        setEntry(fam, f.subfamily || 'Regular', ps, true);
      }
    }
  }
}

// Pass 2: legacy family/subfamily (IDs 1/2), all language variants — only fill gaps
for (const f of flat) {
  const ps = f.postScriptName;
  if (!ps) continue;
  const fams = (f.allFamilies && f.allFamilies.length) ? f.allFamilies : (f.family ? [f.family] : []);
  const subs = (f.allSubfamilies && f.allSubfamilies.length) ? f.allSubfamilies : (f.subfamily ? [f.subfamily] : ['Regular']);
  for (const fam of fams) {
    for (const sub of subs) setEntry(fam, sub, ps, false);
  }
  // full name as a direct alias for the family
  const fullNames = (f.allFullNames && f.allFullNames.length) ? f.allFullNames : (f.fullName ? [f.fullName] : []);
  for (const fn of fullNames) {
    setEntry(fn, 'Regular', ps, false);
  }
  // registry display name (Windows Chinese names often differ from name table)
  const reg = cleanRegistryName(f.registryName);
  if (reg) {
    setEntry(reg, f.preferredSubfamily || f.subfamily || 'Regular', ps, false);
    const base = stripStyleSuffix(reg);
    if (base && base !== reg) {
      setEntry(base, f.preferredSubfamily || f.subfamily || 'Regular', ps, false);
    }
  }
}

// Pass 3: metrics by PostScript name (from font file hhea/OS-2/head tables)
for (const f of flat) {
  const ps = f.postScriptName;
  if (!ps) continue;
  const m = f.file ? metricsByFile[f.file] : undefined;
  if (!m) continue;
  const asc = ascentRatio(m);
  const desc = descentRatio(m);
  const cap = capHeightRatio(m);
  if (asc !== undefined && desc !== undefined) {
    metrics.set(ps, { ascent: asc, descent: desc, capHeight: cap });
  }
}

// Build deterministic TS source
const familyNames = [...map.keys()].sort();
const lines = [];
lines.push('// 自动生成：本机已安装字体 -> Photoshop PostScript 名 + 布局度量映射');
lines.push('// 由 test-env/extract-font-names.js + extract-font-metrics.js + generate-font-map.js 生成，勿手改。');
lines.push('// 若换机器或增删字体，请重新生成（npm run build:fonts）。');
lines.push('');
lines.push('export type FontPsNameMap = Record<string, Record<string, string>>;');
lines.push('export type FontMetricsMap = Record<string, { ascent: number; descent: number; capHeight?: number }>;');
lines.push('');
lines.push('export const FONT_PS_NAME_MAP: FontPsNameMap = {');
for (const fam of familyNames) {
  const styleMap = map.get(fam);
  const styleNames = [...styleMap.keys()].sort();
  const entries = [];
  for (const style of styleNames) {
    entries.push(`    ${JSON.stringify(style)}: ${JSON.stringify(styleMap.get(style))}`);
  }
  lines.push(`  ${JSON.stringify(fam)}: {`);
  lines.push(entries.join(',\n'));
  lines.push('  },');
}
lines.push('};');
lines.push('');
lines.push('export const FONT_METRICS_MAP: FontMetricsMap = {');
const psNames = [...metrics.keys()].sort();
for (const ps of psNames) {
  const m = metrics.get(ps);
  const capPart = m.capHeight !== undefined ? `, capHeight: ${m.capHeight}` : '';
  lines.push(`  ${JSON.stringify(ps)}: { ascent: ${m.ascent}, descent: ${m.descent}${capPart} },`);
}
lines.push('};');
lines.push('');

const src = lines.join('\n');
fs.writeFileSync(OUT_PATH, src, 'utf8');
console.log(`generated ${OUT_PATH} with ${familyNames.length} families, ${psNames.length} metrics`);
