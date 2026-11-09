/**
 * End-to-end simulation of the FIXED plugin flow.
 *
 * Simulates:
 *  1. exporter.ts output: layer payloads with pngBase64 for ALL layers
 *     (image + text) + textData for text layers
 *  2. ui.html generatePsdFile logic (verbatim port): builds layer objects,
 *     groups, root composite, writes PSD with ag-psd 31.0.2
 *  3. Reads back with ag-psd 31.0.2 and verifies: text preserved (TySh),
 *     images have real pixels at correct bounds, group structure intact.
 */
const path = require('path');
const fs = require('fs');
const ENV_NM = path.resolve(__dirname, 'node_modules');
const { createCanvas } = require(path.join(ENV_NM, '@napi-rs/canvas'));
const agpsd = require(path.join(ENV_NM, 'ag-psd'));
agpsd.initializeCanvas(createCanvas);

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

// ==================== helpers ====================
function uint8ToBase64(bytes) {
  // tiny base64 for small test PNGs
  return Buffer.from(bytes).toString('base64');
}

function makePngCanvas(w, h, fillStyle) {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = fillStyle || '#ff8800';
  ctx.fillRect(0, 0, w, h);
  // draw some content so it's not empty
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('img', 4, 20);
  return c;
}

function canvasToPngBase64(canvas) {
  return canvas.toBuffer('image/png').toString('base64');
}

// ==================== simulate exporter payload ====================
// Artboard 200x150, scale=2 => doc 400x300
const SCALE = 2;
const artboardName = '七夕测试';
const rootBounds = { x: 0, y: 0, width: 200, height: 150 };

// root composite PNG (simulate exportAsync of artboard)
const rootCanvas = createCanvas(200 * SCALE, 150 * SCALE);
{
  const ctx = rootCanvas.getContext('2d');
  ctx.fillStyle = '#f5f5f5';
  ctx.fillRect(0, 0, 200 * SCALE, 150 * SCALE);
}

// layers (what collectNodes + exporter would produce)
// 1. background (image)
const bgCanvas = makePngCanvas(200 * SCALE, 150 * SCALE, '#ffe0e0');
// 2. text layer "七夕快乐" at (20,10) size 100x40
const textCanvas = createCanvas(100 * SCALE, 40 * SCALE);
{
  const ctx = textCanvas.getContext('2d');
  ctx.fillStyle = '#ff0000';
  ctx.font = 'bold ' + (24 * SCALE) + 'px sans-serif';
  ctx.fillText('七夕快乐', 4 * SCALE, 28 * SCALE);
}
// 3. image layer at (20,60) size 160x80
const imgCanvas = makePngCanvas(160 * SCALE, 80 * SCALE, '#4488ff');
// 4. image inside a group (group "小组" at (10,10) size 180x130, child at (100,70) size 40x40)
const groupChildCanvas = makePngCanvas(40 * SCALE, 40 * SCALE, '#22aa44');

const layers = [
  {
    id: 'bg', name: '背景', kind: 'image', isGroup: false, visible: true, opacity: 1,
    blendMode: 'normal', x: 0, y: 0, width: 200 * SCALE, height: 150 * SCALE,
    parentId: null, pngBase64: canvasToPngBase64(bgCanvas)
  },
  {
    id: 'text1', name: '标题文字', kind: 'text', isGroup: false, visible: true, opacity: 1,
    blendMode: 'normal', x: 20 * SCALE, y: 10 * SCALE, width: 100 * SCALE, height: 40 * SCALE,
    parentId: null,
    pngBase64: canvasToPngBase64(textCanvas),
    textData: {
      text: '七夕快乐',
      fontName: 'SourceHanSansCN-Regular',
      fontScript: 3,
      fontType: 2,
      fontSize: 24 * SCALE,
      color: { r: 1, g: 0, b: 0, a: 1 },
      align: 'center',
      letterSpacing: 50,
      lineHeight: 30 * SCALE,
      fauxBold: false,
      fauxItalic: false,
      underline: false,
      strikethrough: false
    }
  },
  {
    id: 'img1', name: '图片', kind: 'image', isGroup: false, visible: true, opacity: 1,
    blendMode: 'normal', x: 20 * SCALE, y: 60 * SCALE, width: 160 * SCALE, height: 80 * SCALE,
    parentId: null, pngBase64: canvasToPngBase64(imgCanvas)
  },
  {
    id: 'grp1', name: '小组', kind: 'group', isGroup: true, visible: true, opacity: 1,
    blendMode: 'pass through', x: 10 * SCALE, y: 10 * SCALE, width: 180 * SCALE, height: 130 * SCALE,
    parentId: null
  },
  {
    id: 'grpchild1', name: '组内元素', kind: 'image', isGroup: false, visible: true, opacity: 1,
    blendMode: 'normal', x: 100 * SCALE, y: 70 * SCALE, width: 40 * SCALE, height: 40 * SCALE,
    parentId: 'grp1', pngBase64: canvasToPngBase64(groupChildCanvas)
  }
];

