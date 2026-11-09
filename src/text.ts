/**
 * Text 文本解析模块 (src/text.ts)
 * 读取 Figma TEXT 节点属性：characters, fontFamily, fontSize, fills颜色, letterSpacing, lineHeight
 *
 * 说明：为了生成 Photoshop 原生可编辑文字图层 (TySh + EngineData)，这里输出的
 * 字段单位与 ag-psd 写入 EngineData 时的约定保持一致（已对照真实 PS 导出文件验证）：
 *   - fontSize / leading ：Point（磅值）。Figma 像素值在 72PPI 文档中等同于磅值，
 *     导出倍率 scale 同样作用于磅值，保证与栅格预览一致。
 *   - tracking ：1/1000 em（Photoshop 的 tracking 单位）。
 *   - fontName ：PostScript 字体名（如 SourceHanSansCN-Regular），Photoshop 依赖它匹配字体。
 */

import { FONT_PS_NAME_MAP, FONT_METRICS_MAP } from './font-map';

export interface NativePsdTextData {
  text: string;
  fontName: string; // PostScript 字体名（Photoshop 可识别的 name）
  fontScript: number; // 0=拉丁, 3=CJK（与真实 PSD EngineData 对齐）
  fontType: number; // 0=unknown, 1=OpenType, 2=TrueType
  fontSize: number; // Point，与 Figma px 数值一致（如 Figma 24px -> 24pt），不乘 scale
  fontSizeScaled: number; // = fontSize × scale，渲染像素字号（用于 TySh transform 基线定位）
  ascentRatio: number; // 基线到框顶距离 / 字号（用于 TySh transform 基线定位）
  descentRatio: number; // 基线到 descender 底部距离 / 字号（含 descender 字符时用于修正基线）
  shapeType: 'point' | 'box'; // Figma 自动宽度文本 -> point，固定宽度 -> box
  textAlignVertical: 'top' | 'center' | 'bottom'; // box 文本垂直对齐
  color: { r: number; g: number; b: number; a: number }; // 0..1（写入时转 0..255）
  align: 'left' | 'center' | 'right' | 'justify-all'; // Photoshop justification
  letterSpacing?: number; // 已换算为 1/1000 em
  lineHeight?: number; // Point，与 Figma lineHeight px 数值一致（不乘 scale）；undefined 表示自动行距
  fauxBold: boolean;
  fauxItalic: boolean;
  underline: boolean;
  strikethrough: boolean;
  styleRuns?: Array<{
    length: number;
    fontName: string;
    fontScript: number;
    fontType: number;
  }>; // 字体回退 run（如拉丁字体文本中的 ￥/中文 拆到 CJK 字体）
}

/** 判断字体是否为中文字体（影响 EngineData 的 script/type 字段） */
function isCjkFont(family: string): boolean {
  return /[\u4e00-\u9fff]/.test(family) || /^(PingFang|Source Han|思源|微软雅黑|Microsoft YaHei|SimSun|SimHei|宋体|黑体|等线|DengXian|方正|FZ|汉仪|HY)/.test(family);
}

/** 归一化字体名用于查表匹配（去掉大小写/空格/连字符差异） */
function normalizeFontKey(s: string): string {
  return s.toLowerCase().replace(/[\s\-_]+/g, '');
}

/**
 * 生成 Photoshop 可识别的字体名（PostScript 名）。
 * 优先级：
 *   1. 本机已安装字体映射表（精确 family+style 匹配）
 *   2. 归一化模糊匹配（忽略大小写/空格/连字符）
 *   3. 回退规则：族名去空格 + "-" + 风格去空格
 */
