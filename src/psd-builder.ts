/**
 * PSD Builder 接口模块 (src/psd-builder.ts)
 */

import { NativePsdTextData } from './text';
import { LayerKind } from './layers';

export interface ExportLayerPayload {
  id: string;
  name: string;
  kind: LayerKind;
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

export interface ExportDataPayload {
  artboardName: string;
  width: number;
  height: number;
  scale: number; // 导出倍率（用于设置文档 PPI = 72 × scale，使 pt 数值与 Figma px 一致）
  rootCompositePngBase64: string;
  layers: ExportLayerPayload[];
}
