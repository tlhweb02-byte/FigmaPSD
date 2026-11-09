/**
 * Exporter 模块 (src/exporter.ts)
 * 导出主流程：根画板合成图、容器背景离屏渲染、逐图层 PNG 导出、文本属性解析，最后发送给 UI 线程合成 PSD。
 */

import { collectNodes, hasOwnPaint, ParsedNodeItem, RelRect } from './layers';
import { uint8ToBase64 } from './image';
import { parseTextNode, NativePsdTextData } from './text';
import { ExportLayerPayload, ExportDataPayload, PixelRect } from './psd-builder';
import { convertBlendMode } from './vector';

function getNodeBlendMode(node: SceneNode): string {
  return 'blendMode' in node ? (node as BlendMixin).blendMode : 'NORMAL';
}

function scaleRect(r: RelRect | null | undefined, scale: number): PixelRect | null {
  if (!r) return null;
  const x = Math.round(r.x * scale);
  const y = Math.round(r.y * scale);
  return {
    x,
    y,
    width: Math.round((r.x + r.width) * scale) - x,
    height: Math.round((r.y + r.height) * scale) - y
  };
}

/**
 * 离屏渲染容器自身的背景（填充、描边、圆角、效果），不包含子节点。
 * 使用临时矩形节点渲染后立即删除，不修改原文档。
 * 返回 PNG 以及 PNG 左上角相对容器布局框左上角的偏移（Figma 单位）。
 */
async function renderContainerBackground(
  node: SceneNode,
  scale: number
): Promise<{ bytes: Uint8Array; offsetX: number; offsetY: number } | null> {
  if (!hasOwnPaint(node)) return null;
  const src = node as FrameNode;
  let rect: RectangleNode | null = null;
  try {
    rect = figma.createRectangle();
    rect.resize(Math.max(0.01, src.width), Math.max(0.01, src.height));
    rect.fills = src.fills;
    if ('strokes' in src) {
      rect.strokes = src.strokes;
      rect.strokeAlign = src.strokeAlign;
      if (src.strokeWeight !== figma.mixed) {
        rect.strokeWeight = src.strokeWeight;
      } else {
        rect.strokeTopWeight = src.strokeTopWeight;
        rect.strokeRightWeight = src.strokeRightWeight;
        rect.strokeBottomWeight = src.strokeBottomWeight;
        rect.strokeLeftWeight = src.strokeLeftWeight;
      }
      if (Array.isArray(src.dashPattern)) rect.dashPattern = src.dashPattern;
    }
    if ('cornerRadius' in src) {
      if (src.cornerRadius !== figma.mixed) {
        rect.cornerRadius = src.cornerRadius;
      } else {
        rect.topLeftRadius = src.topLeftRadius;
        rect.topRightRadius = src.topRightRadius;
        rect.bottomLeftRadius = src.bottomLeftRadius;
        rect.bottomRightRadius = src.bottomRightRadius;
      }
      if (typeof src.cornerSmoothing === 'number') rect.cornerSmoothing = src.cornerSmoothing;
    }
    if ('effects' in src && Array.isArray(src.effects)) rect.effects = src.effects;
    if ('rotation' in src && src.rotation) rect.rotation = src.rotation;

    const bytes = await rect.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale } });
    const box = rect.absoluteBoundingBox;
    const render = rect.absoluteRenderBounds;
    const offsetX = box && render ? render.x - box.x : 0;
    const offsetY = box && render ? render.y - box.y : 0;
    return { bytes, offsetX, offsetY };
  } catch (err) {
    console.warn(`容器 ${node.name} 背景渲染失败:`, err);
    return null;
  } finally {
    if (rect) rect.remove();
  }
}