export function toPsdFontName(family: string, style: string): string {
  const fam = family || 'Arial';
  const sty = style || 'Regular';

  // 1. 精确匹配
  const exactFam = FONT_PS_NAME_MAP[fam];
  if (exactFam && exactFam[sty]) return exactFam[sty];

  // 1b. 风格模糊（Regular 与 normal 等）
  if (exactFam) {
    const styleEntries = Object.keys(exactFam);
    const want = normalizeFontKey(sty);
    for (const s of styleEntries) {
      if (normalizeFontKey(s) === want) return exactFam[s];
    }
    // 若只有一种风格，直接取它
    if (styleEntries.length === 1) return exactFam[styleEntries[0]];
  }

  // 2. 族名模糊匹配
  const wantFam = normalizeFontKey(fam);
  const wantSty = normalizeFontKey(sty);
  for (const keyFam of Object.keys(FONT_PS_NAME_MAP)) {
    if (normalizeFontKey(keyFam) === wantFam) {
      const styles = FONT_PS_NAME_MAP[keyFam];
      for (const s of Object.keys(styles)) {
        if (normalizeFontKey(s) === wantSty) return styles[s];
      }
      if (Object.keys(styles).length === 1) return styles[Object.keys(styles)[0]];
      break;
    }
  }

  // 3. 回退规则
  return fam.replace(/\s+/g, '') + '-' + sty.replace(/\s+/g, '');
}

/** 获取字体基线度量（ascent 占 em 的比例），用于 TySh transform 基线定位 */
export function getFontAscentRatio(family: string, style: string): number {
  const psName = toPsdFontName(family, style);
  const m = FONT_METRICS_MAP[psName];
  if (m && m.ascent > 0) return m.ascent;
  // 回退：CJK 常见 0.88，拉丁约 0.72（Helvetica/Arial 等常见无衬线字体）
  // 已调整自 0.8，提升数字/大写文本在 PS 中的基线定位精度
  return isCjkFont(family || '') ? 0.88 : 0.72;
}

/** 获取字体 cap height（数字/大写字母视觉顶部占 em 的比例） */
export function getFontCapHeightRatio(family: string, style: string): number | undefined {
  const psName = toPsdFontName(family, style);
  const m = FONT_METRICS_MAP[psName];
  if (m && m.capHeight && m.capHeight > 0) return m.capHeight;
  // 默认值：拉丁约 0.7，CJK 字形接近 em 高度（视觉顶部即 em 顶部）
  return isCjkFont(family || '') ? 0.88 : 0.7;
}

/** 获取字体 descender 深度（基线到 descender 底部的距离占 em 的比例） */
export function getFontDescentRatio(family: string, style: string): number {
  const psName = toPsdFontName(family, style);
  const m = FONT_METRICS_MAP[psName];
  if (m && m.descent > 0 && m.descent < 1) return m.descent;
  // 回退：拉丁常见 0.2，CJK 0.12
  return isCjkFont(family || '') ? 0.12 : 0.2;
}

/** 判断字符是否为"有上升部"的小写字母（b d f h k l t 等），决定视觉顶部是否到 ascent */
function isAscenderLower(char: string): boolean {
  return /[bdfhkl]/.test(char);
}
/** 判断字符是否为"有下降部"的小写字母（g j p q y） */
function isDescenderLower(char: string): boolean {
  return /[gjpqy]/.test(char);
}

/**
 * 计算文本"框顶到基线"的距离比例（用于 TySh transform 基线定位）。
 * - 含中文/假名/韩文等 CJK 字符：用 ascent（CJK 字形几乎填满 em 框）
 * - 含上升部小写字母（b d f h k l）：视觉顶部到 ascent，用 ascent
 * - 纯数字 / 大写字母 / 无上升部字符：视觉顶部是 cap height，用 cap height
 *   （避免 PS 用 ascent 重排后数字整体下移）
 */
export function getTopToBaselineRatio(family: string, style: string, text: string): number {
  const ascent = getFontAscentRatio(family, style);
  const cap = getFontCapHeightRatio(family, style);

  let hasCjk = false;
  let hasAscender = false;
  for (const ch of text || '') {
    const code = ch.codePointAt(0) || 0;
    if (isCjkFallbackChar(code) || (code >= 0x4e00 && code <= 0x9fff)) hasCjk = true;
    if (isAscenderLower(ch)) hasAscender = true;
  }
  if (hasCjk) return ascent;
  if (hasAscender) return ascent;
  // 纯数字/大写/符号：用 cap height（无 capHeight 数据时退回 ascent）
  return cap !== undefined ? cap : ascent;
}

/**
 * 判断字符是否需要 CJK 字体回退（拉丁字体通常不含 ￥/中文/全角符号）。
 * 覆盖：CJK 统一表意文字、CJK 兼容表意文字、全角/半角形式（￥ U+FFE5）、
 * CJK 标点、平假名/片假名、韩文。
 */
