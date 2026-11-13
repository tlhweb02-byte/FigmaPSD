/**
 * Layers 图层列表收集模块
 *
 * 坐标约定（均为相对根画板左上角、未乘导出倍率的 Figma 单位）：
 *   - x/y/width/height：节点 absoluteBoundingBox（布局框）
 *   - renderX/renderY ：节点 absoluteRenderBounds（实际渲染范围，含描边外扩/阴影等效果）。
 *     exportAsync 默认按渲染范围裁切 PNG，因此位图图层必须按 renderX/renderY 定位，
 *     否则带阴影/外描边的图层会整体错位。
 */

export type LayerKind = 'group' | 'text' | 'vector' | 'image';

/** 相对根画板的矩形（Figma 单位，未乘倍率） */
export interface RelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

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
  renderX: number;
  renderY: number;
  parentId: string | null;
  node: SceneNode;
  /** 需要在 PSD 中用图层蒙版裁切到的矩形（来自 clipsContent 的祖先画板） */
  clip?: RelRect | null;
  /** 该条目是容器自身的背景（填充/描边/圆角/效果），需离屏单独渲染 */
  isBackground?: boolean;
  /** 该条目是 Figma 蒙版（isMask）生成的组，maskNode 的像素作为组蒙版 */
  maskNode?: SceneNode;
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

/**
 * 判断节点是否为容器（展开为 PSD 组，子图层各自导出）。
 * 规则：凡是有子节点的都算容器——FRAME / GROUP / COMPONENT / INSTANCE / SECTION，
 * 以及组件插槽 SLOT 等新类型（旧版只列举固定类型，插槽被当成一张图片导出，里面的文字变成位图）。
 * 例外：布尔运算组（BOOLEAN_OPERATION）的子路径只是参与运算的形状，必须整体作为一个形状导出。
 */
function isContainerType(node: SceneNode): boolean {
  if (node.type === 'BOOLEAN_OPERATION') return false;
  if (!('children' in node)) return false;
  // 不用 Array.isArray：只要是带 length 的列表即可（不同运行环境下 children 的具体类型可能不同）
  const children = (node as ChildrenMixin).children as unknown;
  return children != null && typeof (children as { length?: unknown }).length === 'number';
}

/**
 * 诊断：按插件在 Figma 中实际读到的样子输出节点树（每个属性单独容错）。
 * 用于排查"接口里结构正常、插件里读不到/被合并"的问题。
 */
export function describeTree(node: SceneNode, depth: number = 0, lines: string[] = []): string[] {
  const read = (fn: () => unknown): string => {
    try { return String(fn()); } catch (e: any) { return '<<错误: ' + (e && e.message ? e.message : e) + '>>'; }
  };
  const n = node as any;
  let kids: any = null;
  let kidsInfo = '无children属性';
  try {
    if ('children' in n) {
      kids = n.children;
      kidsInfo = `children: isArray=${Array.isArray(kids)} length=${kids == null ? 'null' : kids.length}`;
    }
  } catch (e: any) {
    kidsInfo = '<<读取children出错: ' + (e && e.message ? e.message : e) + '>>';
  }
  lines.push(
    '  '.repeat(depth) +
    `${read(() => n.type)} "${read(() => n.name)}" id=${read(() => n.id)} visible=${read(() => n.visible)} ` +
    `removed=${read(() => n.removed)} isMask=${read(() => n.isMask)} ` +
    `box=${read(() => JSON.stringify(n.absoluteBoundingBox))} render=${read(() => JSON.stringify(n.absoluteRenderBounds))} ${kidsInfo}`
  );
  if (kids && typeof kids.length === 'number' && depth < 12) {
    for (let i = 0; i < kids.length; i++) {
      try {
        describeTree(kids[i], depth + 1, lines);
      } catch (e: any) {
        lines.push('  '.repeat(depth + 1) + `<<第 ${i} 个子节点无法读取: ${e && e.message ? e.message : e}>>`);
      }
    }
  }
  return lines;
}