export async function handleExportPSD(nodeId: string, scale: number = 1, exportMode: string = 'hierarchical'): Promise<void> {
  // getNodeById 已废弃，且在 documentAccess: dynamic-page 下会直接抛异常
  const targetNode = (await figma.getNodeByIdAsync(nodeId)) as FrameNode | null;

  if (!targetNode) {
    figma.ui.postMessage({ type: 'error', message: '找不到指定的画板/图层' });
    return;
  }

  const rootBounds = targetNode.absoluteBoundingBox;
  if (!rootBounds) {
    figma.ui.postMessage({ type: 'error', message: '无法获取画板尺寸' });
    return;
  }

  const docWidth = Math.round(rootBounds.width * scale);
  const docHeight = Math.round(rootBounds.height * scale);

  figma.ui.postMessage({ type: 'status', status: '导出主画板全局预览图像中...' });

  // 1. 导出主画板全量图像快照（用于全局视口预览）。
  //    useAbsoluteBounds：严格按画板布局框导出。默认导出会把画板外阴影/外描边算进去，
  //    导致 PSD 文档尺寸变大、所有图层相对合成图错位。
  const rootCompositeBytes = await targetNode.exportAsync({
    format: 'PNG',
    constraint: { type: 'SCALE', value: scale },
    useAbsoluteBounds: true
  });
  const rootCompositeBase64 = uint8ToBase64(rootCompositeBytes);

  const exportLayers: ExportLayerPayload[] = [];

  // 2. 根节点（画板/选中容器）合并栅格化：命名以 "-合并" 结尾时，
  //    整板拍平为一张位图图层（不再单独渲染背景/递归子图层）
  const isRootMerge = typeof targetNode.name === 'string' && targetNode.name.endsWith('-合并');
  const rootLayerName = isRootMerge
    ? targetNode.name.slice(0, -'-合并'.length)
    : targetNode.name;

  if (isRootMerge) {
    exportLayers.push({
      id: targetNode.id + '_merged',
      name: rootLayerName,
      kind: 'image',
      isGroup: false,
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      x: 0,
      y: 0,
      width: docWidth,
      height: docHeight,
      parentId: null,
      pngBase64: rootCompositeBase64
    });

    figma.ui.postMessage({ type: 'status', status: '检测到 "-合并" 命名，整板栅格化导出中...' });

    const payloadRootMerge: ExportDataPayload = {
      artboardName: rootLayerName,
      width: docWidth,
      height: docHeight,
      scale: scale,
      rootCompositePngBase64: rootCompositeBase64,
      layers: exportLayers
    };

    figma.ui.postMessage({ type: 'export-data', ...payloadRootMerge });
    return;
  }

  // 2b. 根画板背景图层（离屏临时节点渲染）
  if (hasOwnPaint(targetNode)) {
    figma.ui.postMessage({ type: 'status', status: '正在单独渲染画板背景图层...' });
    const bg = await renderContainerBackground(targetNode, scale);
    if (bg) {
      exportLayers.push({
        id: targetNode.id + '_bg',
        name: '背景',
        kind: 'image',
        isGroup: false,
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        x: Math.round(bg.offsetX * scale),
        y: Math.round(bg.offsetY * scale),
        width: docWidth,
        height: docHeight,
        parentId: null,
        pngBase64: uint8ToBase64(bg.bytes)
      });
    }
  }

  // 3. 递归解析树图层
  const nodeList: ParsedNodeItem[] = [];
  collectNodes(targetNode, targetNode, rootBounds, nodeList, exportMode, null);

  const total = nodeList.length;
  figma.ui.postMessage({
    type: 'status',
    status: `开始处理分层 (共 ${total} 个图层)...`
  });

  for (let i = 0; i < total; i++) {
    const item = nodeList[i];

    figma.ui.postMessage({
      type: 'progress',
      current: i + 1,
      total: total,
      layerName: item.name
    });

    const common = {
      id: item.id,
      name: item.name,
      visible: item.visible,
      opacity: item.opacity !== undefined ? item.opacity : 1,
      width: Math.round(item.width * scale),
      height: Math.round(item.height * scale),
      parentId: item.parentId,
      clip: scaleRect(item.clip, scale)
    };

    if (item.isGroup) {
      const groupLayer: ExportLayerPayload = {
        ...common,
        kind: 'group',
        isGroup: true,
        blendMode: item.maskNode ? 'pass through' : convertBlendMode(getNodeBlendMode(item.node), true),
        x: Math.round(item.x * scale),
        y: Math.round(item.y * scale)
      };

      // Figma 蒙版：导出蒙版节点自身像素，作为组蒙版
      if (item.maskNode) {
        try {
          const maskBytes = await item.maskNode.exportAsync({
            format: 'PNG',
            constraint: { type: 'SCALE', value: scale }
          });
          groupLayer.maskPngBase64 = uint8ToBase64(maskBytes);
          groupLayer.maskX = Math.round(item.renderX * scale);
          groupLayer.maskY = Math.round(item.renderY * scale);
          groupLayer.maskLuminance = 'maskType' in item.maskNode &&
            (item.maskNode as BlendMixin).maskType === 'LUMINANCE';
        } catch (err) {
          console.warn(`蒙版 ${item.name} 导出失败:`, err);
        }
      }

      exportLayers.push(groupLayer);
    } else if (item.isBackground) {
      const bg = await renderContainerBackground(item.node, scale);
      if (bg) {
        exportLayers.push({
          ...common,
          kind: 'image',
          isGroup: false,
          blendMode: 'normal',
          x: Math.round((item.x + bg.offsetX) * scale),
          y: Math.round((item.y + bg.offsetY) * scale),
          pngBase64: uint8ToBase64(bg.bytes)
        });
      }
    } else if (item.kind === 'text') {
      // TEXT 节点：解析原生可编辑文本属性（TySh），同时导出 PNG 作为栅格预览
      //（Photoshop 文本图层本身就同时包含像素与 TySh 描述符，二者缺一不可）
      let textData: NativePsdTextData | null = null;
      try {
        textData = await parseTextNode(item.node as TextNode, scale, item.name);
      } catch (fontErr) {
        console.warn(`文本属性解析异常:`, fontErr);
      }

      let textPngBase64: string | undefined = undefined;
      try {
        // useAbsoluteBounds：PNG 与文本框（absoluteBoundingBox）完全对齐。
        // 默认导出会裁切到字形实际像素，PNG 左上角不再是文本框左上角，
        // 既会让预览像素错位，也会让 UI 端基于 PNG 的基线检测整体偏移。
        const pngBytes = await item.node.exportAsync({
          format: 'PNG',
          constraint: { type: 'SCALE', value: scale },
          useAbsoluteBounds: true
        });
        textPngBase64 = uint8ToBase64(pngBytes);
      } catch (pngErr) {
        console.warn(`文本图层 ${item.name} PNG 导出失败（仍保留可编辑文本）:`, pngErr);
      }

      exportLayers.push({
        ...common,
        kind: 'text',
        isGroup: false,
        textData: textData,
        blendMode: convertBlendMode(getNodeBlendMode(item.node), false),
        x: Math.round(item.x * scale),
        y: Math.round(item.y * scale),
        pngBase64: textPngBase64
      });
    } else {
      // 非 TEXT 节点（图片/形状/合并容器）：PNG 按渲染范围裁切，因此用 renderX/renderY 定位
      try {
        const pngBytes = await item.node.exportAsync({
          format: 'PNG',
          constraint: { type: 'SCALE', value: scale }
        });

        exportLayers.push({
          ...common,
          kind: item.kind,
          isGroup: false,
          blendMode: convertBlendMode(getNodeBlendMode(item.node), false),
          x: Math.round(item.renderX * scale),
          y: Math.round(item.renderY * scale),
          pngBase64: uint8ToBase64(pngBytes)
        });
      } catch (err) {
        console.warn(`图层 ${item.name} 导出失败:`, err);
      }
    }
  }

  const payload: ExportDataPayload = {
    artboardName: targetNode.name,
    width: docWidth,
    height: docHeight,
    scale: scale,
    rootCompositePngBase64: rootCompositeBase64,
    layers: exportLayers
  };

  figma.ui.postMessage({
    type: 'export-data',
    ...payload
  });
}
