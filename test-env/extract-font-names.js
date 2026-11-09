/**
 * Extract full font name info: family(1), subfamily(2), postScript(6),
 * fullName(4), preferred family(16), preferred subfamily(17), typographic(16/17).
 * Outputs a flat JSON array.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const CACHE_DIR = path.resolve(__dirname, 'cache');
const CSV_PATH = process.argv[2] || path.join(CACHE_DIR, 'fonts-list.csv');
const OUT_PATH = process.argv[3] || path.join(CACHE_DIR, 'fonts-flat.json');

function readU16BE(buf, off) { return buf.readUInt16BE(off); }
function readU32BE(buf, off) { return buf.readUInt32BE(off); }

function readNameTable(data) {
  if (data.length < 12) return null;
  let tag = data.toString('latin1', 0, 4);
  let wholeFile = data; // for TTC, table offsets are relative to the WHOLE file
  if (tag === 'ttcf') {
    const numFonts = readU32BE(data, 8);
    if (numFonts < 1) return null;
    const offset = readU32BE(data, 12);
    // In a TrueType Collection, each subfont's table directory stores offsets
    // relative to the beginning of the ENTIRE TTC file (not the subfont).
    data = data.subarray(offset);
    tag = data.toString('latin1', 0, 4);
  } else {
    wholeFile = data;
  }
  if (tag !== '\x00\x01\x00\x00' && tag !== 'OTTO' && tag !== 'true') return null;

  const numTables = readU16BE(data, 4);
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const off = 12 + i * 16;
    if (off + 16 > data.length) return null;
    const ttag = data.toString('latin1', off, off + 4);
    tables[ttag] = [readU32BE(data, off + 8), readU32BE(data, off + 12)];
  }
  if (!tables['name']) return null;
  const [n_off, n_len] = tables['name'];
  // resolve name table bytes against the whole file (handles TTC)
  const base = wholeFile;
  if (n_off + n_len > base.length) return null;
  const nd = base.subarray(n_off, n_off + n_len);
  if (nd.length < 6) return null;
  const count = readU16BE(nd, 2);
  const strOffset = readU16BE(nd, 4);

  // Collect ALL name records (all languages), each as {text, score}.
  // We keep every unique string per nameId so both English and localized
  // (e.g. Chinese) family names are indexed, not just the "best" language.
  const cand = {}; // nameId -> Map(text -> score)
  for (let i = 0; i < count; i++) {
    const roff = 6 + i * 12;
    if (roff + 12 > nd.length) break;
    const platformId = readU16BE(nd, roff);
    const encodingId = readU16BE(nd, roff + 2);
    const languageId = readU16BE(nd, roff + 4);
    const nameId = readU16BE(nd, roff + 6);
    const length = readU16BE(nd, roff + 8);
    const offset = readU16BE(nd, roff + 10);
    const s = nd.subarray(strOffset + offset, strOffset + offset + length);
    let txt = null;
    if (platformId === 3 || (platformId === 0 && (encodingId === 3 || encodingId === 4))) {
      const le = Buffer.alloc(s.length);
      for (let j = 0; j + 1 < s.length; j += 2) { le[j] = s[j + 1]; le[j + 1] = s[j]; }
      txt = le.toString('utf16le').replace(/\0+$/, '');
    } else if (platformId === 1) {
      txt = s.toString('latin1');
    }
    if (txt == null || txt === '') continue;
    let score;
    if (platformId === 3) score = languageId === 0x0409 ? 400 : 300;
    else if (platformId === 0) score = 200;
    else score = 100;
    if (!cand[nameId]) cand[nameId] = new Map();
    const m = cand[nameId];
    if (!m.has(txt) || score > m.get(txt)) m.set(txt, score);
  }

  // best name (highest score) for single-value fields like PostScript name
  const best = (nid) => {
    const m = cand[nid];
    if (!m) return undefined;
    let bestTxt = undefined, bestScore = -1;
    for (const [txt, score] of m) if (score > bestScore) { bestScore = score; bestTxt = txt; }
    return bestTxt;
  };
  // all values for a nameId (for family/subfamily, index every language)
  const all = (nid) => {
    const m = cand[nid];
    if (!m) return [];
    return [...m.keys()].filter(t => t && t.trim());
  };

  return {
    family: best(1),
    subfamily: best(2),
    postScriptName: best(6),
    fullName: best(4),
    preferredFamily: best(16),
    preferredSubfamily: best(17),
    allFamilies: all(1),
    allSubfamilies: all(2),
    allPreferredFamilies: all(16),
    allPreferredSubfamilies: all(17),
    allFullNames: all(4),
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

  const flat = [];
  for (const f of rows) {
    const file = f.File;
    if (!file || !/\.(ttf|otf|ttc)$/i.test(file)) continue;
    if (!fs.existsSync(file)) continue;
    let info;
    try { info = readNameTable(fs.readFileSync(file)); }
    catch (e) { continue; }
    if (!info || !info.postScriptName) continue;
    info.registryName = f.RegistryName || '';
    info.file = file;
    flat.push(info);
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(flat, null, 2), 'utf8');
  console.log(`extracted ${flat.length} fonts`);
  console.log(`wrote ${OUT_PATH}`);
}

main();
