/**
 * Layer Converter 图层转换器 (src/layer-converter.ts)
 * 严格只修此模块：
 * 1. TEXT 类型 return 没有 canvas/imageData 的 Layer
 * 2. 普通 IMAGE/VECTOR 继续使用 canvas
 * 3. ag-psd text 结构严格为：text: { text, style: { font: [{ name, sizes: [num], colors: [{r,g,b,a}] }] } }
 * 4. 颜色 RGBA 转换至 0-255
 */

import { NativePsdTextData } from './text';

export interface ExportLayerPayload {
  id: string;
  name: string;
  kind: 'group' | 'text' | 'vector' | 'image';
  isGroup: boolean;
  visible: boolean;
  opacity: number;
  blendMode: string;
  x: number;
  y: number;
  width: number;
  height: number;
  parentId: string | null;
  textData?: NativePsdTextData | null;
  pngBase64?: string;
}

export interface ConvertedPsdLayer {
  name: string;
  hidden?: boolean;
  opacity?: number;
  blendMode?: string;
  opened?: boolean;
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
  canvas?: HTMLCanvasElement;
  text?: {
    text: string;
    left?: number;
    top?: number;
    right?: number;
    bottom?: number;
    transform?: number[];
    shapeType?: 'point' | 'box';
    pointBase?: number[];
    antiAlias?: string;
    gridding?: string;
    orientation?: string;
    index?: number;
    style?: {
      font?: { name: string; script?: number; type?: number; synthetic?: number };
      fontSize?: number;
      autoLeading?: boolean;
      leading?: number;
      tracking?: number;
      fauxBold?: boolean;
      fauxItalic?: boolean;
      underline?: boolean;
      strikethrough?: boolean;
      fillColor?: { r: number; g: number; b: number };
      [key: string]: any;
    };
    paragraphStyle?: { justification?: string; [key: string]: any };
    [key: string]: any;
  };
  children?: ConvertedPsdLayer[];
}

export function sanitizeBlendMode(blendMode: string, isGroup: boolean): string {
  const ALLOWED_AG_PSD_MODES = new Set([
    'normal', 'pass through', 'darken', 'multiply', 'color burn', 'linear burn',
    'darker color', 'lighten', 'screen', 'color dodge', 'linear dodge',
    'lighter color', 'overlay', 'soft light', 'hard light', 'vivid light',
    'linear light', 'pin light', 'hard mix', 'difference', 'exclusion',
    'subtract', 'divide', 'hue', 'saturation', 'color', 'luminosity'
  ]);

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

  if (!ALLOWED_AG_PSD_MODES.has(mode)) {
    return 'normal';
  }

  if (!isGroup && mode === 'pass through') {
    return 'normal';
  }

  return mode;
}

export function buildConvertedLayer(
  layer: ExportLayerPayload,
  docWidth: number,
  docHeight: number,
  canvasData?: { canvas: HTMLCanvasElement; w: number; h: number }
): ConvertedPsdLayer {
  // 文件夹组
  if (layer.isGroup) {
    const groupLayer: ConvertedPsdLayer = {
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
      groupLayer.opacity = layer.opacity;
    }
    return groupLayer;
  }

  // TEXT 类型：构建 ag-psd 31.x 原生 TySh 文本结构（含栅格预览 canvas）
  if (layer.kind === 'text' && layer.textData) {
    const left = Math.round(layer.x);
    const top = Math.round(layer.y);
    const right = left + Math.round(layer.width);
    const bottom = top + Math.round(layer.height);

    // 颜色 RGBA 转换至 0-255
    const c = layer.textData.color;
    const rVal = c.r <= 1 ? Math.round(c.r * 255) : Math.round(c.r);
    const gVal = c.g <= 1 ? Math.round(c.g * 255) : Math.round(c.g);
    const bVal = c.b <= 1 ? Math.round(c.b * 255) : Math.round(c.b);
    const aVal = c.a <= 1 ? Math.round(c.a * 255) : Math.round(c.a);

    const shapeType = layer.textData.shapeType === 'box' ? 'box' : 'point';
    const baselineY = top + Math.round((layer.textData.fontSizeScaled || layer.textData.fontSize) * layer.textData.ascentRatio);

    const textLayer: ConvertedPsdLayer = {
      name: layer.name,
      hidden: layer.visible === false,
      blendMode: sanitizeBlendMode(layer.blendMode, false),
      left: left,
      top: top,
      right: right,
      bottom: bottom,
      text: {
        text: layer.textData.text,
        left: shapeType === 'box' ? left : 0,
        top: shapeType === 'box' ? top : 0,
        right: shapeType === 'box' ? right : 0,
        bottom: shapeType === 'box' ? bottom : 0,
        // box 文本必须用单位阵 transform（否则与 boxBounds 叠加成 2 倍偏移）
        transform: shapeType === 'box' ? [1, 0, 0, 1, 0, 0] : [1, 0, 0, 1, left, baselineY],
        shapeType: shapeType,
        pointBase: shapeType === 'box' ? undefined : [0, 0],
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
      textLayer.opacity = layer.opacity;
    }

    return textLayer;
  }

  // 要求 2: 普通 IMAGE/VECTOR 继续使用 canvas
  const { canvas, w, h } = canvasData || {
    canvas: document.createElement('canvas'),
    w: Math.max(1, layer.width),
    h: Math.max(1, layer.height)
  };

  const psdLayer: ConvertedPsdLayer = {
    name: layer.name,
    hidden: layer.visible === false,
    blendMode: sanitizeBlendMode(layer.blendMode, false),
    left: Math.round(layer.x),
    top: Math.round(layer.y),
    right: Math.round(layer.x) + w,
    bottom: Math.round(layer.y) + h,
    canvas: canvas
    // 严禁包含 imageData 与 text!
  };

  if (typeof layer.opacity === 'number' && layer.opacity < 0.99) {
    psdLayer.opacity = layer.opacity;
  }

  return psdLayer;
}