/** 容器自身是否有可见的填充或描边（展开为组时需要单独输出背景图层） */
export function hasOwnPaint(node: SceneNode): boolean {
  if (node.type === 'GROUP') return false;
  const visiblePaint = (paints: unknown): boolean =>
    Array.isArray(paints) && paints.some((p: Paint) => p.visible !== false && (p.opacity === undefined || p.opacity > 0));
  const fills = 'fills' in node ? (node as GeometryMixin).fills : undefined;
  const strokes = 'strokes' in node ? (node as GeometryMixin).strokes : undefined;
  return visiblePaint(fills) || visiblePaint(strokes);
}

function intersectRect(a: RelRect | null, b: RelRect | null): RelRect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.width, b.x + b.width);
  const btm = Math.min(a.y + a.height, b.y + b.height);
  return { x, y, width: Math.max(0, r - x), height: Math.max(0, btm - y) };
}

function toRel(rect: Rect, rootBounds: Rect): RelRect {
  return { x: rect.x - rootBounds.x, y: rect.y - rootBounds.y, width: rect.width, height: rect.height };
}

function getOpacity(node: SceneNode): number {
  return 'opacity' in node && typeof (node as any).opacity === 'number' ? (node as any).opacity : 1;
}

/**
 * 递归收集图层。结果数组顺序 = 由下到上（与 Figma children 及 ag-psd children 顺序一致）。
 *
 * @param clip 祖先 clipsContent 画板留下、尚未被已输出的组蒙版处理的裁切矩形
 */
export function collectNodes(
  node: SceneNode,
  rootNode: SceneNode,
  rootBounds: Rect,
  result: ParsedNodeItem[],
  exportMode: string,
  parentId: string | null = null,
  clip: RelRect | null = null
): void {
  if (node === rootNode) {
    if ('children' in node) {
      // 根画板本身就是 PSD 文档边界，clipsContent 由文档尺寸天然实现
      collectChildren((node as ChildrenMixin).children, rootNode, rootBounds, result, exportMode, null, null);
    }
    return;
  }

  if (!node.visible) return;

  const bounds = node.absoluteBoundingBox;
  // 渲染范围为 null 表示节点没有任何可见像素（空文本、全透明等）。
  // 注意：不能用 bounds 宽/高为 0 来判断——水平/垂直线条的布局框高或宽就是 0，但有描边像素。
  const renderBounds = 'absoluteRenderBounds' in node ? (node as any).absoluteRenderBounds as Rect | null : bounds;
  if (!bounds || !renderBounds || renderBounds.width <= 0 || renderBounds.height <= 0) return;

  const rel = toRel(bounds, rootBounds);
  const relRender = toRel(renderBounds, rootBounds);

  // 完全落在裁切区域之外的图层在 Figma 中不可见，直接跳过
  if (clip) {
    const vis = intersectRect(clip, relRender);
    if (!vis || vis.width <= 0 || vis.height <= 0) return;
  }

  // 合并栅格化：容器命名以 "-合并" 结尾时，不再展开为组，
  // 整组作为一张位图（kind 走 inferKind 默认 image），图层名去掉后缀
  const wantsMerge = isContainerType(node) &&
    typeof node.name === 'string' && node.name.endsWith(MERGE_SUFFIX);
  const layerName = wantsMerge ? node.name.slice(0, -MERGE_SUFFIX.length) : node.name;

  const expand = isContainerType(node) && !wantsMerge && 'children' in node;
  const base = {
    visible: node.visible,
    x: rel.x,
    y: rel.y,
    width: bounds.width,
    height: bounds.height,
    renderX: relRender.x,
    renderY: relRender.y,
    node: node
  };

  if (!expand) {
    result.push({
      ...base,
      id: node.id,
      name: layerName,
      kind: inferKind(node),
      isGroup: false,
      opacity: getOpacity(node),
      parentId: parentId,
      clip: clip
    });
    return;
  }

  const ownClip: RelRect | null =
    'clipsContent' in node && (node as FrameNode).clipsContent ? rel : null;
  const hierarchical = exportMode === 'hierarchical';

  let childParent = parentId;
  let childClip: RelRect | null;

  if (hierarchical) {
    // 容器 -> PSD 组（文件夹）。组蒙版负责祖先裁切 + 自身 clipsContent 裁切。
    result.push({
      ...base,
      id: node.id,
      name: layerName,
      kind: 'group',
      isGroup: true,
      opacity: getOpacity(node),
      parentId: parentId,
      clip: intersectRect(clip, ownClip)
    });
    childParent = node.id;
    childClip = null;
  } else {
    // 平铺模式：不输出组，裁切矩形下传给每个子图层
    childClip = intersectRect(clip, ownClip);
  }

  // 容器自身的背景（填充/描边/圆角/阴影）。展开为组后这些属性没有对应的 PSD 图层，
  // 必须单独渲染一张背景位图，否则卡片/按钮等的底色全部丢失。
  if (hasOwnPaint(node)) {
    result.push({
      ...base,
      id: node.id + '_bg',
      name: layerName + ' 背景',
      kind: 'image',
      isGroup: false,
      // 平铺模式下容器的不透明度无法落到组上，叠加到背景图层
      opacity: hierarchical ? 1 : getOpacity(node),
      parentId: childParent,
      // 背景不受自身 clipsContent 裁切（外阴影/外描边要保留），只受祖先裁切
      clip: hierarchical ? null : clip,
      isBackground: true
    });
  }

  collectChildren((node as ChildrenMixin).children, rootNode, rootBounds, result, exportMode, childParent, childClip);
}

