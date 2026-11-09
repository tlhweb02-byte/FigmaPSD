const fs = require('fs');
const file = 'C:/windows/Fonts/simsun.ttc';
const data = fs.readFileSync(file);
console.log('size', data.length);
console.log('tag', data.toString('latin1', 0, 4));
if (data.toString('latin1', 0, 4) === 'ttcf') {
  const numFonts = data.readUInt32BE(8);
  console.log('numFonts', numFonts);
  for (let i = 0; i < Math.min(numFonts, 4); i++) {
    const off = data.readUInt32BE(12 + i * 4);
    const sub = data.subarray(off);
    console.log('font', i, 'offset', off, 'tag', sub.toString('latin1', 0, 4));
    if (sub.length >= 12) {
      const numTables = sub.readUInt16BE(4);
      console.log('  numTables', numTables);
      const tables = {};
      for (let t = 0; t < numTables; t++) {
        const toff = 12 + t * 16;
        if (toff + 16 > sub.length) break;
        const ttag = sub.toString('latin1', toff, toff + 4);
        const t_off = sub.readUInt32BE(toff + 8);
        const t_len = sub.readUInt32BE(toff + 12);
        tables[ttag] = [t_off, t_len];
      }
      console.log('  tables:', Object.keys(tables).join(', '));
    }
  }
}
