/**
 * Figma 插件核心主进程 (src/code.ts)
 */

import { handleExportPSD } from './exporter';

figma.showUI(__html__, { width: 420, height: 640, themeColors: true });

function updateSelection(): void {
  const selection = figma.currentPage.selection;
  const artboards = [];

  for (const node of selection) {
    if (
      node.type === "FRAME" ||
      node.type === "COMPONENT" ||
      node.type === "INSTANCE" ||
      node.type === "SECTION" ||
      node.type === "GROUP"
    ) {
      artboards.push({
        id: node.id,
        name: node.name,
        type: node.type,
        width: Math.round(node.width),
        height: Math.round(node.height)
      });
    }
  }

  figma.ui.postMessage({
    type: "selection-changed",
    artboards: artboards,
    hasSelection: artboards.length > 0
  });
}

figma.on("selectionchange", () => {
  updateSelection();
});

updateSelection();

figma.ui.onmessage = async (msg: any) => {
  if (msg.type === "get-selection") {
    updateSelection();
  } else if (msg.type === "export-psd") {
    try {
      await handleExportPSD(msg.nodeId, msg.scale, msg.exportMode);
    } catch (err: any) {
      figma.ui.postMessage({
        type: "error",
        message: "导出过程发生错误: " + (err.message || err)
      });
    }
  }
};