export function isCjkFallbackChar(code: number): boolean {
  return (
    (code >= 0x2e80 && code <= 0x2eff) || // CJK 部首
    (code >= 0x3000 && code <= 0x303f) || // CJK 标点
    (code >= 0x3040 && code <= 0x30ff) || // 假名
    (code >= 0x31c0 && code <= 0x31ef) || // CJK 笔画
    (code >= 0x3200 && code <= 0x9fff) || // 带圈汉字 / CJK 统一表意文字
    (code >= 0xf900 && code <= 0xfaff) || // CJK 兼容表意文字
    (code >= 0xfe30 && code <= 0xfe4f) || // CJK 兼容形式
    (code >= 0xff00 && code <= 0xffef) || // 全角/半角形式（含 ￥ U+FFE5）
    (code >= 0xac00 && code <= 0xd7af)    // 韩文音节
  );
}

/** 本机可用的 CJK 回退字体（优先宋体 SimSun，其次等线 DengXian） */
function pickCjkFallbackFont(): { name: string; script: number; type: number } {
  const candidates = ['宋体', 'SimSun', '等线', 'DengXian', '微软雅黑', 'Microsoft YaHei'];
  for (const fam of candidates) {
    const styles = FONT_PS_NAME_MAP[fam];
    if (styles) {
      const name = styles['Regular'] || Object.values(styles)[0];
      if (name) return { name: name, script: 3, type: 2 };
    }
  }
  return { name: 'SimSun', script: 3, type: 2 };
}

/**
 * 将文本拆成字体 run：拉丁/数字用主字体，￥/中文等用 CJK 回退字体。
 * 仅当文本同时包含两类字符且主字体不是 CJK 字体时才拆分。
 * 返回 run 长度数组（与 PS EngineData styleRuns 对齐：length 为字符数）。
 */
export function buildFontRuns(
  text: string,
  primaryIsCjk: boolean,
  primaryFont: { name: string; script: number; type: number },
  fallbackFont: { name: string; script: number; type: number }
): Array<{ length: number; fontName: string; fontScript: number; fontType: number }> | undefined {
  if (!text || primaryIsCjk) return undefined;

  // 扫描字符归属
  const runs: Array<{ length: number; font: { name: string; script: number; type: number } }> = [];
  let currentFont: { name: string; script: number; type: number } | null = null;
  let currentLen = 0;

  for (const ch of text) {
    const needsFallback = isCjkFallbackChar(ch.charCodeAt(0));
    const font = needsFallback ? fallbackFont : primaryFont;
    if (currentFont && currentFont.name === font.name) {
      currentLen++;
    } else {
      if (currentFont) runs.push({ length: currentLen, font: currentFont });
      currentFont = font;
      currentLen = 1;
    }
  }
  if (currentFont) runs.push({ length: currentLen, font: currentFont });

  // 若只有一种字体（全拉丁或全中文），无需拆 run
  const distinct = new Set(runs.map(r => r.font.name));
  if (distinct.size <= 1) return undefined;

  return runs.map(r => ({
    length: r.length,
    fontName: r.font.name,
    fontScript: r.font.script,
    fontType: r.font.type
  }));
}

