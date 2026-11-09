/**
 * Blend 混合模式映射 (src/blend.ts)
 * 将 Figma BlendMode 转换为 ag-psd 使用的 PSD 混合模式名
 */

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
