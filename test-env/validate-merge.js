/**
 * Validate the "-合并" merge-flatten feature in collectNodes:
 * - A container (GROUP/FRAME/COMPONENT/INSTANCE/SECTION) named "xxx-合并"
 *   is emitted as a single raster layer (kind 'image', isGroup false),
 *   its children are NOT recursed, and the name drops the "-合并" suffix.
 * - Normal containers still expand into groups.
 */
const path = require('path');

// ---- replicate the collectNodes logic (mirrors src/layers.ts) ----
const MERGE_SUFFIX = '-合并';

function isContainerType(node) {
  return ['FRAME', 'GROUP', 'COMPONENT', 'INSTANCE', 'SECTION'].includes(node.type);
}

function inferKind(node) {
  switch (node.type) {
    case 'TEXT': return 'text';
    case 'RECTANGLE': case 'ELLIPSE': case 'POLYGON':
    case 'STAR': case 'VECTOR': case 'LINE': return 'vector';
    default: return 'image';
  }
}

function collectNodes(node, rootNode, rootBounds, result, exportMode, parentId = null) {
  if (!node.visible && node !== rootNode) return;
  const isRoot = node === rootNode;

  if (!isRoot) {
    const bounds = node.absoluteBoundingBox;
    if (!bounds || bounds.width === 0 || bounds.height === 0) return;
    const relX = bounds.x - rootBounds.x;
    const relY = bounds.y - rootBounds.y;

    const wantsMerge = isContainerType(node) &&
      typeof node.name === 'string' && node.name.endsWith(MERGE_SUFFIX);
    const layerName = wantsMerge ? node.name.slice(0, -MERGE_SUFFIX.length) : node.name;
    const isContainer = isContainerType(node) && !wantsMerge && exportMode === 'hierarchical';
    const opacity = 'opacity' in node && typeof node.opacity === 'number' ? node.opacity : 1;

    if (isContainer && 'children' in node && node.children.length > 0) {
      result.push({ id: node.id, name: layerName, kind: 'group', isGroup: true, visible: node.visible, opacity, x: relX, y: relY, width: bounds.width, height: bounds.height, parentId, node });
      for (const child of node.children) collectNodes(child, rootNode, rootBounds, result, exportMode, node.id);
      return;
    } else {
      result.push({ id: node.id, name: layerName, kind: inferKind(node), isGroup: false, visible: node.visible, opacity, x: relX, y: relY, width: bounds.width, height: bounds.height, parentId, node });
      return;
    }
  }
  if ('children' in node) {
    for (const child of node.children) collectNodes(child, rootNode, rootBounds, result, exportMode, null);
  }
}

// ---- mock nodes ----
function makeNode(id, name, type, children, visible = true) {
  return {
    id, name, type, visible,
    children: children || [],
    absoluteBoundingBox: { x: 10, y: 20, width: 200, height: 100 },
    opacity: 1
  };
}

const rootBounds = { x: 0, y: 0, width: 500, height: 400 };

// scenario:
// root FRAME
//   ├─ GROUP "按钮组-合并"          -> should flatten to image, name "按钮组"
//   │    ├─ RECTANGLE "背景"
//   │    └─ TEXT "文字"
//   ├─ GROUP "正常组"                -> should stay a group
//   │    └─ RECTANGLE "子矩形"
//   ├─ INSTANCE "卡片实例-合并"      -> should flatten to image, name "卡片实例"
//   │    └─ (children from component)
//   ├─ FRAME "子画板-合并"           -> should flatten, name "子画板"
//   │    └─ RECTANGLE "x"
//   └─ TEXT "标题"                   -> stays text
const root = makeNode('root', '主画板', 'FRAME', [
  makeNode('g1', '按钮组-合并', 'GROUP', [
    makeNode('r1', '背景', 'RECTANGLE'),
    makeNode('t1', '文字', 'TEXT')
  ]),
  makeNode('g2', '正常组', 'GROUP', [
    makeNode('r2', '子矩形', 'RECTANGLE')
  ]),
  makeNode('i1', '卡片实例-合并', 'INSTANCE', [
    makeNode('r3', '内部元素', 'RECTANGLE')
  ]),
  makeNode('f1', '子画板-合并', 'FRAME', [
    makeNode('r4', 'x', 'RECTANGLE')
  ]),
  makeNode('tx1', '标题', 'TEXT')
]);

const result = [];
collectNodes(root, root, rootBounds, result, 'hierarchical');

console.log('collected layers:');
const summary = result.map(r => `${r.id} "${r.name}" kind=${r.kind} isGroup=${r.isGroup} parent=${r.parentId}`);
summary.forEach(s => console.log('  ' + s));

const failures = [];

// 1. merged group -> single image, name stripped
const g1 = result.find(r => r.id === 'g1');
if (!g1) failures.push('g1 missing');
else {
  if (g1.kind !== 'image') failures.push(`g1 kind should be image, got ${g1.kind}`);
  if (g1.isGroup !== false) failures.push('g1 should not be a group');
  if (g1.name !== '按钮组') failures.push(`g1 name should be "按钮组", got "${g1.name}"`);
  if (result.some(r => r.parentId === 'g1')) failures.push('g1 children should NOT be recursed');
}
// 2. normal group -> stays group with child
const g2 = result.find(r => r.id === 'g2');
if (!g2 || g2.kind !== 'group' || g2.isGroup !== true) failures.push('g2 should stay a group');
else if (!result.some(r => r.id === 'r2' && r.parentId === 'g2')) failures.push('g2 child r2 missing');
// 3. merged instance -> image, name stripped
const i1 = result.find(r => r.id === 'i1');
if (!i1) failures.push('i1 missing');
else {
  if (i1.kind !== 'image') failures.push(`i1 kind should be image, got ${i1.kind}`);
  if (i1.name !== '卡片实例') failures.push(`i1 name should be "卡片实例", got "${i1.name}"`);
  if (result.some(r => r.parentId === 'i1')) failures.push('i1 children should NOT be recursed');
}
// 4. merged frame (artboard-like) -> image, name stripped
const f1 = result.find(r => r.id === 'f1');
if (!f1) failures.push('f1 missing');
else {
  if (f1.kind !== 'image') failures.push(`f1 kind should be image, got ${f1.kind}`);
  if (f1.name !== '子画板') failures.push(`f1 name should be "子画板", got "${f1.name}"`);
}
// 5. plain text unaffected
const tx1 = result.find(r => r.id === 'tx1');
if (!tx1 || tx1.kind !== 'text' || tx1.name !== '标题') failures.push('tx1 should stay text "标题"');

// 6. flat mode: containers without -合并 are leaves anyway; -合并 still strips name
const resultFlat = [];
collectNodes(root, root, rootBounds, resultFlat, 'flat');
const g2flat = resultFlat.find(r => r.id === 'g2');
if (g2flat && g2flat.isGroup === true) failures.push('flat mode: g2 should not be a group');
const g1flat = resultFlat.find(r => r.id === 'g1');
if (!g1flat || g1flat.name !== '按钮组') failures.push('flat mode: g1 name should be "按钮组"');

console.log('\n=== RESULT ===');
if (failures.length) { failures.forEach(f => console.log(' - ' + f)); process.exitCode = 1; }
else console.log('MERGE-FLATTEN FEATURE VALIDATED ✓');
