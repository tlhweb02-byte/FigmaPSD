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


/** 单个样式 run（对应 PS EngineData 的一个 StyleRun） */
export interface PsdTextRun {
  length: number; // UTF-16 码元数（与 PS / ag-psd 的文本长度计数一致）
  fontName: string; // PostScript 字体名
  fontScript: number; // 0=拉丁, 3=CJK
  fontType: number; // 0=unknown, 1=OpenType, 2=TrueType
  fontSize: number; // Point，与 Figma px 数值一致（不乘 scale）
  color: { r: number; g: number; b: number; a: number }; // 0..1
  tracking: number; // 1/1000 em
  leading?: number; // Point；undefined 表示自动行距
  underline: boolean;
  strikethrough: boolean;
  fontCaps: number; // 0=正常, 1=小型大写, 2=全部大写
}

export interface NativePsdTextData {
  text: string;
  fontName: string; // PostScript 字体名（Photoshop 可识别的 name）
  fontScript: number; // 0=拉丁, 3=CJK（与真实 PSD EngineData 对齐）
  fontType: number; // 0=unknown, 1=OpenType, 2=TrueType
  fontSize: number; // Point，与 Figma px 数值一致（如 Figma 24px -> 24pt），不乘 scale
  fontSizeScaled: number; // 首行最大字号 × scale，渲染像素字号（用于 TySh transform 基线定位）
  ascentRatio: number; // 首行"视觉顶部到基线"距离 / 字号（用于 TySh transform 基线定位）
  descentRatio: number; // 基线到 descender 底部距离 / 字号（含 descender 字符时用于修正基线）
  shapeType: 'point' | 'box'; // Figma 自动宽度文本 -> point，固定宽度（含自动高度）-> box
  autoHeight: boolean; // Figma 固定宽度 + 自动高度：PS 文本框底部需要留余量，避免末行被截掉
  multiLine: boolean; // 含换行（point 文本的基线只能按首行计算）
  textAlignVertical: 'top' | 'center' | 'bottom'; // box 文本垂直对齐
  color: { r: number; g: number; b: number; a: number }; // 0..1（写入时转 0..255）
  align: 'left' | 'center' | 'right' | 'justify-all'; // Photoshop justification
  letterSpacing?: number; // 已换算为 1/1000 em
  lineHeight?: number; // Point，与 Figma lineHeight px 数值一致（不乘 scale）；undefined 表示自动行距
  fauxBold: boolean;
  fauxItalic: boolean;
  underline: boolean;
  strikethrough: boolean;
  fontCaps: number;
  /** 多样式文本 / 字体回退时的完整样式 run；单一样式时为 undefined */
  styleRuns?: PsdTextRun[];
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


type PsFont = { name: string; script: number; type: number };

/**
 * 将一段文本按字体回退拆分：拉丁/数字用主字体，￥/中文等用 CJK 回退字体。
 * 长度按 UTF-16 码元计数（emoji 等代理对占 2），与 PS EngineData / ag-psd 一致。
 */
export function splitByFontFallback(
  text: string,
  primaryIsCjk: boolean,
  primaryFont: PsFont,
  fallbackFont: PsFont
): Array<{ length: number; font: PsFont }> {
  if (!text) return [];
  if (primaryIsCjk) return [{ length: text.length, font: primaryFont }];

  const runs: Array<{ length: number; font: PsFont }> = [];
  let i = 0;
  while (i < text.length) {
    const code = text.codePointAt(i) || 0;
    const unitLen = code > 0xffff ? 2 : 1;
    const font = isCjkFallbackChar(code) ? fallbackFont : primaryFont;
    const last = runs[runs.length - 1];
    if (last && last.font.name === font.name) last.length += unitLen;
    else runs.push({ length: unitLen, font });
    i += unitLen;
  }
  return runs;
}

type TextSegment = {
  characters: string;
  start: number;
  end: number;
  fontName: FontName;
  fontSize: number;
  fills: readonly Paint[];
  letterSpacing: LetterSpacing;
  lineHeight: LineHeight;
  textDecoration: TextDecoration;
  textCase: TextCase;
};

/** 读取 Figma 文本的样式分段；接口不可用时退回节点级属性 */
function getSegments(node: TextNode): TextSegment[] {
  try {
    const segs = node.getStyledTextSegments([
      'fontName', 'fontSize', 'fills', 'letterSpacing', 'lineHeight', 'textDecoration', 'textCase'
    ]);
    if (segs && segs.length) return segs as unknown as TextSegment[];
  } catch (err) {
    console.warn('读取文本样式分段失败，使用节点级样式:', err);
  }
  const pick = <T>(v: T | PluginAPI['mixed'], d: T): T => (v === figma.mixed ? d : v as T);
  return [{
    characters: node.characters,
    start: 0,
    end: node.characters.length,
    fontName: pick(node.fontName, { family: 'Arial', style: 'Regular' }),
    fontSize: pick(node.fontSize, 16),
    fills: pick(node.fills as readonly Paint[] | PluginAPI['mixed'], [] as readonly Paint[]),
    letterSpacing: pick(node.letterSpacing, { unit: 'PIXELS', value: 0 } as LetterSpacing),
    lineHeight: pick(node.lineHeight, { unit: 'AUTO' } as LineHeight),
    textDecoration: pick(node.textDecoration, 'NONE' as TextDecoration),
    textCase: pick(node.textCase, 'ORIGINAL' as TextCase)
  }];
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function solidColor(fills: readonly Paint[]): { r: number; g: number; b: number; a: number } {
  const solid = Array.isArray(fills)
    ? fills.find(f => f.visible !== false && f.type === 'SOLID') as SolidPaint | undefined
    : undefined;
  if (!solid) return { r: 0, g: 0, b: 0, a: 1 };
  return {
    r: solid.color.r,
    g: solid.color.g,
    b: solid.color.b,
    a: solid.opacity !== undefined ? solid.opacity : 1
  };
}

/** Figma letterSpacing -> Photoshop tracking（1/1000 em） */
function toTracking(ls: LetterSpacing, fontSize: number): number {
  if (!ls || !ls.value) return 0;
  if (ls.unit === 'PERCENT') return Math.round(ls.value * 10); // 1% em = 10/1000 em
  return fontSize > 0 ? Math.round((ls.value / fontSize) * 1000) : 0;
}

/** Figma lineHeight -> Photoshop leading（pt，数值与 Figma px 一致）；AUTO 返回 undefined */
function toLeading(lh: LineHeight, fontSize: number): number | undefined {
  if (!lh || lh.unit === 'AUTO') return undefined;
  if (lh.unit === 'PERCENT') return round1((lh.value / 100) * fontSize);
  return round1(lh.value);
}

/** Figma textCase：UPPER/SMALL_CAPS 用 PS fontCaps（保持可编辑），LOWER/TITLE 直接转换字符 */
function applyTextCase(chars: string, textCase: TextCase): { text: string; fontCaps: number } {
  if (textCase === 'UPPER') return { text: chars, fontCaps: 2 };
  if (textCase === 'SMALL_CAPS' || textCase === 'SMALL_CAPS_FORCED') return { text: chars, fontCaps: 1 };
  let out = chars;
  if (textCase === 'LOWER') out = chars.toLowerCase();
  else if (textCase === 'TITLE') out = chars.replace(/(^|[\s\-])(\S)/g, (_m, sep, c) => sep + c.toUpperCase());
  // 大小写转换在个别语言下会改变字符串长度，此时保留原文以免 run 长度错位
  return { text: out.length === chars.length ? out : chars, fontCaps: 0 };
}

function sameRunStyle(a: PsdTextRun, b: PsdTextRun): boolean {
  return a.fontName === b.fontName && a.fontSize === b.fontSize && a.tracking === b.tracking &&
    a.leading === b.leading && a.underline === b.underline && a.strikethrough === b.strikethrough &&
    a.fontCaps === b.fontCaps && a.color.r === b.color.r && a.color.g === b.color.g &&
    a.color.b === b.color.b && a.color.a === b.color.a;
}

export async function parseTextNode(node: TextNode, scale: number, fallbackName: string): Promise<NativePsdTextData> {
  const segments = getSegments(node);
  const fallbackFont = pickCjkFallbackFont();

  let text = '';
  const runs: PsdTextRun[] = [];
  // 首行（第一个换行之前）中字号最大的样式，决定首行基线位置
  let firstLineMax: { size: number; family: string; style: string; text: string } | null = null;
  let inFirstLine = true;

  for (const seg of segments) {
    const family = seg.fontName.family || 'Arial';
    const style = seg.fontName.style || 'Regular';
    const fontSize = typeof seg.fontSize === 'number' ? seg.fontSize : 16;
    const isCjk = isCjkFont(family);
    const primaryFont: PsFont = { name: toPsdFontName(family, style), script: isCjk ? 3 : 0, type: isCjk ? 2 : 0 };

    // Figma 软换行 U+2028（Shift+Enter）在 PS 中没有对应字符，统一转为换行（长度不变）
    const cased = applyTextCase(seg.characters.replace(/\u2028/g, '\n'), seg.textCase);
    text += cased.text;

    if (inFirstLine) {
      const nl = cased.text.indexOf('\n');
      const lineText = nl >= 0 ? cased.text.slice(0, nl) : cased.text;
      if (lineText.length && (!firstLineMax || fontSize > firstLineMax.size)) {
        firstLineMax = { size: fontSize, family, style, text: lineText };
      } else if (firstLineMax && fontSize === firstLineMax.size) {
        firstLineMax.text += lineText;
      }
      if (nl >= 0) inFirstLine = false;
    }

    const decoration = seg.textDecoration;
    const common = {
      fontSize: round1(fontSize),
      color: solidColor(seg.fills),
      tracking: toTracking(seg.letterSpacing, fontSize),
      leading: toLeading(seg.lineHeight, fontSize),
      underline: decoration === 'UNDERLINE',
      strikethrough: decoration === 'STRIKETHROUGH',
      fontCaps: cased.fontCaps
    };

    // 字体回退 run：拉丁字体中的 ￥/中文/全角符号 -> CJK 字体（避免 PS 空心方块）
    for (const part of splitByFontFallback(cased.text, isCjk, primaryFont, fallbackFont)) {
      const run: PsdTextRun = {
        length: part.length,
        fontName: part.font.name,
        fontScript: part.font.script,
        fontType: part.font.type,
        ...common
      };
      const last = runs[runs.length - 1];
      if (last && sameRunStyle(last, run)) last.length += run.length;
      else runs.push(run);
    }
  }

  if (!text) text = fallbackName;
  const first: PsdTextRun = runs[0] || {
    length: text.length, fontName: 'ArialMT', fontScript: 0, fontType: 0, fontSize: 16,
    color: { r: 0, g: 0, b: 0, a: 1 }, tracking: 0, leading: undefined,
    underline: false, strikethrough: false, fontCaps: 0
  };
  const firstSeg = segments[0];
  const baseFamily = firstLineMax ? firstLineMax.family : (firstSeg ? firstSeg.fontName.family : 'Arial');
  const baseStyle = firstLineMax ? firstLineMax.style : (firstSeg ? firstSeg.fontName.style : 'Regular');
  const baseSize = firstLineMax ? firstLineMax.size : first.fontSize;

  // Photoshop justification：JUSTIFIED -> justify-all
  let align: 'left' | 'center' | 'right' | 'justify-all' = 'left';
  if (node.textAlignHorizontal === 'CENTER') align = 'center';
  else if (node.textAlignHorizontal === 'RIGHT') align = 'right';
  else if (node.textAlignHorizontal === 'JUSTIFIED') align = 'justify-all';

  // 文本排版模式：只有"自动宽度"(WIDTH_AND_HEIGHT) 是 point 文本；
  // 固定宽度（NONE）、固定宽度自动高度（HEIGHT，最常见的段落文本）、截断（TRUNCATE）
  // 都会在宽度处自动换行，必须是 box 文本，否则 PS 中会变成一整行不换行。
  const autoResize = node.textAutoResize;
  const shapeType: 'point' | 'box' = autoResize === 'WIDTH_AND_HEIGHT' ? 'point' : 'box';

  const textAlignVertical: 'top' | 'center' | 'bottom' =
    node.textAlignVertical === 'CENTER' ? 'center' :
    node.textAlignVertical === 'BOTTOM' ? 'bottom' : 'top';

  return {
    text: text,
    fontName: first.fontName,
    fontScript: first.fontScript,
    fontType: first.fontType,
    fontSize: first.fontSize,
    fontSizeScaled: round1(baseSize * scale),
    ascentRatio: getTopToBaselineRatio(baseFamily, baseStyle, firstLineMax ? firstLineMax.text : text),
    descentRatio: getFontDescentRatio(baseFamily, baseStyle),
    shapeType: shapeType,
    autoHeight: autoResize === 'HEIGHT',
    multiLine: text.indexOf('\n') >= 0,
    textAlignVertical: textAlignVertical,
    color: first.color,
    align: align,
    letterSpacing: first.tracking || undefined,
    lineHeight: first.leading,
    // 字体名已解析为真实字重/斜体的 PostScript 名（如 Arial-BoldMT），
    // 再开仿粗体/仿斜体会在 PS 中二次加粗/倾斜，因此始终关闭
    fauxBold: false,
    fauxItalic: false,
    underline: first.underline,
    strikethrough: first.strikethrough,
    fontCaps: first.fontCaps,
    styleRuns: runs.length > 1 ? runs : undefined
  };
}
