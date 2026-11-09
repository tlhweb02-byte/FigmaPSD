/**
 * PSD Builder 接口模块 (src/psd-builder.ts)
 * 主线程 -> UI 线程的导出数据结构。所有坐标/尺寸均为文档像素（已乘导出倍率）。
 */

import { NativePsdTextData } from './text';
import { LayerKind } from './layers';

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExportLayerPayload {
  id: string;
  name: string;
  kind: LayerKind;
  isGroup: boolean;
  visible: boolean;
  opacity: number;
  blendMode: string;
  /** 位图图层：PNG 左上角位置；文本图层：文本框左上角位置 */
  x: number;
  y: number;
  width: number;
  height: number;
  parentId: string | null;
  textData?: NativePsdTextData | null;
  pngBase64?: string;
  /** 用图层蒙版裁切到该矩形（clipsContent 画板） */
  clip?: PixelRect | null;
  /** Figma 蒙版节点的渲染像素（作为组蒙版） */
  maskPngBase64?: string;
  maskX?: number;
  maskY?: number;
  /** 亮度蒙版（Figma LUMINANCE），否则按 alpha */
  maskLuminance?: boolean;
}

export interface ExportDataPayload {
  artboardName: string;
  width: number;
  height: number;
  scale: number; // 导出倍率（用于设置文档 PPI = 72 × scale，使 pt 数值与 Figma px 一致）
  rootCompositePngBase64: string;
  layers: ExportLayerPayload[];
}