/**
 * 遍历同级子节点，处理 Figma 蒙版：isMask 节点会裁切它上方的所有兄弟节点，
 * 直到遇到下一个蒙版节点或父容器结束。PSD 中生成一个以蒙版节点像素为组蒙版的组。
 */
function collectChildren(
  children: readonly SceneNode[],
  rootNode: SceneNode,
  rootBounds: Rect,
  result: ParsedNodeItem[],
  exportMode: string,
  parentId: string | null,
  clip: RelRect | null
): void {
  let currentParent = parentId;
  let currentClip = clip;

  for (const child of children) {
    // 实例/插槽里偶尔会列出已失效的子图层（Figma 报 "node ... does not exist"），
    // 读它的任何属性都会抛异常。跳过这一个图层，不让整个画板导出失败。
    const before = result.length;
    try {
      if (child.removed) continue;
      if (collectChild(child)) continue;
      collectNodes(child, rootNode, rootBounds, result, exportMode, currentParent, currentClip);
    } catch (err) {
      result.length = before; // 撤销该图层已写入的半成品条目
      let label = '(未知图层)';
      try { label = child.id; } catch (e) { /* 连 id 都读不到 */ }
      console.warn(`跳过失效图层 ${label}:`, err);
    }
  }

  /** 处理蒙版节点；返回 true 表示已处理（或应跳过），false 表示是普通图层 */
  function collectChild(child: SceneNode): boolean {
    if ('isMask' in child && (child as BlendMixin).isMask) {
      if (!child.visible) return true;
      const bounds = child.absoluteBoundingBox;
      const renderBounds = (child as any).absoluteRenderBounds as Rect | null;
      if (!bounds || !renderBounds) return true;
      const rel = toRel(bounds, rootBounds);
      const relRender = toRel(renderBounds, rootBounds);
      const groupId = child.id + '_maskgroup';
      result.push({
        id: groupId,
        name: child.name + ' (蒙版)',
        kind: 'group',
        isGroup: true,
        visible: true,
        opacity: 1,
        x: rel.x,
        y: rel.y,
        width: bounds.width,
        height: bounds.height,
        renderX: relRender.x,
        renderY: relRender.y,
        parentId: parentId,
        node: child,
        clip: clip,
        maskNode: child
      });
      // 蒙版组已承担了外层裁切，组内图层不再重复裁切
      currentParent = groupId;
      currentClip = null;
      return true;
    }
    return false;
  }
}
