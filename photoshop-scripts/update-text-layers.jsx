// Figma2PSD-Pro：批量更新导出 PSD 的文字图层（Photoshop 脚本）
//
// 为什么需要：插件生成的 PSD 不含 Photoshop 文字引擎的内部排版缓存（Txt2，由 PS 用本机字体算出，
// 无法在 Figma 中生成），所以 PS 编辑文字时会提示「更新文字图层」。本脚本让 PS 一次性完成更新并保存，
// 之后再打开就不会提示。
//
// 用法：Photoshop > 文件 > 脚本 > 浏览…，选择本文件，再选择存放导出 PSD 的文件夹。
// 更新后的文件保存到该文件夹下的「已更新」子文件夹，原文件不改动。
//
// 更新方式（按顺序尝试）：
//   1. 如果动作面板里有动作组「Figma2PSD」中的动作「更新文字图层」，直接执行它（最可靠，见 README）；
//   2. 否则尝试直接调用菜单命令「文字 > 更新所有文字图层」。
#target photoshop

(function () {
  var ACTION_SET = 'Figma2PSD';
  var ACTION_NAME = '更新文字图层';
  var MENU_IDS = ['updateAllTypeLayers', 'updateAllTextLayers', 'updateTextLayers'];

  var folder = Folder.selectDialog('选择存放 Figma2PSD 导出 PSD 的文件夹');
  if (!folder) return;
  var files = folder.getFiles(function (f) { return f instanceof File && /\.psd$/i.test(f.name); });
  if (!files.length) { alert('该文件夹中没有 PSD 文件'); return; }

  var outFolder = new Folder(folder.fsName + '/已更新');
  if (!outFolder.exists) outFolder.create();

  var oldDialogs = app.displayDialogs;
  // 关闭交互对话框：打开/编辑时的「更新文字图层」询问按默认（更新）处理
  app.displayDialogs = DialogModes.NO;

  var done = 0, failed = [], usedMethod = '';
  for (var i = 0; i < files.length; i++) {
    var doc = null;
    try {
      doc = app.open(files[i]);
      var method = updateTextLayers();
      if (!method) throw new Error('未能执行「更新所有文字图层」，请按 README 录制动作后重试');
      usedMethod = method;
      var opts = new PhotoshopSaveOptions();
      opts.layers = true;
      opts.embedColorProfile = true;
      opts.maximizeCompatibility = true;
      doc.saveAs(new File(outFolder.fsName + '/' + files[i].name), opts, true, Extension.LOWERCASE);
      done++;
    } catch (e) {
      failed.push(files[i].name + '：' + e.message);
    } finally {
      if (doc) { try { doc.close(SaveOptions.DONOTSAVECHANGES); } catch (e2) {} }
    }
  }
  app.displayDialogs = oldDialogs;

  var msg = '已更新 ' + done + ' / ' + files.length + ' 个文件，保存在：\n' + outFolder.fsName;
  if (usedMethod) msg += '\n\n更新方式：' + usedMethod;
  if (failed.length) msg += '\n\n失败：\n' + failed.join('\n');
  alert(msg);

  function updateTextLayers() {
    try {
      app.doAction(ACTION_NAME, ACTION_SET);
      return '动作「' + ACTION_SET + ' / ' + ACTION_NAME + '」';
    } catch (e) {}
    for (var k = 0; k < MENU_IDS.length; k++) {
      try {
        app.runMenuItem(stringIDToTypeID(MENU_IDS[k]));
        return '菜单命令 ' + MENU_IDS[k];
      } catch (e3) {}
    }
    return '';
  }
})();
