# Figma2PSD-Pro

一个遵循高内聚、低耦合架构设计的专业级 Figma 导出 Photoshop PSD 插件。

## 项目架构与文件职责

```text
Figma2PSD-Pro
│
├── manifest.json       # Figma 插件清单与权限配置
├── package.json        # NPM 构建脚本与依赖配置
├── tsconfig.json       # TypeScript 编译配置
│
├── src
│   ├── code.ts         # Figma 主线程核心入口（初始化 UI 与监听选择状态）
│   ├── ui.html         # 插件前端界面与 PSD 合成 JS（ag-psd 驱动，构建后复制到根目录）
│   ├── exporter.ts     # 导出主流程控制（离屏快照、独立背景渲染、图层通信）
│   ├── psd-builder.ts  # PSD 数据结构接口定义与类型构建
│   ├── layers.ts       # 树状图层解析（绝对坐标、递归嵌套、组关系判定、类型推断）
│   ├── text.ts         # 文本节点转换（字体预加载、PS 字体名映射、原生 TySh 文本提取）
│   ├── image.ts        # 位图转换（无损 Uint8Array -> Base64 编码管道）
│   └── vector.ts       # 矢量/形状节点混合模式与坐标映射
│
├── code.js             # 构建导出的 Figma 主线程可执行文件
├── ui.html             # Figma 前端 UI（内含 ag-psd PSD 合成逻辑）
└── README.md           # 说明文档
```

## 核心设计与技术亮点

1. **模块化架构**：将 Figma API 操作、文本提取、位图 Base64 转换、图层递归解析和 PSD 结构拼接拆分为独立模块，便于后续维护与扩展。
2. **零污染离屏渲染**：通过 `figma.createRectangle()` 离屏节点单独渲染画板背景，渲染完成后立刻 `.remove()` 销毁，绝对不修改原文档节点显隐属性，保证导出稳定无损。
3. **原生 PSD 可编辑文本**：解析 Figma `TEXT` 节点属性，为 `ag-psd` 注入原生 `TySh` 文本描述符（含 EngineData）。Photoshop 打开后呈现为原生 T 文字图层，支持双击编辑。字体名按 PostScript 风格映射（如 `SourceHanSansCN-Regular`），字号/行距使用磅值、字距使用 1/1000 em，均与真实 PS 导出文件字段对齐。
4. **全量 Viewport 拼合预览流**：写入 PSD 全局 `canvas` 拼合预览，保证画板在 Photoshop 中完美呈现。
5. **图层内容完整可见**：所有图层（含文本图层）均附带导出 PNG 作为栅格像素，配合原生描述符，确保图片与文字在 Photoshop 中都能正常显示。

## 历史问题修复说明（重要）

旧版本导出 PSD 打开后"全是栅格化图层、文字和图片都看不到"，根因有三，均已修复：

1. **ag-psd 版本过旧**：旧版使用 `ag-psd@2.1.0`，该版本明确不支持矢量/文本图层（其 README 声明
   "Does not support vector/text layers"），传入的 `text` 属性被静默忽略，文字图层变成无像素空图层。
   → 已升级为 `ag-psd@31.0.2`（CDN 地址同步更新），完整支持 TySh/EngineData 写入。
2. **图层类型从未被标记**：`layers.ts` 的 `collectNodes` 没有给 `ParsedNodeItem` 写入 `kind` 字段，
   导致 `exporter.ts` 中 `item.kind === 'text'` 恒为 false，所有 TEXT 节点都走了栅格导出分支。
   → 已为 `ParsedNodeItem` 增加 `kind` 并实现 `inferKind()` 类型推断。
3. **图层画布约定不匹配**：ag-psd 2.1.0 的写入器按"文档尺寸画布"读取图层像素，而插件传的是
   "图层自身尺寸画布"，导致图片图层读出越界、被裁剪成透明，全部不可见。
   → 升级后的 ag-psd 31.0.2 采用与插件一致的"图层尺寸画布 + 文档坐标"约定，图片图层像素完整保留。

## 安装与开发说明

1. 在 Figma 桌面端点击左上角菜单 -> **Plugins** -> **Development** -> **Import plugin from manifest...**。
2. 选中本项目目录下的 `manifest.json` 即可导入使用。
3. 开发调试：执行 `npm run watch` 或 `npm run build` 即可进行 TypeScript 实时增量编译。

## 字体映射与"字体缺失"问题

导出的文字图层在 Photoshop 中提示"字体缺失"，通常是因为写入 EngineData 的字体名
（PostScript 名）与你电脑上实际安装的字体名不一致。本项目已内置字体映射机制：

1. **`src/font-map.ts`（自动生成）**：扫描本机已安装字体（Windows 注册表 + 字体文件
   `name` 表），生成 `family/style -> PostScript 名` 的完整映射（含中文字体族名与
   英文名、所有语言变体、TrueType Collection 如 `simsun.ttc`），同时从字体文件的
   `head/hhea/OS/2` 表提取 **ascent/descent 度量**（用于文字基线精确定位）。
   Photoshop 据此能精确定位你本机的真实字体，不再提示缺失。
