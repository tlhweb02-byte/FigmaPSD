/**
 * Vector 矢量转换模块 (src/vector.ts)
 * 负责将 Figma Rectangle, Ellipse, Polygon, Vector 几何图形解析为 PSD 原生矢量形状图层 (Vector Mask + Solid Color Fill)
 */

export interface VectorPoint {
  x: number;
  y: number;
}

export interface VectorPath {
  closed: boolean;
  points: VectorPoint[];
}

export interface SolidColor {
  r: number; // 0..255
  g: number;
  b: number;
  a?: number; // 0..1
}

export interface VectorShapeData {
  shapeType: 'rectangle' | 'ellipse' | 'polygon' | 'vector';
  paths: VectorPath[];
  solidColor: SolidColor;
}

export const VALID_PSD_BLEND_MODES: Record<string, string> = {
  'PASS_THROUGH': 'pass through',
  'NORMAL': 'normal',
  'DARKEN': 'darken',
  'MULTIPLY': 'multiply',
  'COLOR_BURN': 'color burn',
  'LINEAR_BURN': 'linear burn',
  'DARKER_COLOR': 'darker color',
  'LIGHTEN': 'lighten',
  'SCREEN': 'screen',
  'COLOR_DODGE': 'color dodge',
  'LINEAR_DODGE': 'linear dodge',
  'LIGHTER_COLOR': 'lighter color',
  'OVERLAY': 'overlay',
  'SOFT_LIGHT': 'soft light',
  'HARD_LIGHT': 'hard light',
  'VIVID_LIGHT': 'vivid light',
  'LINEAR_LIGHT': 'linear light',
  'PIN_LIGHT': 'pin light',
  'HARD_MIX': 'hard mix',
  'DIFFERENCE': 'difference',
  'EXCLUSION': 'exclusion',
  'SUBTRACT': 'subtract',
  'DIVIDE': 'divide',
  'HUE': 'hue',
  'SATURATION': 'saturation',
  'COLOR': 'color',
  'LUMINOSITY': 'luminosity'
};

export function convertBlendMode(mode?: string, isGroup: boolean = false): string {
  if (!mode || mode === 'PASS_THROUGH') {
    return isGroup ? 'pass through' : 'normal';
  }
  const cleanMode = String(mode).toUpperCase().replace(/-/g, '_').replace(/ /g, '_');
  const mapped = VALID_PSD_BLEND_MODES[cleanMode];
  if (!mapped) return 'normal';
  if (!isGroup && mapped === 'pass through') return 'normal';
  return mapped;
}

export function parseVectorShape(node: SceneNode, scale: number, relX: number, relY: number): VectorShapeData | null {
  let solidColor: SolidColor = { r: 128, g: 128, b: 128, a: 1 };
  
  if ('fills' in node && Array.isArray((node as GeometryMixin).fills)) {
    const fills = (node as GeometryMixin).fills as Paint[];
    const solidFill = fills.find(f => f.visible !== false && f.type === 'SOLID') as SolidPaint | undefined;
    if (solidFill) {
      solidColor = {
        r: Math.round(solidFill.color.r * 255),
        g: Math.round(solidFill.color.g * 255),
        b: Math.round(solidFill.color.b * 255),
        a: solidFill.opacity !== undefined ? solidFill.opacity : 1
      };
    }
  }

  const bounds = node.absoluteBoundingBox;
  if (!bounds) return null;

  const w = Math.round(bounds.width * scale);
  const h = Math.round(bounds.height * scale);
  const left = Math.round(relX * scale);
  const top = Math.round(relY * scale);

  if (node.type === 'RECTANGLE') {
    return {
      shapeType: 'rectangle',
      solidColor: solidColor,
      paths: [{
        closed: true,
        points: [
          { x: left, y: top },
          { x: left + w, y: top },
          { x: left + w, y: top + h },
          { x: left, y: top + h }
        ]
      }]
    };
  } else if (node.type === 'ELLIPSE') {
    // 椭圆 4 点插值
    const cx = left + w / 2;
    const cy = top + h / 2;
    const rx = w / 2;
    const ry = h / 2;
    return {
      shapeType: 'ellipse',
      solidColor: solidColor,
      paths: [{
        closed: true,
        points: [
          { x: cx, y: top },
          { x: left + w, y: cy },
          { x: cx, y: top + h },
          { x: left, y: cy }
        ]
      }]
    };
  }

  return {
    shapeType: 'vector',
    solidColor: solidColor,
    paths: [{
      closed: true,
      points: [
        { x: left, y: top },
        { x: left + w, y: top },
        { x: left + w, y: top + h },
        { x: left, y: top + h }
      ]
    }]
  };
}