// ==================== ui.html generatePsdFile (verbatim port) ====================
const ALLOWED_AG_PSD_MODES = new Set([
  'normal', 'pass through', 'darken', 'multiply', 'color burn', 'linear burn',
  'darker color', 'lighten', 'screen', 'color dodge', 'linear dodge',
  'lighter color', 'overlay', 'soft light', 'hard light', 'vivid light',
  'linear light', 'pin light', 'hard mix', 'difference', 'exclusion',
  'subtract', 'divide', 'hue', 'saturation', 'color', 'luminosity'
]);

function sanitizeBlendMode(blendMode, isGroup) {
  if (!blendMode) return 'normal';
  let mode = String(blendMode).toLowerCase().trim();
  if (mode === 'passthrough' || mode === 'pass-through') mode = 'pass through';
  if (mode === 'colorburn' || mode === 'color-burn') mode = 'color burn';
  if (mode === 'linearburn' || mode === 'linear-burn') mode = 'linear burn';
  if (mode === 'darkercolor' || mode === 'darker-color') mode = 'darker color';
  if (mode === 'colordodge' || mode === 'color-dodge') mode = 'color dodge';
  if (mode === 'lineardodge' || mode === 'linear-dodge') mode = 'linear dodge';
  if (mode === 'lightercolor' || mode === 'lighter-color') mode = 'lighter color';
  if (mode === 'softlight' || mode === 'soft-light') mode = 'soft light';
  if (mode === 'hardlight' || mode === 'hard-light') mode = 'hard light';
  if (mode === 'vividlight' || mode === 'vivid-light') mode = 'vivid light';
  if (mode === 'linearlight' || mode === 'linear-light') mode = 'linear light';
  if (mode === 'pinlight' || mode === 'pin-light') mode = 'pin light';
  if (mode === 'hardmix' || mode === 'hard-mix') mode = 'hard mix';
  if (!ALLOWED_AG_PSD_MODES.has(mode)) return 'normal';
  if (!isGroup && mode === 'pass through') return 'normal';
  return mode;
}

function base64ToCanvasOnly(base64Str, layerName) {
  return new Promise((resolve) => {
    if (!base64Str) {
      const emptyCanvas = createCanvas(1, 1);
      resolve({ canvas: emptyCanvas, w: 1, h: 1 });
      return;
    }
    const img = new (require(path.join(ENV_NM, '@napi-rs/canvas'))).Image();
    img.onload = () => {
      const w = img.width;
      const h = img.height;
      const canvas = createCanvas(w, h);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      resolve({ canvas: canvas, w: w, h: h });
    };
    img.onerror = () => {
      const emptyCanvas = createCanvas(1, 1);
      resolve({ canvas: emptyCanvas, w: 1, h: 1 });
    };
    img.src = 'data:image/png;base64,' + base64Str;
  });
}

