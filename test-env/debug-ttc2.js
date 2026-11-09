const fs = require('fs');
const file = 'C:/windows/Fonts/simsun.ttc';
const data0 = fs.readFileSync(file);

function readU16BE(buf, off) { return buf.readUInt16BE(off); }
function readU32BE(buf, off) { return buf.readUInt32BE(off); }

let data = data0;
// TTC
if (data.toString('latin1', 0, 4) === 'ttcf') {
  const off = readU32BE(data, 12);
  data = data.subarray(off);
}
const numTables = readU16BE(data, 4);
const tables = {};
for (let i = 0; i < numTables; i++) {
  const o = 12 + i * 16;
  const ttag = data.toString('latin1', o, o + 4);
  tables[ttag] = [readU32BE(data, o + 8), readU32BE(data, o + 12)];
}
const [n_off, n_len] = tables['name'];
const nd = data.subarray(n_off, n_off + n_len);
const count = readU16BE(nd, 2);
const strOffset = readU16BE(nd, 4);
console.log('name table count', count, 'strOffset', strOffset, 'len', n_len);

const names = {};
for (let i = 0; i < count; i++) {
  const roff = 6 + i * 12;
  const platformId = readU16BE(nd, roff);
  const encodingId = readU16BE(nd, roff + 2);
  const languageId = readU16BE(nd, roff + 4);
  const nameId = readU16BE(nd, roff + 6);
  const length = readU16BE(nd, roff + 8);
  const offset = readU16BE(nd, roff + 10);
  const s = nd.subarray(strOffset + offset, strOffset + offset + length);
  let txt;
  if (platformId === 3 || (platformId === 0 && (encodingId === 3 || encodingId === 4))) {
    const le = Buffer.alloc(s.length);
    for (let j = 0; j + 1 < s.length; j += 2) { le[j] = s[j + 1]; le[j + 1] = s[j]; }
    txt = le.toString('utf16le').replace(/\0+$/, '');
  } else if (platformId === 1) {
    txt = s.toString('latin1');
  } else {
    txt = null;
  }
  if (txt !== null) {
    const key = `${platformId}/${encodingId}/${languageId}/id${nameId}`;
    names[key] = txt;
    if ([1,2,6,16,17].includes(nameId)) {
      console.log(`p${platformId} e${encodingId} l${languageId} id${nameId} = "${txt}"`);
    }
  }
}