2. **换机器或增删字体后重新生成**：
   ```bash
   npm run build:fonts   # 重新扫描本机字体并重建 src/font-map.ts（含度量）
   npm run build         # 重新打包 code.js
   ```
3. **查找优先级**：精确匹配 `family+style` -> 归一化模糊匹配（忽略大小写/空格/连字符）
   -> 兜底规则「族名去空格-风格」。
4. 若 Photoshop 仍提示缺失，说明该字体未安装在本机（Figma 云字体需先本地安装），
   或字体映射表未覆盖，请运行 `npm run build:fonts` 重新生成。

## 文字图层定位（"文字往左/下偏移"问题）

Photoshop 打开 PSD 时会执行"更新所有文字图层"，用 TySh 描述符重新排版文字，因此
**图层边界（bounds）不是定位依据，TySh 的 transform 才是**。本项目已对照真实 PS
导出文件修正定位逻辑：

- **基线定位**：`transform` 的平移量 = 文字基线原点，即
  `baselineY = 图层顶 + fontSize × 基线比例`。基线比例来自字体文件度量：
  - 含中文/假名/韩文，或含上升部小写字母（b d f h k l）的文本用 **ascent**
    （CJK 约 0.88em、拉丁约 0.75em）；
  - **纯数字/大写字母文本用 cap height**（如 Arial 0.716、DINPro 0.712）。
    否则 PS 用 ascent 重排后数字会整体下移（数字视觉顶部是 cap height，不是 ascent）。
  旧版本误把基线放在文本框底部，导致文字整体下移。
- **水平锚点**：左对齐锚点在左边、居中对齐在中心、右对齐在右边（旧版本一律用左边，
  导致居中/右对齐文字水平偏移）。
- **TySh text 边界归零**：point 文本的 `text.left/top/right/bottom` 在真实 PSD 中
  全部为 0（旧版本误写成图层边界，干扰 PS 重排版）。
- **box 文本**（Figma 固定宽度文本）：写入精确 `boxBounds`，垂直对齐按 Figma 设置映射。
  **box 文本的 transform 必须用单位阵 `[1,0,0,1,0,0]`**——若 transform 平移量也写
  成 `(left,top)`，Photoshop 会把 transform 位移与 boxBounds 叠加成 **2 倍偏移**
  （实测：期望 (72,702) 却渲染到 (144,1404)）。
- **像素级自检**：导出时对每个文字图层用其 PNG 栅格预览（Figma 逐像素渲染）检测
  文字实际 ink 边界，反推精确基线（无 descender 文本 ink.bottom 即基线），并在
  控制台输出"文字位置对比报告"（Figma 框 / ink 边界 / 度量估算基线 vs 实际使用基线）。

## 字号单位（"PS 点数和 Figma 对不上"问题）

Figma 字号单位是 **px**，Photoshop 是 **pt**（1pt = 1/72 英寸）。为了与设计师在
PS 面板中看到的数值一致，本项目采用以下换算：

- **PSD 内写入的字号 = Figma px 数值**（如 Figma 24px → PSD 24pt），不随导出倍率放大。
- **文档分辨率 PPI = 72 × 导出倍率**（1x→72PPI、2x→144PPI、3x→216PPI），这样
  PS 渲染像素 = pt × PPI/72 = px × scale，与画板像素同步放大，文字相对画板的比例
  在任意倍率下都与 Figma 完全一致。
- 行距（leading）同样与 Figma lineHeight 数值一致；字距（tracking）为 1/1000 em，
  与倍率无关。

## 合并栅格化（命名以「-合并」结尾）

**组 / 组件实例 / 画板**等容器节点，如果**命名以 `-合并` 结尾**，导出 PSD 时会将
**整组拍平栅格化为一张位图图层**，不再展开内部子图层，且图层名自动去掉 `-合并` 后缀。
适用于希望把复杂嵌套结构（组件实例、图标、插画等）直接合并成一张图、避免 PS 中
图层过多或样式失真的场景：

- 子容器（组/组件实例/子画板）：`collectNodes` 识别 `-合并` 后缀后不再递归其子节点，
  该节点以单张 PNG 位图输出，名字去掉后缀。
- 选中的根画板本身命名为 `xxx-合并`：整板直接以一张位图输出（仅合成图 + 该位图图层），
  PSD 文件名同样去掉后缀。
- 不改变原 Figma 文档结构，仅在导出时生效。

> 注意：PSD 合成发生在插件 UI 线程（`ui.html`），其中通过 CDN 加载 `ag-psd@31.0.2`，
> `manifest.json` 已授权 `cdn.jsdelivr.net` 与 `unpkg.com` 网络访问。
