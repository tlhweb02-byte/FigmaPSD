/**
 * Exporter 模块 (src/exporter.ts)
 * 特别说明：对于 TEXT 节点绝对不调用 exportAsync PNG，直接读取文本属性传输；其它图层保持 Canvas PNG 机制
 */

import { collectNodes, ParsedNodeItem } from './layers';
import { uint8ToBase64 } from './image';
import { parseTextNode, NativePsdTextData } from './text';
import { ExportLayerPayload, ExportDataPayload } from './psd-builder';
import { convertBlendMode } from './blend';

function getNodeBlendMode(node: SceneNode): string {
  return 'blendMode' in node ? (node as BlendMixin).blendMode : 'NORMAL';
}

export async function handleExportPSD(nodeId: string, scale: number = 1, exportMode: string = 'hierarchical'): Promise<void> {
  const targetNode = figma.getNodeById(nodeId) as FrameNode;

  if (!targetNode) {
    figma.ui.postMessage({ type: 'error', message: '找不到指定的画板/图层' });
    return;
  }

  const rootBounds = targetNode.absoluteBoundingBox;
  if (!rootBounds) {
    figma.ui.postMessage({ type: 'error', message: '无法获取画板尺寸' });
    return;
  }

  figma.ui.postMessage({ type: 'status', status: '导出主画板全局预览图像中...' });

  // 1. 导出主画板全量图像快照（用于全局视口预览）
  const rootCompositeBytes = await targetNode.exportAsync({
    format: 'PNG',
    constraint: { type: 'SCALE', value: scale }
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
      width: Math.round(rootBounds.width * scale),
      height: Math.round(rootBounds.height * scale),
      parentId: null,
      pngBase64: rootCompositeBase64
    });

    figma.ui.postMessage({ type: 'status', status: '检测到 "-合并" 命名，整板栅格化导出中...' });

    const payloadRootMerge: ExportDataPayload = {
      artboardName: rootLayerName,
      width: Math.round(rootBounds.width * scale),
      height: Math.round(rootBounds.height * scale),
      scale: scale,
      rootCompositePngBase64: rootCompositeBase64,
      layers: exportLayers
    };

    figma.ui.postMessage({ type: 'export-data', ...payloadRootMerge });
    return;
  }

  // 2b. 独立背景图层渲染（离屏临时节点）
  let hasBackground = false;
  if ('fills' in targetNode && Array.isArray(targetNode.fills) && targetNode.fills.length > 0) {
    const visibleFills = targetNode.fills.filter(f => f.visible !== false);
    if (visibleFills.length > 0) {
      hasBackground = true;
    }
  }

  if (hasBackground) {
    figma.ui.postMessage({ type: 'status', status: '正在单独渲染画板背景图层...' });

    let tempBgRect: RectangleNode | null = null;
    try {
      tempBgRect = figma.createRectangle();
      tempBgRect.resize(targetNode.width, targetNode.height);
      tempBgRect.fills = targetNode.fills;

      const bgPngBytes = await tempBgRect.exportAsync({
        format: 'PNG',
        constraint: { type: 'SCALE', value: scale }
      });

      exportLayers.push({
        id: targetNode.id + '_bg',
        name: '背景',
        kind: 'image',
        isGroup: false,
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        x: 0,
        y: 0,
        width: Math.round(rootBounds.width * scale),
        height: Math.round(rootBounds.height * scale),
        parentId: null,
        pngBase64: uint8ToBase64(bgPngBytes)
      });
    } catch (err) {
      console.warn('纯背景渲染失败:', err);
    } finally {
      if (tempBgRect) {
        tempBgRect.remove();
      }
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

    if (item.isGroup) {
      exportLayers.push({
        id: item.id,
        name: item.name,
        kind: 'group',
        isGroup: true,
        visible: item.visible,
        opacity: item.opacity !== undefined ? item.opacity : 1,
        blendMode: convertBlendMode(getNodeBlendMode(item.node), true),
        x: Math.round(item.x * scale),
        y: Math.round(item.y * scale),
        width: Math.round(item.width * scale),
        height: Math.round(item.height * scale),
        parentId: item.parentId
      });
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
        const pngBytes = await item.node.exportAsync({
          format: 'PNG',
          constraint: { type: 'SCALE', value: scale }
        });
        textPngBase64 = uint8ToBase64(pngBytes);
      } catch (pngErr) {
        console.warn(`文本图层 ${item.name} PNG 导出失败（仍保留可编辑文本）:`, pngErr);
      }

      exportLayers.push({
        id: item.id,
        name: item.name,
        kind: 'text',
        isGroup: false,
        textData: textData,
        visible: item.visible,
        opacity: item.opacity !== undefined ? item.opacity : 1,
        blendMode: convertBlendMode(getNodeBlendMode(item.node), false),
        x: Math.round(item.x * scale),
        y: Math.round(item.y * scale),
        width: Math.round(item.width * scale),
        height: Math.round(item.height * scale),
        parentId: item.parentId,
        pngBase64: textPngBase64
      });
    } else {
      // 非 TEXT 节点（图片/形状）：继续保持 Canvas PNG 导出机制
      try {
        const pngBytes = await item.node.exportAsync({
          format: 'PNG',
          constraint: { type: 'SCALE', value: scale }
        });

        exportLayers.push({
          id: item.id,
          name: item.name,
          kind: item.kind,
          isGroup: false,
          visible: item.visible,
          opacity: item.opacity !== undefined ? item.opacity : 1,
          blendMode: convertBlendMode(getNodeBlendMode(item.node), false),
          x: Math.round(item.x * scale),
          y: Math.round(item.y * scale),
          width: Math.round(item.width * scale),
          height: Math.round(item.height * scale),
          parentId: item.parentId,
          pngBase64: uint8ToBase64(pngBytes)
        });
      } catch (err) {
        console.warn(`图层 ${item.name} 导出失败:`, err);
      }
    }
  }

  const payload: ExportDataPayload = {
    artboardName: targetNode.name,
    width: Math.round(rootBounds.width * scale),
    height: Math.round(rootBounds.height * scale),
    scale: scale,
    rootCompositePngBase64: rootCompositeBase64,
    layers: exportLayers
  };

  figma.ui.postMessage({
    type: 'export-data',
    ...payload
  });
}