async function generatePsdFile(data) {
  const { artboardName, rootCompositePngBase64, layers } = data;
  const { canvas: rootCanvas } = await base64ToCanvasOnly(rootCompositePngBase64, 'RootComposite');
  const docWidth = rootCanvas.width;
  const docHeight = rootCanvas.height;

  const layerMap = new Map();
  const rootChildren = [];

  for (const layer of layers) {
    if (layer.isGroup) {
      const groupObj = {
        name: layer.name,
        hidden: layer.visible === false,
        blendMode: sanitizeBlendMode(layer.blendMode, true),
        opened: true,
        left: 0,
        top: 0,
        right: docWidth,
        bottom: docHeight,
        children: []
      };
      if (typeof layer.opacity === 'number' && layer.opacity < 0.99) {
        groupObj.opacity = layer.opacity;
      }
      layerMap.set(layer.id, groupObj);
    } else if (layer.kind === 'text' && layer.textData) {
      const left = Math.round(layer.x);
      const top = Math.round(layer.y);
      const right = left + Math.round(layer.width);
      const bottom = top + Math.round(layer.height);

      const c = layer.textData.color;
      const rVal = c.r <= 1 ? Math.round(c.r * 255) : Math.round(c.r);
      const gVal = c.g <= 1 ? Math.round(c.g * 255) : Math.round(c.g);
      const bVal = c.b <= 1 ? Math.round(c.b * 255) : Math.round(c.b);
      const aVal = c.a <= 1 ? Math.round(c.a * 255) : Math.round(c.a);

      const textLayerObj = {
        name: layer.name,
        hidden: layer.visible === false,
        blendMode: sanitizeBlendMode(layer.blendMode, false),
        left: left,
        top: top,
        right: right,
        bottom: bottom,
        text: {
          text: layer.textData.text,
          left: left,
          top: top,
          right: right,
          bottom: bottom,
          transform: [1, 0, 0, 1, left, bottom],
          shapeType: 'point',
          pointBase: [0, 0],
          antiAlias: 'sharp',
          gridding: 'none',
          orientation: 'horizontal',
          index: 0,
          style: {
            font: {
              name: layer.textData.fontName || 'ArialMT',
              script: layer.textData.fontScript || 0,
              type: layer.textData.fontType || 0,
              synthetic: 0
            },
            fontSize: layer.textData.fontSize || 16,
            autoLeading: !layer.textData.lineHeight,
            leading: layer.textData.lineHeight || 0,
            tracking: layer.textData.letterSpacing || 0,
            fauxBold: !!layer.textData.fauxBold,
            fauxItalic: !!layer.textData.fauxItalic,
            underline: !!layer.textData.underline,
            strikethrough: !!layer.textData.strikethrough,
            autoKerning: true,
            kerning: 0,
            baselineShift: 0,
            fillColor: { r: rVal, g: gVal, b: bVal },
            strokeColor: { r: rVal, g: gVal, b: bVal },
            fillFlag: true,
            strokeFlag: false,
            fillFirst: true,
            horizontalScale: 1,
            verticalScale: 1,
            ligatures: true,
            baselineDirection: 2,
            styleRunAlignment: 2,
            language: 0,
            noBreak: false,
            yUnderline: 1,
            outlineWidth: 1,
            characterDirection: 0,
            hindiNumbers: false,
            kashida: 1,
            diacriticPos: 2
          },
          paragraphStyle: {
            justification: layer.textData.align || 'left',
            firstLineIndent: 0,
            startIndent: 0,
            endIndent: 0,
            spaceBefore: 0,
            spaceAfter: 0,
            autoHyphenate: true,
            hyphenatedWordSize: 6,
            preHyphen: 2,
            postHyphen: 2,
            consecutiveHyphens: 8,
            zone: 36,
            wordSpacing: [0.8, 1, 1.33],
            letterSpacing: [0, 0, 0],
            glyphSpacing: [1, 1, 1],
            autoLeading: layer.textData.lineHeight ? 1 : 1.2,
            leadingType: 0,
            hanging: false,
            burasagari: false,
            kinsokuOrder: 0,
            everyLineComposer: false
          }
        }
      };

      if (typeof layer.opacity === 'number' && layer.opacity < 0.99) {
        textLayerObj.opacity = layer.opacity;
      }

      if (layer.pngBase64) {
        const { canvas } = await base64ToCanvasOnly(layer.pngBase64, layer.name);
        textLayerObj.canvas = canvas;
      } else {
        const emptyCanvas = createCanvas(Math.max(1, right - left), Math.max(1, bottom - top));
        textLayerObj.canvas = emptyCanvas;
      }

      layerMap.set(layer.id, textLayerObj);
    } else {
      const { canvas } = await base64ToCanvasOnly(layer.pngBase64, layer.name);

      const left = Math.round(layer.x);
      const top = Math.round(layer.y);
      const right = left + canvas.width;
      const bottom = top + canvas.height;

      const layerObj = {
        name: layer.name,
        hidden: layer.visible === false,
        blendMode: sanitizeBlendMode(layer.blendMode, false),
        left: left,
        top: top,
        right: right,
        bottom: bottom,
        canvas: canvas
      };

      if (typeof layer.opacity === 'number' && layer.opacity < 0.99) {
        layerObj.opacity = layer.opacity;
      }

      layerMap.set(layer.id, layerObj);
    }
  }

  for (const layer of layers) {
    const currentObj = layerMap.get(layer.id);
    if (!currentObj) continue;

    if (layer.parentId && layerMap.has(layer.parentId)) {
      const parentGroup = layerMap.get(layer.parentId);
      if (parentGroup.children) {
        parentGroup.children.push(currentObj);
      }
    } else {
      rootChildren.push(currentObj);
    }
  }

  const psdData = {
    width: docWidth,
    height: docHeight,
    canvas: rootCanvas,
    children: rootChildren
  };

  const psdBuffer = agpsd.writePsd(psdData, { generateThumbnail: true, noBackground: true });
  return Buffer.from(psdBuffer);
}

