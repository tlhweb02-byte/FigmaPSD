/**
 * Extract font layout metrics (hhea/OS-2/head) alongside name tables,
 * so text baselines can be computed precisely for Photoshop.
 * Reads the fonts-flat pipeline CSV and appends metrics to a new JSON.
 */
const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.resolve(__dirname, 'cache');
const CSV_PATH = process.argv[2] || path.join(CACHE_DIR, 'fonts-list.csv');
const OUT_PATH = process.argv[3] || path.join(CACHE_DIR, 'fonts-metrics.json');

function u16(buf, off) { return buf.readUInt16BE(off); }
function u32(buf, off) { return buf.readUInt32BE(off); }

function getTable(data, tag, baseOffset) {
  // data = whole file (for TTC) ; baseOffset = start of the subfont's sfnt header
  if (data.length < baseOffset + 12) return null;
  const numTables = u16(data, baseOffset + 4);
  for (let i = 0; i < numTables; i++) {
    const off = baseOffset + 12 + i * 16;
    if (off + 16 > data.length) return null;
    if (data.toString('latin1', off, off + 4) === tag) {
      // table offset is relative to the WHOLE file (TrueType/OpenType & TTC)
      const tOff = u32(data, off + 8);
      const tLen = u32(data, off + 12);
      return { off: tOff, len: tLen };
    }
  }
  return null;
}

function parseMetrics(data) {
  let tag = data.toString('latin1', 0, 4);
  let baseOffset = 0;
  if (tag === 'ttcf') {
    const numFonts = u32(data, 8);
    if (numFonts < 1) return null;
    baseOffset = u32(data, 12);
    tag = data.toString('latin1', baseOffset, baseOffset + 4);
  }
  if (tag !== '\x00\x01\x00\x00' && tag !== 'OTTO' && tag !== 'true') return null;

  const headT = getTable(data, 'head', baseOffset);
  const hheaT = getTable(data, 'hhea', baseOffset);
  const os2T = getTable(data, 'OS/2', baseOffset);
  if (!headT || !hheaT || !os2T) return null;

  const head = data.subarray(headT.off, headT.off + headT.len);
  const hhea = data.subarray(hheaT.off, hheaT.off + hheaT.len);
  const os2 = data.subarray(os2T.off, os2T.off + os2T.len);
  if (head.length < 18 || hhea.length < 10 || os2.length < 76) return null;

  const i16 = (buf, off) => {
    const v = buf.readInt16BE(off);
    return v;
  };

  const os2Version = u16(os2, 0);
  // OS/2 sCapHeight 位于 offset 88（version >= 2 才有）；数字/大写字母的视觉顶部
  const os2CapHeight = (os2Version >= 2 && os2.length >= 90) ? i16(os2, 88) : undefined;
  // OS/2 sxHeight 位于 offset 86（小写 x 高度）
  const os2XHeight = (os2Version >= 2 && os2.length >= 88) ? i16(os2, 86) : undefined;

  return {
    unitsPerEm: u16(head, 18),
    hheaAscender: i16(hhea, 4),
    hheaDescender: i16(hhea, 6),
    hheaLineGap: i16(hhea, 8),
    os2TypoAscender: i16(os2, 68),
    os2TypoDescender: i16(os2, 70),
    os2TypoLineGap: i16(os2, 72),
    os2WinAscent: u16(os2, 74),
    os2WinDescent: u16(os2, 76),
    os2CapHeight: os2CapHeight,
    os2XHeight: os2XHeight,
  };
}

function main() {
  const csvText = fs.readFileSync(CSV_PATH, 'utf8').replace(/^\uFEFF/, '');
  const parseCsv = (text) => {
    const result = []; let row = []; let field = ''; let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
        else field += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ',') { row.push(field); field = ''; }
        else if (ch === '\n' || ch === '\r') {
          if (ch === '\r' && text[i + 1] === '\n') i++;
          row.push(field); field = '';
          if (row.some(c => c !== '')) result.push(row);
          row = [];
        } else field += ch;
      }
    }
    if (field !== '' || row.length) { row.push(field); if (row.some(c => c !== '')) result.push(row); }
    return result;
  };
  const parsedRows = parseCsv(csvText);
  const header = parsedRows[0];
  const rows = [];
  for (let i = 1; i < parsedRows.length; i++) {
    const cols = parsedRows[i];
    const row = {};
    header.forEach((h, idx) => { row[h] = (cols[idx] || '').trim(); });
    rows.push(row);
  }

  const out = {}; // file -> metrics
  let ok = 0;
  for (const f of rows) {
    const file = f.File;
    if (!file || !/\.(ttf|otf|ttc)$/i.test(file)) continue;
    if (!fs.existsSync(file)) continue;
    if (out[file]) continue;
    try {
      const m = parseMetrics(fs.readFileSync(file));
      if (m && m.unitsPerEm > 0) { out[file] = m; ok++; }
    } catch (e) { /* skip */ }
  }
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), 'utf8');
  console.log(`metrics for ${ok} font files -> ${OUT_PATH}`);
}

main();