export async function parseTextNode(node: TextNode, scale: number, fallbackName: string): Promise<NativePsdTextData> {
  if (node.fontName !== figma.mixed) {
    try {
      await figma.loadFontAsync(node.fontName);
    } catch (err) {
      console.warn('字体预加载跳过:', err);
    }
  }

  let color = { r: 0, g: 0, b: 0, a: 1 };
  if (Array.isArray(node.fills) && node.fills.length > 0) {
    const solidFill = node.fills.find(f => f.visible !== false && f.type === 'SOLID') as SolidPaint | undefined;
    if (solidFill) {
      color = {
        r: solidFill.color.r,
        g: solidFill.color.g,
        b: solidFill.color.b,
        a: solidFill.opacity !== undefined ? solidFill.opacity : 1
      };
    }
  }

  const fontObj = node.fontName !== figma.mixed ? node.fontName : { family: 'Arial', style: 'Regular' };
  const fontSizeVal = typeof node.fontSize === 'number' ? node.fontSize : 16;

  // Photoshop justification：JUSTIFIED -> justify-all
  let align: 'left' | 'center' | 'right' | 'justify-all' = 'left';
  if (node.textAlignHorizontal === 'CENTER') align = 'center';
  else if (node.textAlignHorizontal === 'RIGHT') align = 'right';
  else if (node.textAlignHorizontal === 'JUSTIFIED') align = 'justify-all';

  // tracking：Figma letterSpacing(px) -> Photoshop 1/1000 em
  let letterSpacingEm: number | undefined = undefined;
  if (node.letterSpacing !== figma.mixed && node.letterSpacing && fontSizeVal > 0) {
    if (node.letterSpacing.unit === 'PIXELS') {
      letterSpacingEm = Math.round((node.letterSpacing.value / fontSizeVal) * 1000);
    }
  }

  // leading：Figma lineHeight(px) -> Point（数值与 Figma 一致，不乘 scale）；
  // AUTO/PERCENT 时留空让 PS 自动
  let lineHeightPt: number | undefined = undefined;
  if (node.lineHeight !== figma.mixed && node.lineHeight) {
    if (node.lineHeight.unit === 'PIXELS') {
      lineHeightPt = Math.round(node.lineHeight.value * 10) / 10;
    }
  }

  // 字体风格 -> fauxBold / fauxItalic
  const styleLower = fontObj.style.toLowerCase();
  const fauxBold = /bold|700|800|900/.test(styleLower) && !/light|thin/.test(styleLower);
  const fauxItalic = /italic|oblique/.test(styleLower);

  // 文本排版模式：Figma 自动宽度/自动高度文本 -> point；固定宽度 -> box
  const autoResize = 'textAutoResize' in node ? node.textAutoResize : 'HEIGHT';
  const shapeType: 'point' | 'box' = (autoResize === 'NONE') ? 'box' : 'point';

  // 垂直对齐（box 文本用）
  const textAlignVertical: 'top' | 'center' | 'bottom' =
    node.textAlignVertical === 'CENTER' ? 'center' :
    node.textAlignVertical === 'BOTTOM' ? 'bottom' : 'top';

  // 装饰：UNDERLINE -> underline，STRIKETHROUGH -> strikethrough（互斥，勿同时设置）
  const decoration = node.textDecoration !== figma.mixed ? node.textDecoration : 'NONE';
  const underline = decoration === 'UNDERLINE';
  const strikethrough = decoration === 'STRIKETHROUGH';

  // 字体回退 run：拉丁字体中的 ￥/中文/全角符号 -> CJK 字体（避免 PS 空心方块）
  const primaryIsCjk = isCjkFont(fontObj.family || '');
  const primaryFont = {
    name: toPsdFontName(fontObj.family || 'Arial', fontObj.style || 'Regular'),
    script: primaryIsCjk ? 3 : 0,
    type: primaryIsCjk ? 2 : 0
  };
  const styleRuns = buildFontRuns(node.characters || '', primaryIsCjk, primaryFont, pickCjkFallbackFont());

  return {
    text: node.characters || fallbackName,
    fontName: primaryFont.name,
    fontScript: primaryFont.script,
    fontType: primaryFont.type,
    // 字号（pt）与 Figma px 数值一致（如 Figma 24px -> 24pt），不乘 scale；
    // 渲染像素由文档 PPI（=72×scale）控制，保证视觉比例正确。
    fontSize: Math.round(fontSizeVal * 10) / 10,
    fontSizeScaled: Math.round(fontSizeVal * scale * 10) / 10,
    ascentRatio: getTopToBaselineRatio(fontObj.family || 'Arial', fontObj.style || 'Regular', node.characters || ''),
    descentRatio: getFontDescentRatio(fontObj.family || 'Arial', fontObj.style || 'Regular'),
    shapeType: shapeType,
    textAlignVertical: textAlignVertical,
    color: color,
    align: align,
    letterSpacing: letterSpacingEm,
    lineHeight: lineHeightPt,
    fauxBold: fauxBold,
    fauxItalic: fauxItalic,
    underline: underline,
    strikethrough: strikethrough,
    styleRuns: styleRuns
  };
}