(async () => {
  const psdBuf = await generatePsdFile({
    artboardName: artboardName,
    width: 400,
    height: 300,
    rootCompositePngBase64: canvasToPngBase64(rootCanvas),
    layers: layers
  });
  const outFile = path.join(OUT, 'simulated-fixed-export.psd');
  fs.writeFileSync(outFile, psdBuf);
  console.log('wrote', path.basename(outFile), psdBuf.length, 'bytes');

  // ============ verify by reading back ============
  const psd = agpsd.readPsd(fs.readFileSync(outFile));
  console.log('doc:', psd.width, 'x', psd.height);
  const failures = [];

  function walk(layers, depth) {
    for (const layer of layers) {
      const ind = '  '.repeat(depth);
      let info = `"${layer.name}" bounds=(${layer.left},${layer.top})-(${layer.right},${layer.bottom})`;
      if (layer.text) {
        info += ` | TEXT="${layer.text.text}" font=${layer.text.style && layer.text.style.font && layer.text.style.font.name} size=${layer.text.style && layer.text.style.fontSize}`;
        if (layer.text.text !== '七夕快乐') failures.push(`text content wrong: ${layer.text.text}`);
        if (layer.text.style.font.name !== 'SourceHanSansCN-Regular') failures.push(`font name wrong: ${layer.text.style.font.name}`);
      }
      if (layer.canvas) {
        const img = layer.canvas.getContext('2d').getImageData(0, 0, layer.canvas.width, layer.canvas.height);
        let opaque = 0;
        for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 0) opaque++;
        info += ` | canvas ${layer.canvas.width}x${layer.canvas.height} opaquePx=${opaque}`;
        if (opaque === 0) failures.push(`layer "${layer.name}" has zero opaque pixels!`);
      } else if (!layer.children) {
        info += ' | NO CANVAS';
        failures.push(`layer "${layer.name}" has no canvas`);
      }
      console.log(ind + info);
      if (layer.children) walk(layer.children, depth + 1);
    }
  }
  walk(psd.children, 0);

  // group structure check
  const group = psd.children.find(l => l.children);
  if (!group) failures.push('group missing');
  else {
    console.log('GROUP found:', group.name, 'children:', group.children.length);
    if (group.children.length !== 1) failures.push(`group should have 1 child, got ${group.children.length}`);
  }
  // text layer check
  const textLayer = psd.children.find(l => l.text);
  if (!textLayer) failures.push('text layer missing!');
  else console.log('TEXT layer present: "', textLayer.text.text, '"');

  console.log('\n=== RESULT ===');
  if (failures.length) {
    console.log('FAILURES:');
    failures.forEach(f => console.log(' - ' + f));
    process.exitCode = 1;
  } else {
    console.log('ALL CHECKS PASSED ✓');
  }
})();
