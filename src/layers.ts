/**
 * Layers 图层列表收集模块
 */

export type LayerKind = 'group' | 'text' | 'vector' | 'image';

export interface ParsedNodeItem {
  id: string;
  name: string;
  kind: LayerKind;
  isGroup: boolean;
  visible: boolean;
  opacity: number;
  x: number;
  y: number;
  width: number;
  height: number;
  parentId: string | null;
  node: SceneNode;
}

/** 根据 Figma 节点类型推断 PSD 图层类型 */
export function inferKind(node: SceneNode): LayerKind {
  switch (node.type) {
    case 'TEXT':
      return 'text';
    case 'RECTANGLE':
    case 'ELLIPSE':
    case 'POLYGON':
    case 'STAR':
    case 'VECTOR':
    case 'LINE':
      return 'vector';
    default:
      return 'image';
  }
}

/** 合并栅格化标记：容器命名以该后缀结尾时，导出时整组拍平为一张位图 */
export const MERGE_SUFFIX = '-合并';

/** 判断节点类型是否为容器（组/组件实例/画板） */
function isContainerType(node: SceneNode): boolean {
  return (
    node.type === 'FRAME' ||
    node.type === 'GROUP' ||
    node.type === 'COMPONENT' ||
    node.type === 'INSTANCE' ||
    node.type === 'SECTION'
  );
}

export function collectNodes(
  node: SceneNode,
  rootNode: SceneNode,
  rootBounds: Rect,
  result: ParsedNodeItem[],
  exportMode: string,
  parentId: string | null = null
): void {
  if (!node.visible && node !== rootNode) return;

  const isRoot = node === rootNode;

  if (!isRoot) {
    const bounds = node.absoluteBoundingBox;
    if (!bounds || bounds.width === 0 || bounds.height === 0) return;

    const relX = bounds.x - rootBounds.x;
    const relY = bounds.y - rootBounds.y;

    // 合并栅格化：容器命名以 "-合并" 结尾时，不再展开为组，
    // 整组作为一张位图（kind 走 inferKind 默认 image），图层名去掉后缀
    const wantsMerge = isContainerType(node) &&
      typeof node.name === 'string' && node.name.endsWith(MERGE_SUFFIX);
    const layerName = wantsMerge ? node.name.slice(0, -MERGE_SUFFIX.length) : node.name;

    const isContainer = isContainerType(node) && !wantsMerge && exportMode === 'hierarchical';

    const opacity = 'opacity' in node && typeof (node as any).opacity === 'number'
      ? (node as any).opacity
      : 1;

    if (isContainer && 'children' in node && (node as FrameNode).children.length > 0) {
      result.push({
        id: node.id,
        name: layerName,
        kind: 'group',
        isGroup: true,
        visible: node.visible,
        opacity: opacity,
        x: relX,
        y: relY,
        width: bounds.width,
        height: bounds.height,
        parentId: parentId,
        node: node
      });

      for (const child of (node as FrameNode).children) {
        collectNodes(child, rootNode, rootBounds, result, exportMode, node.id);
      }
      return;
    } else {
      result.push({
        id: node.id,
        name: layerName,
        kind: inferKind(node),
        isGroup: false,
        visible: node.visible,
        opacity: opacity,
        x: relX,
        y: relY,
        width: bounds.width,
        height: bounds.height,
        parentId: parentId,
        node: node
      });
      return;
    }
  }

  if ('children' in node) {
    for (const child of (node as FrameNode).children) {
      collectNodes(child, rootNode, rootBounds, result, exportMode, null);
    }
  }
}
