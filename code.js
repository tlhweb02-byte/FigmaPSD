"use strict";
(() => {
  // src/layers.ts
  function inferKind(node) {
    switch (node.type) {
      case "TEXT":
        return "text";
      case "RECTANGLE":
      case "ELLIPSE":
      case "POLYGON":
      case "STAR":
      case "VECTOR":
      case "LINE":
        return "vector";
      default:
        return "image";
    }
  }
  var MERGE_SUFFIX = "-\u5408\u5E76";
  function isContainerType(node) {
    if (node.type === "BOOLEAN_OPERATION") return false;
    return "children" in node && Array.isArray(node.children);
  }
  function hasOwnPaint(node) {
    if (node.type === "GROUP") return false;
    const visiblePaint = (paints) => Array.isArray(paints) && paints.some((p) => p.visible !== false && (p.opacity === void 0 || p.opacity > 0));
    const fills = "fills" in node ? node.fills : void 0;
    const strokes = "strokes" in node ? node.strokes : void 0;
    return visiblePaint(fills) || visiblePaint(strokes);
  }
  function intersectRect(a, b) {
    if (!a) return b;
    if (!b) return a;
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const r = Math.min(a.x + a.width, b.x + b.width);
    const btm = Math.min(a.y + a.height, b.y + b.height);
    return { x, y, width: Math.max(0, r - x), height: Math.max(0, btm - y) };
  }
  function toRel(rect, rootBounds) {
    return { x: rect.x - rootBounds.x, y: rect.y - rootBounds.y, width: rect.width, height: rect.height };
  }
  function getOpacity(node) {
    return "opacity" in node && typeof node.opacity === "number" ? node.opacity : 1;
  }
  function collectNodes(node, rootNode, rootBounds, result, exportMode, parentId = null, clip = null) {
    if (node === rootNode) {
      if ("children" in node) {
        collectChildren(node.children, rootNode, rootBounds, result, exportMode, null, null);
      }
      return;
    }
    if (!node.visible) return;
    const bounds = node.absoluteBoundingBox;
    const renderBounds = "absoluteRenderBounds" in node ? node.absoluteRenderBounds : bounds;
    if (!bounds || !renderBounds || renderBounds.width <= 0 || renderBounds.height <= 0) return;
    const rel = toRel(bounds, rootBounds);
    const relRender = toRel(renderBounds, rootBounds);
    if (clip) {
      const vis = intersectRect(clip, relRender);
      if (!vis || vis.width <= 0 || vis.height <= 0) return;
    }
    const wantsMerge = isContainerType(node) && typeof node.name === "string" && node.name.endsWith(MERGE_SUFFIX);
    const layerName = wantsMerge ? node.name.slice(0, -MERGE_SUFFIX.length) : node.name;
    const expand = isContainerType(node) && !wantsMerge && "children" in node;
    const base = {
      visible: node.visible,
      x: rel.x,
      y: rel.y,
      width: bounds.width,
      height: bounds.height,
      renderX: relRender.x,
      renderY: relRender.y,
      node
    };
    if (!expand) {
      result.push({
        ...base,
        id: node.id,
        name: layerName,
        kind: inferKind(node),
        isGroup: false,
        opacity: getOpacity(node),
        parentId,
        clip
      });
      return;
    }
    const ownClip = "clipsContent" in node && node.clipsContent ? rel : null;
    const hierarchical = exportMode === "hierarchical";
    let childParent = parentId;
    let childClip;
    if (hierarchical) {
      result.push({
        ...base,
        id: node.id,
        name: layerName,
        kind: "group",
        isGroup: true,
        opacity: getOpacity(node),
        parentId,
        clip: intersectRect(clip, ownClip)
      });
      childParent = node.id;
      childClip = null;
    } else {
      childClip = intersectRect(clip, ownClip);
    }
    if (hasOwnPaint(node)) {
      result.push({
        ...base,
        id: node.id + "_bg",
        name: layerName + " \u80CC\u666F",
        kind: "image",
        isGroup: false,
        // 平铺模式下容器的不透明度无法落到组上，叠加到背景图层
        opacity: hierarchical ? 1 : getOpacity(node),
        parentId: childParent,
        // 背景不受自身 clipsContent 裁切（外阴影/外描边要保留），只受祖先裁切
        clip: hierarchical ? null : clip,
        isBackground: true
      });
    }
    collectChildren(node.children, rootNode, rootBounds, result, exportMode, childParent, childClip);
  }
  function collectChildren(children, rootNode, rootBounds, result, exportMode, parentId, clip) {
    let currentParent = parentId;
    let currentClip = clip;
    for (const child of children) {
      if ("isMask" in child && child.isMask) {
        if (!child.visible) continue;
        const bounds = child.absoluteBoundingBox;
        const renderBounds = child.absoluteRenderBounds;
        if (!bounds || !renderBounds) continue;
        const rel = toRel(bounds, rootBounds);
        const relRender = toRel(renderBounds, rootBounds);
        const groupId = child.id + "_maskgroup";
        result.push({
          id: groupId,
          name: child.name + " (\u8499\u7248)",
          kind: "group",
          isGroup: true,
          visible: true,
          opacity: 1,
          x: rel.x,
          y: rel.y,
          width: bounds.width,
          height: bounds.height,
          renderX: relRender.x,
          renderY: relRender.y,
          parentId,
          node: child,
          clip,
          maskNode: child
        });
        currentParent = groupId;
        currentClip = null;
        continue;
      }
      collectNodes(child, rootNode, rootBounds, result, exportMode, currentParent, currentClip);
    }
  }

  // src/image.ts
  function uint8ToBase64(bytes) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let base64 = "";
    const len = bytes.length;
    for (let i = 0; i < len; i += 3) {
      const b1 = bytes[i];
      const b2 = i + 1 < len ? bytes[i + 1] : 0;
      const b3 = i + 2 < len ? bytes[i + 2] : 0;
      const c1 = b1 >> 2;
      const c2 = (b1 & 3) << 4 | b2 >> 4;
      const c3 = (b2 & 15) << 2 | b3 >> 6;
      const c4 = b3 & 63;
      base64 += chars[c1] + chars[c2];
      base64 += i + 1 < len ? chars[c3] : "=";
      base64 += i + 2 < len ? chars[c4] : "=";
    }
    return base64;
  }

  // src/font-map.ts
  var FONT_PS_NAME_MAP = {
    "Agency FB": {
      "Arrunta": "AgencyFB-Reg",
      "Bold": "AgencyFB-Bold",
      "Fet": "AgencyFB-Bold",
      "Fett": "AgencyFB-Bold",
      "F\xE9lk\xF6v\xE9r": "AgencyFB-Bold",
      "Gras": "AgencyFB-Bold",
      "Grassetto": "AgencyFB-Bold",
      "Halvfet": "AgencyFB-Bold",
      "Kal\u0131n": "AgencyFB-Bold",
      "Krepko": "AgencyFB-Bold",
      "Lihavoitu": "AgencyFB-Bold",
      "Lodia": "AgencyFB-Bold",
      "Navadno": "AgencyFB-Reg",
      "Negreta": "AgencyFB-Bold",
      "Negrita": "AgencyFB-Bold",
      "Negrito": "AgencyFB-Bold",
      "Normaali": "AgencyFB-Reg",
      "Normal": "AgencyFB-Reg",
      "Normale": "AgencyFB-Reg",
      "Normalny": "AgencyFB-Reg",
      "Norm\xE1l": "AgencyFB-Reg",
      "Norm\xE1lne": "AgencyFB-Reg",
      "Pogrubiony": "AgencyFB-Bold",
      "Regular": "AgencyFB-Reg",
      "Standaard": "AgencyFB-Reg",
      "Standard": "AgencyFB-Reg",
      "Tu\u010Dn\xE9": "AgencyFB-Bold",
      "Vet": "AgencyFB-Bold",
      "fed": "AgencyFB-Bold",
      "normal": "AgencyFB-Reg",
      "oby\u010Dejn\xE9": "AgencyFB-Reg",
      "tu\u010Dn\xE9": "AgencyFB-Bold",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "AgencyFB-Bold",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "AgencyFB-Reg",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "AgencyFB-Reg",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "AgencyFB-Bold"
    },
    "Agency FB Bold": {
      "Bold": "AgencyFB-Bold",
      "Regular": "AgencyFB-Bold"
    },
    "Agency FB Fet": {
      "Regular": "AgencyFB-Bold"
    },
    "Agency FB Fett": {
      "Regular": "AgencyFB-Bold"
    },
    "Agency FB F\xE9lk\xF6v\xE9r": {
      "Regular": "AgencyFB-Bold"
    },
    "Agency FB Gras": {
      "Regular": "AgencyFB-Bold"
    },
    "Agency FB Grassetto": {
      "Regular": "AgencyFB-Bold"
    },
    "Agency FB Halvfet": {
      "Regular": "AgencyFB-Bold"
    },
    "Agency FB Kal\u0131n": {
      "Regular": "AgencyFB-Bold"
    },
    "Agency FB Krepko": {
      "Regular": "AgencyFB-Bold"
    },
    "Agency FB Lihavoitu": {
      "Regular": "AgencyFB-Bold"
    },
    "Agency FB Lodia": {
      "Regular": "AgencyFB-Bold"
    },
    "Agency FB Negreta": {
      "Regular": "AgencyFB-Bold"
    },
    "Agency FB Negrita": {
      "Regular": "AgencyFB-Bold"
    },
    "Agency FB Negrito": {
      "Regular": "AgencyFB-Bold"
    },
    "Agency FB Pogrubiony": {
      "Regular": "AgencyFB-Bold"
    },
    "Agency FB Tu\u010Dn\xE9": {
      "Regular": "AgencyFB-Bold"
    },
    "Agency FB Vet": {
      "Regular": "AgencyFB-Bold"
    },
    "Agency FB fed": {
      "Regular": "AgencyFB-Bold"
    },
    "Agency FB tu\u010Dn\xE9": {
      "Regular": "AgencyFB-Bold"
    },
    "Agency FB \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "AgencyFB-Bold"
    },
    "Agency FB \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "AgencyFB-Bold"
    },
    "Alef": {
      "Bold": "Alef-Bold",
      "Regular": "Alef-Regular"
    },
    "Alef Bold": {
      "Bold": "Alef-Bold",
      "Regular": "Alef-Bold"
    },
    "Alef Regular": {
      "Regular": "Alef-Regular"
    },
    "Algerian": {
      "Normaali": "Algerian",
      "Normal": "Algerian",
      "Normale": "Algerian",
      "Regular": "Algerian",
      "Standaard": "Algerian",
      "Standard": "Algerian",
      "normal": "Algerian"
    },
    "Amiri": {
      "Bold": "Amiri-Bold",
      "Bold Italic": "Amiri-BoldItalic",
      "Bold Slanted": "Amiri-BoldSlanted",
      "Italic": "Amiri-Italic",
      "Regular": "Amiri-Regular",
      "Slanted": "Amiri-Slanted"
    },
    "Amiri Bold": {
      "Bold": "Amiri-Bold",
      "Regular": "Amiri-Bold"
    },
    "Amiri Bold Italic": {
      "Bold Italic": "Amiri-BoldItalic",
      "Regular": "Amiri-BoldItalic"
    },
    "Amiri Bold Slanted": {
      "Bold Slanted": "Amiri-BoldSlanted",
      "Regular": "Amiri-BoldSlanted"
    },
    "Amiri Italic": {
      "Italic": "Amiri-Italic",
      "Regular": "Amiri-Italic"
    },
    "Amiri Quran": {
      "Regular": "AmiriQuran-Regular"
    },
    "Amiri Quran Regular": {
      "Regular": "AmiriQuran-Regular"
    },
    "Amiri Regular": {
      "Regular": "Amiri-Regular"
    },
    "Amiri Slanted": {
      "Regular": "Amiri-Slanted",
      "Slanted": "Amiri-Slanted"
    },
    "Arial": {
      "Arrunta": "ArialMT",
      "Black": "Arial-Black",
      "Bold": "Arial-BoldMT",
      "Bold Italic": "Arial-BoldItalicMT",
      "Corsivo": "Arial-ItalicMT",
      "Cursief": "Arial-ItalicMT",
      "Cursiva": "Arial-ItalicMT",
      "D\u0151lt": "Arial-ItalicMT",
      "Etzana": "Arial-ItalicMT",
      "Fet": "Arial-BoldMT",
      "Fet Kursiv": "Arial-BoldItalicMT",
      "Fett": "Arial-BoldMT",
      "Fett Kursiv": "Arial-BoldItalicMT",
      "F\xE9lk\xF6v\xE9r": "Arial-BoldMT",
      "F\xE9lk\xF6v\xE9r d\u0151lt": "Arial-BoldItalicMT",
      "Gras": "Arial-BoldMT",
      "Gras Italique": "Arial-BoldItalicMT",
      "Grassetto": "Arial-BoldMT",
      "Grassetto Corsivo": "Arial-BoldItalicMT",
      "Halvfet": "Arial-BoldMT",
      "Halvfet Kursiv": "Arial-BoldItalicMT",
      "Italic": "Arial-ItalicMT",
      "Italique": "Arial-ItalicMT",
      "It\xE1lico": "Arial-ItalicMT",
      "Kal\u0131n": "Arial-BoldMT",
      "Kal\u0131n \u0130talik": "Arial-BoldItalicMT",
      "Krepko": "Arial-BoldMT",
      "Krepko po\u0161evno": "Arial-BoldItalicMT",
      "Kursiv": "Arial-ItalicMT",
      "Kursivoitu": "Arial-ItalicMT",
      "Kursywa": "Arial-ItalicMT",
      "Kurz\xEDva": "Arial-ItalicMT",
      "Lihavoitu": "Arial-BoldMT",
      "Lihavoitu Kursivoi": "Arial-BoldItalicMT",
      "Lodi etzana": "Arial-BoldItalicMT",
      "Lodia": "Arial-BoldMT",
      "Narrow": "ArialNarrow",
      "Narrow Bold": "ArialNarrow-Bold",
      "Narrow Bold Italic": "ArialNarrow-BoldItalic",
      "Narrow Italic": "ArialNarrow-Italic",
      "Navadno": "ArialMT",
      "Negreta": "Arial-BoldMT",
      "Negreta cursiva": "Arial-BoldItalicMT",
      "Negrita": "Arial-BoldMT",
      "Negrita Cursiva": "Arial-BoldItalicMT",
      "Negrito": "Arial-BoldMT",
      "Negrito It\xE1lico": "Arial-BoldItalicMT",
      "Normaali": "ArialMT",
      "Normal": "ArialMT",
      "Normale": "ArialMT",
      "Normalny": "ArialMT",
      "Norm\xE1l": "ArialMT",
      "Norm\xE1lne": "ArialMT",
      "Pogrubiona kursywa": "Arial-BoldItalicMT",
      "Pogrubiony": "Arial-BoldMT",
      "Po\u0161evno": "Arial-ItalicMT",
      "Regular": "ArialMT",
      "Standaard": "ArialMT",
      "Standard": "ArialMT",
      "Tu\u010Dn\xE1 kurz\xEDva": "Arial-BoldItalicMT",
      "Tu\u010Dn\xE9": "Arial-BoldMT",
      "Vet": "Arial-BoldMT",
      "Vet Cursief": "Arial-BoldItalicMT",
      "fed": "Arial-BoldMT",
      "fed kursiv": "Arial-BoldItalicMT",
      "kursiv": "Arial-ItalicMT",
      "kurz\xEDva": "Arial-ItalicMT",
      "nghi\xEAng": "Arial-ItalicMT",
      "nghi\xEAng \u0111\xE2\u0323m": "Arial-BoldItalicMT",
      "normal": "ArialMT",
      "oby\u010Dejn\xE9": "ArialMT",
      "th\u01B0\u01A1\u0300ng": "ArialMT",
      "tu\u010Dn\xE9": "Arial-BoldMT",
      "tu\u010Dn\xE9 kurz\xEDva": "Arial-BoldItalicMT",
      "\u0111\xE2\u0323m": "Arial-BoldMT",
      "\u0130talik": "Arial-ItalicMT",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "Arial-BoldMT",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "Arial-BoldItalicMT",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "ArialMT",
      "\u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "Arial-ItalicMT",
      "\u041A\u0443\u0440\u0441\u0438\u0432": "Arial-ItalicMT",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "ArialMT",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "Arial-BoldMT",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": "Arial-BoldItalicMT"
    },
    "Arial Black": {
      "Arrunta": "Arial-Black",
      "Black": "Arial-Black",
      "Navadno": "Arial-Black",
      "Normaali": "Arial-Black",
      "Normal": "Arial-Black",
      "Normale": "Arial-Black",
      "Normalny": "Arial-Black",
      "Norm\xE1l": "Arial-Black",
      "Norm\xE1lne": "Arial-Black",
      "Regular": "Arial-Black",
      "Standaard": "Arial-Black",
      "Standard": "Arial-Black",
      "normal": "Arial-Black",
      "oby\u010Dejn\xE9": "Arial-Black",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "Arial-Black",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "Arial-Black"
    },
    "Arial Black Arrunta": {
      "Regular": "Arial-Black"
    },
    "Arial Black Navadno": {
      "Regular": "Arial-Black"
    },
    "Arial Black Normaali": {
      "Regular": "Arial-Black"
    },
    "Arial Black Normal": {
      "Regular": "Arial-Black"
    },
    "Arial Black Normale": {
      "Regular": "Arial-Black"
    },
    "Arial Black Normalny": {
      "Regular": "Arial-Black"
    },
    "Arial Black Norm\xE1l": {
      "Regular": "Arial-Black"
    },
    "Arial Black Norm\xE1lne": {
      "Regular": "Arial-Black"
    },
    "Arial Black Standaard": {
      "Regular": "Arial-Black"
    },
    "Arial Black Standard": {
      "Regular": "Arial-Black"
    },
    "Arial Black normal": {
      "Regular": "Arial-Black"
    },
    "Arial Black oby\u010Dejn\xE9": {
      "Regular": "Arial-Black"
    },
    "Arial Black \u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": {
      "Regular": "Arial-Black"
    },
    "Arial Black \u041E\u0431\u044B\u0447\u043D\u044B\u0439": {
      "Regular": "Arial-Black"
    },
    "Arial Bold": {
      "Bold": "Arial-BoldMT",
      "Regular": "Arial-BoldMT"
    },
    "Arial Bold Italic": {
      "Bold Italic": "Arial-BoldItalicMT",
      "Regular": "Arial-BoldItalicMT"
    },
    "Arial Corsivo": {
      "Regular": "Arial-ItalicMT"
    },
    "Arial Cursief": {
      "Regular": "Arial-ItalicMT"
    },
    "Arial Cursiva": {
      "Regular": "Arial-ItalicMT"
    },
    "Arial D\u0151lt": {
      "Regular": "Arial-ItalicMT"
    },
    "Arial Etzana": {
      "Regular": "Arial-ItalicMT"
    },
    "Arial Fet": {
      "Regular": "Arial-BoldMT"
    },
    "Arial Fet Kursiv": {
      "Regular": "Arial-BoldItalicMT"
    },
    "Arial Fett": {
      "Regular": "Arial-BoldMT"
    },
    "Arial Fett Kursiv": {
      "Regular": "Arial-BoldItalicMT"
    },
    "Arial F\xE9lk\xF6v\xE9r": {
      "Regular": "Arial-BoldMT"
    },
    "Arial F\xE9lk\xF6v\xE9r d\u0151lt": {
      "Regular": "Arial-BoldItalicMT"
    },
    "Arial Gras": {
      "Regular": "Arial-BoldMT"
    },
    "Arial Gras Italique": {
      "Regular": "Arial-BoldItalicMT"
    },
    "Arial Grassetto": {
      "Regular": "Arial-BoldMT"
    },
    "Arial Grassetto Corsivo": {
      "Regular": "Arial-BoldItalicMT"
    },
    "Arial Halvfet": {
      "Regular": "Arial-BoldMT"
    },
    "Arial Halvfet Kursiv": {
      "Regular": "Arial-BoldItalicMT"
    },
    "Arial Italic": {
      "Italic": "Arial-ItalicMT",
      "Regular": "Arial-ItalicMT"
    },
    "Arial Italique": {
      "Regular": "Arial-ItalicMT"
    },
    "Arial It\xE1lico": {
      "Regular": "Arial-ItalicMT"
    },
    "Arial Kal\u0131n": {
      "Regular": "Arial-BoldMT"
    },
    "Arial Kal\u0131n \u0130talik": {
      "Regular": "Arial-BoldItalicMT"
    },
    "Arial Krepko": {
      "Regular": "Arial-BoldMT"
    },
    "Arial Krepko po\u0161evno": {
      "Regular": "Arial-BoldItalicMT"
    },
    "Arial Kursiv": {
      "Regular": "Arial-ItalicMT"
    },
    "Arial Kursivoitu": {
      "Regular": "Arial-ItalicMT"
    },
    "Arial Kursywa": {
      "Regular": "Arial-ItalicMT"
    },
    "Arial Kurz\xEDva": {
      "Regular": "Arial-ItalicMT"
    },
    "Arial Lihavoitu": {
      "Regular": "Arial-BoldMT"
    },
    "Arial Lihavoitu Kursivoi": {
      "Regular": "Arial-BoldItalicMT"
    },
    "Arial Lodi etzana": {
      "Regular": "Arial-BoldItalicMT"
    },
    "Arial Lodia": {
      "Regular": "Arial-BoldMT"
    },
    "Arial Narrow": {
      "Arrunta": "ArialNarrow",
      "Bold": "ArialNarrow-Bold",
      "Bold Italic": "ArialNarrow-BoldItalic",
      "Corsivo": "ArialNarrow-Italic",
      "Cursief": "ArialNarrow-Italic",
      "Cursiva": "ArialNarrow-Italic",
      "D\u0151lt": "ArialNarrow-Italic",
      "Etzana": "ArialNarrow-Italic",
      "Fet": "ArialNarrow-Bold",
      "Fet Kursiv": "ArialNarrow-BoldItalic",
      "Fett": "ArialNarrow-Bold",
      "Fett Kursiv": "ArialNarrow-BoldItalic",
      "F\xE9lk\xF6v\xE9r": "ArialNarrow-Bold",
      "F\xE9lk\xF6v\xE9r d\u0151lt": "ArialNarrow-BoldItalic",
      "Gras": "ArialNarrow-Bold",
      "Gras Italique": "ArialNarrow-BoldItalic",
      "Grassetto": "ArialNarrow-Bold",
      "Grassetto Corsivo": "ArialNarrow-BoldItalic",
      "Halvfet": "ArialNarrow-Bold",
      "Halvfet Kursiv": "ArialNarrow-BoldItalic",
      "Italic": "ArialNarrow-Italic",
      "Italique": "ArialNarrow-Italic",
      "It\xE1lico": "ArialNarrow-Italic",
      "Kal\u0131n": "ArialNarrow-Bold",
      "Kal\u0131n \u0130talik": "ArialNarrow-BoldItalic",
      "Krepko": "ArialNarrow-Bold",
      "Krepko po\u0161evno": "ArialNarrow-BoldItalic",
      "Kursiv": "ArialNarrow-Italic",
      "Kursivoitu": "ArialNarrow-Italic",
      "Kursywa": "ArialNarrow-Italic",
      "Kurz\xEDva": "ArialNarrow-Italic",
      "Lihavoitu": "ArialNarrow-Bold",
      "Lihavoitu Kursivoi": "ArialNarrow-BoldItalic",
      "Lodi etzana": "ArialNarrow-BoldItalic",
      "Lodia": "ArialNarrow-Bold",
      "Narrow": "ArialNarrow",
      "Navadno": "ArialNarrow",
      "Negreta": "ArialNarrow-Bold",
      "Negreta cursiva": "ArialNarrow-BoldItalic",
      "Negrita": "ArialNarrow-Bold",
      "Negrita Cursiva": "ArialNarrow-BoldItalic",
      "Negrito": "ArialNarrow-Bold",
      "Negrito It\xE1lico": "ArialNarrow-BoldItalic",
      "Normaali": "ArialNarrow",
      "Normal": "ArialNarrow",
      "Normale": "ArialNarrow",
      "Normalny": "ArialNarrow",
      "Norm\xE1l": "ArialNarrow",
      "Norm\xE1lne": "ArialNarrow",
      "Pogrubiona kursywa": "ArialNarrow-BoldItalic",
      "Pogrubiony": "ArialNarrow-Bold",
      "Po\u0161evno": "ArialNarrow-Italic",
      "Regular": "ArialNarrow",
      "Standaard": "ArialNarrow",
      "Standard": "ArialNarrow",
      "Tu\u010Dn\xE1 kurz\xEDva": "ArialNarrow-BoldItalic",
      "Tu\u010Dn\xE9": "ArialNarrow-Bold",
      "Vet": "ArialNarrow-Bold",
      "Vet Cursief": "ArialNarrow-BoldItalic",
      "fed": "ArialNarrow-Bold",
      "fed kursiv": "ArialNarrow-BoldItalic",
      "kursiv": "ArialNarrow-Italic",
      "kurz\xEDva": "ArialNarrow-Italic",
      "normal": "ArialNarrow",
      "oby\u010Dejn\xE9": "ArialNarrow",
      "tu\u010Dn\xE9": "ArialNarrow-Bold",
      "tu\u010Dn\xE9 kurz\xEDva": "ArialNarrow-BoldItalic",
      "\u0130talik": "ArialNarrow-Italic",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "ArialNarrow-Bold",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "ArialNarrow-BoldItalic",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "ArialNarrow",
      "\u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "ArialNarrow-Italic",
      "\u041A\u0443\u0440\u0441\u0438\u0432": "ArialNarrow-Italic",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "ArialNarrow",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "ArialNarrow-Bold",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": "ArialNarrow-BoldItalic"
    },
    "Arial Narrow Bold": {
      "Narrow Bold": "ArialNarrow-Bold",
      "Regular": "ArialNarrow-Bold"
    },
    "Arial Narrow Bold Italic": {
      "Narrow Bold Italic": "ArialNarrow-BoldItalic",
      "Regular": "ArialNarrow-BoldItalic"
    },
    "Arial Narrow Corsivo": {
      "Regular": "ArialNarrow-Italic"
    },
    "Arial Narrow Cursief": {
      "Regular": "ArialNarrow-Italic"
    },
    "Arial Narrow Cursiva": {
      "Regular": "ArialNarrow-Italic"
    },
    "Arial Narrow D\u0151lt": {
      "Regular": "ArialNarrow-Italic"
    },
    "Arial Narrow Etzana": {
      "Regular": "ArialNarrow-Italic"
    },
    "Arial Narrow Fet": {
      "Regular": "ArialNarrow-Bold"
    },
    "Arial Narrow Fet Kursiv": {
      "Regular": "ArialNarrow-BoldItalic"
    },
    "Arial Narrow Fett": {
      "Regular": "ArialNarrow-Bold"
    },
    "Arial Narrow Fett Kursiv": {
      "Regular": "ArialNarrow-BoldItalic"
    },
    "Arial Narrow F\xE9lk\xF6v\xE9r": {
      "Regular": "ArialNarrow-Bold"
    },
    "Arial Narrow F\xE9lk\xF6v\xE9r d\u0151lt": {
      "Regular": "ArialNarrow-BoldItalic"
    },
    "Arial Narrow Gras": {
      "Regular": "ArialNarrow-Bold"
    },
    "Arial Narrow Gras Italique": {
      "Regular": "ArialNarrow-BoldItalic"
    },
    "Arial Narrow Grassetto": {
      "Regular": "ArialNarrow-Bold"
    },
    "Arial Narrow Grassetto Corsivo": {
      "Regular": "ArialNarrow-BoldItalic"
    },
    "Arial Narrow Halvfet": {
      "Regular": "ArialNarrow-Bold"
    },
    "Arial Narrow Halvfet Kursiv": {
      "Regular": "ArialNarrow-BoldItalic"
    },
    "Arial Narrow Italic": {
      "Narrow Italic": "ArialNarrow-Italic",
      "Regular": "ArialNarrow-Italic"
    },
    "Arial Narrow Italique": {
      "Regular": "ArialNarrow-Italic"
    },
    "Arial Narrow It\xE1lico": {
      "Regular": "ArialNarrow-Italic"
    },
    "Arial Narrow Kal\u0131n": {
      "Regular": "ArialNarrow-Bold"
    },
    "Arial Narrow Kal\u0131n \u0130talik": {
      "Regular": "ArialNarrow-BoldItalic"
    },
    "Arial Narrow Krepko": {
      "Regular": "ArialNarrow-Bold"
    },
    "Arial Narrow Krepko po\u0161evno": {
      "Regular": "ArialNarrow-BoldItalic"
    },
    "Arial Narrow Kursiv": {
      "Regular": "ArialNarrow-Italic"
    },
    "Arial Narrow Kursivoitu": {
      "Regular": "ArialNarrow-Italic"
    },
    "Arial Narrow Kursywa": {
      "Regular": "ArialNarrow-Italic"
    },
    "Arial Narrow Kurz\xEDva": {
      "Regular": "ArialNarrow-Italic"
    },
    "Arial Narrow Lihavoitu": {
      "Regular": "ArialNarrow-Bold"
    },
    "Arial Narrow Lihavoitu Kursivoi": {
      "Regular": "ArialNarrow-BoldItalic"
    },
    "Arial Narrow Lodi etzana": {
      "Regular": "ArialNarrow-BoldItalic"
    },
    "Arial Narrow Lodia": {
      "Regular": "ArialNarrow-Bold"
    },
    "Arial Narrow Negreta": {
      "Regular": "ArialNarrow-Bold"
    },
    "Arial Narrow Negreta cursiva": {
      "Regular": "ArialNarrow-BoldItalic"
    },
    "Arial Narrow Negrita": {
      "Regular": "ArialNarrow-Bold"
    },
    "Arial Narrow Negrita Cursiva": {
      "Regular": "ArialNarrow-BoldItalic"
    },
    "Arial Narrow Negrito": {
      "Regular": "ArialNarrow-Bold"
    },
    "Arial Narrow Negrito It\xE1lico": {
      "Regular": "ArialNarrow-BoldItalic"
    },
    "Arial Narrow Pogrubiona kursywa": {
      "Regular": "ArialNarrow-BoldItalic"
    },
    "Arial Narrow Pogrubiony": {
      "Regular": "ArialNarrow-Bold"
    },
    "Arial Narrow Po\u0161evno": {
      "Regular": "ArialNarrow-Italic"
    },
    "Arial Narrow Tu\u010Dn\xE1 kurz\xEDva": {
      "Regular": "ArialNarrow-BoldItalic"
    },
    "Arial Narrow Tu\u010Dn\xE9": {
      "Regular": "ArialNarrow-Bold"
    },
    "Arial Narrow Vet": {
      "Regular": "ArialNarrow-Bold"
    },
    "Arial Narrow Vet Cursief": {
      "Regular": "ArialNarrow-BoldItalic"
    },
    "Arial Narrow fed": {
      "Regular": "ArialNarrow-Bold"
    },
    "Arial Narrow fed kursiv": {
      "Regular": "ArialNarrow-BoldItalic"
    },
    "Arial Narrow kursiv": {
      "Regular": "ArialNarrow-Italic"
    },
    "Arial Narrow kurz\xEDva": {
      "Regular": "ArialNarrow-Italic"
    },
    "Arial Narrow tu\u010Dn\xE9": {
      "Regular": "ArialNarrow-Bold"
    },
    "Arial Narrow tu\u010Dn\xE9 kurz\xEDva": {
      "Regular": "ArialNarrow-BoldItalic"
    },
    "Arial Narrow \u0130talik": {
      "Regular": "ArialNarrow-Italic"
    },
    "Arial Narrow \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "ArialNarrow-Bold"
    },
    "Arial Narrow \u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "ArialNarrow-BoldItalic"
    },
    "Arial Narrow \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "ArialNarrow-Italic"
    },
    "Arial Narrow \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "ArialNarrow-Italic"
    },
    "Arial Narrow \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "ArialNarrow-Bold"
    },
    "Arial Narrow \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "ArialNarrow-BoldItalic"
    },
    "Arial Negreta": {
      "Regular": "Arial-BoldMT"
    },
    "Arial Negreta cursiva": {
      "Regular": "Arial-BoldItalicMT"
    },
    "Arial Negrita": {
      "Regular": "Arial-BoldMT"
    },
    "Arial Negrita Cursiva": {
      "Regular": "Arial-BoldItalicMT"
    },
    "Arial Negrito": {
      "Regular": "Arial-BoldMT"
    },
    "Arial Negrito It\xE1lico": {
      "Regular": "Arial-BoldItalicMT"
    },
    "Arial Pogrubiona kursywa": {
      "Regular": "Arial-BoldItalicMT"
    },
    "Arial Pogrubiony": {
      "Regular": "Arial-BoldMT"
    },
    "Arial Po\u0161evno": {
      "Regular": "Arial-ItalicMT"
    },
    "Arial Rounded MT": {
      "Regular": "ArialRoundedMTBold"
    },
    "Arial Rounded MT Bold": {
      "Arrunta": "ArialRoundedMTBold",
      "Navadno": "ArialRoundedMTBold",
      "Normaali": "ArialRoundedMTBold",
      "Normal": "ArialRoundedMTBold",
      "Normale": "ArialRoundedMTBold",
      "Normalny": "ArialRoundedMTBold",
      "Norm\xE1l": "ArialRoundedMTBold",
      "Norm\xE1lne": "ArialRoundedMTBold",
      "Regular": "ArialRoundedMTBold",
      "Standaard": "ArialRoundedMTBold",
      "Standard": "ArialRoundedMTBold",
      "normal": "ArialRoundedMTBold",
      "oby\u010Dejn\xE9": "ArialRoundedMTBold",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "ArialRoundedMTBold",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "ArialRoundedMTBold"
    },
    "Arial Tu\u010Dn\xE1 kurz\xEDva": {
      "Regular": "Arial-BoldItalicMT"
    },
    "Arial Tu\u010Dn\xE9": {
      "Regular": "Arial-BoldMT"
    },
    "Arial Vet": {
      "Regular": "Arial-BoldMT"
    },
    "Arial Vet Cursief": {
      "Regular": "Arial-BoldItalicMT"
    },
    "Arial fed": {
      "Regular": "Arial-BoldMT"
    },
    "Arial fed kursiv": {
      "Regular": "Arial-BoldItalicMT"
    },
    "Arial kursiv": {
      "Regular": "Arial-ItalicMT"
    },
    "Arial kurz\xEDva": {
      "Regular": "Arial-ItalicMT"
    },
    "Arial nghi\xEAng": {
      "Regular": "Arial-ItalicMT"
    },
    "Arial nghi\xEAng \u0111\xE2\u0323m": {
      "Regular": "Arial-BoldItalicMT"
    },
    "Arial tu\u010Dn\xE9": {
      "Regular": "Arial-BoldMT"
    },
    "Arial tu\u010Dn\xE9 kurz\xEDva": {
      "Regular": "Arial-BoldItalicMT"
    },
    "Arial \u0111\xE2\u0323m": {
      "Regular": "Arial-BoldMT"
    },
    "Arial \u0130talik": {
      "Regular": "Arial-ItalicMT"
    },
    "Arial \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "Arial-BoldMT"
    },
    "Arial \u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "Arial-BoldItalicMT"
    },
    "Arial \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "Arial-ItalicMT"
    },
    "Arial \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "Arial-ItalicMT"
    },
    "Arial \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "Arial-BoldMT"
    },
    "Arial \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "Arial-BoldItalicMT"
    },
    "Bahnschrift": {
      "Regular": "Bahnschrift"
    },
    "Baskerville Old Face": {
      "Arrunta": "BaskOldFace",
      "Navadno": "BaskOldFace",
      "Normaali": "BaskOldFace",
      "Normal": "BaskOldFace",
      "Normale": "BaskOldFace",
      "Normalny": "BaskOldFace",
      "Norm\xE1l": "BaskOldFace",
      "Norm\xE1lne": "BaskOldFace",
      "Regular": "BaskOldFace",
      "Standaard": "BaskOldFace",
      "Standard": "BaskOldFace",
      "normal": "BaskOldFace",
      "oby\u010Dejn\xE9": "BaskOldFace",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "BaskOldFace",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "BaskOldFace"
    },
    "Bauhaus 93": {
      "Arrunta": "Bauhaus93",
      "Navadno": "Bauhaus93",
      "Normaali": "Bauhaus93",
      "Normal": "Bauhaus93",
      "Normale": "Bauhaus93",
      "Normalny": "Bauhaus93",
      "Norm\xE1l": "Bauhaus93",
      "Norm\xE1lne": "Bauhaus93",
      "Regular": "Bauhaus93",
      "Standaard": "Bauhaus93",
      "Standard": "Bauhaus93",
      "normal": "Bauhaus93",
      "oby\u010Dejn\xE9": "Bauhaus93",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "Bauhaus93",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "Bauhaus93"
    },
    "Bell MT": {
      "Arrunta": "BellMT",
      "Bold": "BellMTBold",
      "Corsivo": "BellMTItalic",
      "Cursief": "BellMTItalic",
      "Cursiva": "BellMTItalic",
      "D\u0151lt": "BellMTItalic",
      "Etzana": "BellMTItalic",
      "Fet": "BellMTBold",
      "Fett": "BellMTBold",
      "F\xE9lk\xF6v\xE9r": "BellMTBold",
      "Gras": "BellMTBold",
      "Grassetto": "BellMTBold",
      "Halvfet": "BellMTBold",
      "Italic": "BellMTItalic",
      "Italique": "BellMTItalic",
      "It\xE1lico": "BellMTItalic",
      "Kal\u0131n": "BellMTBold",
      "Krepko": "BellMTBold",
      "Kursiv": "BellMTItalic",
      "Kursivoitu": "BellMTItalic",
      "Kursywa": "BellMTItalic",
      "Kurz\xEDva": "BellMTItalic",
      "Lihavoitu": "BellMTBold",
      "Lodia": "BellMTBold",
      "Navadno": "BellMT",
      "Negreta": "BellMTBold",
      "Negrita": "BellMTBold",
      "Negrito": "BellMTBold",
      "Normaali": "BellMT",
      "Normal": "BellMT",
      "Normale": "BellMT",
      "Normalny": "BellMT",
      "Norm\xE1l": "BellMT",
      "Norm\xE1lne": "BellMT",
      "Pogrubiony": "BellMTBold",
      "Po\u0161evno": "BellMTItalic",
      "Regular": "BellMT",
      "Standaard": "BellMT",
      "Standard": "BellMT",
      "Tu\u010Dn\xE9": "BellMTBold",
      "Vet": "BellMTBold",
      "fed": "BellMTBold",
      "kursiv": "BellMTItalic",
      "kurz\xEDva": "BellMTItalic",
      "normal": "BellMT",
      "oby\u010Dejn\xE9": "BellMT",
      "tu\u010Dn\xE9": "BellMTBold",
      "\u0130talik": "BellMTItalic",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "BellMTBold",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "BellMT",
      "\u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "BellMTItalic",
      "\u041A\u0443\u0440\u0441\u0438\u0432": "BellMTItalic",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "BellMT",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "BellMTBold"
    },
    "Bell MT Bold": {
      "Bold": "BellMTBold",
      "Regular": "BellMTBold"
    },
    "Bell MT Corsivo": {
      "Regular": "BellMTItalic"
    },
    "Bell MT Cursief": {
      "Regular": "BellMTItalic"
    },
    "Bell MT Cursiva": {
      "Regular": "BellMTItalic"
    },
    "Bell MT D\u0151lt": {
      "Regular": "BellMTItalic"
    },
    "Bell MT Etzana": {
      "Regular": "BellMTItalic"
    },
    "Bell MT Fet": {
      "Regular": "BellMTBold"
    },
    "Bell MT Fett": {
      "Regular": "BellMTBold"
    },
    "Bell MT F\xE9lk\xF6v\xE9r": {
      "Regular": "BellMTBold"
    },
    "Bell MT Gras": {
      "Regular": "BellMTBold"
    },
    "Bell MT Grassetto": {
      "Regular": "BellMTBold"
    },
    "Bell MT Halvfet": {
      "Regular": "BellMTBold"
    },
    "Bell MT Italic": {
      "Italic": "BellMTItalic",
      "Regular": "BellMTItalic"
    },
    "Bell MT Italique": {
      "Regular": "BellMTItalic"
    },
    "Bell MT It\xE1lico": {
      "Regular": "BellMTItalic"
    },
    "Bell MT Kal\u0131n": {
      "Regular": "BellMTBold"
    },
    "Bell MT Krepko": {
      "Regular": "BellMTBold"
    },
    "Bell MT Kursiv": {
      "Regular": "BellMTItalic"
    },
    "Bell MT Kursivoitu": {
      "Regular": "BellMTItalic"
    },
    "Bell MT Kursywa": {
      "Regular": "BellMTItalic"
    },
    "Bell MT Kurz\xEDva": {
      "Regular": "BellMTItalic"
    },
    "Bell MT Lihavoitu": {
      "Regular": "BellMTBold"
    },
    "Bell MT Lodia": {
      "Regular": "BellMTBold"
    },
    "Bell MT Negreta": {
      "Regular": "BellMTBold"
    },
    "Bell MT Negrita": {
      "Regular": "BellMTBold"
    },
    "Bell MT Negrito": {
      "Regular": "BellMTBold"
    },
    "Bell MT Pogrubiony": {
      "Regular": "BellMTBold"
    },
    "Bell MT Po\u0161evno": {
      "Regular": "BellMTItalic"
    },
    "Bell MT Tu\u010Dn\xE9": {
      "Regular": "BellMTBold"
    },
    "Bell MT Vet": {
      "Regular": "BellMTBold"
    },
    "Bell MT fed": {
      "Regular": "BellMTBold"
    },
    "Bell MT kursiv": {
      "Regular": "BellMTItalic"
    },
    "Bell MT kurz\xEDva": {
      "Regular": "BellMTItalic"
    },
    "Bell MT tu\u010Dn\xE9": {
      "Regular": "BellMTBold"
    },
    "Bell MT \u0130talik": {
      "Regular": "BellMTItalic"
    },
    "Bell MT \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "BellMTBold"
    },
    "Bell MT \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "BellMTItalic"
    },
    "Bell MT \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "BellMTItalic"
    },
    "Bell MT \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "BellMTBold"
    },
    "Berlin Sans FB": {
      "Arrunta": "BerlinSansFB-Reg",
      "Bold": "BerlinSansFB-Bold",
      "Fet": "BerlinSansFB-Bold",
      "Fett": "BerlinSansFB-Bold",
      "F\xE9lk\xF6v\xE9r": "BerlinSansFB-Bold",
      "Gras": "BerlinSansFB-Bold",
      "Grassetto": "BerlinSansFB-Bold",
      "Halvfet": "BerlinSansFB-Bold",
      "Kal\u0131n": "BerlinSansFB-Bold",
      "Krepko": "BerlinSansFB-Bold",
      "Lihavoitu": "BerlinSansFB-Bold",
      "Lodia": "BerlinSansFB-Bold",
      "Navadno": "BerlinSansFB-Reg",
      "Negreta": "BerlinSansFB-Bold",
      "Negrita": "BerlinSansFB-Bold",
      "Negrito": "BerlinSansFB-Bold",
      "Normaali": "BerlinSansFB-Reg",
      "Normal": "BerlinSansFB-Reg",
      "Normale": "BerlinSansFB-Reg",
      "Normalny": "BerlinSansFB-Reg",
      "Norm\xE1l": "BerlinSansFB-Reg",
      "Norm\xE1lne": "BerlinSansFB-Reg",
      "Pogrubiony": "BerlinSansFB-Bold",
      "Regular": "BerlinSansFB-Reg",
      "Standaard": "BerlinSansFB-Reg",
      "Standard": "BerlinSansFB-Reg",
      "Tu\u010Dn\xE9": "BerlinSansFB-Bold",
      "Vet": "BerlinSansFB-Bold",
      "fed": "BerlinSansFB-Bold",
      "normal": "BerlinSansFB-Reg",
      "oby\u010Dejn\xE9": "BerlinSansFB-Reg",
      "tu\u010Dn\xE9": "BerlinSansFB-Bold",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "BerlinSansFB-Bold",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "BerlinSansFB-Reg",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "BerlinSansFB-Reg",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "BerlinSansFB-Bold"
    },
    "Berlin Sans FB Bold": {
      "Bold": "BerlinSansFB-Bold",
      "Regular": "BerlinSansFB-Bold"
    },
    "Berlin Sans FB Demi": {
      "Bold": "BerlinSansFBDemi-Bold",
      "Fet": "BerlinSansFBDemi-Bold",
      "Fett": "BerlinSansFBDemi-Bold",
      "F\xE9lk\xF6v\xE9r": "BerlinSansFBDemi-Bold",
      "Gras": "BerlinSansFBDemi-Bold",
      "Grassetto": "BerlinSansFBDemi-Bold",
      "Halvfet": "BerlinSansFBDemi-Bold",
      "Kal\u0131n": "BerlinSansFBDemi-Bold",
      "Krepko": "BerlinSansFBDemi-Bold",
      "Lihavoitu": "BerlinSansFBDemi-Bold",
      "Lodia": "BerlinSansFBDemi-Bold",
      "Negreta": "BerlinSansFBDemi-Bold",
      "Negrita": "BerlinSansFBDemi-Bold",
      "Negrito": "BerlinSansFBDemi-Bold",
      "Pogrubiony": "BerlinSansFBDemi-Bold",
      "Tu\u010Dn\xE9": "BerlinSansFBDemi-Bold",
      "Vet": "BerlinSansFBDemi-Bold",
      "fed": "BerlinSansFBDemi-Bold",
      "tu\u010Dn\xE9": "BerlinSansFBDemi-Bold",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "BerlinSansFBDemi-Bold",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "BerlinSansFBDemi-Bold"
    },
    "Berlin Sans FB Demi Bold": {
      "Bold": "BerlinSansFBDemi-Bold",
      "Regular": "BerlinSansFBDemi-Bold"
    },
    "Berlin Sans FB Demi Fet": {
      "Regular": "BerlinSansFBDemi-Bold"
    },
    "Berlin Sans FB Demi Fett": {
      "Regular": "BerlinSansFBDemi-Bold"
    },
    "Berlin Sans FB Demi F\xE9lk\xF6v\xE9r": {
      "Regular": "BerlinSansFBDemi-Bold"
    },
    "Berlin Sans FB Demi Gras": {
      "Regular": "BerlinSansFBDemi-Bold"
    },
    "Berlin Sans FB Demi Grassetto": {
      "Regular": "BerlinSansFBDemi-Bold"
    },
    "Berlin Sans FB Demi Halvfet": {
      "Regular": "BerlinSansFBDemi-Bold"
    },
    "Berlin Sans FB Demi Kal\u0131n": {
      "Regular": "BerlinSansFBDemi-Bold"
    },
    "Berlin Sans FB Demi Krepko": {
      "Regular": "BerlinSansFBDemi-Bold"
    },
    "Berlin Sans FB Demi Lihavoitu": {
      "Regular": "BerlinSansFBDemi-Bold"
    },
    "Berlin Sans FB Demi Lodia": {
      "Regular": "BerlinSansFBDemi-Bold"
    },
    "Berlin Sans FB Demi Negreta": {
      "Regular": "BerlinSansFBDemi-Bold"
    },
    "Berlin Sans FB Demi Negrita": {
      "Regular": "BerlinSansFBDemi-Bold"
    },
    "Berlin Sans FB Demi Negrito": {
      "Regular": "BerlinSansFBDemi-Bold"
    },
    "Berlin Sans FB Demi Pogrubiony": {
      "Regular": "BerlinSansFBDemi-Bold"
    },
    "Berlin Sans FB Demi Tu\u010Dn\xE9": {
      "Regular": "BerlinSansFBDemi-Bold"
    },
    "Berlin Sans FB Demi Vet": {
      "Regular": "BerlinSansFBDemi-Bold"
    },
    "Berlin Sans FB Demi fed": {
      "Regular": "BerlinSansFBDemi-Bold"
    },
    "Berlin Sans FB Demi tu\u010Dn\xE9": {
      "Regular": "BerlinSansFBDemi-Bold"
    },
    "Berlin Sans FB Demi \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "BerlinSansFBDemi-Bold"
    },
    "Berlin Sans FB Demi \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "BerlinSansFBDemi-Bold"
    },
    "Berlin Sans FB Fet": {
      "Regular": "BerlinSansFB-Bold"
    },
    "Berlin Sans FB Fett": {
      "Regular": "BerlinSansFB-Bold"
    },
    "Berlin Sans FB F\xE9lk\xF6v\xE9r": {
      "Regular": "BerlinSansFB-Bold"
    },
    "Berlin Sans FB Gras": {
      "Regular": "BerlinSansFB-Bold"
    },
    "Berlin Sans FB Grassetto": {
      "Regular": "BerlinSansFB-Bold"
    },
    "Berlin Sans FB Halvfet": {
      "Regular": "BerlinSansFB-Bold"
    },
    "Berlin Sans FB Kal\u0131n": {
      "Regular": "BerlinSansFB-Bold"
    },
    "Berlin Sans FB Krepko": {
      "Regular": "BerlinSansFB-Bold"
    },
    "Berlin Sans FB Lihavoitu": {
      "Regular": "BerlinSansFB-Bold"
    },
    "Berlin Sans FB Lodia": {
      "Regular": "BerlinSansFB-Bold"
    },
    "Berlin Sans FB Negreta": {
      "Regular": "BerlinSansFB-Bold"
    },
    "Berlin Sans FB Negrita": {
      "Regular": "BerlinSansFB-Bold"
    },
    "Berlin Sans FB Negrito": {
      "Regular": "BerlinSansFB-Bold"
    },
    "Berlin Sans FB Pogrubiony": {
      "Regular": "BerlinSansFB-Bold"
    },
    "Berlin Sans FB Tu\u010Dn\xE9": {
      "Regular": "BerlinSansFB-Bold"
    },
    "Berlin Sans FB Vet": {
      "Regular": "BerlinSansFB-Bold"
    },
    "Berlin Sans FB fed": {
      "Regular": "BerlinSansFB-Bold"
    },
    "Berlin Sans FB tu\u010Dn\xE9": {
      "Regular": "BerlinSansFB-Bold"
    },
    "Berlin Sans FB \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "BerlinSansFB-Bold"
    },
    "Berlin Sans FB \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "BerlinSansFB-Bold"
    },
    "Bernard MT": {
      "Regular": "BernardMT-Condensed"
    },
    "Bernard MT Condensed": {
      "Arrunta": "BernardMT-Condensed",
      "Navadno": "BernardMT-Condensed",
      "Normaali": "BernardMT-Condensed",
      "Normal": "BernardMT-Condensed",
      "Normale": "BernardMT-Condensed",
      "Normalny": "BernardMT-Condensed",
      "Norm\xE1l": "BernardMT-Condensed",
      "Norm\xE1lne": "BernardMT-Condensed",
      "Regular": "BernardMT-Condensed",
      "Standaard": "BernardMT-Condensed",
      "Standard": "BernardMT-Condensed",
      "normal": "BernardMT-Condensed",
      "oby\u010Dejn\xE9": "BernardMT-Condensed",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "BernardMT-Condensed",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "BernardMT-Condensed"
    },
    "Blackadder ITC": {
      "Arrunta": "BlackadderITC-Regular",
      "Navadno": "BlackadderITC-Regular",
      "Normaali": "BlackadderITC-Regular",
      "Normal": "BlackadderITC-Regular",
      "Normale": "BlackadderITC-Regular",
      "Normalny": "BlackadderITC-Regular",
      "Norm\xE1l": "BlackadderITC-Regular",
      "Norm\xE1lne": "BlackadderITC-Regular",
      "Regular": "BlackadderITC-Regular",
      "Standaard": "BlackadderITC-Regular",
      "Standard": "BlackadderITC-Regular",
      "normal": "BlackadderITC-Regular",
      "oby\u010Dejn\xE9": "BlackadderITC-Regular",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "BlackadderITC-Regular",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "BlackadderITC-Regular"
    },
    "Bodoni MT": {
      "Arrunta": "BodoniMT",
      "Black": "BodoniMTBlack",
      "Black Italic": "BodoniMTBlack-Italic",
      "Bold": "BodoniMT-Bold",
      "Bold Italic": "BodoniMT-BoldItalic",
      "Condensed": "BodoniMTCondensed",
      "Condensed Bold": "BodoniMTCondensed-Bold",
      "Condensed Bold Italic": "BodoniMTCondensed-BoldItalic",
      "Condensed Italic": "BodoniMTCondensed-Italic",
      "Corsivo": "BodoniMT-Italic",
      "Cursief": "BodoniMT-Italic",
      "Cursiva": "BodoniMT-Italic",
      "D\u0151lt": "BodoniMT-Italic",
      "Etzana": "BodoniMT-Italic",
      "Fet": "BodoniMT-Bold",
      "Fet Kursiv": "BodoniMT-BoldItalic",
      "Fett": "BodoniMT-Bold",
      "Fett Kursiv": "BodoniMT-BoldItalic",
      "F\xE9lk\xF6v\xE9r": "BodoniMT-Bold",
      "F\xE9lk\xF6v\xE9r d\u0151lt": "BodoniMT-BoldItalic",
      "Gras": "BodoniMT-Bold",
      "Gras Italique": "BodoniMT-BoldItalic",
      "Grassetto": "BodoniMT-Bold",
      "Grassetto Corsivo": "BodoniMT-BoldItalic",
      "Halvfet": "BodoniMT-Bold",
      "Halvfet Kursiv": "BodoniMT-BoldItalic",
      "Italic": "BodoniMT-Italic",
      "Italique": "BodoniMT-Italic",
      "It\xE1lico": "BodoniMT-Italic",
      "Kal\u0131n": "BodoniMT-Bold",
      "Kal\u0131n \u0130talik": "BodoniMT-BoldItalic",
      "Krepko": "BodoniMT-Bold",
      "Krepko po\u0161evno": "BodoniMT-BoldItalic",
      "Kursiv": "BodoniMT-Italic",
      "Kursivoitu": "BodoniMT-Italic",
      "Kursywa": "BodoniMT-Italic",
      "Kurz\xEDva": "BodoniMT-Italic",
      "Lihavoitu": "BodoniMT-Bold",
      "Lihavoitu Kursivoi": "BodoniMT-BoldItalic",
      "Lodi etzana": "BodoniMT-BoldItalic",
      "Lodia": "BodoniMT-Bold",
      "Navadno": "BodoniMT",
      "Negreta": "BodoniMT-Bold",
      "Negreta cursiva": "BodoniMT-BoldItalic",
      "Negrita": "BodoniMT-Bold",
      "Negrita Cursiva": "BodoniMT-BoldItalic",
      "Negrito": "BodoniMT-Bold",
      "Negrito It\xE1lico": "BodoniMT-BoldItalic",
      "Normaali": "BodoniMT",
      "Normal": "BodoniMT",
      "Normale": "BodoniMT",
      "Normalny": "BodoniMT",
      "Norm\xE1l": "BodoniMT",
      "Norm\xE1lne": "BodoniMT",
      "Pogrubiona kursywa": "BodoniMT-BoldItalic",
      "Pogrubiony": "BodoniMT-Bold",
      "Poster Compressed": "BodoniMTPosterCompressed",
      "Po\u0161evno": "BodoniMT-Italic",
      "Regular": "BodoniMT",
      "Standaard": "BodoniMT",
      "Standard": "BodoniMT",
      "Tu\u010Dn\xE1 kurz\xEDva": "BodoniMT-BoldItalic",
      "Tu\u010Dn\xE9": "BodoniMT-Bold",
      "Vet": "BodoniMT-Bold",
      "Vet Cursief": "BodoniMT-BoldItalic",
      "fed": "BodoniMT-Bold",
      "fed kursiv": "BodoniMT-BoldItalic",
      "kursiv": "BodoniMT-Italic",
      "kurz\xEDva": "BodoniMT-Italic",
      "normal": "BodoniMT",
      "oby\u010Dejn\xE9": "BodoniMT",
      "tu\u010Dn\xE9": "BodoniMT-Bold",
      "tu\u010Dn\xE9 kurz\xEDva": "BodoniMT-BoldItalic",
      "\u0130talik": "BodoniMT-Italic",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "BodoniMT-Bold",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "BodoniMT-BoldItalic",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "BodoniMT",
      "\u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "BodoniMT-Italic",
      "\u041A\u0443\u0440\u0441\u0438\u0432": "BodoniMT-Italic",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "BodoniMT",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "BodoniMT-Bold",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": "BodoniMT-BoldItalic"
    },
    "Bodoni MT Black": {
      "Arrunta": "BodoniMTBlack",
      "Black": "BodoniMTBlack",
      "Corsivo": "BodoniMTBlack-Italic",
      "Cursief": "BodoniMTBlack-Italic",
      "Cursiva": "BodoniMTBlack-Italic",
      "D\u0151lt": "BodoniMTBlack-Italic",
      "Etzana": "BodoniMTBlack-Italic",
      "Italic": "BodoniMTBlack-Italic",
      "Italique": "BodoniMTBlack-Italic",
      "It\xE1lico": "BodoniMTBlack-Italic",
      "Kursiv": "BodoniMTBlack-Italic",
      "Kursivoitu": "BodoniMTBlack-Italic",
      "Kursywa": "BodoniMTBlack-Italic",
      "Kurz\xEDva": "BodoniMTBlack-Italic",
      "Navadno": "BodoniMTBlack",
      "Normaali": "BodoniMTBlack",
      "Normal": "BodoniMTBlack",
      "Normale": "BodoniMTBlack",
      "Normalny": "BodoniMTBlack",
      "Norm\xE1l": "BodoniMTBlack",
      "Norm\xE1lne": "BodoniMTBlack",
      "Po\u0161evno": "BodoniMTBlack-Italic",
      "Regular": "BodoniMTBlack",
      "Standaard": "BodoniMTBlack",
      "Standard": "BodoniMTBlack",
      "kursiv": "BodoniMTBlack-Italic",
      "kurz\xEDva": "BodoniMTBlack-Italic",
      "normal": "BodoniMTBlack",
      "oby\u010Dejn\xE9": "BodoniMTBlack",
      "\u0130talik": "BodoniMTBlack-Italic",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "BodoniMTBlack",
      "\u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "BodoniMTBlack-Italic",
      "\u041A\u0443\u0440\u0441\u0438\u0432": "BodoniMTBlack-Italic",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "BodoniMTBlack"
    },
    "Bodoni MT Black Corsivo": {
      "Regular": "BodoniMTBlack-Italic"
    },
    "Bodoni MT Black Cursief": {
      "Regular": "BodoniMTBlack-Italic"
    },
    "Bodoni MT Black Cursiva": {
      "Regular": "BodoniMTBlack-Italic"
    },
    "Bodoni MT Black D\u0151lt": {
      "Regular": "BodoniMTBlack-Italic"
    },
    "Bodoni MT Black Etzana": {
      "Regular": "BodoniMTBlack-Italic"
    },
    "Bodoni MT Black Italic": {
      "Black Italic": "BodoniMTBlack-Italic",
      "Regular": "BodoniMTBlack-Italic"
    },
    "Bodoni MT Black Italique": {
      "Regular": "BodoniMTBlack-Italic"
    },
    "Bodoni MT Black It\xE1lico": {
      "Regular": "BodoniMTBlack-Italic"
    },
    "Bodoni MT Black Kursiv": {
      "Regular": "BodoniMTBlack-Italic"
    },
    "Bodoni MT Black Kursivoitu": {
      "Regular": "BodoniMTBlack-Italic"
    },
    "Bodoni MT Black Kursywa": {
      "Regular": "BodoniMTBlack-Italic"
    },
    "Bodoni MT Black Kurz\xEDva": {
      "Regular": "BodoniMTBlack-Italic"
    },
    "Bodoni MT Black Po\u0161evno": {
      "Regular": "BodoniMTBlack-Italic"
    },
    "Bodoni MT Black kursiv": {
      "Regular": "BodoniMTBlack-Italic"
    },
    "Bodoni MT Black kurz\xEDva": {
      "Regular": "BodoniMTBlack-Italic"
    },
    "Bodoni MT Black \u0130talik": {
      "Regular": "BodoniMTBlack-Italic"
    },
    "Bodoni MT Black \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "BodoniMTBlack-Italic"
    },
    "Bodoni MT Black \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "BodoniMTBlack-Italic"
    },
    "Bodoni MT Bold": {
      "Bold": "BodoniMT-Bold",
      "Regular": "BodoniMT-Bold"
    },
    "Bodoni MT Bold Italic": {
      "Bold Italic": "BodoniMT-BoldItalic",
      "Regular": "BodoniMT-BoldItalic"
    },
    "Bodoni MT Condensed": {
      "Arrunta": "BodoniMTCondensed",
      "Bold": "BodoniMTCondensed-Bold",
      "Bold Italic": "BodoniMTCondensed-BoldItalic",
      "Condensed": "BodoniMTCondensed",
      "Corsivo": "BodoniMTCondensed-Italic",
      "Cursief": "BodoniMTCondensed-Italic",
      "Cursiva": "BodoniMTCondensed-Italic",
      "D\u0151lt": "BodoniMTCondensed-Italic",
      "Etzana": "BodoniMTCondensed-Italic",
      "Fet": "BodoniMTCondensed-Bold",
      "Fet Kursiv": "BodoniMTCondensed-BoldItalic",
      "Fett": "BodoniMTCondensed-Bold",
      "Fett Kursiv": "BodoniMTCondensed-BoldItalic",
      "F\xE9lk\xF6v\xE9r": "BodoniMTCondensed-Bold",
      "F\xE9lk\xF6v\xE9r d\u0151lt": "BodoniMTCondensed-BoldItalic",
      "Gras": "BodoniMTCondensed-Bold",
      "Gras Italique": "BodoniMTCondensed-BoldItalic",
      "Grassetto": "BodoniMTCondensed-Bold",
      "Grassetto Corsivo": "BodoniMTCondensed-BoldItalic",
      "Halvfet": "BodoniMTCondensed-Bold",
      "Halvfet Kursiv": "BodoniMTCondensed-BoldItalic",
      "Italic": "BodoniMTCondensed-Italic",
      "Italique": "BodoniMTCondensed-Italic",
      "It\xE1lico": "BodoniMTCondensed-Italic",
      "Kal\u0131n": "BodoniMTCondensed-Bold",
      "Kal\u0131n \u0130talik": "BodoniMTCondensed-BoldItalic",
      "Krepko": "BodoniMTCondensed-Bold",
      "Krepko po\u0161evno": "BodoniMTCondensed-BoldItalic",
      "Kursiv": "BodoniMTCondensed-Italic",
      "Kursivoitu": "BodoniMTCondensed-Italic",
      "Kursywa": "BodoniMTCondensed-Italic",
      "Kurz\xEDva": "BodoniMTCondensed-Italic",
      "Lihavoitu": "BodoniMTCondensed-Bold",
      "Lihavoitu Kursivoi": "BodoniMTCondensed-BoldItalic",
      "Lodi etzana": "BodoniMTCondensed-BoldItalic",
      "Lodia": "BodoniMTCondensed-Bold",
      "Navadno": "BodoniMTCondensed",
      "Negreta": "BodoniMTCondensed-Bold",
      "Negreta cursiva": "BodoniMTCondensed-BoldItalic",
      "Negrita": "BodoniMTCondensed-Bold",
      "Negrita Cursiva": "BodoniMTCondensed-BoldItalic",
      "Negrito": "BodoniMTCondensed-Bold",
      "Negrito It\xE1lico": "BodoniMTCondensed-BoldItalic",
      "Normaali": "BodoniMTCondensed",
      "Normal": "BodoniMTCondensed",
      "Normale": "BodoniMTCondensed",
      "Normalny": "BodoniMTCondensed",
      "Norm\xE1l": "BodoniMTCondensed",
      "Norm\xE1lne": "BodoniMTCondensed",
      "Pogrubiona kursywa": "BodoniMTCondensed-BoldItalic",
      "Pogrubiony": "BodoniMTCondensed-Bold",
      "Po\u0161evno": "BodoniMTCondensed-Italic",
      "Regular": "BodoniMTCondensed",
      "Standaard": "BodoniMTCondensed",
      "Standard": "BodoniMTCondensed",
      "Tu\u010Dn\xE1 kurz\xEDva": "BodoniMTCondensed-BoldItalic",
      "Tu\u010Dn\xE9": "BodoniMTCondensed-Bold",
      "Vet": "BodoniMTCondensed-Bold",
      "Vet Cursief": "BodoniMTCondensed-BoldItalic",
      "fed": "BodoniMTCondensed-Bold",
      "fed kursiv": "BodoniMTCondensed-BoldItalic",
      "kursiv": "BodoniMTCondensed-Italic",
      "kurz\xEDva": "BodoniMTCondensed-Italic",
      "normal": "BodoniMTCondensed",
      "oby\u010Dejn\xE9": "BodoniMTCondensed",
      "tu\u010Dn\xE9": "BodoniMTCondensed-Bold",
      "tu\u010Dn\xE9 kurz\xEDva": "BodoniMTCondensed-BoldItalic",
      "\u0130talik": "BodoniMTCondensed-Italic",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "BodoniMTCondensed-Bold",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "BodoniMTCondensed-BoldItalic",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "BodoniMTCondensed",
      "\u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "BodoniMTCondensed-Italic",
      "\u041A\u0443\u0440\u0441\u0438\u0432": "BodoniMTCondensed-Italic",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "BodoniMTCondensed",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "BodoniMTCondensed-Bold",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": "BodoniMTCondensed-BoldItalic"
    },
    "Bodoni MT Condensed Bold": {
      "Condensed Bold": "BodoniMTCondensed-Bold",
      "Regular": "BodoniMTCondensed-Bold"
    },
    "Bodoni MT Condensed Bold Italic": {
      "Condensed Bold Italic": "BodoniMTCondensed-BoldItalic",
      "Regular": "BodoniMTCondensed-BoldItalic"
    },
    "Bodoni MT Condensed Corsivo": {
      "Regular": "BodoniMTCondensed-Italic"
    },
    "Bodoni MT Condensed Cursief": {
      "Regular": "BodoniMTCondensed-Italic"
    },
    "Bodoni MT Condensed Cursiva": {
      "Regular": "BodoniMTCondensed-Italic"
    },
    "Bodoni MT Condensed D\u0151lt": {
      "Regular": "BodoniMTCondensed-Italic"
    },
    "Bodoni MT Condensed Etzana": {
      "Regular": "BodoniMTCondensed-Italic"
    },
    "Bodoni MT Condensed Fet": {
      "Regular": "BodoniMTCondensed-Bold"
    },
    "Bodoni MT Condensed Fet Kursiv": {
      "Regular": "BodoniMTCondensed-BoldItalic"
    },
    "Bodoni MT Condensed Fett": {
      "Regular": "BodoniMTCondensed-Bold"
    },
    "Bodoni MT Condensed Fett Kursiv": {
      "Regular": "BodoniMTCondensed-BoldItalic"
    },
    "Bodoni MT Condensed F\xE9lk\xF6v\xE9r": {
      "Regular": "BodoniMTCondensed-Bold"
    },
    "Bodoni MT Condensed F\xE9lk\xF6v\xE9r d\u0151lt": {
      "Regular": "BodoniMTCondensed-BoldItalic"
    },
    "Bodoni MT Condensed Gras": {
      "Regular": "BodoniMTCondensed-Bold"
    },
    "Bodoni MT Condensed Gras Italique": {
      "Regular": "BodoniMTCondensed-BoldItalic"
    },
    "Bodoni MT Condensed Grassetto": {
      "Regular": "BodoniMTCondensed-Bold"
    },
    "Bodoni MT Condensed Grassetto Corsivo": {
      "Regular": "BodoniMTCondensed-BoldItalic"
    },
    "Bodoni MT Condensed Halvfet": {
      "Regular": "BodoniMTCondensed-Bold"
    },
    "Bodoni MT Condensed Halvfet Kursiv": {
      "Regular": "BodoniMTCondensed-BoldItalic"
    },
    "Bodoni MT Condensed Italic": {
      "Condensed Italic": "BodoniMTCondensed-Italic",
      "Regular": "BodoniMTCondensed-Italic"
    },
    "Bodoni MT Condensed Italique": {
      "Regular": "BodoniMTCondensed-Italic"
    },
    "Bodoni MT Condensed It\xE1lico": {
      "Regular": "BodoniMTCondensed-Italic"
    },
    "Bodoni MT Condensed Kal\u0131n": {
      "Regular": "BodoniMTCondensed-Bold"
    },
    "Bodoni MT Condensed Kal\u0131n \u0130talik": {
      "Regular": "BodoniMTCondensed-BoldItalic"
    },
    "Bodoni MT Condensed Krepko": {
      "Regular": "BodoniMTCondensed-Bold"
    },
    "Bodoni MT Condensed Krepko po\u0161evno": {
      "Regular": "BodoniMTCondensed-BoldItalic"
    },
    "Bodoni MT Condensed Kursiv": {
      "Regular": "BodoniMTCondensed-Italic"
    },
    "Bodoni MT Condensed Kursivoitu": {
      "Regular": "BodoniMTCondensed-Italic"
    },
    "Bodoni MT Condensed Kursywa": {
      "Regular": "BodoniMTCondensed-Italic"
    },
    "Bodoni MT Condensed Kurz\xEDva": {
      "Regular": "BodoniMTCondensed-Italic"
    },
    "Bodoni MT Condensed Lihavoitu": {
      "Regular": "BodoniMTCondensed-Bold"
    },
    "Bodoni MT Condensed Lihavoitu Kursivoi": {
      "Regular": "BodoniMTCondensed-BoldItalic"
    },
    "Bodoni MT Condensed Lodi etzana": {
      "Regular": "BodoniMTCondensed-BoldItalic"
    },
    "Bodoni MT Condensed Lodia": {
      "Regular": "BodoniMTCondensed-Bold"
    },
    "Bodoni MT Condensed Negreta": {
      "Regular": "BodoniMTCondensed-Bold"
    },
    "Bodoni MT Condensed Negreta cursiva": {
      "Regular": "BodoniMTCondensed-BoldItalic"
    },
    "Bodoni MT Condensed Negrita": {
      "Regular": "BodoniMTCondensed-Bold"
    },
    "Bodoni MT Condensed Negrita Cursiva": {
      "Regular": "BodoniMTCondensed-BoldItalic"
    },
    "Bodoni MT Condensed Negrito": {
      "Regular": "BodoniMTCondensed-Bold"
    },
    "Bodoni MT Condensed Negrito It\xE1lico": {
      "Regular": "BodoniMTCondensed-BoldItalic"
    },
    "Bodoni MT Condensed Pogrubiona kursywa": {
      "Regular": "BodoniMTCondensed-BoldItalic"
    },
    "Bodoni MT Condensed Pogrubiony": {
      "Regular": "BodoniMTCondensed-Bold"
    },
    "Bodoni MT Condensed Po\u0161evno": {
      "Regular": "BodoniMTCondensed-Italic"
    },
    "Bodoni MT Condensed Tu\u010Dn\xE1 kurz\xEDva": {
      "Regular": "BodoniMTCondensed-BoldItalic"
    },
    "Bodoni MT Condensed Tu\u010Dn\xE9": {
      "Regular": "BodoniMTCondensed-Bold"
    },
    "Bodoni MT Condensed Vet": {
      "Regular": "BodoniMTCondensed-Bold"
    },
    "Bodoni MT Condensed Vet Cursief": {
      "Regular": "BodoniMTCondensed-BoldItalic"
    },
    "Bodoni MT Condensed fed": {
      "Regular": "BodoniMTCondensed-Bold"
    },
    "Bodoni MT Condensed fed kursiv": {
      "Regular": "BodoniMTCondensed-BoldItalic"
    },
    "Bodoni MT Condensed kursiv": {
      "Regular": "BodoniMTCondensed-Italic"
    },
    "Bodoni MT Condensed kurz\xEDva": {
      "Regular": "BodoniMTCondensed-Italic"
    },
    "Bodoni MT Condensed tu\u010Dn\xE9": {
      "Regular": "BodoniMTCondensed-Bold"
    },
    "Bodoni MT Condensed tu\u010Dn\xE9 kurz\xEDva": {
      "Regular": "BodoniMTCondensed-BoldItalic"
    },
    "Bodoni MT Condensed \u0130talik": {
      "Regular": "BodoniMTCondensed-Italic"
    },
    "Bodoni MT Condensed \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "BodoniMTCondensed-Bold"
    },
    "Bodoni MT Condensed \u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "BodoniMTCondensed-BoldItalic"
    },
    "Bodoni MT Condensed \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "BodoniMTCondensed-Italic"
    },
    "Bodoni MT Condensed \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "BodoniMTCondensed-Italic"
    },
    "Bodoni MT Condensed \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "BodoniMTCondensed-Bold"
    },
    "Bodoni MT Condensed \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "BodoniMTCondensed-BoldItalic"
    },
    "Bodoni MT Corsivo": {
      "Regular": "BodoniMT-Italic"
    },
    "Bodoni MT Cursief": {
      "Regular": "BodoniMT-Italic"
    },
    "Bodoni MT Cursiva": {
      "Regular": "BodoniMT-Italic"
    },
    "Bodoni MT D\u0151lt": {
      "Regular": "BodoniMT-Italic"
    },
    "Bodoni MT Etzana": {
      "Regular": "BodoniMT-Italic"
    },
    "Bodoni MT Fet": {
      "Regular": "BodoniMT-Bold"
    },
    "Bodoni MT Fet Kursiv": {
      "Regular": "BodoniMT-BoldItalic"
    },
    "Bodoni MT Fett": {
      "Regular": "BodoniMT-Bold"
    },
    "Bodoni MT Fett Kursiv": {
      "Regular": "BodoniMT-BoldItalic"
    },
    "Bodoni MT F\xE9lk\xF6v\xE9r": {
      "Regular": "BodoniMT-Bold"
    },
    "Bodoni MT F\xE9lk\xF6v\xE9r d\u0151lt": {
      "Regular": "BodoniMT-BoldItalic"
    },
    "Bodoni MT Gras": {
      "Regular": "BodoniMT-Bold"
    },
    "Bodoni MT Gras Italique": {
      "Regular": "BodoniMT-BoldItalic"
    },
    "Bodoni MT Grassetto": {
      "Regular": "BodoniMT-Bold"
    },
    "Bodoni MT Grassetto Corsivo": {
      "Regular": "BodoniMT-BoldItalic"
    },
    "Bodoni MT Halvfet": {
      "Regular": "BodoniMT-Bold"
    },
    "Bodoni MT Halvfet Kursiv": {
      "Regular": "BodoniMT-BoldItalic"
    },
    "Bodoni MT Italic": {
      "Italic": "BodoniMT-Italic",
      "Regular": "BodoniMT-Italic"
    },
    "Bodoni MT Italique": {
      "Regular": "BodoniMT-Italic"
    },
    "Bodoni MT It\xE1lico": {
      "Regular": "BodoniMT-Italic"
    },
    "Bodoni MT Kal\u0131n": {
      "Regular": "BodoniMT-Bold"
    },
    "Bodoni MT Kal\u0131n \u0130talik": {
      "Regular": "BodoniMT-BoldItalic"
    },
    "Bodoni MT Krepko": {
      "Regular": "BodoniMT-Bold"
    },
    "Bodoni MT Krepko po\u0161evno": {
      "Regular": "BodoniMT-BoldItalic"
    },
    "Bodoni MT Kursiv": {
      "Regular": "BodoniMT-Italic"
    },
    "Bodoni MT Kursivoitu": {
      "Regular": "BodoniMT-Italic"
    },
    "Bodoni MT Kursywa": {
      "Regular": "BodoniMT-Italic"
    },
    "Bodoni MT Kurz\xEDva": {
      "Regular": "BodoniMT-Italic"
    },
    "Bodoni MT Lihavoitu": {
      "Regular": "BodoniMT-Bold"
    },
    "Bodoni MT Lihavoitu Kursivoi": {
      "Regular": "BodoniMT-BoldItalic"
    },
    "Bodoni MT Lodi etzana": {
      "Regular": "BodoniMT-BoldItalic"
    },
    "Bodoni MT Lodia": {
      "Regular": "BodoniMT-Bold"
    },
    "Bodoni MT Negreta": {
      "Regular": "BodoniMT-Bold"
    },
    "Bodoni MT Negreta cursiva": {
      "Regular": "BodoniMT-BoldItalic"
    },
    "Bodoni MT Negrita": {
      "Regular": "BodoniMT-Bold"
    },
    "Bodoni MT Negrita Cursiva": {
      "Regular": "BodoniMT-BoldItalic"
    },
    "Bodoni MT Negrito": {
      "Regular": "BodoniMT-Bold"
    },
    "Bodoni MT Negrito It\xE1lico": {
      "Regular": "BodoniMT-BoldItalic"
    },
    "Bodoni MT Pogrubiona kursywa": {
      "Regular": "BodoniMT-BoldItalic"
    },
    "Bodoni MT Pogrubiony": {
      "Regular": "BodoniMT-Bold"
    },
    "Bodoni MT Poster Compressed": {
      "Arrunta": "BodoniMTPosterCompressed",
      "Navadno": "BodoniMTPosterCompressed",
      "Normaali": "BodoniMTPosterCompressed",
      "Normal": "BodoniMTPosterCompressed",
      "Normale": "BodoniMTPosterCompressed",
      "Normalny": "BodoniMTPosterCompressed",
      "Norm\xE1l": "BodoniMTPosterCompressed",
      "Norm\xE1lne": "BodoniMTPosterCompressed",
      "Poster Compressed": "BodoniMTPosterCompressed",
      "Regular": "BodoniMTPosterCompressed",
      "Standaard": "BodoniMTPosterCompressed",
      "Standard": "BodoniMTPosterCompressed",
      "normal": "BodoniMTPosterCompressed",
      "oby\u010Dejn\xE9": "BodoniMTPosterCompressed",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "BodoniMTPosterCompressed",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "BodoniMTPosterCompressed"
    },
    "Bodoni MT Po\u0161evno": {
      "Regular": "BodoniMT-Italic"
    },
    "Bodoni MT Tu\u010Dn\xE1 kurz\xEDva": {
      "Regular": "BodoniMT-BoldItalic"
    },
    "Bodoni MT Tu\u010Dn\xE9": {
      "Regular": "BodoniMT-Bold"
    },
    "Bodoni MT Vet": {
      "Regular": "BodoniMT-Bold"
    },
    "Bodoni MT Vet Cursief": {
      "Regular": "BodoniMT-BoldItalic"
    },
    "Bodoni MT fed": {
      "Regular": "BodoniMT-Bold"
    },
    "Bodoni MT fed kursiv": {
      "Regular": "BodoniMT-BoldItalic"
    },
    "Bodoni MT kursiv": {
      "Regular": "BodoniMT-Italic"
    },
    "Bodoni MT kurz\xEDva": {
      "Regular": "BodoniMT-Italic"
    },
    "Bodoni MT tu\u010Dn\xE9": {
      "Regular": "BodoniMT-Bold"
    },
    "Bodoni MT tu\u010Dn\xE9 kurz\xEDva": {
      "Regular": "BodoniMT-BoldItalic"
    },
    "Bodoni MT \u0130talik": {
      "Regular": "BodoniMT-Italic"
    },
    "Bodoni MT \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "BodoniMT-Bold"
    },
    "Bodoni MT \u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "BodoniMT-BoldItalic"
    },
    "Bodoni MT \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "BodoniMT-Italic"
    },
    "Bodoni MT \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "BodoniMT-Italic"
    },
    "Bodoni MT \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "BodoniMT-Bold"
    },
    "Bodoni MT \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "BodoniMT-BoldItalic"
    },
    "Book Antiqua": {
      "Arrunta": "BookAntiqua",
      "Bold": "BookAntiqua-Bold",
      "Bold Italic": "BookAntiqua-BoldItalic",
      "Corsivo": "BookAntiqua-Italic",
      "Cursief": "BookAntiqua-Italic",
      "Cursiva": "BookAntiqua-Italic",
      "D\u0151lt": "BookAntiqua-Italic",
      "Etzana": "BookAntiqua-Italic",
      "Fet": "BookAntiqua-Bold",
      "Fet Kursiv": "BookAntiqua-BoldItalic",
      "Fett": "BookAntiqua-Bold",
      "Fett Kursiv": "BookAntiqua-BoldItalic",
      "F\xE9lk\xF6v\xE9r": "BookAntiqua-Bold",
      "F\xE9lk\xF6v\xE9r d\u0151lt": "BookAntiqua-BoldItalic",
      "Gras": "BookAntiqua-Bold",
      "Gras Italique": "BookAntiqua-BoldItalic",
      "Grassetto": "BookAntiqua-Bold",
      "Grassetto Corsivo": "BookAntiqua-BoldItalic",
      "Halvfet": "BookAntiqua-Bold",
      "Halvfet Kursiv": "BookAntiqua-BoldItalic",
      "Italic": "BookAntiqua-Italic",
      "Italique": "BookAntiqua-Italic",
      "It\xE1lico": "BookAntiqua-Italic",
      "Kal\u0131n": "BookAntiqua-Bold",
      "Kal\u0131n \u0130talik": "BookAntiqua-BoldItalic",
      "Krepko": "BookAntiqua-Bold",
      "Krepko po\u0161evno": "BookAntiqua-BoldItalic",
      "Kursiv": "BookAntiqua-Italic",
      "Kursivoitu": "BookAntiqua-Italic",
      "Kursywa": "BookAntiqua-Italic",
      "Kurz\xEDva": "BookAntiqua-Italic",
      "Lihavoitu": "BookAntiqua-Bold",
      "Lihavoitu Kursivoi": "BookAntiqua-BoldItalic",
      "Lodi etzana": "BookAntiqua-BoldItalic",
      "Lodia": "BookAntiqua-Bold",
      "Navadno": "BookAntiqua",
      "Negreta": "BookAntiqua-Bold",
      "Negreta cursiva": "BookAntiqua-BoldItalic",
      "Negrita": "BookAntiqua-Bold",
      "Negrita Cursiva": "BookAntiqua-BoldItalic",
      "Negrito": "BookAntiqua-Bold",
      "Negrito It\xE1lico": "BookAntiqua-BoldItalic",
      "Normaali": "BookAntiqua",
      "Normal": "BookAntiqua",
      "Normale": "BookAntiqua",
      "Normalny": "BookAntiqua",
      "Norm\xE1l": "BookAntiqua",
      "Norm\xE1lne": "BookAntiqua",
      "Pogrubiona kursywa": "BookAntiqua-BoldItalic",
      "Pogrubiony": "BookAntiqua-Bold",
      "Po\u0161evno": "BookAntiqua-Italic",
      "Regular": "BookAntiqua",
      "Standaard": "BookAntiqua",
      "Standard": "BookAntiqua",
      "Tu\u010Dn\xE1 kurz\xEDva": "BookAntiqua-BoldItalic",
      "Tu\u010Dn\xE9": "BookAntiqua-Bold",
      "Vet": "BookAntiqua-Bold",
      "Vet Cursief": "BookAntiqua-BoldItalic",
      "fed": "BookAntiqua-Bold",
      "fed kursiv": "BookAntiqua-BoldItalic",
      "kursiv": "BookAntiqua-Italic",
      "kurz\xEDva": "BookAntiqua-Italic",
      "normal": "BookAntiqua",
      "oby\u010Dejn\xE9": "BookAntiqua",
      "tu\u010Dn\xE9": "BookAntiqua-Bold",
      "tu\u010Dn\xE9 kurz\xEDva": "BookAntiqua-BoldItalic",
      "\u0130talik": "BookAntiqua-Italic",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "BookAntiqua-Bold",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "BookAntiqua-BoldItalic",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "BookAntiqua",
      "\u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "BookAntiqua-Italic",
      "\u041A\u0443\u0440\u0441\u0438\u0432": "BookAntiqua-Italic",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "BookAntiqua",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "BookAntiqua-Bold",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": "BookAntiqua-BoldItalic"
    },
    "Book Antiqua Bold": {
      "Bold": "BookAntiqua-Bold",
      "Regular": "BookAntiqua-Bold"
    },
    "Book Antiqua Bold Italic": {
      "Bold Italic": "BookAntiqua-BoldItalic",
      "Regular": "BookAntiqua-BoldItalic"
    },
    "Book Antiqua Corsivo": {
      "Regular": "BookAntiqua-Italic"
    },
    "Book Antiqua Cursief": {
      "Regular": "BookAntiqua-Italic"
    },
    "Book Antiqua Cursiva": {
      "Regular": "BookAntiqua-Italic"
    },
    "Book Antiqua D\u0151lt": {
      "Regular": "BookAntiqua-Italic"
    },
    "Book Antiqua Etzana": {
      "Regular": "BookAntiqua-Italic"
    },
    "Book Antiqua Fet": {
      "Regular": "BookAntiqua-Bold"
    },
    "Book Antiqua Fet Kursiv": {
      "Regular": "BookAntiqua-BoldItalic"
    },
    "Book Antiqua Fett": {
      "Regular": "BookAntiqua-Bold"
    },
    "Book Antiqua Fett Kursiv": {
      "Regular": "BookAntiqua-BoldItalic"
    },
    "Book Antiqua F\xE9lk\xF6v\xE9r": {
      "Regular": "BookAntiqua-Bold"
    },
    "Book Antiqua F\xE9lk\xF6v\xE9r d\u0151lt": {
      "Regular": "BookAntiqua-BoldItalic"
    },
    "Book Antiqua Gras": {
      "Regular": "BookAntiqua-Bold"
    },
    "Book Antiqua Gras Italique": {
      "Regular": "BookAntiqua-BoldItalic"
    },
    "Book Antiqua Grassetto": {
      "Regular": "BookAntiqua-Bold"
    },
    "Book Antiqua Grassetto Corsivo": {
      "Regular": "BookAntiqua-BoldItalic"
    },
    "Book Antiqua Halvfet": {
      "Regular": "BookAntiqua-Bold"
    },
    "Book Antiqua Halvfet Kursiv": {
      "Regular": "BookAntiqua-BoldItalic"
    },
    "Book Antiqua Italic": {
      "Italic": "BookAntiqua-Italic",
      "Regular": "BookAntiqua-Italic"
    },
    "Book Antiqua Italique": {
      "Regular": "BookAntiqua-Italic"
    },
    "Book Antiqua It\xE1lico": {
      "Regular": "BookAntiqua-Italic"
    },
    "Book Antiqua Kal\u0131n": {
      "Regular": "BookAntiqua-Bold"
    },
    "Book Antiqua Kal\u0131n \u0130talik": {
      "Regular": "BookAntiqua-BoldItalic"
    },
    "Book Antiqua Krepko": {
      "Regular": "BookAntiqua-Bold"
    },
    "Book Antiqua Krepko po\u0161evno": {
      "Regular": "BookAntiqua-BoldItalic"
    },
    "Book Antiqua Kursiv": {
      "Regular": "BookAntiqua-Italic"
    },
    "Book Antiqua Kursivoitu": {
      "Regular": "BookAntiqua-Italic"
    },
    "Book Antiqua Kursywa": {
      "Regular": "BookAntiqua-Italic"
    },
    "Book Antiqua Kurz\xEDva": {
      "Regular": "BookAntiqua-Italic"
    },
    "Book Antiqua Lihavoitu": {
      "Regular": "BookAntiqua-Bold"
    },
    "Book Antiqua Lihavoitu Kursivoi": {
      "Regular": "BookAntiqua-BoldItalic"
    },
    "Book Antiqua Lodi etzana": {
      "Regular": "BookAntiqua-BoldItalic"
    },
    "Book Antiqua Lodia": {
      "Regular": "BookAntiqua-Bold"
    },
    "Book Antiqua Negreta": {
      "Regular": "BookAntiqua-Bold"
    },
    "Book Antiqua Negreta cursiva": {
      "Regular": "BookAntiqua-BoldItalic"
    },
    "Book Antiqua Negrita": {
      "Regular": "BookAntiqua-Bold"
    },
    "Book Antiqua Negrita Cursiva": {
      "Regular": "BookAntiqua-BoldItalic"
    },
    "Book Antiqua Negrito": {
      "Regular": "BookAntiqua-Bold"
    },
    "Book Antiqua Negrito It\xE1lico": {
      "Regular": "BookAntiqua-BoldItalic"
    },
    "Book Antiqua Pogrubiona kursywa": {
      "Regular": "BookAntiqua-BoldItalic"
    },
    "Book Antiqua Pogrubiony": {
      "Regular": "BookAntiqua-Bold"
    },
    "Book Antiqua Po\u0161evno": {
      "Regular": "BookAntiqua-Italic"
    },
    "Book Antiqua Tu\u010Dn\xE1 kurz\xEDva": {
      "Regular": "BookAntiqua-BoldItalic"
    },
    "Book Antiqua Tu\u010Dn\xE9": {
      "Regular": "BookAntiqua-Bold"
    },
    "Book Antiqua Vet": {
      "Regular": "BookAntiqua-Bold"
    },
    "Book Antiqua Vet Cursief": {
      "Regular": "BookAntiqua-BoldItalic"
    },
    "Book Antiqua fed": {
      "Regular": "BookAntiqua-Bold"
    },
    "Book Antiqua fed kursiv": {
      "Regular": "BookAntiqua-BoldItalic"
    },
    "Book Antiqua kursiv": {
      "Regular": "BookAntiqua-Italic"
    },
    "Book Antiqua kurz\xEDva": {
      "Regular": "BookAntiqua-Italic"
    },
    "Book Antiqua tu\u010Dn\xE9": {
      "Regular": "BookAntiqua-Bold"
    },
    "Book Antiqua tu\u010Dn\xE9 kurz\xEDva": {
      "Regular": "BookAntiqua-BoldItalic"
    },
    "Book Antiqua \u0130talik": {
      "Regular": "BookAntiqua-Italic"
    },
    "Book Antiqua \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "BookAntiqua-Bold"
    },
    "Book Antiqua \u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "BookAntiqua-BoldItalic"
    },
    "Book Antiqua \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "BookAntiqua-Italic"
    },
    "Book Antiqua \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "BookAntiqua-Italic"
    },
    "Book Antiqua \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "BookAntiqua-Bold"
    },
    "Book Antiqua \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "BookAntiqua-BoldItalic"
    },
    "Bookman Old Style": {
      "Arrunta": "BookmanOldStyle",
      "Bold": "BookmanOldStyle-Bold",
      "Bold Italic": "BookmanOldStyle-BoldItalic",
      "Corsivo": "BookmanOldStyle-Italic",
      "Cursief": "BookmanOldStyle-Italic",
      "Cursiva": "BookmanOldStyle-Italic",
      "D\u0151lt": "BookmanOldStyle-Italic",
      "Etzana": "BookmanOldStyle-Italic",
      "Fet": "BookmanOldStyle-Bold",
      "Fet Kursiv": "BookmanOldStyle-BoldItalic",
      "Fett": "BookmanOldStyle-Bold",
      "Fett Kursiv": "BookmanOldStyle-BoldItalic",
      "F\xE9lk\xF6v\xE9r": "BookmanOldStyle-Bold",
      "F\xE9lk\xF6v\xE9r d\u0151lt": "BookmanOldStyle-BoldItalic",
      "Gras": "BookmanOldStyle-Bold",
      "Gras Italique": "BookmanOldStyle-BoldItalic",
      "Grassetto": "BookmanOldStyle-Bold",
      "Grassetto Corsivo": "BookmanOldStyle-BoldItalic",
      "Halvfet": "BookmanOldStyle-Bold",
      "Halvfet Kursiv": "BookmanOldStyle-BoldItalic",
      "Italic": "BookmanOldStyle-Italic",
      "Italique": "BookmanOldStyle-Italic",
      "It\xE1lico": "BookmanOldStyle-Italic",
      "Kal\u0131n": "BookmanOldStyle-Bold",
      "Kal\u0131n \u0130talik": "BookmanOldStyle-BoldItalic",
      "Krepko": "BookmanOldStyle-Bold",
      "Krepko po\u0161evno": "BookmanOldStyle-BoldItalic",
      "Kursiv": "BookmanOldStyle-Italic",
      "Kursivoitu": "BookmanOldStyle-Italic",
      "Kursywa": "BookmanOldStyle-Italic",
      "Kurz\xEDva": "BookmanOldStyle-Italic",
      "Lihavoitu": "BookmanOldStyle-Bold",
      "Lihavoitu Kursivoi": "BookmanOldStyle-BoldItalic",
      "Lodi etzana": "BookmanOldStyle-BoldItalic",
      "Lodia": "BookmanOldStyle-Bold",
      "Navadno": "BookmanOldStyle",
      "Negreta": "BookmanOldStyle-Bold",
      "Negreta cursiva": "BookmanOldStyle-BoldItalic",
      "Negrita": "BookmanOldStyle-Bold",
      "Negrita Cursiva": "BookmanOldStyle-BoldItalic",
      "Negrito": "BookmanOldStyle-Bold",
      "Negrito It\xE1lico": "BookmanOldStyle-BoldItalic",
      "Normaali": "BookmanOldStyle",
      "Normal": "BookmanOldStyle",
      "Normale": "BookmanOldStyle",
      "Normalny": "BookmanOldStyle",
      "Norm\xE1l": "BookmanOldStyle",
      "Norm\xE1lne": "BookmanOldStyle",
      "Pogrubiona kursywa": "BookmanOldStyle-BoldItalic",
      "Pogrubiony": "BookmanOldStyle-Bold",
      "Po\u0161evno": "BookmanOldStyle-Italic",
      "Regular": "BookmanOldStyle",
      "Standaard": "BookmanOldStyle",
      "Standard": "BookmanOldStyle",
      "Tu\u010Dn\xE1 kurz\xEDva": "BookmanOldStyle-BoldItalic",
      "Tu\u010Dn\xE9": "BookmanOldStyle-Bold",
      "Vet": "BookmanOldStyle-Bold",
      "Vet Cursief": "BookmanOldStyle-BoldItalic",
      "fed": "BookmanOldStyle-Bold",
      "fed kursiv": "BookmanOldStyle-BoldItalic",
      "kursiv": "BookmanOldStyle-Italic",
      "kurz\xEDva": "BookmanOldStyle-Italic",
      "normal": "BookmanOldStyle",
      "oby\u010Dejn\xE9": "BookmanOldStyle",
      "tu\u010Dn\xE9": "BookmanOldStyle-Bold",
      "tu\u010Dn\xE9 kurz\xEDva": "BookmanOldStyle-BoldItalic",
      "\u0130talik": "BookmanOldStyle-Italic",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "BookmanOldStyle-Bold",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "BookmanOldStyle-BoldItalic",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "BookmanOldStyle",
      "\u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "BookmanOldStyle-Italic",
      "\u041A\u0443\u0440\u0441\u0438\u0432": "BookmanOldStyle-Italic",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "BookmanOldStyle",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "BookmanOldStyle-Bold",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": "BookmanOldStyle-BoldItalic"
    },
    "Bookman Old Style Bold": {
      "Bold": "BookmanOldStyle-Bold",
      "Regular": "BookmanOldStyle-Bold"
    },
    "Bookman Old Style Bold Italic": {
      "Bold Italic": "BookmanOldStyle-BoldItalic",
      "Regular": "BookmanOldStyle-BoldItalic"
    },
    "Bookman Old Style Corsivo": {
      "Regular": "BookmanOldStyle-Italic"
    },
    "Bookman Old Style Cursief": {
      "Regular": "BookmanOldStyle-Italic"
    },
    "Bookman Old Style Cursiva": {
      "Regular": "BookmanOldStyle-Italic"
    },
    "Bookman Old Style D\u0151lt": {
      "Regular": "BookmanOldStyle-Italic"
    },
    "Bookman Old Style Etzana": {
      "Regular": "BookmanOldStyle-Italic"
    },
    "Bookman Old Style Fet": {
      "Regular": "BookmanOldStyle-Bold"
    },
    "Bookman Old Style Fet Kursiv": {
      "Regular": "BookmanOldStyle-BoldItalic"
    },
    "Bookman Old Style Fett": {
      "Regular": "BookmanOldStyle-Bold"
    },
    "Bookman Old Style Fett Kursiv": {
      "Regular": "BookmanOldStyle-BoldItalic"
    },
    "Bookman Old Style F\xE9lk\xF6v\xE9r": {
      "Regular": "BookmanOldStyle-Bold"
    },
    "Bookman Old Style F\xE9lk\xF6v\xE9r d\u0151lt": {
      "Regular": "BookmanOldStyle-BoldItalic"
    },
    "Bookman Old Style Gras": {
      "Regular": "BookmanOldStyle-Bold"
    },
    "Bookman Old Style Gras Italique": {
      "Regular": "BookmanOldStyle-BoldItalic"
    },
    "Bookman Old Style Grassetto": {
      "Regular": "BookmanOldStyle-Bold"
    },
    "Bookman Old Style Grassetto Corsivo": {
      "Regular": "BookmanOldStyle-BoldItalic"
    },
    "Bookman Old Style Halvfet": {
      "Regular": "BookmanOldStyle-Bold"
    },
    "Bookman Old Style Halvfet Kursiv": {
      "Regular": "BookmanOldStyle-BoldItalic"
    },
    "Bookman Old Style Italic": {
      "Italic": "BookmanOldStyle-Italic",
      "Regular": "BookmanOldStyle-Italic"
    },
    "Bookman Old Style Italique": {
      "Regular": "BookmanOldStyle-Italic"
    },
    "Bookman Old Style It\xE1lico": {
      "Regular": "BookmanOldStyle-Italic"
    },
    "Bookman Old Style Kal\u0131n": {
      "Regular": "BookmanOldStyle-Bold"
    },
    "Bookman Old Style Kal\u0131n \u0130talik": {
      "Regular": "BookmanOldStyle-BoldItalic"
    },
    "Bookman Old Style Krepko": {
      "Regular": "BookmanOldStyle-Bold"
    },
    "Bookman Old Style Krepko po\u0161evno": {
      "Regular": "BookmanOldStyle-BoldItalic"
    },
    "Bookman Old Style Kursiv": {
      "Regular": "BookmanOldStyle-Italic"
    },
    "Bookman Old Style Kursivoitu": {
      "Regular": "BookmanOldStyle-Italic"
    },
    "Bookman Old Style Kursywa": {
      "Regular": "BookmanOldStyle-Italic"
    },
    "Bookman Old Style Kurz\xEDva": {
      "Regular": "BookmanOldStyle-Italic"
    },
    "Bookman Old Style Lihavoitu": {
      "Regular": "BookmanOldStyle-Bold"
    },
    "Bookman Old Style Lihavoitu Kursivoi": {
      "Regular": "BookmanOldStyle-BoldItalic"
    },
    "Bookman Old Style Lodi etzana": {
      "Regular": "BookmanOldStyle-BoldItalic"
    },
    "Bookman Old Style Lodia": {
      "Regular": "BookmanOldStyle-Bold"
    },
    "Bookman Old Style Negreta": {
      "Regular": "BookmanOldStyle-Bold"
    },
    "Bookman Old Style Negreta cursiva": {
      "Regular": "BookmanOldStyle-BoldItalic"
    },
    "Bookman Old Style Negrita": {
      "Regular": "BookmanOldStyle-Bold"
    },
    "Bookman Old Style Negrita Cursiva": {
      "Regular": "BookmanOldStyle-BoldItalic"
    },
    "Bookman Old Style Negrito": {
      "Regular": "BookmanOldStyle-Bold"
    },
    "Bookman Old Style Negrito It\xE1lico": {
      "Regular": "BookmanOldStyle-BoldItalic"
    },
    "Bookman Old Style Pogrubiona kursywa": {
      "Regular": "BookmanOldStyle-BoldItalic"
    },
    "Bookman Old Style Pogrubiony": {
      "Regular": "BookmanOldStyle-Bold"
    },
    "Bookman Old Style Po\u0161evno": {
      "Regular": "BookmanOldStyle-Italic"
    },
    "Bookman Old Style Tu\u010Dn\xE1 kurz\xEDva": {
      "Regular": "BookmanOldStyle-BoldItalic"
    },
    "Bookman Old Style Tu\u010Dn\xE9": {
      "Regular": "BookmanOldStyle-Bold"
    },
    "Bookman Old Style Vet": {
      "Regular": "BookmanOldStyle-Bold"
    },
    "Bookman Old Style Vet Cursief": {
      "Regular": "BookmanOldStyle-BoldItalic"
    },
    "Bookman Old Style fed": {
      "Regular": "BookmanOldStyle-Bold"
    },
    "Bookman Old Style fed kursiv": {
      "Regular": "BookmanOldStyle-BoldItalic"
    },
    "Bookman Old Style kursiv": {
      "Regular": "BookmanOldStyle-Italic"
    },
    "Bookman Old Style kurz\xEDva": {
      "Regular": "BookmanOldStyle-Italic"
    },
    "Bookman Old Style tu\u010Dn\xE9": {
      "Regular": "BookmanOldStyle-Bold"
    },
    "Bookman Old Style tu\u010Dn\xE9 kurz\xEDva": {
      "Regular": "BookmanOldStyle-BoldItalic"
    },
    "Bookman Old Style \u0130talik": {
      "Regular": "BookmanOldStyle-Italic"
    },
    "Bookman Old Style \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "BookmanOldStyle-Bold"
    },
    "Bookman Old Style \u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "BookmanOldStyle-BoldItalic"
    },
    "Bookman Old Style \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "BookmanOldStyle-Italic"
    },
    "Bookman Old Style \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "BookmanOldStyle-Italic"
    },
    "Bookman Old Style \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "BookmanOldStyle-Bold"
    },
    "Bookman Old Style \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "BookmanOldStyle-BoldItalic"
    },
    "Bookshelf Symbol 7": {
      "Regular": "BookshelfSymbolSeven"
    },
    "Bradley Hand ITC": {
      "Arrunta": "BradleyHandITC",
      "Navadno": "BradleyHandITC",
      "Normaali": "BradleyHandITC",
      "Normal": "BradleyHandITC",
      "Normale": "BradleyHandITC",
      "Normalny": "BradleyHandITC",
      "Norm\xE1l": "BradleyHandITC",
      "Norm\xE1lne": "BradleyHandITC",
      "Regular": "BradleyHandITC",
      "Standaard": "BradleyHandITC",
      "Standard": "BradleyHandITC",
      "normal": "BradleyHandITC",
      "oby\u010Dejn\xE9": "BradleyHandITC",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "BradleyHandITC",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "BradleyHandITC"
    },
    "Britannic": {
      "Regular": "BritannicBold"
    },
    "Britannic Bold": {
      "Arrunta": "BritannicBold",
      "Navadno": "BritannicBold",
      "Normaali": "BritannicBold",
      "Normal": "BritannicBold",
      "Normale": "BritannicBold",
      "Normalny": "BritannicBold",
      "Norm\xE1l": "BritannicBold",
      "Norm\xE1lne": "BritannicBold",
      "Regular": "BritannicBold",
      "Standaard": "BritannicBold",
      "Standard": "BritannicBold",
      "normal": "BritannicBold",
      "oby\u010Dejn\xE9": "BritannicBold",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "BritannicBold",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "BritannicBold"
    },
    "Broadway": {
      "Arrunta": "Broadway",
      "Navadno": "Broadway",
      "Normaali": "Broadway",
      "Normal": "Broadway",
      "Normale": "Broadway",
      "Normalny": "Broadway",
      "Norm\xE1l": "Broadway",
      "Norm\xE1lne": "Broadway",
      "Regular": "Broadway",
      "Standaard": "Broadway",
      "Standard": "Broadway",
      "normal": "Broadway",
      "oby\u010Dejn\xE9": "Broadway",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "Broadway",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "Broadway"
    },
    "Brush Script MT": {
      "Corsivo": "BrushScriptMT",
      "Cursief": "BrushScriptMT",
      "Cursiva": "BrushScriptMT",
      "D\u0151lt": "BrushScriptMT",
      "Etzana": "BrushScriptMT",
      "Italic": "BrushScriptMT",
      "Italique": "BrushScriptMT",
      "It\xE1lico": "BrushScriptMT",
      "Kursiv": "BrushScriptMT",
      "Kursivoitu": "BrushScriptMT",
      "Kursywa": "BrushScriptMT",
      "Kurz\xEDva": "BrushScriptMT",
      "Po\u0161evno": "BrushScriptMT",
      "kursiv": "BrushScriptMT",
      "kurz\xEDva": "BrushScriptMT",
      "\u0130talik": "BrushScriptMT",
      "\u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "BrushScriptMT",
      "\u041A\u0443\u0440\u0441\u0438\u0432": "BrushScriptMT"
    },
    "Brush Script MT Corsivo": {
      "Regular": "BrushScriptMT"
    },
    "Brush Script MT Cursief": {
      "Regular": "BrushScriptMT"
    },
    "Brush Script MT Cursiva": {
      "Regular": "BrushScriptMT"
    },
    "Brush Script MT D\u0151lt": {
      "Regular": "BrushScriptMT"
    },
    "Brush Script MT Etzana": {
      "Regular": "BrushScriptMT"
    },
    "Brush Script MT Italic": {
      "Italic": "BrushScriptMT",
      "Regular": "BrushScriptMT"
    },
    "Brush Script MT Italique": {
      "Regular": "BrushScriptMT"
    },
    "Brush Script MT It\xE1lico": {
      "Regular": "BrushScriptMT"
    },
    "Brush Script MT Kursiv": {
      "Regular": "BrushScriptMT"
    },
    "Brush Script MT Kursivoitu": {
      "Regular": "BrushScriptMT"
    },
    "Brush Script MT Kursywa": {
      "Regular": "BrushScriptMT"
    },
    "Brush Script MT Kurz\xEDva": {
      "Regular": "BrushScriptMT"
    },
    "Brush Script MT Po\u0161evno": {
      "Regular": "BrushScriptMT"
    },
    "Brush Script MT kursiv": {
      "Regular": "BrushScriptMT"
    },
    "Brush Script MT kurz\xEDva": {
      "Regular": "BrushScriptMT"
    },
    "Brush Script MT \u0130talik": {
      "Regular": "BrushScriptMT"
    },
    "Brush Script MT \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "BrushScriptMT"
    },
    "Brush Script MT \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "BrushScriptMT"
    },
    "Caladea": {
      "Bold": "Caladea-Bold",
      "Bold Italic": "Caladea-BoldItalic",
      "Italic": "Caladea-Italic",
      "Regular": "Caladea-Regular"
    },
    "Caladea Bold": {
      "Bold": "Caladea-Bold",
      "Regular": "Caladea-Bold"
    },
    "Caladea Bold Italic": {
      "Bold Italic": "Caladea-BoldItalic",
      "Regular": "Caladea-BoldItalic"
    },
    "Caladea Italic": {
      "Italic": "Caladea-Italic",
      "Regular": "Caladea-Italic"
    },
    "Calibri": {
      "Bold": "Calibri-Bold",
      "Bold Italic": "Calibri-BoldItalic",
      "Italic": "Calibri-Italic",
      "Light": "Calibri-Light",
      "Light Italic": "Calibri-LightItalic",
      "Regular": "Calibri"
    },
    "Calibri Bold": {
      "Bold": "Calibri-Bold",
      "Regular": "Calibri-Bold"
    },
    "Calibri Bold Italic": {
      "Bold Italic": "Calibri-BoldItalic",
      "Regular": "Calibri-BoldItalic"
    },
    "Calibri Italic": {
      "Italic": "Calibri-Italic",
      "Regular": "Calibri-Italic"
    },
    "Calibri Light": {
      "Italic": "Calibri-LightItalic",
      "Light": "Calibri-Light",
      "Regular": "Calibri-Light"
    },
    "Calibri Light Italic": {
      "Light Italic": "Calibri-LightItalic",
      "Regular": "Calibri-LightItalic"
    },
    "Californian FB": {
      "Arrunta": "CalifornianFB-Reg",
      "Bold": "CalifornianFB-Bold",
      "Corsivo": "CalifornianFB-Italic",
      "Cursief": "CalifornianFB-Italic",
      "Cursiva": "CalifornianFB-Italic",
      "D\u0151lt": "CalifornianFB-Italic",
      "Etzana": "CalifornianFB-Italic",
      "Fet": "CalifornianFB-Bold",
      "Fett": "CalifornianFB-Bold",
      "F\xE9lk\xF6v\xE9r": "CalifornianFB-Bold",
      "Gras": "CalifornianFB-Bold",
      "Grassetto": "CalifornianFB-Bold",
      "Halvfet": "CalifornianFB-Bold",
      "Italic": "CalifornianFB-Italic",
      "Italique": "CalifornianFB-Italic",
      "It\xE1lico": "CalifornianFB-Italic",
      "Kal\u0131n": "CalifornianFB-Bold",
      "Krepko": "CalifornianFB-Bold",
      "Kursiv": "CalifornianFB-Italic",
      "Kursivoitu": "CalifornianFB-Italic",
      "Kursywa": "CalifornianFB-Italic",
      "Kurz\xEDva": "CalifornianFB-Italic",
      "Lihavoitu": "CalifornianFB-Bold",
      "Lodia": "CalifornianFB-Bold",
      "Navadno": "CalifornianFB-Reg",
      "Negreta": "CalifornianFB-Bold",
      "Negrita": "CalifornianFB-Bold",
      "Negrito": "CalifornianFB-Bold",
      "Normaali": "CalifornianFB-Reg",
      "Normal": "CalifornianFB-Reg",
      "Normale": "CalifornianFB-Reg",
      "Normalny": "CalifornianFB-Reg",
      "Norm\xE1l": "CalifornianFB-Reg",
      "Norm\xE1lne": "CalifornianFB-Reg",
      "Pogrubiony": "CalifornianFB-Bold",
      "Po\u0161evno": "CalifornianFB-Italic",
      "Regular": "CalifornianFB-Reg",
      "Standaard": "CalifornianFB-Reg",
      "Standard": "CalifornianFB-Reg",
      "Tu\u010Dn\xE9": "CalifornianFB-Bold",
      "Vet": "CalifornianFB-Bold",
      "fed": "CalifornianFB-Bold",
      "kursiv": "CalifornianFB-Italic",
      "kurz\xEDva": "CalifornianFB-Italic",
      "normal": "CalifornianFB-Reg",
      "oby\u010Dejn\xE9": "CalifornianFB-Reg",
      "tu\u010Dn\xE9": "CalifornianFB-Bold",
      "\u0130talik": "CalifornianFB-Italic",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "CalifornianFB-Bold",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "CalifornianFB-Reg",
      "\u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "CalifornianFB-Italic",
      "\u041A\u0443\u0440\u0441\u0438\u0432": "CalifornianFB-Italic",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "CalifornianFB-Reg",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "CalifornianFB-Bold"
    },
    "Californian FB Bold": {
      "Bold": "CalifornianFB-Bold",
      "Regular": "CalifornianFB-Bold"
    },
    "Californian FB Corsivo": {
      "Regular": "CalifornianFB-Italic"
    },
    "Californian FB Cursief": {
      "Regular": "CalifornianFB-Italic"
    },
    "Californian FB Cursiva": {
      "Regular": "CalifornianFB-Italic"
    },
    "Californian FB D\u0151lt": {
      "Regular": "CalifornianFB-Italic"
    },
    "Californian FB Etzana": {
      "Regular": "CalifornianFB-Italic"
    },
    "Californian FB Fet": {
      "Regular": "CalifornianFB-Bold"
    },
    "Californian FB Fett": {
      "Regular": "CalifornianFB-Bold"
    },
    "Californian FB F\xE9lk\xF6v\xE9r": {
      "Regular": "CalifornianFB-Bold"
    },
    "Californian FB Gras": {
      "Regular": "CalifornianFB-Bold"
    },
    "Californian FB Grassetto": {
      "Regular": "CalifornianFB-Bold"
    },
    "Californian FB Halvfet": {
      "Regular": "CalifornianFB-Bold"
    },
    "Californian FB Italic": {
      "Italic": "CalifornianFB-Italic",
      "Regular": "CalifornianFB-Italic"
    },
    "Californian FB Italique": {
      "Regular": "CalifornianFB-Italic"
    },
    "Californian FB It\xE1lico": {
      "Regular": "CalifornianFB-Italic"
    },
    "Californian FB Kal\u0131n": {
      "Regular": "CalifornianFB-Bold"
    },
    "Californian FB Krepko": {
      "Regular": "CalifornianFB-Bold"
    },
    "Californian FB Kursiv": {
      "Regular": "CalifornianFB-Italic"
    },
    "Californian FB Kursivoitu": {
      "Regular": "CalifornianFB-Italic"
    },
    "Californian FB Kursywa": {
      "Regular": "CalifornianFB-Italic"
    },
    "Californian FB Kurz\xEDva": {
      "Regular": "CalifornianFB-Italic"
    },
    "Californian FB Lihavoitu": {
      "Regular": "CalifornianFB-Bold"
    },
    "Californian FB Lodia": {
      "Regular": "CalifornianFB-Bold"
    },
    "Californian FB Negreta": {
      "Regular": "CalifornianFB-Bold"
    },
    "Californian FB Negrita": {
      "Regular": "CalifornianFB-Bold"
    },
    "Californian FB Negrito": {
      "Regular": "CalifornianFB-Bold"
    },
    "Californian FB Pogrubiony": {
      "Regular": "CalifornianFB-Bold"
    },
    "Californian FB Po\u0161evno": {
      "Regular": "CalifornianFB-Italic"
    },
    "Californian FB Tu\u010Dn\xE9": {
      "Regular": "CalifornianFB-Bold"
    },
    "Californian FB Vet": {
      "Regular": "CalifornianFB-Bold"
    },
    "Californian FB fed": {
      "Regular": "CalifornianFB-Bold"
    },
    "Californian FB kursiv": {
      "Regular": "CalifornianFB-Italic"
    },
    "Californian FB kurz\xEDva": {
      "Regular": "CalifornianFB-Italic"
    },
    "Californian FB tu\u010Dn\xE9": {
      "Regular": "CalifornianFB-Bold"
    },
    "Californian FB \u0130talik": {
      "Regular": "CalifornianFB-Italic"
    },
    "Californian FB \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "CalifornianFB-Bold"
    },
    "Californian FB \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "CalifornianFB-Italic"
    },
    "Californian FB \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "CalifornianFB-Italic"
    },
    "Californian FB \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "CalifornianFB-Bold"
    },
    "Calisto MT": {
      "Arrunta": "CalistoMT",
      "Bold": "CalisMTBol",
      "Bold Italic": "CalistoMT-BoldItalic",
      "Corsivo": "CalistoMT-Italic",
      "Cursief": "CalistoMT-Italic",
      "Cursiva": "CalistoMT-Italic",
      "D\u0151lt": "CalistoMT-Italic",
      "Etzana": "CalistoMT-Italic",
      "Fet": "CalisMTBol",
      "Fet Kursiv": "CalistoMT-BoldItalic",
      "Fett": "CalisMTBol",
      "Fett Kursiv": "CalistoMT-BoldItalic",
      "F\xE9lk\xF6v\xE9r": "CalisMTBol",
      "F\xE9lk\xF6v\xE9r d\u0151lt": "CalistoMT-BoldItalic",
      "Gras": "CalisMTBol",
      "Gras Italique": "CalistoMT-BoldItalic",
      "Grassetto": "CalisMTBol",
      "Grassetto Corsivo": "CalistoMT-BoldItalic",
      "Halvfet": "CalisMTBol",
      "Halvfet Kursiv": "CalistoMT-BoldItalic",
      "Italic": "CalistoMT-Italic",
      "Italique": "CalistoMT-Italic",
      "It\xE1lico": "CalistoMT-Italic",
      "Kal\u0131n": "CalisMTBol",
      "Kal\u0131n \u0130talik": "CalistoMT-BoldItalic",
      "Krepko": "CalisMTBol",
      "Krepko po\u0161evno": "CalistoMT-BoldItalic",
      "Kursiv": "CalistoMT-Italic",
      "Kursivoitu": "CalistoMT-Italic",
      "Kursywa": "CalistoMT-Italic",
      "Kurz\xEDva": "CalistoMT-Italic",
      "Lihavoitu": "CalisMTBol",
      "Lihavoitu Kursivoi": "CalistoMT-BoldItalic",
      "Lodi etzana": "CalistoMT-BoldItalic",
      "Lodia": "CalisMTBol",
      "Navadno": "CalistoMT",
      "Negreta": "CalisMTBol",
      "Negreta cursiva": "CalistoMT-BoldItalic",
      "Negrita": "CalisMTBol",
      "Negrita Cursiva": "CalistoMT-BoldItalic",
      "Negrito": "CalisMTBol",
      "Negrito It\xE1lico": "CalistoMT-BoldItalic",
      "Normaali": "CalistoMT",
      "Normal": "CalistoMT",
      "Normale": "CalistoMT",
      "Normalny": "CalistoMT",
      "Norm\xE1l": "CalistoMT",
      "Norm\xE1lne": "CalistoMT",
      "Pogrubiona kursywa": "CalistoMT-BoldItalic",
      "Pogrubiony": "CalisMTBol",
      "Po\u0161evno": "CalistoMT-Italic",
      "Regular": "CalistoMT",
      "Standaard": "CalistoMT",
      "Standard": "CalistoMT",
      "Tu\u010Dn\xE1 kurz\xEDva": "CalistoMT-BoldItalic",
      "Tu\u010Dn\xE9": "CalisMTBol",
      "Vet": "CalisMTBol",
      "Vet Cursief": "CalistoMT-BoldItalic",
      "fed": "CalisMTBol",
      "fed kursiv": "CalistoMT-BoldItalic",
      "kursiv": "CalistoMT-Italic",
      "kurz\xEDva": "CalistoMT-Italic",
      "normal": "CalistoMT",
      "oby\u010Dejn\xE9": "CalistoMT",
      "tu\u010Dn\xE9": "CalisMTBol",
      "tu\u010Dn\xE9 kurz\xEDva": "CalistoMT-BoldItalic",
      "\u0130talik": "CalistoMT-Italic",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "CalisMTBol",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "CalistoMT-BoldItalic",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "CalistoMT",
      "\u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "CalistoMT-Italic",
      "\u041A\u0443\u0440\u0441\u0438\u0432": "CalistoMT-Italic",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "CalistoMT",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "CalisMTBol",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": "CalistoMT-BoldItalic"
    },
    "Calisto MT Bold": {
      "Bold": "CalisMTBol",
      "Regular": "CalisMTBol"
    },
    "Calisto MT Bold Italic": {
      "Bold Italic": "CalistoMT-BoldItalic",
      "Regular": "CalistoMT-BoldItalic"
    },
    "Calisto MT Corsivo": {
      "Regular": "CalistoMT-Italic"
    },
    "Calisto MT Cursief": {
      "Regular": "CalistoMT-Italic"
    },
    "Calisto MT Cursiva": {
      "Regular": "CalistoMT-Italic"
    },
    "Calisto MT D\u0151lt": {
      "Regular": "CalistoMT-Italic"
    },
    "Calisto MT Etzana": {
      "Regular": "CalistoMT-Italic"
    },
    "Calisto MT Fet": {
      "Regular": "CalisMTBol"
    },
    "Calisto MT Fet Kursiv": {
      "Regular": "CalistoMT-BoldItalic"
    },
    "Calisto MT Fett": {
      "Regular": "CalisMTBol"
    },
    "Calisto MT Fett Kursiv": {
      "Regular": "CalistoMT-BoldItalic"
    },
    "Calisto MT F\xE9lk\xF6v\xE9r": {
      "Regular": "CalisMTBol"
    },
    "Calisto MT F\xE9lk\xF6v\xE9r d\u0151lt": {
      "Regular": "CalistoMT-BoldItalic"
    },
    "Calisto MT Gras": {
      "Regular": "CalisMTBol"
    },
    "Calisto MT Gras Italique": {
      "Regular": "CalistoMT-BoldItalic"
    },
    "Calisto MT Grassetto": {
      "Regular": "CalisMTBol"
    },
    "Calisto MT Grassetto Corsivo": {
      "Regular": "CalistoMT-BoldItalic"
    },
    "Calisto MT Halvfet": {
      "Regular": "CalisMTBol"
    },
    "Calisto MT Halvfet Kursiv": {
      "Regular": "CalistoMT-BoldItalic"
    },
    "Calisto MT Italic": {
      "Italic": "CalistoMT-Italic",
      "Regular": "CalistoMT-Italic"
    },
    "Calisto MT Italique": {
      "Regular": "CalistoMT-Italic"
    },
    "Calisto MT It\xE1lico": {
      "Regular": "CalistoMT-Italic"
    },
    "Calisto MT Kal\u0131n": {
      "Regular": "CalisMTBol"
    },
    "Calisto MT Kal\u0131n \u0130talik": {
      "Regular": "CalistoMT-BoldItalic"
    },
    "Calisto MT Krepko": {
      "Regular": "CalisMTBol"
    },
    "Calisto MT Krepko po\u0161evno": {
      "Regular": "CalistoMT-BoldItalic"
    },
    "Calisto MT Kursiv": {
      "Regular": "CalistoMT-Italic"
    },
    "Calisto MT Kursivoitu": {
      "Regular": "CalistoMT-Italic"
    },
    "Calisto MT Kursywa": {
      "Regular": "CalistoMT-Italic"
    },
    "Calisto MT Kurz\xEDva": {
      "Regular": "CalistoMT-Italic"
    },
    "Calisto MT Lihavoitu": {
      "Regular": "CalisMTBol"
    },
    "Calisto MT Lihavoitu Kursivoi": {
      "Regular": "CalistoMT-BoldItalic"
    },
    "Calisto MT Lodi etzana": {
      "Regular": "CalistoMT-BoldItalic"
    },
    "Calisto MT Lodia": {
      "Regular": "CalisMTBol"
    },
    "Calisto MT Negreta": {
      "Regular": "CalisMTBol"
    },
    "Calisto MT Negreta cursiva": {
      "Regular": "CalistoMT-BoldItalic"
    },
    "Calisto MT Negrita": {
      "Regular": "CalisMTBol"
    },
    "Calisto MT Negrita Cursiva": {
      "Regular": "CalistoMT-BoldItalic"
    },
    "Calisto MT Negrito": {
      "Regular": "CalisMTBol"
    },
    "Calisto MT Negrito It\xE1lico": {
      "Regular": "CalistoMT-BoldItalic"
    },
    "Calisto MT Pogrubiona kursywa": {
      "Regular": "CalistoMT-BoldItalic"
    },
    "Calisto MT Pogrubiony": {
      "Regular": "CalisMTBol"
    },
    "Calisto MT Po\u0161evno": {
      "Regular": "CalistoMT-Italic"
    },
    "Calisto MT Tu\u010Dn\xE1 kurz\xEDva": {
      "Regular": "CalistoMT-BoldItalic"
    },
    "Calisto MT Tu\u010Dn\xE9": {
      "Regular": "CalisMTBol"
    },
    "Calisto MT Vet": {
      "Regular": "CalisMTBol"
    },
    "Calisto MT Vet Cursief": {
      "Regular": "CalistoMT-BoldItalic"
    },
    "Calisto MT fed": {
      "Regular": "CalisMTBol"
    },
    "Calisto MT fed kursiv": {
      "Regular": "CalistoMT-BoldItalic"
    },
    "Calisto MT kursiv": {
      "Regular": "CalistoMT-Italic"
    },
    "Calisto MT kurz\xEDva": {
      "Regular": "CalistoMT-Italic"
    },
    "Calisto MT tu\u010Dn\xE9": {
      "Regular": "CalisMTBol"
    },
    "Calisto MT tu\u010Dn\xE9 kurz\xEDva": {
      "Regular": "CalistoMT-BoldItalic"
    },
    "Calisto MT \u0130talik": {
      "Regular": "CalistoMT-Italic"
    },
    "Calisto MT \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "CalisMTBol"
    },
    "Calisto MT \u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "CalistoMT-BoldItalic"
    },
    "Calisto MT \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "CalistoMT-Italic"
    },
    "Calisto MT \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "CalistoMT-Italic"
    },
    "Calisto MT \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "CalisMTBol"
    },
    "Calisto MT \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "CalistoMT-BoldItalic"
    },
    "Cambria": {
      "Bold": "Cambria-Bold",
      "Bold Italic": "Cambria-BoldItalic",
      "Italic": "Cambria-Italic",
      "Regular": "Cambria"
    },
    "Cambria Bold": {
      "Bold": "Cambria-Bold",
      "Regular": "Cambria-Bold"
    },
    "Cambria Bold Italic": {
      "Bold Italic": "Cambria-BoldItalic",
      "Regular": "Cambria-BoldItalic"
    },
    "Cambria Italic": {
      "Italic": "Cambria-Italic",
      "Regular": "Cambria-Italic"
    },
    "Candara": {
      "Bold": "Candara-Bold",
      "Bold Italic": "Candara-BoldItalic",
      "Italic": "Candara-Italic",
      "Light": "Candara-Light",
      "Light Italic": "Candara-LightItalic",
      "Regular": "Candara"
    },
    "Candara Bold": {
      "Bold": "Candara-Bold",
      "Regular": "Candara-Bold"
    },
    "Candara Bold Italic": {
      "Bold Italic": "Candara-BoldItalic",
      "Regular": "Candara-BoldItalic"
    },
    "Candara Italic": {
      "Italic": "Candara-Italic",
      "Regular": "Candara-Italic"
    },
    "Candara Light": {
      "Italic": "Candara-LightItalic",
      "Light": "Candara-Light",
      "Light Italic": "Candara-LightItalic",
      "Regular": "Candara-Light"
    },
    "Candara Light Italic": {
      "Light Italic": "Candara-LightItalic",
      "Regular": "Candara-LightItalic"
    },
    "Carlito": {
      "Bold": "Carlito-Bold",
      "Bold Italic": "Carlito-BoldItalic",
      "Italic": "Carlito-Italic",
      "Regular": "Carlito"
    },
    "Carlito Bold": {
      "Bold": "Carlito-Bold",
      "Regular": "Carlito-Bold"
    },
    "Carlito Bold Italic": {
      "Bold Italic": "Carlito-BoldItalic",
      "Regular": "Carlito-BoldItalic"
    },
    "Carlito Italic": {
      "Italic": "Carlito-Italic",
      "Regular": "Carlito-Italic"
    },
    "Castellar": {
      "Arrunta": "Castellar",
      "Navadno": "Castellar",
      "Normaali": "Castellar",
      "Normal": "Castellar",
      "Normale": "Castellar",
      "Normalny": "Castellar",
      "Norm\xE1l": "Castellar",
      "Norm\xE1lne": "Castellar",
      "Regular": "Castellar",
      "Standaard": "Castellar",
      "Standard": "Castellar",
      "normal": "Castellar",
      "oby\u010Dejn\xE9": "Castellar",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "Castellar",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "Castellar"
    },
    "Centaur": {
      "Arrunta": "Centaur",
      "Navadno": "Centaur",
      "Normaali": "Centaur",
      "Normal": "Centaur",
      "Normale": "Centaur",
      "Normalny": "Centaur",
      "Norm\xE1l": "Centaur",
      "Norm\xE1lne": "Centaur",
      "Regular": "Centaur",
      "Standaard": "Centaur",
      "Standard": "Centaur",
      "normal": "Centaur",
      "oby\u010Dejn\xE9": "Centaur",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "Centaur",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "Centaur"
    },
    "Century": {
      "Arrunta": "Century",
      "Navadno": "Century",
      "Normaali": "Century",
      "Normal": "Century",
      "Normale": "Century",
      "Normalny": "Century",
      "Norm\xE1l": "Century",
      "Regular": "Century",
      "Standaard": "Century",
      "Standard": "Century",
      "normal": "Century",
      "oby\u010Dejn\xE9": "Century",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "Century",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "Century"
    },
    "Century Gothic": {
      "Arrunta": "CenturyGothic",
      "Bold": "CenturyGothic-Bold",
      "Bold Italic": "CenturyGothic-BoldItalic",
      "Corsivo": "CenturyGothic-Italic",
      "Cursief": "CenturyGothic-Italic",
      "Cursiva": "CenturyGothic-Italic",
      "D\u0151lt": "CenturyGothic-Italic",
      "Etzana": "CenturyGothic-Italic",
      "Fet": "CenturyGothic-Bold",
      "Fet Kursiv": "CenturyGothic-BoldItalic",
      "Fett": "CenturyGothic-Bold",
      "Fett Kursiv": "CenturyGothic-BoldItalic",
      "F\xE9lk\xF6v\xE9r": "CenturyGothic-Bold",
      "F\xE9lk\xF6v\xE9r d\u0151lt": "CenturyGothic-BoldItalic",
      "Gras": "CenturyGothic-Bold",
      "Gras Italique": "CenturyGothic-BoldItalic",
      "Grassetto": "CenturyGothic-Bold",
      "Grassetto Corsivo": "CenturyGothic-BoldItalic",
      "Halvfet": "CenturyGothic-Bold",
      "Halvfet Kursiv": "CenturyGothic-BoldItalic",
      "Italic": "CenturyGothic-Italic",
      "Italique": "CenturyGothic-Italic",
      "It\xE1lico": "CenturyGothic-Italic",
      "Kal\u0131n": "CenturyGothic-Bold",
      "Kal\u0131n \u0130talik": "CenturyGothic-BoldItalic",
      "Krepko": "CenturyGothic-Bold",
      "Krepko po\u0161evno": "CenturyGothic-BoldItalic",
      "Kursiv": "CenturyGothic-Italic",
      "Kursivoitu": "CenturyGothic-Italic",
      "Kursywa": "CenturyGothic-Italic",
      "Kurz\xEDva": "CenturyGothic-Italic",
      "Lihavoitu": "CenturyGothic-Bold",
      "Lihavoitu Kursivoi": "CenturyGothic-BoldItalic",
      "Lodi etzana": "CenturyGothic-BoldItalic",
      "Lodia": "CenturyGothic-Bold",
      "Navadno": "CenturyGothic",
      "Negreta": "CenturyGothic-Bold",
      "Negreta cursiva": "CenturyGothic-BoldItalic",
      "Negrita": "CenturyGothic-Bold",
      "Negrita Cursiva": "CenturyGothic-BoldItalic",
      "Negrito": "CenturyGothic-Bold",
      "Negrito It\xE1lico": "CenturyGothic-BoldItalic",
      "Normaali": "CenturyGothic",
      "Normal": "CenturyGothic",
      "Normale": "CenturyGothic",
      "Normalny": "CenturyGothic",
      "Norm\xE1l": "CenturyGothic",
      "Norm\xE1lne": "CenturyGothic",
      "Pogrubiona kursywa": "CenturyGothic-BoldItalic",
      "Pogrubiony": "CenturyGothic-Bold",
      "Po\u0161evno": "CenturyGothic-Italic",
      "Regular": "CenturyGothic",
      "Standaard": "CenturyGothic",
      "Standard": "CenturyGothic",
      "Tu\u010Dn\xE1 kurz\xEDva": "CenturyGothic-BoldItalic",
      "Tu\u010Dn\xE9": "CenturyGothic-Bold",
      "Vet": "CenturyGothic-Bold",
      "Vet Cursief": "CenturyGothic-BoldItalic",
      "fed": "CenturyGothic-Bold",
      "fed kursiv": "CenturyGothic-BoldItalic",
      "kursiv": "CenturyGothic-Italic",
      "kurz\xEDva": "CenturyGothic-Italic",
      "normal": "CenturyGothic",
      "oby\u010Dejn\xE9": "CenturyGothic",
      "tu\u010Dn\xE9": "CenturyGothic-Bold",
      "tu\u010Dn\xE9 kurz\xEDva": "CenturyGothic-BoldItalic",
      "\u0130talik": "CenturyGothic-Italic",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "CenturyGothic-Bold",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "CenturyGothic-BoldItalic",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "CenturyGothic",
      "\u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "CenturyGothic-Italic",
      "\u041A\u0443\u0440\u0441\u0438\u0432": "CenturyGothic-Italic",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "CenturyGothic",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "CenturyGothic-Bold",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": "CenturyGothic-BoldItalic"
    },
    "Century Gothic Bold": {
      "Bold": "CenturyGothic-Bold",
      "Regular": "CenturyGothic-Bold"
    },
    "Century Gothic Bold Italic": {
      "Bold Italic": "CenturyGothic-BoldItalic",
      "Regular": "CenturyGothic-BoldItalic"
    },
    "Century Gothic Corsivo": {
      "Regular": "CenturyGothic-Italic"
    },
    "Century Gothic Cursief": {
      "Regular": "CenturyGothic-Italic"
    },
    "Century Gothic Cursiva": {
      "Regular": "CenturyGothic-Italic"
    },
    "Century Gothic D\u0151lt": {
      "Regular": "CenturyGothic-Italic"
    },
    "Century Gothic Etzana": {
      "Regular": "CenturyGothic-Italic"
    },
    "Century Gothic Fet": {
      "Regular": "CenturyGothic-Bold"
    },
    "Century Gothic Fet Kursiv": {
      "Regular": "CenturyGothic-BoldItalic"
    },
    "Century Gothic Fett": {
      "Regular": "CenturyGothic-Bold"
    },
    "Century Gothic Fett Kursiv": {
      "Regular": "CenturyGothic-BoldItalic"
    },
    "Century Gothic F\xE9lk\xF6v\xE9r": {
      "Regular": "CenturyGothic-Bold"
    },
    "Century Gothic F\xE9lk\xF6v\xE9r d\u0151lt": {
      "Regular": "CenturyGothic-BoldItalic"
    },
    "Century Gothic Gras": {
      "Regular": "CenturyGothic-Bold"
    },
    "Century Gothic Gras Italique": {
      "Regular": "CenturyGothic-BoldItalic"
    },
    "Century Gothic Grassetto": {
      "Regular": "CenturyGothic-Bold"
    },
    "Century Gothic Grassetto Corsivo": {
      "Regular": "CenturyGothic-BoldItalic"
    },
    "Century Gothic Halvfet": {
      "Regular": "CenturyGothic-Bold"
    },
    "Century Gothic Halvfet Kursiv": {
      "Regular": "CenturyGothic-BoldItalic"
    },
    "Century Gothic Italic": {
      "Italic": "CenturyGothic-Italic",
      "Regular": "CenturyGothic-Italic"
    },
    "Century Gothic Italique": {
      "Regular": "CenturyGothic-Italic"
    },
    "Century Gothic It\xE1lico": {
      "Regular": "CenturyGothic-Italic"
    },
    "Century Gothic Kal\u0131n": {
      "Regular": "CenturyGothic-Bold"
    },
    "Century Gothic Kal\u0131n \u0130talik": {
      "Regular": "CenturyGothic-BoldItalic"
    },
    "Century Gothic Krepko": {
      "Regular": "CenturyGothic-Bold"
    },
    "Century Gothic Krepko po\u0161evno": {
      "Regular": "CenturyGothic-BoldItalic"
    },
    "Century Gothic Kursiv": {
      "Regular": "CenturyGothic-Italic"
    },
    "Century Gothic Kursivoitu": {
      "Regular": "CenturyGothic-Italic"
    },
    "Century Gothic Kursywa": {
      "Regular": "CenturyGothic-Italic"
    },
    "Century Gothic Kurz\xEDva": {
      "Regular": "CenturyGothic-Italic"
    },
    "Century Gothic Lihavoitu": {
      "Regular": "CenturyGothic-Bold"
    },
    "Century Gothic Lihavoitu Kursivoi": {
      "Regular": "CenturyGothic-BoldItalic"
    },
    "Century Gothic Lodi etzana": {
      "Regular": "CenturyGothic-BoldItalic"
    },
    "Century Gothic Lodia": {
      "Regular": "CenturyGothic-Bold"
    },
    "Century Gothic Negreta": {
      "Regular": "CenturyGothic-Bold"
    },
    "Century Gothic Negreta cursiva": {
      "Regular": "CenturyGothic-BoldItalic"
    },
    "Century Gothic Negrita": {
      "Regular": "CenturyGothic-Bold"
    },
    "Century Gothic Negrita Cursiva": {
      "Regular": "CenturyGothic-BoldItalic"
    },
    "Century Gothic Negrito": {
      "Regular": "CenturyGothic-Bold"
    },
    "Century Gothic Negrito It\xE1lico": {
      "Regular": "CenturyGothic-BoldItalic"
    },
    "Century Gothic Pogrubiona kursywa": {
      "Regular": "CenturyGothic-BoldItalic"
    },
    "Century Gothic Pogrubiony": {
      "Regular": "CenturyGothic-Bold"
    },
    "Century Gothic Po\u0161evno": {
      "Regular": "CenturyGothic-Italic"
    },
    "Century Gothic Tu\u010Dn\xE1 kurz\xEDva": {
      "Regular": "CenturyGothic-BoldItalic"
    },
    "Century Gothic Tu\u010Dn\xE9": {
      "Regular": "CenturyGothic-Bold"
    },
    "Century Gothic Vet": {
      "Regular": "CenturyGothic-Bold"
    },
    "Century Gothic Vet Cursief": {
      "Regular": "CenturyGothic-BoldItalic"
    },
    "Century Gothic fed": {
      "Regular": "CenturyGothic-Bold"
    },
    "Century Gothic fed kursiv": {
      "Regular": "CenturyGothic-BoldItalic"
    },
    "Century Gothic kursiv": {
      "Regular": "CenturyGothic-Italic"
    },
    "Century Gothic kurz\xEDva": {
      "Regular": "CenturyGothic-Italic"
    },
    "Century Gothic tu\u010Dn\xE9": {
      "Regular": "CenturyGothic-Bold"
    },
    "Century Gothic tu\u010Dn\xE9 kurz\xEDva": {
      "Regular": "CenturyGothic-BoldItalic"
    },
    "Century Gothic \u0130talik": {
      "Regular": "CenturyGothic-Italic"
    },
    "Century Gothic \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "CenturyGothic-Bold"
    },
    "Century Gothic \u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "CenturyGothic-BoldItalic"
    },
    "Century Gothic \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "CenturyGothic-Italic"
    },
    "Century Gothic \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "CenturyGothic-Italic"
    },
    "Century Gothic \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "CenturyGothic-Bold"
    },
    "Century Gothic \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "CenturyGothic-BoldItalic"
    },
    "Century Schoolbook": {
      "Arrunta": "CenturySchoolbook",
      "Bold": "CenturySchoolbook-Bold",
      "Bold Italic": "CenturySchoolbook-BoldItalic",
      "Corsivo": "CenturySchoolbook-Italic",
      "Cursief": "CenturySchoolbook-Italic",
      "Cursiva": "CenturySchoolbook-Italic",
      "D\u0151lt": "CenturySchoolbook-Italic",
      "Etzana": "CenturySchoolbook-Italic",
      "Fet": "CenturySchoolbook-Bold",
      "Fet Kursiv": "CenturySchoolbook-BoldItalic",
      "Fett": "CenturySchoolbook-Bold",
      "Fett Kursiv": "CenturySchoolbook-BoldItalic",
      "F\xE9lk\xF6v\xE9r": "CenturySchoolbook-Bold",
      "F\xE9lk\xF6v\xE9r d\u0151lt": "CenturySchoolbook-BoldItalic",
      "Gras": "CenturySchoolbook-Bold",
      "Gras Italique": "CenturySchoolbook-BoldItalic",
      "Grassetto": "CenturySchoolbook-Bold",
      "Grassetto Corsivo": "CenturySchoolbook-BoldItalic",
      "Halvfet": "CenturySchoolbook-Bold",
      "Halvfet Kursiv": "CenturySchoolbook-BoldItalic",
      "Italic": "CenturySchoolbook-Italic",
      "Italique": "CenturySchoolbook-Italic",
      "It\xE1lico": "CenturySchoolbook-Italic",
      "Kal\u0131n": "CenturySchoolbook-Bold",
      "Kal\u0131n \u0130talik": "CenturySchoolbook-BoldItalic",
      "Krepko": "CenturySchoolbook-Bold",
      "Krepko po\u0161evno": "CenturySchoolbook-BoldItalic",
      "Kursiv": "CenturySchoolbook-Italic",
      "Kursivoitu": "CenturySchoolbook-Italic",
      "Kursywa": "CenturySchoolbook-Italic",
      "Kurz\xEDva": "CenturySchoolbook-Italic",
      "Lihavoitu": "CenturySchoolbook-Bold",
      "Lihavoitu Kursivoi": "CenturySchoolbook-BoldItalic",
      "Lodi etzana": "CenturySchoolbook-BoldItalic",
      "Lodia": "CenturySchoolbook-Bold",
      "Navadno": "CenturySchoolbook",
      "Negreta": "CenturySchoolbook-Bold",
      "Negreta cursiva": "CenturySchoolbook-BoldItalic",
      "Negrita": "CenturySchoolbook-Bold",
      "Negrita Cursiva": "CenturySchoolbook-BoldItalic",
      "Negrito": "CenturySchoolbook-Bold",
      "Negrito It\xE1lico": "CenturySchoolbook-BoldItalic",
      "Normaali": "CenturySchoolbook",
      "Normal": "CenturySchoolbook",
      "Normale": "CenturySchoolbook",
      "Normalny": "CenturySchoolbook",
      "Norm\xE1l": "CenturySchoolbook",
      "Norm\xE1lne": "CenturySchoolbook",
      "Pogrubiona kursywa": "CenturySchoolbook-BoldItalic",
      "Pogrubiony": "CenturySchoolbook-Bold",
      "Po\u0161evno": "CenturySchoolbook-Italic",
      "Regular": "CenturySchoolbook",
      "Standaard": "CenturySchoolbook",
      "Standard": "CenturySchoolbook",
      "Tu\u010Dn\xE1 kurz\xEDva": "CenturySchoolbook-BoldItalic",
      "Tu\u010Dn\xE9": "CenturySchoolbook-Bold",
      "Vet": "CenturySchoolbook-Bold",
      "Vet Cursief": "CenturySchoolbook-BoldItalic",
      "fed": "CenturySchoolbook-Bold",
      "fed kursiv": "CenturySchoolbook-BoldItalic",
      "kursiv": "CenturySchoolbook-Italic",
      "kurz\xEDva": "CenturySchoolbook-Italic",
      "normal": "CenturySchoolbook",
      "oby\u010Dejn\xE9": "CenturySchoolbook",
      "tu\u010Dn\xE9": "CenturySchoolbook-Bold",
      "tu\u010Dn\xE9 kurz\xEDva": "CenturySchoolbook-BoldItalic",
      "\u0130talik": "CenturySchoolbook-Italic",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "CenturySchoolbook-Bold",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "CenturySchoolbook-BoldItalic",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "CenturySchoolbook",
      "\u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "CenturySchoolbook-Italic",
      "\u041A\u0443\u0440\u0441\u0438\u0432": "CenturySchoolbook-Italic",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "CenturySchoolbook",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "CenturySchoolbook-Bold",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": "CenturySchoolbook-BoldItalic"
    },
    "Century Schoolbook Bold": {
      "Bold": "CenturySchoolbook-Bold",
      "Regular": "CenturySchoolbook-Bold"
    },
    "Century Schoolbook Bold Italic": {
      "Bold Italic": "CenturySchoolbook-BoldItalic",
      "Regular": "CenturySchoolbook-BoldItalic"
    },
    "Century Schoolbook Corsivo": {
      "Regular": "CenturySchoolbook-Italic"
    },
    "Century Schoolbook Cursief": {
      "Regular": "CenturySchoolbook-Italic"
    },
    "Century Schoolbook Cursiva": {
      "Regular": "CenturySchoolbook-Italic"
    },
    "Century Schoolbook D\u0151lt": {
      "Regular": "CenturySchoolbook-Italic"
    },
    "Century Schoolbook Etzana": {
      "Regular": "CenturySchoolbook-Italic"
    },
    "Century Schoolbook Fet": {
      "Regular": "CenturySchoolbook-Bold"
    },
    "Century Schoolbook Fet Kursiv": {
      "Regular": "CenturySchoolbook-BoldItalic"
    },
    "Century Schoolbook Fett": {
      "Regular": "CenturySchoolbook-Bold"
    },
    "Century Schoolbook Fett Kursiv": {
      "Regular": "CenturySchoolbook-BoldItalic"
    },
    "Century Schoolbook F\xE9lk\xF6v\xE9r": {
      "Regular": "CenturySchoolbook-Bold"
    },
    "Century Schoolbook F\xE9lk\xF6v\xE9r d\u0151lt": {
      "Regular": "CenturySchoolbook-BoldItalic"
    },
    "Century Schoolbook Gras": {
      "Regular": "CenturySchoolbook-Bold"
    },
    "Century Schoolbook Gras Italique": {
      "Regular": "CenturySchoolbook-BoldItalic"
    },
    "Century Schoolbook Grassetto": {
      "Regular": "CenturySchoolbook-Bold"
    },
    "Century Schoolbook Grassetto Corsivo": {
      "Regular": "CenturySchoolbook-BoldItalic"
    },
    "Century Schoolbook Halvfet": {
      "Regular": "CenturySchoolbook-Bold"
    },
    "Century Schoolbook Halvfet Kursiv": {
      "Regular": "CenturySchoolbook-BoldItalic"
    },
    "Century Schoolbook Italic": {
      "Italic": "CenturySchoolbook-Italic",
      "Regular": "CenturySchoolbook-Italic"
    },
    "Century Schoolbook Italique": {
      "Regular": "CenturySchoolbook-Italic"
    },
    "Century Schoolbook It\xE1lico": {
      "Regular": "CenturySchoolbook-Italic"
    },
    "Century Schoolbook Kal\u0131n": {
      "Regular": "CenturySchoolbook-Bold"
    },
    "Century Schoolbook Kal\u0131n \u0130talik": {
      "Regular": "CenturySchoolbook-BoldItalic"
    },
    "Century Schoolbook Krepko": {
      "Regular": "CenturySchoolbook-Bold"
    },
    "Century Schoolbook Krepko po\u0161evno": {
      "Regular": "CenturySchoolbook-BoldItalic"
    },
    "Century Schoolbook Kursiv": {
      "Regular": "CenturySchoolbook-Italic"
    },
    "Century Schoolbook Kursivoitu": {
      "Regular": "CenturySchoolbook-Italic"
    },
    "Century Schoolbook Kursywa": {
      "Regular": "CenturySchoolbook-Italic"
    },
    "Century Schoolbook Kurz\xEDva": {
      "Regular": "CenturySchoolbook-Italic"
    },
    "Century Schoolbook Lihavoitu": {
      "Regular": "CenturySchoolbook-Bold"
    },
    "Century Schoolbook Lihavoitu Kursivoi": {
      "Regular": "CenturySchoolbook-BoldItalic"
    },
    "Century Schoolbook Lodi etzana": {
      "Regular": "CenturySchoolbook-BoldItalic"
    },
    "Century Schoolbook Lodia": {
      "Regular": "CenturySchoolbook-Bold"
    },
    "Century Schoolbook Negreta": {
      "Regular": "CenturySchoolbook-Bold"
    },
    "Century Schoolbook Negreta cursiva": {
      "Regular": "CenturySchoolbook-BoldItalic"
    },
    "Century Schoolbook Negrita": {
      "Regular": "CenturySchoolbook-Bold"
    },
    "Century Schoolbook Negrita Cursiva": {
      "Regular": "CenturySchoolbook-BoldItalic"
    },
    "Century Schoolbook Negrito": {
      "Regular": "CenturySchoolbook-Bold"
    },
    "Century Schoolbook Negrito It\xE1lico": {
      "Regular": "CenturySchoolbook-BoldItalic"
    },
    "Century Schoolbook Pogrubiona kursywa": {
      "Regular": "CenturySchoolbook-BoldItalic"
    },
    "Century Schoolbook Pogrubiony": {
      "Regular": "CenturySchoolbook-Bold"
    },
    "Century Schoolbook Po\u0161evno": {
      "Regular": "CenturySchoolbook-Italic"
    },
    "Century Schoolbook Tu\u010Dn\xE1 kurz\xEDva": {
      "Regular": "CenturySchoolbook-BoldItalic"
    },
    "Century Schoolbook Tu\u010Dn\xE9": {
      "Regular": "CenturySchoolbook-Bold"
    },
    "Century Schoolbook Vet": {
      "Regular": "CenturySchoolbook-Bold"
    },
    "Century Schoolbook Vet Cursief": {
      "Regular": "CenturySchoolbook-BoldItalic"
    },
    "Century Schoolbook fed": {
      "Regular": "CenturySchoolbook-Bold"
    },
    "Century Schoolbook fed kursiv": {
      "Regular": "CenturySchoolbook-BoldItalic"
    },
    "Century Schoolbook kursiv": {
      "Regular": "CenturySchoolbook-Italic"
    },
    "Century Schoolbook kurz\xEDva": {
      "Regular": "CenturySchoolbook-Italic"
    },
    "Century Schoolbook tu\u010Dn\xE9": {
      "Regular": "CenturySchoolbook-Bold"
    },
    "Century Schoolbook tu\u010Dn\xE9 kurz\xEDva": {
      "Regular": "CenturySchoolbook-BoldItalic"
    },
    "Century Schoolbook \u0130talik": {
      "Regular": "CenturySchoolbook-Italic"
    },
    "Century Schoolbook \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "CenturySchoolbook-Bold"
    },
    "Century Schoolbook \u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "CenturySchoolbook-BoldItalic"
    },
    "Century Schoolbook \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "CenturySchoolbook-Italic"
    },
    "Century Schoolbook \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "CenturySchoolbook-Italic"
    },
    "Century Schoolbook \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "CenturySchoolbook-Bold"
    },
    "Century Schoolbook \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "CenturySchoolbook-BoldItalic"
    },
    "Chiller": {
      "Arrunta": "Chiller-Regular",
      "Navadno": "Chiller-Regular",
      "Normaali": "Chiller-Regular",
      "Normal": "Chiller-Regular",
      "Normale": "Chiller-Regular",
      "Normalny": "Chiller-Regular",
      "Norm\xE1l": "Chiller-Regular",
      "Norm\xE1lne": "Chiller-Regular",
      "Regular": "Chiller-Regular",
      "Standaard": "Chiller-Regular",
      "Standard": "Chiller-Regular",
      "normal": "Chiller-Regular",
      "oby\u010Dejn\xE9": "Chiller-Regular",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "Chiller-Regular",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "Chiller-Regular"
    },
    "Colonna MT": {
      "Arrunta": "ColonnaMT",
      "Navadno": "ColonnaMT",
      "Normaali": "ColonnaMT",
      "Normal": "ColonnaMT",
      "Normale": "ColonnaMT",
      "Normalny": "ColonnaMT",
      "Norm\xE1l": "ColonnaMT",
      "Norm\xE1lne": "ColonnaMT",
      "Regular": "ColonnaMT",
      "Standaard": "ColonnaMT",
      "Standard": "ColonnaMT",
      "normal": "ColonnaMT",
      "oby\u010Dejn\xE9": "ColonnaMT",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "ColonnaMT",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "ColonnaMT"
    },
    "Comic Sans MS": {
      "Arrunta": "ComicSansMS",
      "Bold": "ComicSansMS-Bold",
      "Bold Italic": "ComicSansMS-BoldItalic",
      "Corsivo": "ComicSansMS-Italic",
      "Cursief": "ComicSansMS-Italic",
      "Cursiva": "ComicSansMS-Italic",
      "D\u0151lt": "ComicSansMS-Italic",
      "Etzana": "ComicSansMS-Italic",
      "Fet": "ComicSansMS-Bold",
      "Fet Kursiv": "ComicSansMS-BoldItalic",
      "Fett": "ComicSansMS-Bold",
      "Fett Kursiv": "ComicSansMS-BoldItalic",
      "F\xE9lk\xF6v\xE9r": "ComicSansMS-Bold",
      "F\xE9lk\xF6v\xE9r d\u0151lt": "ComicSansMS-BoldItalic",
      "Gras": "ComicSansMS-Bold",
      "Gras Italique": "ComicSansMS-BoldItalic",
      "Grassetto": "ComicSansMS-Bold",
      "Grassetto Corsivo": "ComicSansMS-BoldItalic",
      "Halvfet": "ComicSansMS-Bold",
      "Halvfet Kursiv": "ComicSansMS-BoldItalic",
      "Italic": "ComicSansMS-Italic",
      "Italique": "ComicSansMS-Italic",
      "It\xE1lico": "ComicSansMS-Italic",
      "Kal\u0131n": "ComicSansMS-Bold",
      "Kal\u0131n \u0130talik": "ComicSansMS-BoldItalic",
      "Krepko": "ComicSansMS-Bold",
      "Krepko po\u0161evno": "ComicSansMS-BoldItalic",
      "Kursiv": "ComicSansMS-Italic",
      "Kursivoitu": "ComicSansMS-Italic",
      "Kursywa": "ComicSansMS-Italic",
      "Kurz\xEDva": "ComicSansMS-Italic",
      "Lihavoitu": "ComicSansMS-Bold",
      "Lihavoitu Kursivoi": "ComicSansMS-BoldItalic",
      "Lodi etzana": "ComicSansMS-BoldItalic",
      "Lodia": "ComicSansMS-Bold",
      "Navadno": "ComicSansMS",
      "Negreta": "ComicSansMS-Bold",
      "Negreta cursiva": "ComicSansMS-BoldItalic",
      "Negrita": "ComicSansMS-Bold",
      "Negrita Cursiva": "ComicSansMS-BoldItalic",
      "Negrito": "ComicSansMS-Bold",
      "Negrito It\xE1lico": "ComicSansMS-BoldItalic",
      "Normaali": "ComicSansMS",
      "Normal": "ComicSansMS",
      "Normale": "ComicSansMS",
      "Normalny": "ComicSansMS",
      "Norm\xE1l": "ComicSansMS",
      "Norm\xE1lne": "ComicSansMS",
      "Pogrubiona kursywa": "ComicSansMS-BoldItalic",
      "Pogrubiony": "ComicSansMS-Bold",
      "Po\u0161evno": "ComicSansMS-Italic",
      "Regular": "ComicSansMS",
      "Standaard": "ComicSansMS",
      "Standard": "ComicSansMS",
      "Tu\u010Dn\xE1 kurz\xEDva": "ComicSansMS-BoldItalic",
      "Tu\u010Dn\xE9": "ComicSansMS-Bold",
      "Vet": "ComicSansMS-Bold",
      "Vet Cursief": "ComicSansMS-BoldItalic",
      "fed": "ComicSansMS-Bold",
      "fed kursiv": "ComicSansMS-BoldItalic",
      "kursiv": "ComicSansMS-Italic",
      "kurz\xEDva": "ComicSansMS-Italic",
      "normal": "ComicSansMS",
      "oby\u010Dejn\xE9": "ComicSansMS",
      "tu\u010Dn\xE9": "ComicSansMS-Bold",
      "tu\u010Dn\xE9 kurz\xEDva": "ComicSansMS-BoldItalic",
      "\u0130talik": "ComicSansMS-Italic",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "ComicSansMS-Bold",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "ComicSansMS-BoldItalic",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "ComicSansMS",
      "\u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "ComicSansMS-Italic",
      "\u041A\u0443\u0440\u0441\u0438\u0432": "ComicSansMS-Italic",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "ComicSansMS",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "ComicSansMS-Bold",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": "ComicSansMS-BoldItalic"
    },
    "Comic Sans MS Bold": {
      "Bold": "ComicSansMS-Bold",
      "Regular": "ComicSansMS-Bold"
    },
    "Comic Sans MS Bold Italic": {
      "Bold Italic": "ComicSansMS-BoldItalic",
      "Regular": "ComicSansMS-BoldItalic"
    },
    "Comic Sans MS Corsivo": {
      "Regular": "ComicSansMS-Italic"
    },
    "Comic Sans MS Cursief": {
      "Regular": "ComicSansMS-Italic"
    },
    "Comic Sans MS Cursiva": {
      "Regular": "ComicSansMS-Italic"
    },
    "Comic Sans MS D\u0151lt": {
      "Regular": "ComicSansMS-Italic"
    },
    "Comic Sans MS Etzana": {
      "Regular": "ComicSansMS-Italic"
    },
    "Comic Sans MS Fet": {
      "Regular": "ComicSansMS-Bold"
    },
    "Comic Sans MS Fet Kursiv": {
      "Regular": "ComicSansMS-BoldItalic"
    },
    "Comic Sans MS Fett": {
      "Regular": "ComicSansMS-Bold"
    },
    "Comic Sans MS Fett Kursiv": {
      "Regular": "ComicSansMS-BoldItalic"
    },
    "Comic Sans MS F\xE9lk\xF6v\xE9r": {
      "Regular": "ComicSansMS-Bold"
    },
    "Comic Sans MS F\xE9lk\xF6v\xE9r d\u0151lt": {
      "Regular": "ComicSansMS-BoldItalic"
    },
    "Comic Sans MS Gras": {
      "Regular": "ComicSansMS-Bold"
    },
    "Comic Sans MS Gras Italique": {
      "Regular": "ComicSansMS-BoldItalic"
    },
    "Comic Sans MS Grassetto": {
      "Regular": "ComicSansMS-Bold"
    },
    "Comic Sans MS Grassetto Corsivo": {
      "Regular": "ComicSansMS-BoldItalic"
    },
    "Comic Sans MS Halvfet": {
      "Regular": "ComicSansMS-Bold"
    },
    "Comic Sans MS Halvfet Kursiv": {
      "Regular": "ComicSansMS-BoldItalic"
    },
    "Comic Sans MS Italic": {
      "Italic": "ComicSansMS-Italic",
      "Regular": "ComicSansMS-Italic"
    },
    "Comic Sans MS Italique": {
      "Regular": "ComicSansMS-Italic"
    },
    "Comic Sans MS It\xE1lico": {
      "Regular": "ComicSansMS-Italic"
    },
    "Comic Sans MS Kal\u0131n": {
      "Regular": "ComicSansMS-Bold"
    },
    "Comic Sans MS Kal\u0131n \u0130talik": {
      "Regular": "ComicSansMS-BoldItalic"
    },
    "Comic Sans MS Krepko": {
      "Regular": "ComicSansMS-Bold"
    },
    "Comic Sans MS Krepko po\u0161evno": {
      "Regular": "ComicSansMS-BoldItalic"
    },
    "Comic Sans MS Kursiv": {
      "Regular": "ComicSansMS-Italic"
    },
    "Comic Sans MS Kursivoitu": {
      "Regular": "ComicSansMS-Italic"
    },
    "Comic Sans MS Kursywa": {
      "Regular": "ComicSansMS-Italic"
    },
    "Comic Sans MS Kurz\xEDva": {
      "Regular": "ComicSansMS-Italic"
    },
    "Comic Sans MS Lihavoitu": {
      "Regular": "ComicSansMS-Bold"
    },
    "Comic Sans MS Lihavoitu Kursivoi": {
      "Regular": "ComicSansMS-BoldItalic"
    },
    "Comic Sans MS Lodi etzana": {
      "Regular": "ComicSansMS-BoldItalic"
    },
    "Comic Sans MS Lodia": {
      "Regular": "ComicSansMS-Bold"
    },
    "Comic Sans MS Negreta": {
      "Regular": "ComicSansMS-Bold"
    },
    "Comic Sans MS Negreta cursiva": {
      "Regular": "ComicSansMS-BoldItalic"
    },
    "Comic Sans MS Negrita": {
      "Regular": "ComicSansMS-Bold"
    },
    "Comic Sans MS Negrita Cursiva": {
      "Regular": "ComicSansMS-BoldItalic"
    },
    "Comic Sans MS Negrito": {
      "Regular": "ComicSansMS-Bold"
    },
    "Comic Sans MS Negrito It\xE1lico": {
      "Regular": "ComicSansMS-BoldItalic"
    },
    "Comic Sans MS Pogrubiona kursywa": {
      "Regular": "ComicSansMS-BoldItalic"
    },
    "Comic Sans MS Pogrubiony": {
      "Regular": "ComicSansMS-Bold"
    },
    "Comic Sans MS Po\u0161evno": {
      "Regular": "ComicSansMS-Italic"
    },
    "Comic Sans MS Tu\u010Dn\xE1 kurz\xEDva": {
      "Regular": "ComicSansMS-BoldItalic"
    },
    "Comic Sans MS Tu\u010Dn\xE9": {
      "Regular": "ComicSansMS-Bold"
    },
    "Comic Sans MS Vet": {
      "Regular": "ComicSansMS-Bold"
    },
    "Comic Sans MS Vet Cursief": {
      "Regular": "ComicSansMS-BoldItalic"
    },
    "Comic Sans MS fed": {
      "Regular": "ComicSansMS-Bold"
    },
    "Comic Sans MS fed kursiv": {
      "Regular": "ComicSansMS-BoldItalic"
    },
    "Comic Sans MS kursiv": {
      "Regular": "ComicSansMS-Italic"
    },
    "Comic Sans MS kurz\xEDva": {
      "Regular": "ComicSansMS-Italic"
    },
    "Comic Sans MS nghi\xEAng": {
      "Regular": "ComicSansMS-Italic"
    },
    "Comic Sans MS nghi\xEAng \u0111\xE2\u0323m": {
      "Regular": "ComicSansMS-BoldItalic"
    },
    "Comic Sans MS tu\u010Dn\xE9": {
      "Regular": "ComicSansMS-Bold"
    },
    "Comic Sans MS tu\u010Dn\xE9 kurz\xEDva": {
      "Regular": "ComicSansMS-BoldItalic"
    },
    "Comic Sans MS \u0130talik": {
      "Regular": "ComicSansMS-Italic"
    },
    "Comic Sans MS \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "ComicSansMS-Bold"
    },
    "Comic Sans MS \u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "ComicSansMS-BoldItalic"
    },
    "Comic Sans MS \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "ComicSansMS-Italic"
    },
    "Comic Sans MS \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "ComicSansMS-Italic"
    },
    "Comic Sans MS \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "ComicSansMS-Bold"
    },
    "Comic Sans MS \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "ComicSansMS-BoldItalic"
    },
    "Consolas": {
      "Bold": "Consolas-Bold",
      "Bold Italic": "Consolas-BoldItalic",
      "Italic": "Consolas-Italic",
      "Regular": "Consolas"
    },
    "Consolas Bold": {
      "Bold": "Consolas-Bold",
      "Regular": "Consolas-Bold"
    },
    "Consolas Bold Italic": {
      "Bold Italic": "Consolas-BoldItalic",
      "Regular": "Consolas-BoldItalic"
    },
    "Consolas Italic": {
      "Italic": "Consolas-Italic",
      "Regular": "Consolas-Italic"
    },
    "Constantia": {
      "Bold": "Constantia-Bold",
      "Bold Italic": "Constantia-BoldItalic",
      "Italic": "Constantia-Italic",
      "Regular": "Constantia"
    },
    "Constantia Bold": {
      "Bold": "Constantia-Bold",
      "Regular": "Constantia-Bold"
    },
    "Constantia Bold Italic": {
      "Bold Italic": "Constantia-BoldItalic",
      "Regular": "Constantia-BoldItalic"
    },
    "Constantia Italic": {
      "Italic": "Constantia-Italic",
      "Regular": "Constantia-Italic"
    },
    "Cooper": {
      "Regular": "CooperBlack"
    },
    "Cooper Black": {
      "Arrunta": "CooperBlack",
      "Navadno": "CooperBlack",
      "Normaali": "CooperBlack",
      "Normal": "CooperBlack",
      "Normale": "CooperBlack",
      "Normalny": "CooperBlack",
      "Norm\xE1l": "CooperBlack",
      "Norm\xE1lne": "CooperBlack",
      "Regular": "CooperBlack",
      "Standaard": "CooperBlack",
      "Standard": "CooperBlack",
      "normal": "CooperBlack",
      "oby\u010Dejn\xE9": "CooperBlack",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "CooperBlack",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "CooperBlack"
    },
    "Copperplate Gothic": {
      "Regular": "CopperplateGothic-Light"
    },
    "Copperplate Gothic Bold": {
      "Arrunta": "CopperplateGothic-Bold",
      "Navadno": "CopperplateGothic-Bold",
      "Normaali": "CopperplateGothic-Bold",
      "Normal": "CopperplateGothic-Bold",
      "Normale": "CopperplateGothic-Bold",
      "Normalny": "CopperplateGothic-Bold",
      "Norm\xE1l": "CopperplateGothic-Bold",
      "Norm\xE1lne": "CopperplateGothic-Bold",
      "Regular": "CopperplateGothic-Bold",
      "Standaard": "CopperplateGothic-Bold",
      "Standard": "CopperplateGothic-Bold",
      "normal": "CopperplateGothic-Bold",
      "oby\u010Dejn\xE9": "CopperplateGothic-Bold",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "CopperplateGothic-Bold",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "CopperplateGothic-Bold"
    },
    "Copperplate Gothic Light": {
      "Arrunta": "CopperplateGothic-Light",
      "Navadno": "CopperplateGothic-Light",
      "Normaali": "CopperplateGothic-Light",
      "Normal": "CopperplateGothic-Light",
      "Normale": "CopperplateGothic-Light",
      "Normalny": "CopperplateGothic-Light",
      "Norm\xE1l": "CopperplateGothic-Light",
      "Norm\xE1lne": "CopperplateGothic-Light",
      "Regular": "CopperplateGothic-Light",
      "Standaard": "CopperplateGothic-Light",
      "Standard": "CopperplateGothic-Light",
      "normal": "CopperplateGothic-Light",
      "oby\u010Dejn\xE9": "CopperplateGothic-Light",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "CopperplateGothic-Light",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "CopperplateGothic-Light"
    },
    "Corbel": {
      "Bold": "Corbel-Bold",
      "Bold Italic": "Corbel-BoldItalic",
      "Italic": "Corbel-Italic",
      "Light": "CorbelLight",
      "Light Italic": "CorbelLight-Italic",
      "Regular": "Corbel"
    },
    "Corbel Bold": {
      "Bold": "Corbel-Bold",
      "Regular": "Corbel-Bold"
    },
    "Corbel Bold Italic": {
      "Bold Italic": "Corbel-BoldItalic",
      "Regular": "Corbel-BoldItalic"
    },
    "Corbel Italic": {
      "Italic": "Corbel-Italic",
      "Regular": "Corbel-Italic"
    },
    "Corbel Light": {
      "Italic": "CorbelLight-Italic",
      "Light": "CorbelLight",
      "Regular": "CorbelLight"
    },
    "Corbel Light Italic": {
      "Light Italic": "CorbelLight-Italic",
      "Regular": "CorbelLight-Italic"
    },
    "Courier New": {
      "Arrunta": "CourierNewPSMT",
      "Bold": "CourierNewPS-BoldMT",
      "Bold Italic": "CourierNewPS-BoldItalicMT",
      "Corsivo": "CourierNewPS-ItalicMT",
      "Cursief": "CourierNewPS-ItalicMT",
      "Cursiva": "CourierNewPS-ItalicMT",
      "D\u0151lt": "CourierNewPS-ItalicMT",
      "Etzana": "CourierNewPS-ItalicMT",
      "Fet": "CourierNewPS-BoldMT",
      "Fet Kursiv": "CourierNewPS-BoldItalicMT",
      "Fett": "CourierNewPS-BoldMT",
      "Fett Kursiv": "CourierNewPS-BoldItalicMT",
      "F\xE9lk\xF6v\xE9r": "CourierNewPS-BoldMT",
      "F\xE9lk\xF6v\xE9r d\u0151lt": "CourierNewPS-BoldItalicMT",
      "Gras": "CourierNewPS-BoldMT",
      "Gras Italique": "CourierNewPS-BoldItalicMT",
      "Grassetto": "CourierNewPS-BoldMT",
      "Grassetto Corsivo": "CourierNewPS-BoldItalicMT",
      "Halvfet": "CourierNewPS-BoldMT",
      "Halvfet Kursiv": "CourierNewPS-BoldItalicMT",
      "Italic": "CourierNewPS-ItalicMT",
      "Italique": "CourierNewPS-ItalicMT",
      "It\xE1lico": "CourierNewPS-ItalicMT",
      "Kal\u0131n": "CourierNewPS-BoldMT",
      "Kal\u0131n \u0130talik": "CourierNewPS-BoldItalicMT",
      "Krepko": "CourierNewPS-BoldMT",
      "Krepko po\u0161evno": "CourierNewPS-BoldItalicMT",
      "Kursiv": "CourierNewPS-ItalicMT",
      "Kursivoitu": "CourierNewPS-ItalicMT",
      "Kursywa": "CourierNewPS-ItalicMT",
      "Kurz\xEDva": "CourierNewPS-ItalicMT",
      "Lihavoitu": "CourierNewPS-BoldMT",
      "Lihavoitu Kursivoi": "CourierNewPS-BoldItalicMT",
      "Lodi etzana": "CourierNewPS-BoldItalicMT",
      "Lodia": "CourierNewPS-BoldMT",
      "Navadno": "CourierNewPSMT",
      "Negreta": "CourierNewPS-BoldMT",
      "Negreta cursiva": "CourierNewPS-BoldItalicMT",
      "Negrita": "CourierNewPS-BoldMT",
      "Negrita Cursiva": "CourierNewPS-BoldItalicMT",
      "Negrito": "CourierNewPS-BoldMT",
      "Negrito It\xE1lico": "CourierNewPS-BoldItalicMT",
      "Normaali": "CourierNewPSMT",
      "Normal": "CourierNewPSMT",
      "Normale": "CourierNewPSMT",
      "Normalny": "CourierNewPSMT",
      "Norm\xE1l": "CourierNewPSMT",
      "Norm\xE1lne": "CourierNewPSMT",
      "Pogrubiona kursywa": "CourierNewPS-BoldItalicMT",
      "Pogrubiony": "CourierNewPS-BoldMT",
      "Po\u0161evno": "CourierNewPS-ItalicMT",
      "Regular": "CourierNewPSMT",
      "Standaard": "CourierNewPSMT",
      "Standard": "CourierNewPSMT",
      "Tu\u010Dn\xE1 kurz\xEDva": "CourierNewPS-BoldItalicMT",
      "Tu\u010Dn\xE9": "CourierNewPS-BoldMT",
      "Vet": "CourierNewPS-BoldMT",
      "Vet Cursief": "CourierNewPS-BoldItalicMT",
      "fed": "CourierNewPS-BoldMT",
      "fed kursiv": "CourierNewPS-BoldItalicMT",
      "kursiv": "CourierNewPS-ItalicMT",
      "kurz\xEDva": "CourierNewPS-ItalicMT",
      "nghi\xEAng": "CourierNewPS-ItalicMT",
      "normal": "CourierNewPSMT",
      "oby\u010Dejn\xE9": "CourierNewPSMT",
      "th\u01B0\u01A1\u0300ng": "CourierNewPSMT",
      "tu\u010Dn\xE9": "CourierNewPS-BoldMT",
      "tu\u010Dn\xE9 kurz\xEDva": "CourierNewPS-BoldItalicMT",
      "\u0111\xE2\u0323m": "CourierNewPS-BoldMT",
      "\u0111\xE2\u0323m nghi\xEAng": "CourierNewPS-BoldItalicMT",
      "\u0130talik": "CourierNewPS-ItalicMT",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "CourierNewPS-BoldMT",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "CourierNewPS-BoldItalicMT",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "CourierNewPSMT",
      "\u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "CourierNewPS-ItalicMT",
      "\u041A\u0443\u0440\u0441\u0438\u0432": "CourierNewPS-ItalicMT",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "CourierNewPSMT",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "CourierNewPS-BoldMT",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": "CourierNewPS-BoldItalicMT"
    },
    "Courier New Bold": {
      "Bold": "CourierNewPS-BoldMT",
      "Regular": "CourierNewPS-BoldMT"
    },
    "Courier New Bold Italic": {
      "Bold Italic": "CourierNewPS-BoldItalicMT",
      "Regular": "CourierNewPS-BoldItalicMT"
    },
    "Courier New Corsivo": {
      "Regular": "CourierNewPS-ItalicMT"
    },
    "Courier New Cursief": {
      "Regular": "CourierNewPS-ItalicMT"
    },
    "Courier New Cursiva": {
      "Regular": "CourierNewPS-ItalicMT"
    },
    "Courier New D\u0151lt": {
      "Regular": "CourierNewPS-ItalicMT"
    },
    "Courier New Etzana": {
      "Regular": "CourierNewPS-ItalicMT"
    },
    "Courier New Fet": {
      "Regular": "CourierNewPS-BoldMT"
    },
    "Courier New Fet Kursiv": {
      "Regular": "CourierNewPS-BoldItalicMT"
    },
    "Courier New Fett": {
      "Regular": "CourierNewPS-BoldMT"
    },
    "Courier New Fett Kursiv": {
      "Regular": "CourierNewPS-BoldItalicMT"
    },
    "Courier New F\xE9lk\xF6v\xE9r": {
      "Regular": "CourierNewPS-BoldMT"
    },
    "Courier New F\xE9lk\xF6v\xE9r d\u0151lt": {
      "Regular": "CourierNewPS-BoldItalicMT"
    },
    "Courier New Gras": {
      "Regular": "CourierNewPS-BoldMT"
    },
    "Courier New Gras Italique": {
      "Regular": "CourierNewPS-BoldItalicMT"
    },
    "Courier New Grassetto": {
      "Regular": "CourierNewPS-BoldMT"
    },
    "Courier New Grassetto Corsivo": {
      "Regular": "CourierNewPS-BoldItalicMT"
    },
    "Courier New Halvfet": {
      "Regular": "CourierNewPS-BoldMT"
    },
    "Courier New Halvfet Kursiv": {
      "Regular": "CourierNewPS-BoldItalicMT"
    },
    "Courier New Italic": {
      "Italic": "CourierNewPS-ItalicMT",
      "Regular": "CourierNewPS-ItalicMT"
    },
    "Courier New Italique": {
      "Regular": "CourierNewPS-ItalicMT"
    },
    "Courier New It\xE1lico": {
      "Regular": "CourierNewPS-ItalicMT"
    },
    "Courier New Kal\u0131n": {
      "Regular": "CourierNewPS-BoldMT"
    },
    "Courier New Kal\u0131n \u0130talik": {
      "Regular": "CourierNewPS-BoldItalicMT"
    },
    "Courier New Krepko": {
      "Regular": "CourierNewPS-BoldMT"
    },
    "Courier New Krepko po\u0161evno": {
      "Regular": "CourierNewPS-BoldItalicMT"
    },
    "Courier New Kursiv": {
      "Regular": "CourierNewPS-ItalicMT"
    },
    "Courier New Kursivoitu": {
      "Regular": "CourierNewPS-ItalicMT"
    },
    "Courier New Kursywa": {
      "Regular": "CourierNewPS-ItalicMT"
    },
    "Courier New Kurz\xEDva": {
      "Regular": "CourierNewPS-ItalicMT"
    },
    "Courier New Lihavoitu": {
      "Regular": "CourierNewPS-BoldMT"
    },
    "Courier New Lihavoitu Kursivoi": {
      "Regular": "CourierNewPS-BoldItalicMT"
    },
    "Courier New Lodi etzana": {
      "Regular": "CourierNewPS-BoldItalicMT"
    },
    "Courier New Lodia": {
      "Regular": "CourierNewPS-BoldMT"
    },
    "Courier New Negreta": {
      "Regular": "CourierNewPS-BoldMT"
    },
    "Courier New Negreta cursiva": {
      "Regular": "CourierNewPS-BoldItalicMT"
    },
    "Courier New Negrita": {
      "Regular": "CourierNewPS-BoldMT"
    },
    "Courier New Negrita Cursiva": {
      "Regular": "CourierNewPS-BoldItalicMT"
    },
    "Courier New Negrito": {
      "Regular": "CourierNewPS-BoldMT"
    },
    "Courier New Negrito It\xE1lico": {
      "Regular": "CourierNewPS-BoldItalicMT"
    },
    "Courier New Pogrubiona kursywa": {
      "Regular": "CourierNewPS-BoldItalicMT"
    },
    "Courier New Pogrubiony": {
      "Regular": "CourierNewPS-BoldMT"
    },
    "Courier New Po\u0161evno": {
      "Regular": "CourierNewPS-ItalicMT"
    },
    "Courier New Tu\u010Dn\xE1 kurz\xEDva": {
      "Regular": "CourierNewPS-BoldItalicMT"
    },
    "Courier New Tu\u010Dn\xE9": {
      "Regular": "CourierNewPS-BoldMT"
    },
    "Courier New Vet": {
      "Regular": "CourierNewPS-BoldMT"
    },
    "Courier New Vet Cursief": {
      "Regular": "CourierNewPS-BoldItalicMT"
    },
    "Courier New fed": {
      "Regular": "CourierNewPS-BoldMT"
    },
    "Courier New fed kursiv": {
      "Regular": "CourierNewPS-BoldItalicMT"
    },
    "Courier New kursiv": {
      "Regular": "CourierNewPS-ItalicMT"
    },
    "Courier New kurz\xEDva": {
      "Regular": "CourierNewPS-ItalicMT"
    },
    "Courier New nghi\xEAng": {
      "Regular": "CourierNewPS-ItalicMT"
    },
    "Courier New tu\u010Dn\xE9": {
      "Regular": "CourierNewPS-BoldMT"
    },
    "Courier New tu\u010Dn\xE9 kurz\xEDva": {
      "Regular": "CourierNewPS-BoldItalicMT"
    },
    "Courier New \u0111\xE2\u0323m": {
      "Regular": "CourierNewPS-BoldMT"
    },
    "Courier New \u0111\xE2\u0323m nghi\xEAng": {
      "Regular": "CourierNewPS-BoldItalicMT"
    },
    "Courier New \u0130talik": {
      "Regular": "CourierNewPS-ItalicMT"
    },
    "Courier New \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "CourierNewPS-BoldMT"
    },
    "Courier New \u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "CourierNewPS-BoldItalicMT"
    },
    "Courier New \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "CourierNewPS-ItalicMT"
    },
    "Courier New \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "CourierNewPS-ItalicMT"
    },
    "Courier New \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "CourierNewPS-BoldMT"
    },
    "Courier New \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "CourierNewPS-BoldItalicMT"
    },
    "Curlz MT": {
      "Arrunta": "CurlzMT",
      "Navadno": "CurlzMT",
      "Normaali": "CurlzMT",
      "Normal": "CurlzMT",
      "Normale": "CurlzMT",
      "Normalny": "CurlzMT",
      "Norm\xE1l": "CurlzMT",
      "Norm\xE1lne": "CurlzMT",
      "Regular": "CurlzMT",
      "Standaard": "CurlzMT",
      "Standard": "CurlzMT",
      "normal": "CurlzMT",
      "oby\u010Dejn\xE9": "CurlzMT",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "CurlzMT",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "CurlzMT"
    },
    "DINPro": {
      "Black": "DINPro-Black",
      "Light": "DINPro-Light",
      "Medium": "DINPro-Medium",
      "Regular": "DINPro-Regular"
    },
    "DINPro-Black": {
      "Black": "DINPro-Black",
      "Regular": "DINPro-Black"
    },
    "DINPro-Light": {
      "Light": "DINPro-Light",
      "Regular": "DINPro-Light"
    },
    "DINPro-Medium": {
      "Medium": "DINPro-Medium",
      "Regular": "DINPro-Medium"
    },
    "DINPro-Regular": {
      "Regular": "DINPro-Regular"
    },
    "David CLM": {
      "Bold": "DavidCLM-Bold",
      "BoldItalic": "DavidCLM-BoldItalic",
      "Medium": "DavidCLM-Medium",
      "MediumItalic": "DavidCLM-MediumItalic"
    },
    "David CLM Bold": {
      "Bold": "DavidCLM-Bold",
      "Regular": "DavidCLM-Bold"
    },
    "David CLM Bold Italic": {
      "BoldItalic": "DavidCLM-BoldItalic",
      "Regular": "DavidCLM-BoldItalic"
    },
    "David CLM Medium": {
      "Medium": "DavidCLM-Medium",
      "Regular": "DavidCLM-Medium"
    },
    "David CLM Medium Italic": {
      "MediumItalic": "DavidCLM-MediumItalic",
      "Regular": "DavidCLM-MediumItalic"
    },
    "David Libre": {
      "Bold": "DavidLibre-Bold",
      "Regular": "DavidLibre-Regular"
    },
    "David Libre Bold": {
      "Bold": "DavidLibre-Bold",
      "Regular": "DavidLibre-Bold"
    },
    "David Libre Regular": {
      "Regular": "DavidLibre-Regular"
    },
    "DejaVu Math TeX Gyre": {
      "Regular": "DejaVuMathTeXGyre-Regular"
    },
    "DejaVu Sans": {
      "Bold": "DejaVuSans-Bold",
      "Bold Oblique": "DejaVuSans-BoldOblique",
      "Book": "DejaVuSans",
      "Condensed": "DejaVuSansCondensed",
      "Condensed Bold": "DejaVuSansCondensed-Bold",
      "Condensed Bold Oblique": "DejaVuSansCondensed-BoldOblique",
      "Condensed Oblique": "DejaVuSansCondensed-Oblique",
      "ExtraLight": "DejaVuSans-ExtraLight",
      "Oblique": "DejaVuSans-Oblique",
      "Regular": "DejaVuSans"
    },
    "DejaVu Sans Bold": {
      "Bold": "DejaVuSans-Bold",
      "Bold Oblique": "DejaVuSans-BoldOblique",
      "Regular": "DejaVuSans-Bold"
    },
    "DejaVu Sans Bold Oblique": {
      "Bold Oblique": "DejaVuSans-BoldOblique",
      "Regular": "DejaVuSans-BoldOblique"
    },
    "DejaVu Sans Condensed": {
      "Bold": "DejaVuSansCondensed-Bold",
      "Bold Oblique": "DejaVuSansCondensed-BoldOblique",
      "Book": "DejaVuSansCondensed",
      "Condensed": "DejaVuSansCondensed",
      "Oblique": "DejaVuSansCondensed-Oblique",
      "Regular": "DejaVuSansCondensed"
    },
    "DejaVu Sans Condensed Bold": {
      "Condensed Bold": "DejaVuSansCondensed-Bold",
      "Condensed Bold Oblique": "DejaVuSansCondensed-BoldOblique",
      "Regular": "DejaVuSansCondensed-Bold"
    },
    "DejaVu Sans Condensed Bold Oblique": {
      "Condensed Bold Oblique": "DejaVuSansCondensed-BoldOblique",
      "Regular": "DejaVuSansCondensed-BoldOblique"
    },
    "DejaVu Sans Condensed Oblique": {
      "Condensed Oblique": "DejaVuSansCondensed-Oblique",
      "Regular": "DejaVuSansCondensed-Oblique"
    },
    "DejaVu Sans ExtraLight": {
      "ExtraLight": "DejaVuSans-ExtraLight",
      "Regular": "DejaVuSans-ExtraLight"
    },
    "DejaVu Sans Light": {
      "ExtraLight": "DejaVuSans-ExtraLight"
    },
    "DejaVu Sans Mono": {
      "Bold": "DejaVuSansMono-Bold",
      "Bold Oblique": "DejaVuSansMono-BoldOblique",
      "Book": "DejaVuSansMono",
      "Oblique": "DejaVuSansMono-Oblique",
      "Regular": "DejaVuSansMono"
    },
    "DejaVu Sans Mono Bold": {
      "Bold": "DejaVuSansMono-Bold",
      "Bold Oblique": "DejaVuSansMono-BoldOblique",
      "Regular": "DejaVuSansMono-Bold"
    },
    "DejaVu Sans Mono Bold Oblique": {
      "Bold Oblique": "DejaVuSansMono-BoldOblique",
      "Regular": "DejaVuSansMono-BoldOblique"
    },
    "DejaVu Sans Mono Oblique": {
      "Oblique": "DejaVuSansMono-Oblique",
      "Regular": "DejaVuSansMono-Oblique"
    },
    "DejaVu Sans Oblique": {
      "Oblique": "DejaVuSans-Oblique",
      "Regular": "DejaVuSans-Oblique"
    },
    "DejaVu Serif": {
      "Bold": "DejaVuSerif-Bold",
      "Bold Italic": "DejaVuSerif-BoldItalic",
      "Book": "DejaVuSerif",
      "Condensed": "DejaVuSerifCondensed",
      "Condensed Bold": "DejaVuSerifCondensed-Bold",
      "Condensed Bold Italic": "DejaVuSerifCondensed-BoldItalic",
      "Condensed Italic": "DejaVuSerifCondensed-Italic",
      "Italic": "DejaVuSerif-Italic",
      "Regular": "DejaVuSerif"
    },
    "DejaVu Serif Bold": {
      "Bold": "DejaVuSerif-Bold",
      "Regular": "DejaVuSerif-Bold"
    },
    "DejaVu Serif Bold Italic": {
      "Bold Italic": "DejaVuSerif-BoldItalic",
      "Regular": "DejaVuSerif-BoldItalic"
    },
    "DejaVu Serif Condensed": {
      "Bold": "DejaVuSerifCondensed-Bold",
      "Bold Italic": "DejaVuSerifCondensed-BoldItalic",
      "Book": "DejaVuSerifCondensed",
      "Condensed": "DejaVuSerifCondensed",
      "Italic": "DejaVuSerifCondensed-Italic",
      "Regular": "DejaVuSerifCondensed"
    },
    "DejaVu Serif Condensed Bold": {
      "Condensed Bold": "DejaVuSerifCondensed-Bold",
      "Regular": "DejaVuSerifCondensed-Bold"
    },
    "DejaVu Serif Condensed Bold Italic": {
      "Condensed Bold Italic": "DejaVuSerifCondensed-BoldItalic",
      "Regular": "DejaVuSerifCondensed-BoldItalic"
    },
    "DejaVu Serif Condensed Italic": {
      "Condensed Italic": "DejaVuSerifCondensed-Italic",
      "Regular": "DejaVuSerifCondensed-Italic"
    },
    "DejaVu Serif Italic": {
      "Italic": "DejaVuSerif-Italic",
      "Regular": "DejaVuSerif-Italic"
    },
    "DejaVuMathTeXGyre-Regular": {
      "Regular": "DejaVuMathTeXGyre-Regular"
    },
    "DengXian": {
      "Bold": "DengXian-Bold",
      "Light": "DengXian-Light",
      "Regular": "DengXian"
    },
    "DengXian Bold": {
      "Bold": "DengXian-Bold",
      "Regular": "DengXian-Bold"
    },
    "DengXian Light": {
      "Light": "DengXian-Light",
      "Regular": "DengXian-Light"
    },
    "DengXian Regular": {
      "Regular": "DengXian"
    },
    "Dubai": {
      "Bold": "Dubai-Bold",
      "Light": "Dubai-Light",
      "Medium": "Dubai-Medium",
      "Regular": "Dubai-Regular"
    },
    "Dubai Bold": {
      "Bold": "Dubai-Bold",
      "Regular": "Dubai-Bold"
    },
    "Dubai Light": {
      "Light": "Dubai-Light",
      "Regular": "Dubai-Light"
    },
    "Dubai Medium": {
      "Medium": "Dubai-Medium",
      "Regular": "Dubai-Medium"
    },
    "Dubai Regular": {
      "Regular": "Dubai-Regular"
    },
    "Ebrima": {
      "Arrunta": "Ebrima",
      "Bold": "Ebrima-Bold",
      "Fet": "Ebrima-Bold",
      "Fett": "Ebrima-Bold",
      "F\xE9lk\xF6v\xE9r": "Ebrima-Bold",
      "Gras": "Ebrima-Bold",
      "Grassetto": "Ebrima-Bold",
      "Halvfet": "Ebrima-Bold",
      "Kal\u0131n": "Ebrima-Bold",
      "Krepko": "Ebrima-Bold",
      "Lihavoitu": "Ebrima-Bold",
      "Lodia": "Ebrima-Bold",
      "Navadno": "Ebrima",
      "Negreta": "Ebrima-Bold",
      "Negrita": "Ebrima-Bold",
      "Negrito": "Ebrima-Bold",
      "Normaali": "Ebrima",
      "Normal": "Ebrima",
      "Normale": "Ebrima",
      "Normalny": "Ebrima",
      "Norm\xE1l": "Ebrima",
      "Norm\xE1lne": "Ebrima",
      "Pogrubiony": "Ebrima-Bold",
      "Regular": "Ebrima",
      "Standaard": "Ebrima",
      "Standard": "Ebrima",
      "Tu\u010Dn\xE9": "Ebrima-Bold",
      "Vet": "Ebrima-Bold",
      "fed": "Ebrima-Bold",
      "normal": "Ebrima",
      "oby\u010Dejn\xE9": "Ebrima",
      "tu\u010Dn\xE9": "Ebrima-Bold",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "Ebrima-Bold",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "Ebrima",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "Ebrima",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "Ebrima-Bold"
    },
    "Ebrima Bold": {
      "Bold": "Ebrima-Bold",
      "Regular": "Ebrima-Bold"
    },
    "Ebrima Fet": {
      "Regular": "Ebrima-Bold"
    },
    "Ebrima Fett": {
      "Regular": "Ebrima-Bold"
    },
    "Ebrima F\xE9lk\xF6v\xE9r": {
      "Regular": "Ebrima-Bold"
    },
    "Ebrima Gras": {
      "Regular": "Ebrima-Bold"
    },
    "Ebrima Grassetto": {
      "Regular": "Ebrima-Bold"
    },
    "Ebrima Halvfet": {
      "Regular": "Ebrima-Bold"
    },
    "Ebrima Kal\u0131n": {
      "Regular": "Ebrima-Bold"
    },
    "Ebrima Krepko": {
      "Regular": "Ebrima-Bold"
    },
    "Ebrima Lihavoitu": {
      "Regular": "Ebrima-Bold"
    },
    "Ebrima Lodia": {
      "Regular": "Ebrima-Bold"
    },
    "Ebrima Negreta": {
      "Regular": "Ebrima-Bold"
    },
    "Ebrima Negrita": {
      "Regular": "Ebrima-Bold"
    },
    "Ebrima Negrito": {
      "Regular": "Ebrima-Bold"
    },
    "Ebrima Pogrubiony": {
      "Regular": "Ebrima-Bold"
    },
    "Ebrima Tu\u010Dn\xE9": {
      "Regular": "Ebrima-Bold"
    },
    "Ebrima Vet": {
      "Regular": "Ebrima-Bold"
    },
    "Ebrima fed": {
      "Regular": "Ebrima-Bold"
    },
    "Ebrima tu\u010Dn\xE9": {
      "Regular": "Ebrima-Bold"
    },
    "Ebrima \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "Ebrima-Bold"
    },
    "Ebrima \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "Ebrima-Bold"
    },
    "Edwardian Script ITC": {
      "Arrunta": "EdwardianScriptITC",
      "Navadno": "EdwardianScriptITC",
      "Normaali": "EdwardianScriptITC",
      "Normal": "EdwardianScriptITC",
      "Normale": "EdwardianScriptITC",
      "Normalny": "EdwardianScriptITC",
      "Norm\xE1l": "EdwardianScriptITC",
      "Norm\xE1lne": "EdwardianScriptITC",
      "Regular": "EdwardianScriptITC",
      "Standaard": "EdwardianScriptITC",
      "Standard": "EdwardianScriptITC",
      "normal": "EdwardianScriptITC",
      "oby\u010Dejn\xE9": "EdwardianScriptITC",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "EdwardianScriptITC",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "EdwardianScriptITC"
    },
    "Elephant": {
      "Arrunta": "Elephant-Regular",
      "Corsivo": "Elephant-Italic",
      "Cursief": "Elephant-Italic",
      "Cursiva": "Elephant-Italic",
      "D\u0151lt": "Elephant-Italic",
      "Etzana": "Elephant-Italic",
      "Italic": "Elephant-Italic",
      "Italique": "Elephant-Italic",
      "It\xE1lico": "Elephant-Italic",
      "Kursiv": "Elephant-Italic",
      "Kursivoitu": "Elephant-Italic",
      "Kursywa": "Elephant-Italic",
      "Kurz\xEDva": "Elephant-Italic",
      "Navadno": "Elephant-Regular",
      "Normaali": "Elephant-Regular",
      "Normal": "Elephant-Regular",
      "Normale": "Elephant-Regular",
      "Normalny": "Elephant-Regular",
      "Norm\xE1l": "Elephant-Regular",
      "Norm\xE1lne": "Elephant-Regular",
      "Po\u0161evno": "Elephant-Italic",
      "Regular": "Elephant-Regular",
      "Standaard": "Elephant-Regular",
      "Standard": "Elephant-Regular",
      "kursiv": "Elephant-Italic",
      "kurz\xEDva": "Elephant-Italic",
      "normal": "Elephant-Regular",
      "oby\u010Dejn\xE9": "Elephant-Regular",
      "\u0130talik": "Elephant-Italic",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "Elephant-Regular",
      "\u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "Elephant-Italic",
      "\u041A\u0443\u0440\u0441\u0438\u0432": "Elephant-Italic",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "Elephant-Regular"
    },
    "Elephant Corsivo": {
      "Regular": "Elephant-Italic"
    },
    "Elephant Cursief": {
      "Regular": "Elephant-Italic"
    },
    "Elephant Cursiva": {
      "Regular": "Elephant-Italic"
    },
    "Elephant D\u0151lt": {
      "Regular": "Elephant-Italic"
    },
    "Elephant Etzana": {
      "Regular": "Elephant-Italic"
    },
    "Elephant Italic": {
      "Italic": "Elephant-Italic",
      "Regular": "Elephant-Italic"
    },
    "Elephant Italique": {
      "Regular": "Elephant-Italic"
    },
    "Elephant It\xE1lico": {
      "Regular": "Elephant-Italic"
    },
    "Elephant Kursiv": {
      "Regular": "Elephant-Italic"
    },
    "Elephant Kursivoitu": {
      "Regular": "Elephant-Italic"
    },
    "Elephant Kursywa": {
      "Regular": "Elephant-Italic"
    },
    "Elephant Kurz\xEDva": {
      "Regular": "Elephant-Italic"
    },
    "Elephant Po\u0161evno": {
      "Regular": "Elephant-Italic"
    },
    "Elephant kursiv": {
      "Regular": "Elephant-Italic"
    },
    "Elephant kurz\xEDva": {
      "Regular": "Elephant-Italic"
    },
    "Elephant \u0130talik": {
      "Regular": "Elephant-Italic"
    },
    "Elephant \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "Elephant-Italic"
    },
    "Elephant \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "Elephant-Italic"
    },
    "EmojiOne Color": {
      "Regular": "EmojiOneColorSVGinOT"
    },
    "EmojiOne Color SVGinOT": {
      "Regular": "EmojiOneColorSVGinOT"
    },
    "Engravers MT": {
      "Arrunta": "EngraversMT",
      "Navadno": "EngraversMT",
      "Normaali": "EngraversMT",
      "Normal": "EngraversMT",
      "Normale": "EngraversMT",
      "Normalny": "EngraversMT",
      "Norm\xE1l": "EngraversMT",
      "Norm\xE1lne": "EngraversMT",
      "Regular": "EngraversMT",
      "Standaard": "EngraversMT",
      "Standard": "EngraversMT",
      "normal": "EngraversMT",
      "oby\u010Dejn\xE9": "EngraversMT",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "EngraversMT",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "EngraversMT"
    },
    "Eras Bold ITC": {
      "Arrunta": "ErasITC-Bold",
      "Navadno": "ErasITC-Bold",
      "Normaali": "ErasITC-Bold",
      "Normal": "ErasITC-Bold",
      "Normale": "ErasITC-Bold",
      "Normalny": "ErasITC-Bold",
      "Norm\xE1l": "ErasITC-Bold",
      "Norm\xE1lne": "ErasITC-Bold",
      "Regular": "ErasITC-Bold",
      "Standaard": "ErasITC-Bold",
      "Standard": "ErasITC-Bold",
      "normal": "ErasITC-Bold",
      "oby\u010Dejn\xE9": "ErasITC-Bold",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "ErasITC-Bold",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "ErasITC-Bold"
    },
    "Eras Demi ITC": {
      "Arrunta": "ErasITC-Demi",
      "Navadno": "ErasITC-Demi",
      "Normaali": "ErasITC-Demi",
      "Normal": "ErasITC-Demi",
      "Normale": "ErasITC-Demi",
      "Normalny": "ErasITC-Demi",
      "Norm\xE1l": "ErasITC-Demi",
      "Norm\xE1lne": "ErasITC-Demi",
      "Regular": "ErasITC-Demi",
      "Standaard": "ErasITC-Demi",
      "Standard": "ErasITC-Demi",
      "normal": "ErasITC-Demi",
      "oby\u010Dejn\xE9": "ErasITC-Demi",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "ErasITC-Demi",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "ErasITC-Demi"
    },
    "Eras Light ITC": {
      "Arrunta": "ErasITC-Light",
      "Navadno": "ErasITC-Light",
      "Normaali": "ErasITC-Light",
      "Normal": "ErasITC-Light",
      "Normale": "ErasITC-Light",
      "Normalny": "ErasITC-Light",
      "Norm\xE1l": "ErasITC-Light",
      "Norm\xE1lne": "ErasITC-Light",
      "Regular": "ErasITC-Light",
      "Standaard": "ErasITC-Light",
      "Standard": "ErasITC-Light",
      "normal": "ErasITC-Light",
      "oby\u010Dejn\xE9": "ErasITC-Light",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "ErasITC-Light",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "ErasITC-Light"
    },
    "Eras Medium ITC": {
      "Arrunta": "ErasITC-Medium",
      "Navadno": "ErasITC-Medium",
      "Normaali": "ErasITC-Medium",
      "Normal": "ErasITC-Medium",
      "Normale": "ErasITC-Medium",
      "Normalny": "ErasITC-Medium",
      "Norm\xE1l": "ErasITC-Medium",
      "Norm\xE1lne": "ErasITC-Medium",
      "Regular": "ErasITC-Medium",
      "Standaard": "ErasITC-Medium",
      "Standard": "ErasITC-Medium",
      "normal": "ErasITC-Medium",
      "oby\u010Dejn\xE9": "ErasITC-Medium",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "ErasITC-Medium",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "ErasITC-Medium"
    },
    "FZFangSong-Z02": {
      "Regular": "FZFSK--GBK1-0"
    },
    "FZShuTi": {
      "Regular": "FZSTK--GBK1-0"
    },
    "FZYaoTi": {
      "Regular": "FZYTK--GBK1-0"
    },
    "FZYouH_GBK 503L": {
      "Regular": "FZYOUHK_503L--GBK1-0"
    },
    "FZYouH_GBK 508R": {
      "Regular": "FZYOUHK_508R--GBK1-0"
    },
    "FZYouH_GBK 510M": {
      "Regular": "FZYOUHK_510M--GBK1-0"
    },
    "FZYouH_GBK_513B": {
      "Regular": "FZYOUHK_513B--GBK1-0"
    },
    "FZYouHei_GBK": {
      "503L": "FZYOUHK_503L--GBK1-0",
      "508R": "FZYOUHK_508R--GBK1-0",
      "510M": "FZYOUHK_510M--GBK1-0",
      "513B": "FZYOUHK_513B--GBK1-0",
      "Regular": "FZYOUHK_503L--GBK1-0"
    },
    "FZYouHei_GBK 503L": {
      "503L": "FZYOUHK_503L--GBK1-0",
      "Regular": "FZYOUHK_503L--GBK1-0"
    },
    "FZYouHei_GBK 508R": {
      "508R": "FZYOUHK_508R--GBK1-0",
      "Regular": "FZYOUHK_508R--GBK1-0"
    },
    "FZYouHei_GBK 510M": {
      "510M": "FZYOUHK_510M--GBK1-0",
      "Regular": "FZYOUHK_510M--GBK1-0"
    },
    "FZYouHei_GBK 513B": {
      "513B": "FZYOUHK_513B--GBK1-0",
      "Regular": "FZYOUHK_513B--GBK1-0"
    },
    "FangSong": {
      "Arrunta": "FangSong",
      "Navadno": "FangSong",
      "Normaali": "FangSong",
      "Normal": "FangSong",
      "Normale": "FangSong",
      "Normalny": "FangSong",
      "Norm\xE1l": "FangSong",
      "Norm\xE1lne": "FangSong",
      "Regular": "FangSong",
      "Standaard": "FangSong",
      "Standard": "FangSong",
      "normal": "FangSong",
      "oby\u010Dejn\xE9": "FangSong",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "FangSong",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "FangSong"
    },
    "Felix Titling": {
      "Arrunta": "FelixTitlingMT",
      "Navadno": "FelixTitlingMT",
      "Normaali": "FelixTitlingMT",
      "Normal": "FelixTitlingMT",
      "Normale": "FelixTitlingMT",
      "Normalny": "FelixTitlingMT",
      "Norm\xE1l": "FelixTitlingMT",
      "Norm\xE1lne": "FelixTitlingMT",
      "Regular": "FelixTitlingMT",
      "Standaard": "FelixTitlingMT",
      "Standard": "FelixTitlingMT",
      "normal": "FelixTitlingMT",
      "oby\u010Dejn\xE9": "FelixTitlingMT",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "FelixTitlingMT",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "FelixTitlingMT"
    },
    "Footlight MT": {
      "Regular": "FootlightMTLight"
    },
    "Footlight MT Light": {
      "Arrunta": "FootlightMTLight",
      "Navadno": "FootlightMTLight",
      "Normaali": "FootlightMTLight",
      "Normal": "FootlightMTLight",
      "Normale": "FootlightMTLight",
      "Normalny": "FootlightMTLight",
      "Norm\xE1l": "FootlightMTLight",
      "Norm\xE1lne": "FootlightMTLight",
      "Regular": "FootlightMTLight",
      "Standaard": "FootlightMTLight",
      "Standard": "FootlightMTLight",
      "normal": "FootlightMTLight",
      "oby\u010Dejn\xE9": "FootlightMTLight",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "FootlightMTLight",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "FootlightMTLight"
    },
    "Forte": {
      "Regular": "ForteMT"
    },
    "Frank Ruehl CLM": {
      "Bold": "FrankRuehlCLM-Bold",
      "BoldOblique": "FrankRuehlCLM-BoldOblique",
      "Medium": "FrankRuehlCLM-Medium",
      "MediumOblique": "FrankRuehlCLM-MediumOblique"
    },
    "Frank Ruehl CLM Bold": {
      "Bold": "FrankRuehlCLM-Bold",
      "BoldOblique": "FrankRuehlCLM-BoldOblique",
      "Regular": "FrankRuehlCLM-Bold"
    },
    "Frank Ruehl CLM Bold Oblique": {
      "BoldOblique": "FrankRuehlCLM-BoldOblique",
      "Regular": "FrankRuehlCLM-BoldOblique"
    },
    "Frank Ruehl CLM Medium": {
      "Medium": "FrankRuehlCLM-Medium",
      "Regular": "FrankRuehlCLM-Medium"
    },
    "Frank Ruehl CLM Medium Oblique": {
      "MediumOblique": "FrankRuehlCLM-MediumOblique",
      "Regular": "FrankRuehlCLM-MediumOblique"
    },
    "Frank Ruhl Hofshi": {
      "Bold": "FrankRuhlHofshi-Bold",
      "Regular": "FrankRuhlHofshi-Regular"
    },
    "Frank Ruhl Hofshi Bold": {
      "Bold": "FrankRuhlHofshi-Bold",
      "Regular": "FrankRuhlHofshi-Bold"
    },
    "FrankRuhlHofshi-Regular": {
      "Regular": "FrankRuhlHofshi-Regular"
    },
    "Franklin Gothic": {
      "Italic": "FranklinGothic-MediumItalic",
      "Regular": "FranklinGothic-Medium"
    },
    "Franklin Gothic Book": {
      "Arrunta": "FranklinGothic-Book",
      "Corsivo": "FranklinGothic-BookItalic",
      "Cursief": "FranklinGothic-BookItalic",
      "Cursiva": "FranklinGothic-BookItalic",
      "D\u0151lt": "FranklinGothic-BookItalic",
      "Etzana": "FranklinGothic-BookItalic",
      "Italic": "FranklinGothic-BookItalic",
      "Italique": "FranklinGothic-BookItalic",
      "It\xE1lico": "FranklinGothic-BookItalic",
      "Kursiv": "FranklinGothic-BookItalic",
      "Kursivoitu": "FranklinGothic-BookItalic",
      "Kursywa": "FranklinGothic-BookItalic",
      "Kurz\xEDva": "FranklinGothic-BookItalic",
      "Navadno": "FranklinGothic-Book",
      "Normaali": "FranklinGothic-Book",
      "Normal": "FranklinGothic-Book",
      "Normale": "FranklinGothic-Book",
      "Normalny": "FranklinGothic-Book",
      "Norm\xE1l": "FranklinGothic-Book",
      "Norm\xE1lne": "FranklinGothic-Book",
      "Po\u0161evno": "FranklinGothic-BookItalic",
      "Regular": "FranklinGothic-Book",
      "Standaard": "FranklinGothic-Book",
      "Standard": "FranklinGothic-Book",
      "kursiv": "FranklinGothic-BookItalic",
      "kurz\xEDva": "FranklinGothic-BookItalic",
      "normal": "FranklinGothic-Book",
      "oby\u010Dejn\xE9": "FranklinGothic-Book",
      "\u0130talik": "FranklinGothic-BookItalic",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "FranklinGothic-Book",
      "\u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "FranklinGothic-BookItalic",
      "\u041A\u0443\u0440\u0441\u0438\u0432": "FranklinGothic-BookItalic",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "FranklinGothic-Book"
    },
    "Franklin Gothic Book Corsivo": {
      "Regular": "FranklinGothic-BookItalic"
    },
    "Franklin Gothic Book Cursief": {
      "Regular": "FranklinGothic-BookItalic"
    },
    "Franklin Gothic Book Cursiva": {
      "Regular": "FranklinGothic-BookItalic"
    },
    "Franklin Gothic Book D\u0151lt": {
      "Regular": "FranklinGothic-BookItalic"
    },
    "Franklin Gothic Book Etzana": {
      "Regular": "FranklinGothic-BookItalic"
    },
    "Franklin Gothic Book Italic": {
      "Italic": "FranklinGothic-BookItalic",
      "Regular": "FranklinGothic-BookItalic"
    },
    "Franklin Gothic Book Italique": {
      "Regular": "FranklinGothic-BookItalic"
    },
    "Franklin Gothic Book It\xE1lico": {
      "Regular": "FranklinGothic-BookItalic"
    },
    "Franklin Gothic Book Kursiv": {
      "Regular": "FranklinGothic-BookItalic"
    },
    "Franklin Gothic Book Kursivoitu": {
      "Regular": "FranklinGothic-BookItalic"
    },
    "Franklin Gothic Book Kursywa": {
      "Regular": "FranklinGothic-BookItalic"
    },
    "Franklin Gothic Book Kurz\xEDva": {
      "Regular": "FranklinGothic-BookItalic"
    },
    "Franklin Gothic Book Po\u0161evno": {
      "Regular": "FranklinGothic-BookItalic"
    },
    "Franklin Gothic Book kursiv": {
      "Regular": "FranklinGothic-BookItalic"
    },
    "Franklin Gothic Book kurz\xEDva": {
      "Regular": "FranklinGothic-BookItalic"
    },
    "Franklin Gothic Book \u0130talik": {
      "Regular": "FranklinGothic-BookItalic"
    },
    "Franklin Gothic Book \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "FranklinGothic-BookItalic"
    },
    "Franklin Gothic Book \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "FranklinGothic-BookItalic"
    },
    "Franklin Gothic Demi": {
      "Arrunta": "FranklinGothic-Demi",
      "Corsivo": "FranklinGothic-DemiItalic",
      "Cursief": "FranklinGothic-DemiItalic",
      "Cursiva": "FranklinGothic-DemiItalic",
      "D\u0151lt": "FranklinGothic-DemiItalic",
      "Etzana": "FranklinGothic-DemiItalic",
      "Italic": "FranklinGothic-DemiItalic",
      "Italique": "FranklinGothic-DemiItalic",
      "It\xE1lico": "FranklinGothic-DemiItalic",
      "Kursiv": "FranklinGothic-DemiItalic",
      "Kursivoitu": "FranklinGothic-DemiItalic",
      "Kursywa": "FranklinGothic-DemiItalic",
      "Kurz\xEDva": "FranklinGothic-DemiItalic",
      "Navadno": "FranklinGothic-Demi",
      "Normaali": "FranklinGothic-Demi",
      "Normal": "FranklinGothic-Demi",
      "Normale": "FranklinGothic-Demi",
      "Normalny": "FranklinGothic-Demi",
      "Norm\xE1l": "FranklinGothic-Demi",
      "Norm\xE1lne": "FranklinGothic-Demi",
      "Po\u0161evno": "FranklinGothic-DemiItalic",
      "Regular": "FranklinGothic-Demi",
      "Standaard": "FranklinGothic-Demi",
      "Standard": "FranklinGothic-Demi",
      "kursiv": "FranklinGothic-DemiItalic",
      "kurz\xEDva": "FranklinGothic-DemiItalic",
      "normal": "FranklinGothic-Demi",
      "oby\u010Dejn\xE9": "FranklinGothic-Demi",
      "\u0130talik": "FranklinGothic-DemiItalic",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "FranklinGothic-Demi",
      "\u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "FranklinGothic-DemiItalic",
      "\u041A\u0443\u0440\u0441\u0438\u0432": "FranklinGothic-DemiItalic",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "FranklinGothic-Demi"
    },
    "Franklin Gothic Demi Cond": {
      "Arrunta": "FranklinGothic-DemiCond",
      "Navadno": "FranklinGothic-DemiCond",
      "Normaali": "FranklinGothic-DemiCond",
      "Normal": "FranklinGothic-DemiCond",
      "Normale": "FranklinGothic-DemiCond",
      "Normalny": "FranklinGothic-DemiCond",
      "Norm\xE1l": "FranklinGothic-DemiCond",
      "Norm\xE1lne": "FranklinGothic-DemiCond",
      "Regular": "FranklinGothic-DemiCond",
      "Standaard": "FranklinGothic-DemiCond",
      "Standard": "FranklinGothic-DemiCond",
      "normal": "FranklinGothic-DemiCond",
      "oby\u010Dejn\xE9": "FranklinGothic-DemiCond",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "FranklinGothic-DemiCond",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "FranklinGothic-DemiCond"
    },
    "Franklin Gothic Demi Corsivo": {
      "Regular": "FranklinGothic-DemiItalic"
    },
    "Franklin Gothic Demi Cursief": {
      "Regular": "FranklinGothic-DemiItalic"
    },
    "Franklin Gothic Demi Cursiva": {
      "Regular": "FranklinGothic-DemiItalic"
    },
    "Franklin Gothic Demi D\u0151lt": {
      "Regular": "FranklinGothic-DemiItalic"
    },
    "Franklin Gothic Demi Etzana": {
      "Regular": "FranklinGothic-DemiItalic"
    },
    "Franklin Gothic Demi Italic": {
      "Italic": "FranklinGothic-DemiItalic",
      "Regular": "FranklinGothic-DemiItalic"
    },
    "Franklin Gothic Demi Italique": {
      "Regular": "FranklinGothic-DemiItalic"
    },
    "Franklin Gothic Demi It\xE1lico": {
      "Regular": "FranklinGothic-DemiItalic"
    },
    "Franklin Gothic Demi Kursiv": {
      "Regular": "FranklinGothic-DemiItalic"
    },
    "Franklin Gothic Demi Kursivoitu": {
      "Regular": "FranklinGothic-DemiItalic"
    },
    "Franklin Gothic Demi Kursywa": {
      "Regular": "FranklinGothic-DemiItalic"
    },
    "Franklin Gothic Demi Kurz\xEDva": {
      "Regular": "FranklinGothic-DemiItalic"
    },
    "Franklin Gothic Demi Po\u0161evno": {
      "Regular": "FranklinGothic-DemiItalic"
    },
    "Franklin Gothic Demi kursiv": {
      "Regular": "FranklinGothic-DemiItalic"
    },
    "Franklin Gothic Demi kurz\xEDva": {
      "Regular": "FranklinGothic-DemiItalic"
    },
    "Franklin Gothic Demi \u0130talik": {
      "Regular": "FranklinGothic-DemiItalic"
    },
    "Franklin Gothic Demi \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "FranklinGothic-DemiItalic"
    },
    "Franklin Gothic Demi \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "FranklinGothic-DemiItalic"
    },
    "Franklin Gothic Heavy": {
      "Arrunta": "FranklinGothic-Heavy",
      "Corsivo": "FranklinGothic-HeavyItalic",
      "Cursief": "FranklinGothic-HeavyItalic",
      "Cursiva": "FranklinGothic-HeavyItalic",
      "D\u0151lt": "FranklinGothic-HeavyItalic",
      "Etzana": "FranklinGothic-HeavyItalic",
      "Italic": "FranklinGothic-HeavyItalic",
      "Italique": "FranklinGothic-HeavyItalic",
      "It\xE1lico": "FranklinGothic-HeavyItalic",
      "Kursiv": "FranklinGothic-HeavyItalic",
      "Kursivoitu": "FranklinGothic-HeavyItalic",
      "Kursywa": "FranklinGothic-HeavyItalic",
      "Kurz\xEDva": "FranklinGothic-HeavyItalic",
      "Navadno": "FranklinGothic-Heavy",
      "Normaali": "FranklinGothic-Heavy",
      "Normal": "FranklinGothic-Heavy",
      "Normale": "FranklinGothic-Heavy",
      "Normalny": "FranklinGothic-Heavy",
      "Norm\xE1l": "FranklinGothic-Heavy",
      "Norm\xE1lne": "FranklinGothic-Heavy",
      "Po\u0161evno": "FranklinGothic-HeavyItalic",
      "Regular": "FranklinGothic-Heavy",
      "Standaard": "FranklinGothic-Heavy",
      "Standard": "FranklinGothic-Heavy",
      "kursiv": "FranklinGothic-HeavyItalic",
      "kurz\xEDva": "FranklinGothic-HeavyItalic",
      "normal": "FranklinGothic-Heavy",
      "oby\u010Dejn\xE9": "FranklinGothic-Heavy",
      "\u0130talik": "FranklinGothic-HeavyItalic",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "FranklinGothic-Heavy",
      "\u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "FranklinGothic-HeavyItalic",
      "\u041A\u0443\u0440\u0441\u0438\u0432": "FranklinGothic-HeavyItalic",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "FranklinGothic-Heavy"
    },
    "Franklin Gothic Heavy Corsivo": {
      "Regular": "FranklinGothic-HeavyItalic"
    },
    "Franklin Gothic Heavy Cursief": {
      "Regular": "FranklinGothic-HeavyItalic"
    },
    "Franklin Gothic Heavy Cursiva": {
      "Regular": "FranklinGothic-HeavyItalic"
    },
    "Franklin Gothic Heavy D\u0151lt": {
      "Regular": "FranklinGothic-HeavyItalic"
    },
    "Franklin Gothic Heavy Etzana": {
      "Regular": "FranklinGothic-HeavyItalic"
    },
    "Franklin Gothic Heavy Italic": {
      "Italic": "FranklinGothic-HeavyItalic",
      "Regular": "FranklinGothic-HeavyItalic"
    },
    "Franklin Gothic Heavy Italique": {
      "Regular": "FranklinGothic-HeavyItalic"
    },
    "Franklin Gothic Heavy It\xE1lico": {
      "Regular": "FranklinGothic-HeavyItalic"
    },
    "Franklin Gothic Heavy Kursiv": {
      "Regular": "FranklinGothic-HeavyItalic"
    },
    "Franklin Gothic Heavy Kursivoitu": {
      "Regular": "FranklinGothic-HeavyItalic"
    },
    "Franklin Gothic Heavy Kursywa": {
      "Regular": "FranklinGothic-HeavyItalic"
    },
    "Franklin Gothic Heavy Kurz\xEDva": {
      "Regular": "FranklinGothic-HeavyItalic"
    },
    "Franklin Gothic Heavy Po\u0161evno": {
      "Regular": "FranklinGothic-HeavyItalic"
    },
    "Franklin Gothic Heavy kursiv": {
      "Regular": "FranklinGothic-HeavyItalic"
    },
    "Franklin Gothic Heavy kurz\xEDva": {
      "Regular": "FranklinGothic-HeavyItalic"
    },
    "Franklin Gothic Heavy \u0130talik": {
      "Regular": "FranklinGothic-HeavyItalic"
    },
    "Franklin Gothic Heavy \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "FranklinGothic-HeavyItalic"
    },
    "Franklin Gothic Heavy \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "FranklinGothic-HeavyItalic"
    },
    "Franklin Gothic Medium": {
      "Arrunta": "FranklinGothic-Medium",
      "Corsivo": "FranklinGothic-MediumItalic",
      "Cursief": "FranklinGothic-MediumItalic",
      "Cursiva": "FranklinGothic-MediumItalic",
      "D\u0151lt": "FranklinGothic-MediumItalic",
      "Etzana": "FranklinGothic-MediumItalic",
      "Italic": "FranklinGothic-MediumItalic",
      "Italique": "FranklinGothic-MediumItalic",
      "It\xE1lico": "FranklinGothic-MediumItalic",
      "Kursiv": "FranklinGothic-MediumItalic",
      "Kursivoitu": "FranklinGothic-MediumItalic",
      "Kursywa": "FranklinGothic-MediumItalic",
      "Kurz\xEDva": "FranklinGothic-MediumItalic",
      "Navadno": "FranklinGothic-Medium",
      "Normaali": "FranklinGothic-Medium",
      "Normal": "FranklinGothic-Medium",
      "Normale": "FranklinGothic-Medium",
      "Normalny": "FranklinGothic-Medium",
      "Norm\xE1l": "FranklinGothic-Medium",
      "Norm\xE1lne": "FranklinGothic-Medium",
      "Po\u0161evno": "FranklinGothic-MediumItalic",
      "Regular": "FranklinGothic-Medium",
      "Standaard": "FranklinGothic-Medium",
      "Standard": "FranklinGothic-Medium",
      "kursiv": "FranklinGothic-MediumItalic",
      "kurz\xEDva": "FranklinGothic-MediumItalic",
      "normal": "FranklinGothic-Medium",
      "oby\u010Dejn\xE9": "FranklinGothic-Medium",
      "\u0130talik": "FranklinGothic-MediumItalic",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "FranklinGothic-Medium",
      "\u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "FranklinGothic-MediumItalic",
      "\u041A\u0443\u0440\u0441\u0438\u0432": "FranklinGothic-MediumItalic",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "FranklinGothic-Medium"
    },
    "Franklin Gothic Medium Cond": {
      "Arrunta": "FranklinGothic-MediumCond",
      "Navadno": "FranklinGothic-MediumCond",
      "Normaali": "FranklinGothic-MediumCond",
      "Normal": "FranklinGothic-MediumCond",
      "Normale": "FranklinGothic-MediumCond",
      "Normalny": "FranklinGothic-MediumCond",
      "Norm\xE1l": "FranklinGothic-MediumCond",
      "Norm\xE1lne": "FranklinGothic-MediumCond",
      "Regular": "FranklinGothic-MediumCond",
      "Standaard": "FranklinGothic-MediumCond",
      "Standard": "FranklinGothic-MediumCond",
      "normal": "FranklinGothic-MediumCond",
      "oby\u010Dejn\xE9": "FranklinGothic-MediumCond",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "FranklinGothic-MediumCond",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "FranklinGothic-MediumCond"
    },
    "Franklin Gothic Medium Corsivo": {
      "Regular": "FranklinGothic-MediumItalic"
    },
    "Franklin Gothic Medium Cursief": {
      "Regular": "FranklinGothic-MediumItalic"
    },
    "Franklin Gothic Medium Cursiva": {
      "Regular": "FranklinGothic-MediumItalic"
    },
    "Franklin Gothic Medium D\u0151lt": {
      "Regular": "FranklinGothic-MediumItalic"
    },
    "Franklin Gothic Medium Etzana": {
      "Regular": "FranklinGothic-MediumItalic"
    },
    "Franklin Gothic Medium Italic": {
      "Italic": "FranklinGothic-MediumItalic",
      "Regular": "FranklinGothic-MediumItalic"
    },
    "Franklin Gothic Medium Italique": {
      "Regular": "FranklinGothic-MediumItalic"
    },
    "Franklin Gothic Medium It\xE1lico": {
      "Regular": "FranklinGothic-MediumItalic"
    },
    "Franklin Gothic Medium Kursiv": {
      "Regular": "FranklinGothic-MediumItalic"
    },
    "Franklin Gothic Medium Kursivoitu": {
      "Regular": "FranklinGothic-MediumItalic"
    },
    "Franklin Gothic Medium Kursywa": {
      "Regular": "FranklinGothic-MediumItalic"
    },
    "Franklin Gothic Medium Kurz\xEDva": {
      "Regular": "FranklinGothic-MediumItalic"
    },
    "Franklin Gothic Medium Po\u0161evno": {
      "Regular": "FranklinGothic-MediumItalic"
    },
    "Franklin Gothic Medium kursiv": {
      "Regular": "FranklinGothic-MediumItalic"
    },
    "Franklin Gothic Medium kurz\xEDva": {
      "Regular": "FranklinGothic-MediumItalic"
    },
    "Franklin Gothic Medium \u0130talik": {
      "Regular": "FranklinGothic-MediumItalic"
    },
    "Franklin Gothic Medium \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "FranklinGothic-MediumItalic"
    },
    "Franklin Gothic Medium \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "FranklinGothic-MediumItalic"
    },
    "Freestyle Script": {
      "Arrunta": "FreestyleScript-Regular",
      "Navadno": "FreestyleScript-Regular",
      "Normaali": "FreestyleScript-Regular",
      "Normal": "FreestyleScript-Regular",
      "Normale": "FreestyleScript-Regular",
      "Normalny": "FreestyleScript-Regular",
      "Norm\xE1l": "FreestyleScript-Regular",
      "Norm\xE1lne": "FreestyleScript-Regular",
      "Regular": "FreestyleScript-Regular",
      "Standaard": "FreestyleScript-Regular",
      "Standard": "FreestyleScript-Regular",
      "normal": "FreestyleScript-Regular",
      "oby\u010Dejn\xE9": "FreestyleScript-Regular",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "FreestyleScript-Regular",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "FreestyleScript-Regular"
    },
    "French Script MT": {
      "Arrunta": "FrenchScriptMT",
      "Navadno": "FrenchScriptMT",
      "Normaali": "FrenchScriptMT",
      "Normal": "FrenchScriptMT",
      "Normale": "FrenchScriptMT",
      "Normalny": "FrenchScriptMT",
      "Norm\xE1l": "FrenchScriptMT",
      "Norm\xE1lne": "FrenchScriptMT",
      "Regular": "FrenchScriptMT",
      "Standaard": "FrenchScriptMT",
      "Standard": "FrenchScriptMT",
      "normal": "FrenchScriptMT",
      "oby\u010Dejn\xE9": "FrenchScriptMT",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "FrenchScriptMT",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "FrenchScriptMT"
    },
    "GWZT-EN": {
      "Regular": "GWZT-EN"
    },
    "Gabriola": {
      "Regular": "Gabriola"
    },
    "Gadugi": {
      "Arrunta": "Gadugi",
      "Bold": "Gadugi-Bold",
      "Fet": "Gadugi-Bold",
      "Fett": "Gadugi-Bold",
      "F\xE9lk\xF6v\xE9r": "Gadugi-Bold",
      "Gras": "Gadugi-Bold",
      "Grassetto": "Gadugi-Bold",
      "Halvfet": "Gadugi-Bold",
      "Kal\u0131n": "Gadugi-Bold",
      "Krepko": "Gadugi-Bold",
      "Lihavoitu": "Gadugi-Bold",
      "Lodia": "Gadugi-Bold",
      "Navadno": "Gadugi",
      "Negreta": "Gadugi-Bold",
      "Negrita": "Gadugi-Bold",
      "Negrito": "Gadugi-Bold",
      "Normaali": "Gadugi",
      "Normal": "Gadugi",
      "Normale": "Gadugi",
      "Normalny": "Gadugi",
      "Norm\xE1l": "Gadugi",
      "Norm\xE1lne": "Gadugi",
      "Pogrubiony": "Gadugi-Bold",
      "Regular": "Gadugi",
      "Standaard": "Gadugi",
      "Standard": "Gadugi",
      "Tu\u010Dn\xE9": "Gadugi-Bold",
      "Vet": "Gadugi-Bold",
      "fed": "Gadugi-Bold",
      "normal": "Gadugi",
      "oby\u010Dejn\xE9": "Gadugi",
      "tu\u010Dn\xE9": "Gadugi-Bold",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "Gadugi-Bold",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "Gadugi",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "Gadugi",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "Gadugi-Bold"
    },
    "Gadugi Bold": {
      "Bold": "Gadugi-Bold",
      "Regular": "Gadugi-Bold"
    },
    "Gadugi Fet": {
      "Regular": "Gadugi-Bold"
    },
    "Gadugi Fett": {
      "Regular": "Gadugi-Bold"
    },
    "Gadugi F\xE9lk\xF6v\xE9r": {
      "Regular": "Gadugi-Bold"
    },
    "Gadugi Gras": {
      "Regular": "Gadugi-Bold"
    },
    "Gadugi Grassetto": {
      "Regular": "Gadugi-Bold"
    },
    "Gadugi Halvfet": {
      "Regular": "Gadugi-Bold"
    },
    "Gadugi Kal\u0131n": {
      "Regular": "Gadugi-Bold"
    },
    "Gadugi Krepko": {
      "Regular": "Gadugi-Bold"
    },
    "Gadugi Lihavoitu": {
      "Regular": "Gadugi-Bold"
    },
    "Gadugi Lodia": {
      "Regular": "Gadugi-Bold"
    },
    "Gadugi Negreta": {
      "Regular": "Gadugi-Bold"
    },
    "Gadugi Negrita": {
      "Regular": "Gadugi-Bold"
    },
    "Gadugi Negrito": {
      "Regular": "Gadugi-Bold"
    },
    "Gadugi Pogrubiony": {
      "Regular": "Gadugi-Bold"
    },
    "Gadugi Tu\u010Dn\xE9": {
      "Regular": "Gadugi-Bold"
    },
    "Gadugi Vet": {
      "Regular": "Gadugi-Bold"
    },
    "Gadugi fed": {
      "Regular": "Gadugi-Bold"
    },
    "Gadugi tu\u010Dn\xE9": {
      "Regular": "Gadugi-Bold"
    },
    "Gadugi \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "Gadugi-Bold"
    },
    "Gadugi \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "Gadugi-Bold"
    },
    "Garamond": {
      "Arrunta": "Garamond",
      "Bold": "Garamond-Bold",
      "Corsivo": "Garamond-Italic",
      "Cursief": "Garamond-Italic",
      "Cursiva": "Garamond-Italic",
      "D\u0151lt": "Garamond-Italic",
      "Etzana": "Garamond-Italic",
      "Fet": "Garamond-Bold",
      "Fett": "Garamond-Bold",
      "F\xE9lk\xF6v\xE9r": "Garamond-Bold",
      "Gras": "Garamond-Bold",
      "Grassetto": "Garamond-Bold",
      "Halvfet": "Garamond-Bold",
      "Italic": "Garamond-Italic",
      "Italique": "Garamond-Italic",
      "It\xE1lico": "Garamond-Italic",
      "Kal\u0131n": "Garamond-Bold",
      "Krepko": "Garamond-Bold",
      "Kursiv": "Garamond-Italic",
      "Kursivoitu": "Garamond-Italic",
      "Kursywa": "Garamond-Italic",
      "Kurz\xEDva": "Garamond-Italic",
      "Lihavoitu": "Garamond-Bold",
      "Lodia": "Garamond-Bold",
      "Navadno": "Garamond",
      "Negreta": "Garamond-Bold",
      "Negrita": "Garamond-Bold",
      "Negrito": "Garamond-Bold",
      "Normaali": "Garamond",
      "Normal": "Garamond",
      "Normale": "Garamond",
      "Normalny": "Garamond",
      "Norm\xE1l": "Garamond",
      "Norm\xE1lne": "Garamond",
      "Pogrubiony": "Garamond-Bold",
      "Po\u0161evno": "Garamond-Italic",
      "Regular": "Garamond",
      "Standaard": "Garamond",
      "Standard": "Garamond",
      "Tu\u010Dn\xE9": "Garamond-Bold",
      "Vet": "Garamond-Bold",
      "fed": "Garamond-Bold",
      "kursiv": "Garamond-Italic",
      "kurz\xEDva": "Garamond-Italic",
      "normal": "Garamond",
      "oby\u010Dejn\xE9": "Garamond",
      "tu\u010Dn\xE9": "Garamond-Bold",
      "\u0130talik": "Garamond-Italic",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "Garamond-Bold",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "Garamond",
      "\u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "Garamond-Italic",
      "\u041A\u0443\u0440\u0441\u0438\u0432": "Garamond-Italic",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "Garamond",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "Garamond-Bold"
    },
    "Garamond Bold": {
      "Bold": "Garamond-Bold",
      "Regular": "Garamond-Bold"
    },
    "Garamond Corsivo": {
      "Regular": "Garamond-Italic"
    },
    "Garamond Cursief": {
      "Regular": "Garamond-Italic"
    },
    "Garamond Cursiva": {
      "Regular": "Garamond-Italic"
    },
    "Garamond D\u0151lt": {
      "Regular": "Garamond-Italic"
    },
    "Garamond Etzana": {
      "Regular": "Garamond-Italic"
    },
    "Garamond Fet": {
      "Regular": "Garamond-Bold"
    },
    "Garamond Fett": {
      "Regular": "Garamond-Bold"
    },
    "Garamond F\xE9lk\xF6v\xE9r": {
      "Regular": "Garamond-Bold"
    },
    "Garamond Gras": {
      "Regular": "Garamond-Bold"
    },
    "Garamond Grassetto": {
      "Regular": "Garamond-Bold"
    },
    "Garamond Halvfet": {
      "Regular": "Garamond-Bold"
    },
    "Garamond Italic": {
      "Italic": "Garamond-Italic",
      "Regular": "Garamond-Italic"
    },
    "Garamond Italique": {
      "Regular": "Garamond-Italic"
    },
    "Garamond It\xE1lico": {
      "Regular": "Garamond-Italic"
    },
    "Garamond Kal\u0131n": {
      "Regular": "Garamond-Bold"
    },
    "Garamond Krepko": {
      "Regular": "Garamond-Bold"
    },
    "Garamond Kursiv": {
      "Regular": "Garamond-Italic"
    },
    "Garamond Kursivoitu": {
      "Regular": "Garamond-Italic"
    },
    "Garamond Kursywa": {
      "Regular": "Garamond-Italic"
    },
    "Garamond Kurz\xEDva": {
      "Regular": "Garamond-Italic"
    },
    "Garamond Lihavoitu": {
      "Regular": "Garamond-Bold"
    },
    "Garamond Lodia": {
      "Regular": "Garamond-Bold"
    },
    "Garamond Negreta": {
      "Regular": "Garamond-Bold"
    },
    "Garamond Negrita": {
      "Regular": "Garamond-Bold"
    },
    "Garamond Negrito": {
      "Regular": "Garamond-Bold"
    },
    "Garamond Pogrubiony": {
      "Regular": "Garamond-Bold"
    },
    "Garamond Po\u0161evno": {
      "Regular": "Garamond-Italic"
    },
    "Garamond Tu\u010Dn\xE9": {
      "Regular": "Garamond-Bold"
    },
    "Garamond Vet": {
      "Regular": "Garamond-Bold"
    },
    "Garamond fed": {
      "Regular": "Garamond-Bold"
    },
    "Garamond kursiv": {
      "Regular": "Garamond-Italic"
    },
    "Garamond kurz\xEDva": {
      "Regular": "Garamond-Italic"
    },
    "Garamond tu\u010Dn\xE9": {
      "Regular": "Garamond-Bold"
    },
    "Garamond \u0130talik": {
      "Regular": "Garamond-Italic"
    },
    "Garamond \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "Garamond-Bold"
    },
    "Garamond \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "Garamond-Italic"
    },
    "Garamond \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "Garamond-Italic"
    },
    "Garamond \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "Garamond-Bold"
    },
    "Gentium Basic": {
      "Bold": "GentiumBasic-Bold",
      "Bold Italic": "GentiumBasic-BoldItalic",
      "Italic": "GentiumBasic-Italic",
      "Regular": "GentiumBasic"
    },
    "Gentium Basic Bold": {
      "Bold": "GentiumBasic-Bold",
      "Regular": "GentiumBasic-Bold"
    },
    "Gentium Basic Bold Italic": {
      "Bold Italic": "GentiumBasic-BoldItalic",
      "Regular": "GentiumBasic-BoldItalic"
    },
    "Gentium Basic Italic": {
      "Italic": "GentiumBasic-Italic",
      "Regular": "GentiumBasic-Italic"
    },
    "Gentium Book Basic": {
      "Bold": "GentiumBookBasic-Bold",
      "Bold Italic": "GentiumBookBasic-BoldItalic",
      "Italic": "GentiumBookBasic-Italic",
      "Regular": "GentiumBookBasic"
    },
    "Gentium Book Basic Bold": {
      "Bold": "GentiumBookBasic-Bold",
      "Regular": "GentiumBookBasic-Bold"
    },
    "Gentium Book Basic Bold Italic": {
      "Bold Italic": "GentiumBookBasic-BoldItalic",
      "Regular": "GentiumBookBasic-BoldItalic"
    },
    "Gentium Book Basic Italic": {
      "Italic": "GentiumBookBasic-Italic",
      "Regular": "GentiumBookBasic-Italic"
    },
    "Georgia": {
      "Arrunta": "Georgia",
      "Bold": "Georgia-Bold",
      "Bold Italic": "Georgia-BoldItalic",
      "Corsivo": "Georgia-Italic",
      "Cursief": "Georgia-Italic",
      "Cursiva": "Georgia-Italic",
      "D\u0151lt": "Georgia-Italic",
      "Etzana": "Georgia-Italic",
      "Fet": "Georgia-Bold",
      "Fet Kursiv": "Georgia-BoldItalic",
      "Fett": "Georgia-Bold",
      "Fett Kursiv": "Georgia-BoldItalic",
      "F\xE9lk\xF6v\xE9r": "Georgia-Bold",
      "F\xE9lk\xF6v\xE9r d\u0151lt": "Georgia-BoldItalic",
      "Gras": "Georgia-Bold",
      "Gras Italique": "Georgia-BoldItalic",
      "Grassetto": "Georgia-Bold",
      "Grassetto Corsivo": "Georgia-BoldItalic",
      "Halvfet": "Georgia-Bold",
      "Halvfet Kursiv": "Georgia-BoldItalic",
      "Italic": "Georgia-Italic",
      "Italique": "Georgia-Italic",
      "It\xE1lico": "Georgia-Italic",
      "Kal\u0131n": "Georgia-Bold",
      "Kal\u0131n \u0130talik": "Georgia-BoldItalic",
      "Krepko": "Georgia-Bold",
      "Krepko po\u0161evno": "Georgia-BoldItalic",
      "Kursiv": "Georgia-Italic",
      "Kursivoitu": "Georgia-Italic",
      "Kursywa": "Georgia-Italic",
      "Kurz\xEDva": "Georgia-Italic",
      "Lihavoitu": "Georgia-Bold",
      "Lihavoitu Kursivoi": "Georgia-BoldItalic",
      "Lodi etzana": "Georgia-BoldItalic",
      "Lodia": "Georgia-Bold",
      "Navadno": "Georgia",
      "Negreta": "Georgia-Bold",
      "Negreta cursiva": "Georgia-BoldItalic",
      "Negrita": "Georgia-Bold",
      "Negrita Cursiva": "Georgia-BoldItalic",
      "Negrito": "Georgia-Bold",
      "Negrito It\xE1lico": "Georgia-BoldItalic",
      "Normaali": "Georgia",
      "Normal": "Georgia",
      "Normale": "Georgia",
      "Normalny": "Georgia",
      "Norm\xE1l": "Georgia",
      "Norm\xE1lne": "Georgia",
      "Pogrubiona kursywa": "Georgia-BoldItalic",
      "Pogrubiony": "Georgia-Bold",
      "Po\u0161evno": "Georgia-Italic",
      "Regular": "Georgia",
      "Standaard": "Georgia",
      "Standard": "Georgia",
      "Tu\u010Dn\xE1 kurz\xEDva": "Georgia-BoldItalic",
      "Tu\u010Dn\xE9": "Georgia-Bold",
      "Vet": "Georgia-Bold",
      "Vet Cursief": "Georgia-BoldItalic",
      "fed": "Georgia-Bold",
      "fed kursiv": "Georgia-BoldItalic",
      "kursiv": "Georgia-Italic",
      "kurz\xEDva": "Georgia-Italic",
      "normal": "Georgia",
      "oby\u010Dejn\xE9": "Georgia",
      "tu\u010Dn\xE9": "Georgia-Bold",
      "tu\u010Dn\xE9 kurz\xEDva": "Georgia-BoldItalic",
      "\u0130talik": "Georgia-Italic",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "Georgia-Bold",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "Georgia-BoldItalic",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "Georgia",
      "\u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "Georgia-Italic",
      "\u041A\u0443\u0440\u0441\u0438\u0432": "Georgia-Italic",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "Georgia",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "Georgia-Bold",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": "Georgia-BoldItalic"
    },
    "Georgia Bold": {
      "Bold": "Georgia-Bold",
      "Regular": "Georgia-Bold"
    },
    "Georgia Bold Italic": {
      "Bold Italic": "Georgia-BoldItalic",
      "Regular": "Georgia-BoldItalic"
    },
    "Georgia Corsivo": {
      "Regular": "Georgia-Italic"
    },
    "Georgia Cursief": {
      "Regular": "Georgia-Italic"
    },
    "Georgia Cursiva": {
      "Regular": "Georgia-Italic"
    },
    "Georgia D\u0151lt": {
      "Regular": "Georgia-Italic"
    },
    "Georgia Etzana": {
      "Regular": "Georgia-Italic"
    },
    "Georgia Fet": {
      "Regular": "Georgia-Bold"
    },
    "Georgia Fet Kursiv": {
      "Regular": "Georgia-BoldItalic"
    },
    "Georgia Fett": {
      "Regular": "Georgia-Bold"
    },
    "Georgia Fett Kursiv": {
      "Regular": "Georgia-BoldItalic"
    },
    "Georgia F\xE9lk\xF6v\xE9r": {
      "Regular": "Georgia-Bold"
    },
    "Georgia F\xE9lk\xF6v\xE9r d\u0151lt": {
      "Regular": "Georgia-BoldItalic"
    },
    "Georgia Gras": {
      "Regular": "Georgia-Bold"
    },
    "Georgia Gras Italique": {
      "Regular": "Georgia-BoldItalic"
    },
    "Georgia Grassetto": {
      "Regular": "Georgia-Bold"
    },
    "Georgia Grassetto Corsivo": {
      "Regular": "Georgia-BoldItalic"
    },
    "Georgia Halvfet": {
      "Regular": "Georgia-Bold"
    },
    "Georgia Halvfet Kursiv": {
      "Regular": "Georgia-BoldItalic"
    },
    "Georgia Italic": {
      "Italic": "Georgia-Italic",
      "Regular": "Georgia-Italic"
    },
    "Georgia Italique": {
      "Regular": "Georgia-Italic"
    },
    "Georgia It\xE1lico": {
      "Regular": "Georgia-Italic"
    },
    "Georgia Kal\u0131n": {
      "Regular": "Georgia-Bold"
    },
    "Georgia Kal\u0131n \u0130talik": {
      "Regular": "Georgia-BoldItalic"
    },
    "Georgia Krepko": {
      "Regular": "Georgia-Bold"
    },
    "Georgia Krepko po\u0161evno": {
      "Regular": "Georgia-BoldItalic"
    },
    "Georgia Kursiv": {
      "Regular": "Georgia-Italic"
    },
    "Georgia Kursivoitu": {
      "Regular": "Georgia-Italic"
    },
    "Georgia Kursywa": {
      "Regular": "Georgia-Italic"
    },
    "Georgia Kurz\xEDva": {
      "Regular": "Georgia-Italic"
    },
    "Georgia Lihavoitu": {
      "Regular": "Georgia-Bold"
    },
    "Georgia Lihavoitu Kursivoi": {
      "Regular": "Georgia-BoldItalic"
    },
    "Georgia Lodi etzana": {
      "Regular": "Georgia-BoldItalic"
    },
    "Georgia Lodia": {
      "Regular": "Georgia-Bold"
    },
    "Georgia Negreta": {
      "Regular": "Georgia-Bold"
    },
    "Georgia Negreta cursiva": {
      "Regular": "Georgia-BoldItalic"
    },
    "Georgia Negrita": {
      "Regular": "Georgia-Bold"
    },
    "Georgia Negrita Cursiva": {
      "Regular": "Georgia-BoldItalic"
    },
    "Georgia Negrito": {
      "Regular": "Georgia-Bold"
    },
    "Georgia Negrito It\xE1lico": {
      "Regular": "Georgia-BoldItalic"
    },
    "Georgia Pogrubiona kursywa": {
      "Regular": "Georgia-BoldItalic"
    },
    "Georgia Pogrubiony": {
      "Regular": "Georgia-Bold"
    },
    "Georgia Po\u0161evno": {
      "Regular": "Georgia-Italic"
    },
    "Georgia Tu\u010Dn\xE1 kurz\xEDva": {
      "Regular": "Georgia-BoldItalic"
    },
    "Georgia Tu\u010Dn\xE9": {
      "Regular": "Georgia-Bold"
    },
    "Georgia Vet": {
      "Regular": "Georgia-Bold"
    },
    "Georgia Vet Cursief": {
      "Regular": "Georgia-BoldItalic"
    },
    "Georgia fed": {
      "Regular": "Georgia-Bold"
    },
    "Georgia fed kursiv": {
      "Regular": "Georgia-BoldItalic"
    },
    "Georgia kursiv": {
      "Regular": "Georgia-Italic"
    },
    "Georgia kurz\xEDva": {
      "Regular": "Georgia-Italic"
    },
    "Georgia tu\u010Dn\xE9": {
      "Regular": "Georgia-Bold"
    },
    "Georgia tu\u010Dn\xE9 kurz\xEDva": {
      "Regular": "Georgia-BoldItalic"
    },
    "Georgia \u0130talik": {
      "Regular": "Georgia-Italic"
    },
    "Georgia \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "Georgia-Bold"
    },
    "Georgia \u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "Georgia-BoldItalic"
    },
    "Georgia \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "Georgia-Italic"
    },
    "Georgia \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "Georgia-Italic"
    },
    "Georgia \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "Georgia-Bold"
    },
    "Georgia \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "Georgia-BoldItalic"
    },
    "Gigi": {
      "Arrunta": "Gigi-Regular",
      "Navadno": "Gigi-Regular",
      "Normaali": "Gigi-Regular",
      "Normal": "Gigi-Regular",
      "Normale": "Gigi-Regular",
      "Normalny": "Gigi-Regular",
      "Norm\xE1l": "Gigi-Regular",
      "Norm\xE1lne": "Gigi-Regular",
      "Regular": "Gigi-Regular",
      "Standaard": "Gigi-Regular",
      "Standard": "Gigi-Regular",
      "normal": "Gigi-Regular",
      "oby\u010Dejn\xE9": "Gigi-Regular",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "Gigi-Regular",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "Gigi-Regular"
    },
    "Gill Sans MT": {
      "Arrunta": "GillSansMT",
      "Bold": "GillSansMT-Bold",
      "Bold Italic": "GillSansMT-BoldItalic",
      "Corsivo": "GillSansMT-Italic",
      "Cursief": "GillSansMT-Italic",
      "Cursiva": "GillSansMT-Italic",
      "D\u0151lt": "GillSansMT-Italic",
      "Etzana": "GillSansMT-Italic",
      "Fet": "GillSansMT-Bold",
      "Fet Kursiv": "GillSansMT-BoldItalic",
      "Fett": "GillSansMT-Bold",
      "Fett Kursiv": "GillSansMT-BoldItalic",
      "F\xE9lk\xF6v\xE9r": "GillSansMT-Bold",
      "F\xE9lk\xF6v\xE9r d\u0151lt": "GillSansMT-BoldItalic",
      "Gras": "GillSansMT-Bold",
      "Gras Italique": "GillSansMT-BoldItalic",
      "Grassetto": "GillSansMT-Bold",
      "Grassetto Corsivo": "GillSansMT-BoldItalic",
      "Halvfet": "GillSansMT-Bold",
      "Halvfet Kursiv": "GillSansMT-BoldItalic",
      "Italic": "GillSansMT-Italic",
      "Italique": "GillSansMT-Italic",
      "It\xE1lico": "GillSansMT-Italic",
      "Kal\u0131n": "GillSansMT-Bold",
      "Kal\u0131n \u0130talik": "GillSansMT-BoldItalic",
      "Krepko": "GillSansMT-Bold",
      "Krepko po\u0161evno": "GillSansMT-BoldItalic",
      "Kursiv": "GillSansMT-Italic",
      "Kursivoitu": "GillSansMT-Italic",
      "Kursywa": "GillSansMT-Italic",
      "Kurz\xEDva": "GillSansMT-Italic",
      "Lihavoitu": "GillSansMT-Bold",
      "Lihavoitu Kursivoi": "GillSansMT-BoldItalic",
      "Lodi etzana": "GillSansMT-BoldItalic",
      "Lodia": "GillSansMT-Bold",
      "Navadno": "GillSansMT",
      "Negreta": "GillSansMT-Bold",
      "Negreta cursiva": "GillSansMT-BoldItalic",
      "Negrita": "GillSansMT-Bold",
      "Negrita Cursiva": "GillSansMT-BoldItalic",
      "Negrito": "GillSansMT-Bold",
      "Negrito It\xE1lico": "GillSansMT-BoldItalic",
      "Normaali": "GillSansMT",
      "Normal": "GillSansMT",
      "Normale": "GillSansMT",
      "Normalny": "GillSansMT",
      "Norm\xE1l": "GillSansMT",
      "Norm\xE1lne": "GillSansMT",
      "Pogrubiona kursywa": "GillSansMT-BoldItalic",
      "Pogrubiony": "GillSansMT-Bold",
      "Po\u0161evno": "GillSansMT-Italic",
      "Regular": "GillSansMT-Condensed",
      "Standaard": "GillSansMT",
      "Standard": "GillSansMT",
      "Tu\u010Dn\xE1 kurz\xEDva": "GillSansMT-BoldItalic",
      "Tu\u010Dn\xE9": "GillSansMT-Bold",
      "Vet": "GillSansMT-Bold",
      "Vet Cursief": "GillSansMT-BoldItalic",
      "fed": "GillSansMT-Bold",
      "fed kursiv": "GillSansMT-BoldItalic",
      "kursiv": "GillSansMT-Italic",
      "kurz\xEDva": "GillSansMT-Italic",
      "normal": "GillSansMT",
      "oby\u010Dejn\xE9": "GillSansMT",
      "tu\u010Dn\xE9": "GillSansMT-Bold",
      "tu\u010Dn\xE9 kurz\xEDva": "GillSansMT-BoldItalic",
      "\u0130talik": "GillSansMT-Italic",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "GillSansMT-Bold",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "GillSansMT-BoldItalic",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "GillSansMT",
      "\u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "GillSansMT-Italic",
      "\u041A\u0443\u0440\u0441\u0438\u0432": "GillSansMT-Italic",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "GillSansMT",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "GillSansMT-Bold",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": "GillSansMT-BoldItalic"
    },
    "Gill Sans MT Bold": {
      "Bold": "GillSansMT-Bold",
      "Regular": "GillSansMT-Bold"
    },
    "Gill Sans MT Bold Italic": {
      "Bold Italic": "GillSansMT-BoldItalic",
      "Regular": "GillSansMT-BoldItalic"
    },
    "Gill Sans MT Condensed": {
      "Arrunta": "GillSansMT-Condensed",
      "Navadno": "GillSansMT-Condensed",
      "Normaali": "GillSansMT-Condensed",
      "Normal": "GillSansMT-Condensed",
      "Normale": "GillSansMT-Condensed",
      "Normalny": "GillSansMT-Condensed",
      "Norm\xE1l": "GillSansMT-Condensed",
      "Norm\xE1lne": "GillSansMT-Condensed",
      "Regular": "GillSansMT-Condensed",
      "Standaard": "GillSansMT-Condensed",
      "Standard": "GillSansMT-Condensed",
      "normal": "GillSansMT-Condensed",
      "oby\u010Dejn\xE9": "GillSansMT-Condensed",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "GillSansMT-Condensed",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "GillSansMT-Condensed"
    },
    "Gill Sans MT Corsivo": {
      "Regular": "GillSansMT-Italic"
    },
    "Gill Sans MT Cursief": {
      "Regular": "GillSansMT-Italic"
    },
    "Gill Sans MT Cursiva": {
      "Regular": "GillSansMT-Italic"
    },
    "Gill Sans MT D\u0151lt": {
      "Regular": "GillSansMT-Italic"
    },
    "Gill Sans MT Etzana": {
      "Regular": "GillSansMT-Italic"
    },
    "Gill Sans MT Ext": {
      "Regular": "GillSansMT-ExtraCondensedBold"
    },
    "Gill Sans MT Ext Condensed Bold": {
      "Arrunta": "GillSansMT-ExtraCondensedBold",
      "Navadno": "GillSansMT-ExtraCondensedBold",
      "Normaali": "GillSansMT-ExtraCondensedBold",
      "Normal": "GillSansMT-ExtraCondensedBold",
      "Normale": "GillSansMT-ExtraCondensedBold",
      "Normalny": "GillSansMT-ExtraCondensedBold",
      "Norm\xE1l": "GillSansMT-ExtraCondensedBold",
      "Norm\xE1lne": "GillSansMT-ExtraCondensedBold",
      "Regular": "GillSansMT-ExtraCondensedBold",
      "Standaard": "GillSansMT-ExtraCondensedBold",
      "Standard": "GillSansMT-ExtraCondensedBold",
      "normal": "GillSansMT-ExtraCondensedBold",
      "oby\u010Dejn\xE9": "GillSansMT-ExtraCondensedBold",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "GillSansMT-ExtraCondensedBold",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "GillSansMT-ExtraCondensedBold"
    },
    "Gill Sans MT Fet": {
      "Regular": "GillSansMT-Bold"
    },
    "Gill Sans MT Fet Kursiv": {
      "Regular": "GillSansMT-BoldItalic"
    },
    "Gill Sans MT Fett": {
      "Regular": "GillSansMT-Bold"
    },
    "Gill Sans MT Fett Kursiv": {
      "Regular": "GillSansMT-BoldItalic"
    },
    "Gill Sans MT F\xE9lk\xF6v\xE9r": {
      "Regular": "GillSansMT-Bold"
    },
    "Gill Sans MT F\xE9lk\xF6v\xE9r d\u0151lt": {
      "Regular": "GillSansMT-BoldItalic"
    },
    "Gill Sans MT Gras": {
      "Regular": "GillSansMT-Bold"
    },
    "Gill Sans MT Gras Italique": {
      "Regular": "GillSansMT-BoldItalic"
    },
    "Gill Sans MT Grassetto": {
      "Regular": "GillSansMT-Bold"
    },
    "Gill Sans MT Grassetto Corsivo": {
      "Regular": "GillSansMT-BoldItalic"
    },
    "Gill Sans MT Halvfet": {
      "Regular": "GillSansMT-Bold"
    },
    "Gill Sans MT Halvfet Kursiv": {
      "Regular": "GillSansMT-BoldItalic"
    },
    "Gill Sans MT Italic": {
      "Italic": "GillSansMT-Italic",
      "Regular": "GillSansMT-Italic"
    },
    "Gill Sans MT Italique": {
      "Regular": "GillSansMT-Italic"
    },
    "Gill Sans MT It\xE1lico": {
      "Regular": "GillSansMT-Italic"
    },
    "Gill Sans MT Kal\u0131n": {
      "Regular": "GillSansMT-Bold"
    },
    "Gill Sans MT Kal\u0131n \u0130talik": {
      "Regular": "GillSansMT-BoldItalic"
    },
    "Gill Sans MT Krepko": {
      "Regular": "GillSansMT-Bold"
    },
    "Gill Sans MT Krepko po\u0161evno": {
      "Regular": "GillSansMT-BoldItalic"
    },
    "Gill Sans MT Kursiv": {
      "Regular": "GillSansMT-Italic"
    },
    "Gill Sans MT Kursivoitu": {
      "Regular": "GillSansMT-Italic"
    },
    "Gill Sans MT Kursywa": {
      "Regular": "GillSansMT-Italic"
    },
    "Gill Sans MT Kurz\xEDva": {
      "Regular": "GillSansMT-Italic"
    },
    "Gill Sans MT Lihavoitu": {
      "Regular": "GillSansMT-Bold"
    },
    "Gill Sans MT Lihavoitu Kursivoi": {
      "Regular": "GillSansMT-BoldItalic"
    },
    "Gill Sans MT Lodi etzana": {
      "Regular": "GillSansMT-BoldItalic"
    },
    "Gill Sans MT Lodia": {
      "Regular": "GillSansMT-Bold"
    },
    "Gill Sans MT Negreta": {
      "Regular": "GillSansMT-Bold"
    },
    "Gill Sans MT Negreta cursiva": {
      "Regular": "GillSansMT-BoldItalic"
    },
    "Gill Sans MT Negrita": {
      "Regular": "GillSansMT-Bold"
    },
    "Gill Sans MT Negrita Cursiva": {
      "Regular": "GillSansMT-BoldItalic"
    },
    "Gill Sans MT Negrito": {
      "Regular": "GillSansMT-Bold"
    },
    "Gill Sans MT Negrito It\xE1lico": {
      "Regular": "GillSansMT-BoldItalic"
    },
    "Gill Sans MT Pogrubiona kursywa": {
      "Regular": "GillSansMT-BoldItalic"
    },
    "Gill Sans MT Pogrubiony": {
      "Regular": "GillSansMT-Bold"
    },
    "Gill Sans MT Po\u0161evno": {
      "Regular": "GillSansMT-Italic"
    },
    "Gill Sans MT Tu\u010Dn\xE1 kurz\xEDva": {
      "Regular": "GillSansMT-BoldItalic"
    },
    "Gill Sans MT Tu\u010Dn\xE9": {
      "Regular": "GillSansMT-Bold"
    },
    "Gill Sans MT Vet": {
      "Regular": "GillSansMT-Bold"
    },
    "Gill Sans MT Vet Cursief": {
      "Regular": "GillSansMT-BoldItalic"
    },
    "Gill Sans MT fed": {
      "Regular": "GillSansMT-Bold"
    },
    "Gill Sans MT fed kursiv": {
      "Regular": "GillSansMT-BoldItalic"
    },
    "Gill Sans MT kursiv": {
      "Regular": "GillSansMT-Italic"
    },
    "Gill Sans MT kurz\xEDva": {
      "Regular": "GillSansMT-Italic"
    },
    "Gill Sans MT tu\u010Dn\xE9": {
      "Regular": "GillSansMT-Bold"
    },
    "Gill Sans MT tu\u010Dn\xE9 kurz\xEDva": {
      "Regular": "GillSansMT-BoldItalic"
    },
    "Gill Sans MT \u0130talik": {
      "Regular": "GillSansMT-Italic"
    },
    "Gill Sans MT \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "GillSansMT-Bold"
    },
    "Gill Sans MT \u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "GillSansMT-BoldItalic"
    },
    "Gill Sans MT \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "GillSansMT-Italic"
    },
    "Gill Sans MT \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "GillSansMT-Italic"
    },
    "Gill Sans MT \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "GillSansMT-Bold"
    },
    "Gill Sans MT \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "GillSansMT-BoldItalic"
    },
    "Gill Sans Ultra": {
      "Regular": "GillSans-UltraBold"
    },
    "Gill Sans Ultra Bold": {
      "Arrunta": "GillSans-UltraBold",
      "Navadno": "GillSans-UltraBold",
      "Normaali": "GillSans-UltraBold",
      "Normal": "GillSans-UltraBold",
      "Normale": "GillSans-UltraBold",
      "Normalny": "GillSans-UltraBold",
      "Norm\xE1l": "GillSans-UltraBold",
      "Norm\xE1lne": "GillSans-UltraBold",
      "Regular": "GillSans-UltraBoldCondensed",
      "Standaard": "GillSans-UltraBold",
      "Standard": "GillSans-UltraBold",
      "normal": "GillSans-UltraBold",
      "oby\u010Dejn\xE9": "GillSans-UltraBold",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "GillSans-UltraBold",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "GillSans-UltraBold"
    },
    "Gill Sans Ultra Bold Condensed": {
      "Arrunta": "GillSans-UltraBoldCondensed",
      "Navadno": "GillSans-UltraBoldCondensed",
      "Normaali": "GillSans-UltraBoldCondensed",
      "Normal": "GillSans-UltraBoldCondensed",
      "Normale": "GillSans-UltraBoldCondensed",
      "Normalny": "GillSans-UltraBoldCondensed",
      "Norm\xE1l": "GillSans-UltraBoldCondensed",
      "Norm\xE1lne": "GillSans-UltraBoldCondensed",
      "Regular": "GillSans-UltraBoldCondensed",
      "Standaard": "GillSans-UltraBoldCondensed",
      "Standard": "GillSans-UltraBoldCondensed",
      "normal": "GillSans-UltraBoldCondensed",
      "oby\u010Dejn\xE9": "GillSans-UltraBoldCondensed",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "GillSans-UltraBoldCondensed",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "GillSans-UltraBoldCondensed"
    },
    "Gloucester MT Extra": {
      "Regular": "GloucesterMT-ExtraCondensed"
    },
    "Gloucester MT Extra Condensed": {
      "Regular": "GloucesterMT-ExtraCondensed"
    },
    "Goudy Old Style": {
      "Arrunta": "GoudyOldStyleT-Regular",
      "Bold": "GoudyOldStyleT-Bold",
      "Corsivo": "GoudyOldStyleT-Italic",
      "Cursief": "GoudyOldStyleT-Italic",
      "Cursiva": "GoudyOldStyleT-Italic",
      "D\u0151lt": "GoudyOldStyleT-Italic",
      "Etzana": "GoudyOldStyleT-Italic",
      "Fet": "GoudyOldStyleT-Bold",
      "Fett": "GoudyOldStyleT-Bold",
      "F\xE9lk\xF6v\xE9r": "GoudyOldStyleT-Bold",
      "Gras": "GoudyOldStyleT-Bold",
      "Grassetto": "GoudyOldStyleT-Bold",
      "Halvfet": "GoudyOldStyleT-Bold",
      "Italic": "GoudyOldStyleT-Italic",
      "Italique": "GoudyOldStyleT-Italic",
      "It\xE1lico": "GoudyOldStyleT-Italic",
      "Kal\u0131n": "GoudyOldStyleT-Bold",
      "Krepko": "GoudyOldStyleT-Bold",
      "Kursiv": "GoudyOldStyleT-Italic",
      "Kursivoitu": "GoudyOldStyleT-Italic",
      "Kursywa": "GoudyOldStyleT-Italic",
      "Kurz\xEDva": "GoudyOldStyleT-Italic",
      "Lihavoitu": "GoudyOldStyleT-Bold",
      "Lodia": "GoudyOldStyleT-Bold",
      "Navadno": "GoudyOldStyleT-Regular",
      "Negreta": "GoudyOldStyleT-Bold",
      "Negrita": "GoudyOldStyleT-Bold",
      "Negrito": "GoudyOldStyleT-Bold",
      "Normaali": "GoudyOldStyleT-Regular",
      "Normal": "GoudyOldStyleT-Regular",
      "Normale": "GoudyOldStyleT-Regular",
      "Normalny": "GoudyOldStyleT-Regular",
      "Norm\xE1l": "GoudyOldStyleT-Regular",
      "Norm\xE1lne": "GoudyOldStyleT-Regular",
      "Pogrubiony": "GoudyOldStyleT-Bold",
      "Po\u0161evno": "GoudyOldStyleT-Italic",
      "Regular": "GoudyOldStyleT-Regular",
      "Standaard": "GoudyOldStyleT-Regular",
      "Standard": "GoudyOldStyleT-Regular",
      "Tu\u010Dn\xE9": "GoudyOldStyleT-Bold",
      "Vet": "GoudyOldStyleT-Bold",
      "fed": "GoudyOldStyleT-Bold",
      "kursiv": "GoudyOldStyleT-Italic",
      "kurz\xEDva": "GoudyOldStyleT-Italic",
      "normal": "GoudyOldStyleT-Regular",
      "oby\u010Dejn\xE9": "GoudyOldStyleT-Regular",
      "tu\u010Dn\xE9": "GoudyOldStyleT-Bold",
      "\u0130talik": "GoudyOldStyleT-Italic",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "GoudyOldStyleT-Bold",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "GoudyOldStyleT-Regular",
      "\u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "GoudyOldStyleT-Italic",
      "\u041A\u0443\u0440\u0441\u0438\u0432": "GoudyOldStyleT-Italic",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "GoudyOldStyleT-Regular",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "GoudyOldStyleT-Bold"
    },
    "Goudy Old Style Bold": {
      "Bold": "GoudyOldStyleT-Bold",
      "Regular": "GoudyOldStyleT-Bold"
    },
    "Goudy Old Style Corsivo": {
      "Regular": "GoudyOldStyleT-Italic"
    },
    "Goudy Old Style Cursief": {
      "Regular": "GoudyOldStyleT-Italic"
    },
    "Goudy Old Style Cursiva": {
      "Regular": "GoudyOldStyleT-Italic"
    },
    "Goudy Old Style D\u0151lt": {
      "Regular": "GoudyOldStyleT-Italic"
    },
    "Goudy Old Style Etzana": {
      "Regular": "GoudyOldStyleT-Italic"
    },
    "Goudy Old Style Fet": {
      "Regular": "GoudyOldStyleT-Bold"
    },
    "Goudy Old Style Fett": {
      "Regular": "GoudyOldStyleT-Bold"
    },
    "Goudy Old Style F\xE9lk\xF6v\xE9r": {
      "Regular": "GoudyOldStyleT-Bold"
    },
    "Goudy Old Style Gras": {
      "Regular": "GoudyOldStyleT-Bold"
    },
    "Goudy Old Style Grassetto": {
      "Regular": "GoudyOldStyleT-Bold"
    },
    "Goudy Old Style Halvfet": {
      "Regular": "GoudyOldStyleT-Bold"
    },
    "Goudy Old Style Italic": {
      "Italic": "GoudyOldStyleT-Italic",
      "Regular": "GoudyOldStyleT-Italic"
    },
    "Goudy Old Style Italique": {
      "Regular": "GoudyOldStyleT-Italic"
    },
    "Goudy Old Style It\xE1lico": {
      "Regular": "GoudyOldStyleT-Italic"
    },
    "Goudy Old Style Kal\u0131n": {
      "Regular": "GoudyOldStyleT-Bold"
    },
    "Goudy Old Style Krepko": {
      "Regular": "GoudyOldStyleT-Bold"
    },
    "Goudy Old Style Kursiv": {
      "Regular": "GoudyOldStyleT-Italic"
    },
    "Goudy Old Style Kursivoitu": {
      "Regular": "GoudyOldStyleT-Italic"
    },
    "Goudy Old Style Kursywa": {
      "Regular": "GoudyOldStyleT-Italic"
    },
    "Goudy Old Style Kurz\xEDva": {
      "Regular": "GoudyOldStyleT-Italic"
    },
    "Goudy Old Style Lihavoitu": {
      "Regular": "GoudyOldStyleT-Bold"
    },
    "Goudy Old Style Lodia": {
      "Regular": "GoudyOldStyleT-Bold"
    },
    "Goudy Old Style Negreta": {
      "Regular": "GoudyOldStyleT-Bold"
    },
    "Goudy Old Style Negrita": {
      "Regular": "GoudyOldStyleT-Bold"
    },
    "Goudy Old Style Negrito": {
      "Regular": "GoudyOldStyleT-Bold"
    },
    "Goudy Old Style Pogrubiony": {
      "Regular": "GoudyOldStyleT-Bold"
    },
    "Goudy Old Style Po\u0161evno": {
      "Regular": "GoudyOldStyleT-Italic"
    },
    "Goudy Old Style Tu\u010Dn\xE9": {
      "Regular": "GoudyOldStyleT-Bold"
    },
    "Goudy Old Style Vet": {
      "Regular": "GoudyOldStyleT-Bold"
    },
    "Goudy Old Style fed": {
      "Regular": "GoudyOldStyleT-Bold"
    },
    "Goudy Old Style kursiv": {
      "Regular": "GoudyOldStyleT-Italic"
    },
    "Goudy Old Style kurz\xEDva": {
      "Regular": "GoudyOldStyleT-Italic"
    },
    "Goudy Old Style tu\u010Dn\xE9": {
      "Regular": "GoudyOldStyleT-Bold"
    },
    "Goudy Old Style \u0130talik": {
      "Regular": "GoudyOldStyleT-Italic"
    },
    "Goudy Old Style \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "GoudyOldStyleT-Bold"
    },
    "Goudy Old Style \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "GoudyOldStyleT-Italic"
    },
    "Goudy Old Style \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "GoudyOldStyleT-Italic"
    },
    "Goudy Old Style \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "GoudyOldStyleT-Bold"
    },
    "Goudy Stout": {
      "Arrunta": "GoudyStout",
      "Navadno": "GoudyStout",
      "Normaali": "GoudyStout",
      "Normal": "GoudyStout",
      "Normale": "GoudyStout",
      "Normalny": "GoudyStout",
      "Norm\xE1l": "GoudyStout",
      "Norm\xE1lne": "GoudyStout",
      "Regular": "GoudyStout",
      "Standaard": "GoudyStout",
      "Standard": "GoudyStout",
      "normal": "GoudyStout",
      "oby\u010Dejn\xE9": "GoudyStout",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "GoudyStout",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "GoudyStout"
    },
    "HYYeYXSJ": {
      "Regular": "HYYeYXSJ"
    },
    "HYZhongYuanB5": {
      "Regular": "HYZhongYuanB5"
    },
    "HYZhongYuanB5 Regular": {
      "Regular": "HYZhongYuanB5"
    },
    "Haettenschweiler": {
      "Arrunta": "Haettenschweiler",
      "Navadno": "Haettenschweiler",
      "Normaali": "Haettenschweiler",
      "Normal": "Haettenschweiler",
      "Normale": "Haettenschweiler",
      "Normalny": "Haettenschweiler",
      "Norm\xE1l": "Haettenschweiler",
      "Norm\xE1lne": "Haettenschweiler",
      "Regular": "Haettenschweiler",
      "Standaard": "Haettenschweiler",
      "Standard": "Haettenschweiler",
      "normal": "Haettenschweiler",
      "oby\u010Dejn\xE9": "Haettenschweiler",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "Haettenschweiler",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "Haettenschweiler"
    },
    "Harlow Solid": {
      "Italic": "HarlowSolid"
    },
    "Harlow Solid Italic": {
      "Italic": "HarlowSolid",
      "Regular": "HarlowSolid"
    },
    "Harrington": {
      "Arrunta": "Harrington",
      "Navadno": "Harrington",
      "Normaali": "Harrington",
      "Normal": "Harrington",
      "Normale": "Harrington",
      "Normalny": "Harrington",
      "Norm\xE1l": "Harrington",
      "Norm\xE1lne": "Harrington",
      "Regular": "Harrington",
      "Standaard": "Harrington",
      "Standard": "Harrington",
      "normal": "Harrington",
      "oby\u010Dejn\xE9": "Harrington",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "Harrington",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "Harrington"
    },
    "High Tower Text": {
      "Arrunta": "HighTowerText-Reg",
      "Corsivo": "HighTowerText-Italic",
      "Cursief": "HighTowerText-Italic",
      "Cursiva": "HighTowerText-Italic",
      "D\u0151lt": "HighTowerText-Italic",
      "Etzana": "HighTowerText-Italic",
      "Italic": "HighTowerText-Italic",
      "Italique": "HighTowerText-Italic",
      "It\xE1lico": "HighTowerText-Italic",
      "Kursiv": "HighTowerText-Italic",
      "Kursivoitu": "HighTowerText-Italic",
      "Kursywa": "HighTowerText-Italic",
      "Kurz\xEDva": "HighTowerText-Italic",
      "Navadno": "HighTowerText-Reg",
      "Normaali": "HighTowerText-Reg",
      "Normal": "HighTowerText-Reg",
      "Normale": "HighTowerText-Reg",
      "Normalny": "HighTowerText-Reg",
      "Norm\xE1l": "HighTowerText-Reg",
      "Norm\xE1lne": "HighTowerText-Reg",
      "Po\u0161evno": "HighTowerText-Italic",
      "Regular": "HighTowerText-Reg",
      "Standaard": "HighTowerText-Reg",
      "Standard": "HighTowerText-Reg",
      "kursiv": "HighTowerText-Italic",
      "kurz\xEDva": "HighTowerText-Italic",
      "normal": "HighTowerText-Reg",
      "oby\u010Dejn\xE9": "HighTowerText-Reg",
      "\u0130talik": "HighTowerText-Italic",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "HighTowerText-Reg",
      "\u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "HighTowerText-Italic",
      "\u041A\u0443\u0440\u0441\u0438\u0432": "HighTowerText-Italic",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "HighTowerText-Reg"
    },
    "High Tower Text Corsivo": {
      "Regular": "HighTowerText-Italic"
    },
    "High Tower Text Cursief": {
      "Regular": "HighTowerText-Italic"
    },
    "High Tower Text Cursiva": {
      "Regular": "HighTowerText-Italic"
    },
    "High Tower Text D\u0151lt": {
      "Regular": "HighTowerText-Italic"
    },
    "High Tower Text Etzana": {
      "Regular": "HighTowerText-Italic"
    },
    "High Tower Text Italic": {
      "Italic": "HighTowerText-Italic",
      "Regular": "HighTowerText-Italic"
    },
    "High Tower Text Italique": {
      "Regular": "HighTowerText-Italic"
    },
    "High Tower Text It\xE1lico": {
      "Regular": "HighTowerText-Italic"
    },
    "High Tower Text Kursiv": {
      "Regular": "HighTowerText-Italic"
    },
    "High Tower Text Kursivoitu": {
      "Regular": "HighTowerText-Italic"
    },
    "High Tower Text Kursywa": {
      "Regular": "HighTowerText-Italic"
    },
    "High Tower Text Kurz\xEDva": {
      "Regular": "HighTowerText-Italic"
    },
    "High Tower Text Po\u0161evno": {
      "Regular": "HighTowerText-Italic"
    },
    "High Tower Text kursiv": {
      "Regular": "HighTowerText-Italic"
    },
    "High Tower Text kurz\xEDva": {
      "Regular": "HighTowerText-Italic"
    },
    "High Tower Text \u0130talik": {
      "Regular": "HighTowerText-Italic"
    },
    "High Tower Text \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "HighTowerText-Italic"
    },
    "High Tower Text \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "HighTowerText-Italic"
    },
    "Holo MDL2 Assets": {
      "Regular": "HoloLensMDL2Assets"
    },
    "HoloLens MDL2 Assets": {
      "Arrunta": "HoloLensMDL2Assets",
      "Navadno": "HoloLensMDL2Assets",
      "Normaali": "HoloLensMDL2Assets",
      "Normal": "HoloLensMDL2Assets",
      "Normale": "HoloLensMDL2Assets",
      "Normalny": "HoloLensMDL2Assets",
      "Norm\xE1l": "HoloLensMDL2Assets",
      "Norm\xE1lne": "HoloLensMDL2Assets",
      "Regular": "HoloLensMDL2Assets",
      "Standaard": "HoloLensMDL2Assets",
      "Standard": "HoloLensMDL2Assets",
      "normal": "HoloLensMDL2Assets",
      "oby\u010Dejn\xE9": "HoloLensMDL2Assets",
      "th\u01B0\u01A1\u0300ng": "HoloLensMDL2Assets",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "HoloLensMDL2Assets",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "HoloLensMDL2Assets"
    },
    "Impact": {
      "Arrunta": "Impact",
      "Navadno": "Impact",
      "Normaali": "Impact",
      "Normal": "Impact",
      "Normale": "Impact",
      "Normalny": "Impact",
      "Norm\xE1l": "Impact",
      "Norm\xE1lne": "Impact",
      "Regular": "Impact",
      "Standaard": "Impact",
      "Standard": "Impact",
      "normal": "Impact",
      "oby\u010Dejn\xE9": "Impact",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "Impact",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "Impact"
    },
    "Imprint MT Shadow": {
      "Arrunta": "ImprintMT-Shadow",
      "Navadno": "ImprintMT-Shadow",
      "Normaali": "ImprintMT-Shadow",
      "Normal": "ImprintMT-Shadow",
      "Normale": "ImprintMT-Shadow",
      "Normalny": "ImprintMT-Shadow",
      "Norm\xE1l": "ImprintMT-Shadow",
      "Norm\xE1lne": "ImprintMT-Shadow",
      "Regular": "ImprintMT-Shadow",
      "Standaard": "ImprintMT-Shadow",
      "Standard": "ImprintMT-Shadow",
      "normal": "ImprintMT-Shadow",
      "oby\u010Dejn\xE9": "ImprintMT-Shadow",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "ImprintMT-Shadow",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "ImprintMT-Shadow"
    },
    "Informal Roman": {
      "Arrunta": "InformalRoman-Regular",
      "Navadno": "InformalRoman-Regular",
      "Normaali": "InformalRoman-Regular",
      "Normal": "InformalRoman-Regular",
      "Normale": "InformalRoman-Regular",
      "Normalny": "InformalRoman-Regular",
      "Norm\xE1l": "InformalRoman-Regular",
      "Norm\xE1lne": "InformalRoman-Regular",
      "Regular": "InformalRoman-Regular",
      "Standaard": "InformalRoman-Regular",
      "Standard": "InformalRoman-Regular",
      "normal": "InformalRoman-Regular",
      "oby\u010Dejn\xE9": "InformalRoman-Regular",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "InformalRoman-Regular",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "InformalRoman-Regular"
    },
    "Ink Free": {
      "Arrunta": "InkFree",
      "Navadno": "InkFree",
      "Normaali": "InkFree",
      "Normal": "InkFree",
      "Normale": "InkFree",
      "Normalny": "InkFree",
      "Norm\xE1l": "InkFree",
      "Norm\xE1lne": "InkFree",
      "Regular": "InkFree",
      "Standaard": "InkFree",
      "Standard": "InkFree",
      "normal": "InkFree",
      "oby\u010Dejn\xE9": "InkFree",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "InkFree",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "InkFree"
    },
    "Javanese Text": {
      "Arrunta": "JavaneseText",
      "Navadno": "JavaneseText",
      "Normaali": "JavaneseText",
      "Normal": "JavaneseText",
      "Normale": "JavaneseText",
      "Normalny": "JavaneseText",
      "Norm\xE1l": "JavaneseText",
      "Norm\xE1lne": "JavaneseText",
      "Regular": "JavaneseText",
      "Standaard": "JavaneseText",
      "Standard": "JavaneseText",
      "normal": "JavaneseText",
      "oby\u010Dejn\xE9": "JavaneseText",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "JavaneseText",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "JavaneseText"
    },
    "Jokerman": {
      "Arrunta": "Jokerman-Regular",
      "Navadno": "Jokerman-Regular",
      "Normaali": "Jokerman-Regular",
      "Normal": "Jokerman-Regular",
      "Normale": "Jokerman-Regular",
      "Normalny": "Jokerman-Regular",
      "Norm\xE1l": "Jokerman-Regular",
      "Norm\xE1lne": "Jokerman-Regular",
      "Regular": "Jokerman-Regular",
      "Standaard": "Jokerman-Regular",
      "Standard": "Jokerman-Regular",
      "normal": "Jokerman-Regular",
      "oby\u010Dejn\xE9": "Jokerman-Regular",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "Jokerman-Regular",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "Jokerman-Regular"
    },
    "Juice ITC": {
      "Arrunta": "JuiceITC-Regular",
      "Navadno": "JuiceITC-Regular",
      "Normaali": "JuiceITC-Regular",
      "Normal": "JuiceITC-Regular",
      "Normale": "JuiceITC-Regular",
      "Normalny": "JuiceITC-Regular",
      "Norm\xE1l": "JuiceITC-Regular",
      "Norm\xE1lne": "JuiceITC-Regular",
      "Regular": "JuiceITC-Regular",
      "Standaard": "JuiceITC-Regular",
      "Standard": "JuiceITC-Regular",
      "normal": "JuiceITC-Regular",
      "oby\u010Dejn\xE9": "JuiceITC-Regular",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "JuiceITC-Regular",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "JuiceITC-Regular"
    },
    "KacstBook": {
      "Medium": "KacstBook",
      "Regular": "KacstBook"
    },
    "KacstOffice": {
      "Medium": "KacstOffice",
      "Regular": "KacstOffice"
    },
    "KaiTi": {
      "Arrunta": "KaiTi",
      "Navadno": "KaiTi",
      "Normaali": "KaiTi",
      "Normal": "KaiTi",
      "Normale": "KaiTi",
      "Normalny": "KaiTi",
      "Norm\xE1l": "KaiTi",
      "Norm\xE1lne": "KaiTi",
      "Regular": "KaiTi",
      "Standaard": "KaiTi",
      "Standard": "KaiTi",
      "normal": "KaiTi",
      "oby\u010Dejn\xE9": "KaiTi",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "KaiTi",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "KaiTi"
    },
    "Kingsoft UE": {
      "Regular": "KingsoftUE"
    },
    "Kristen ITC": {
      "Arrunta": "KristenITC-Regular",
      "Navadno": "KristenITC-Regular",
      "Normaali": "KristenITC-Regular",
      "Normal": "KristenITC-Regular",
      "Normale": "KristenITC-Regular",
      "Normalny": "KristenITC-Regular",
      "Norm\xE1l": "KristenITC-Regular",
      "Norm\xE1lne": "KristenITC-Regular",
      "Regular": "KristenITC-Regular",
      "Standaard": "KristenITC-Regular",
      "Standard": "KristenITC-Regular",
      "normal": "KristenITC-Regular",
      "oby\u010Dejn\xE9": "KristenITC-Regular",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "KristenITC-Regular",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "KristenITC-Regular"
    },
    "Kunstler Script": {
      "Arrunta": "KunstlerScript",
      "Navadno": "KunstlerScript",
      "Normaali": "KunstlerScript",
      "Normal": "KunstlerScript",
      "Normale": "KunstlerScript",
      "Normalny": "KunstlerScript",
      "Norm\xE1l": "KunstlerScript",
      "Norm\xE1lne": "KunstlerScript",
      "Regular": "KunstlerScript",
      "Standaard": "KunstlerScript",
      "Standard": "KunstlerScript",
      "normal": "KunstlerScript",
      "oby\u010Dejn\xE9": "KunstlerScript",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "KunstlerScript",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "KunstlerScript"
    },
    "Leelawadee UI": {
      "Arrunta": "LeelawadeeUI",
      "Bold": "LeelawadeeUI-Bold",
      "Fet": "LeelawadeeUI-Bold",
      "Fett": "LeelawadeeUI-Bold",
      "F\xE9lk\xF6v\xE9r": "LeelawadeeUI-Bold",
      "Gras": "LeelawadeeUI-Bold",
      "Grassetto": "LeelawadeeUI-Bold",
      "Halvfet": "LeelawadeeUI-Bold",
      "Kal\u0131n": "LeelawadeeUI-Bold",
      "Krepko": "LeelawadeeUI-Bold",
      "Lihavoitu": "LeelawadeeUI-Bold",
      "Lodia": "LeelawadeeUI-Bold",
      "Navadno": "LeelawadeeUI",
      "Negreta": "LeelawadeeUI-Bold",
      "Negrita": "LeelawadeeUI-Bold",
      "Negrito": "LeelawadeeUI-Bold",
      "Normaali": "LeelawadeeUI",
      "Normal": "LeelawadeeUI",
      "Normale": "LeelawadeeUI",
      "Normalny": "LeelawadeeUI",
      "Norm\xE1l": "LeelawadeeUI",
      "Norm\xE1lne": "LeelawadeeUI",
      "Pogrubiony": "LeelawadeeUI-Bold",
      "Regular": "LeelawadeeUI",
      "Semilight": "LeelawadeeUI-Semilight",
      "Standaard": "LeelawadeeUI",
      "Standard": "LeelawadeeUI",
      "Tu\u010Dn\xE9": "LeelawadeeUI-Bold",
      "Vet": "LeelawadeeUI-Bold",
      "fed": "LeelawadeeUI-Bold",
      "normal": "LeelawadeeUI",
      "oby\u010Dejn\xE9": "LeelawadeeUI",
      "tu\u010Dn\xE9": "LeelawadeeUI-Bold",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "LeelawadeeUI-Bold",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "LeelawadeeUI",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "LeelawadeeUI",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "LeelawadeeUI-Bold"
    },
    "Leelawadee UI Bold": {
      "Bold": "LeelawadeeUI-Bold",
      "Regular": "LeelawadeeUI-Bold"
    },
    "Leelawadee UI Fet": {
      "Regular": "LeelawadeeUI-Bold"
    },
    "Leelawadee UI Fett": {
      "Regular": "LeelawadeeUI-Bold"
    },
    "Leelawadee UI F\xE9lk\xF6v\xE9r": {
      "Regular": "LeelawadeeUI-Bold"
    },
    "Leelawadee UI Gras": {
      "Regular": "LeelawadeeUI-Bold"
    },
    "Leelawadee UI Grassetto": {
      "Regular": "LeelawadeeUI-Bold"
    },
    "Leelawadee UI Halvfet": {
      "Regular": "LeelawadeeUI-Bold"
    },
    "Leelawadee UI Kal\u0131n": {
      "Regular": "LeelawadeeUI-Bold"
    },
    "Leelawadee UI Krepko": {
      "Regular": "LeelawadeeUI-Bold"
    },
    "Leelawadee UI Lihavoitu": {
      "Regular": "LeelawadeeUI-Bold"
    },
    "Leelawadee UI Lodia": {
      "Regular": "LeelawadeeUI-Bold"
    },
    "Leelawadee UI Negreta": {
      "Regular": "LeelawadeeUI-Bold"
    },
    "Leelawadee UI Negrita": {
      "Regular": "LeelawadeeUI-Bold"
    },
    "Leelawadee UI Negrito": {
      "Regular": "LeelawadeeUI-Bold"
    },
    "Leelawadee UI Pogrubiony": {
      "Regular": "LeelawadeeUI-Bold"
    },
    "Leelawadee UI Semilight": {
      "Arrunta": "LeelawadeeUI-Semilight",
      "Navadno": "LeelawadeeUI-Semilight",
      "Normaali": "LeelawadeeUI-Semilight",
      "Normal": "LeelawadeeUI-Semilight",
      "Normale": "LeelawadeeUI-Semilight",
      "Normalny": "LeelawadeeUI-Semilight",
      "Norm\xE1l": "LeelawadeeUI-Semilight",
      "Norm\xE1lne": "LeelawadeeUI-Semilight",
      "Regular": "LeelawadeeUI-Semilight",
      "Semilight": "LeelawadeeUI-Semilight",
      "Standaard": "LeelawadeeUI-Semilight",
      "Standard": "LeelawadeeUI-Semilight",
      "normal": "LeelawadeeUI-Semilight",
      "oby\u010Dejn\xE9": "LeelawadeeUI-Semilight",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "LeelawadeeUI-Semilight",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "LeelawadeeUI-Semilight"
    },
    "Leelawadee UI Semilight Arrunta": {
      "Regular": "LeelawadeeUI-Semilight"
    },
    "Leelawadee UI Semilight Navadno": {
      "Regular": "LeelawadeeUI-Semilight"
    },
    "Leelawadee UI Semilight Normaali": {
      "Regular": "LeelawadeeUI-Semilight"
    },
    "Leelawadee UI Semilight Normal": {
      "Regular": "LeelawadeeUI-Semilight"
    },
    "Leelawadee UI Semilight Normale": {
      "Regular": "LeelawadeeUI-Semilight"
    },
    "Leelawadee UI Semilight Normalny": {
      "Regular": "LeelawadeeUI-Semilight"
    },
    "Leelawadee UI Semilight Norm\xE1l": {
      "Regular": "LeelawadeeUI-Semilight"
    },
    "Leelawadee UI Semilight Norm\xE1lne": {
      "Regular": "LeelawadeeUI-Semilight"
    },
    "Leelawadee UI Semilight Standaard": {
      "Regular": "LeelawadeeUI-Semilight"
    },
    "Leelawadee UI Semilight Standard": {
      "Regular": "LeelawadeeUI-Semilight"
    },
    "Leelawadee UI Semilight normal": {
      "Regular": "LeelawadeeUI-Semilight"
    },
    "Leelawadee UI Semilight oby\u010Dejn\xE9": {
      "Regular": "LeelawadeeUI-Semilight"
    },
    "Leelawadee UI Semilight \u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": {
      "Regular": "LeelawadeeUI-Semilight"
    },
    "Leelawadee UI Semilight \u041E\u0431\u044B\u0447\u043D\u044B\u0439": {
      "Regular": "LeelawadeeUI-Semilight"
    },
    "Leelawadee UI Tu\u010Dn\xE9": {
      "Regular": "LeelawadeeUI-Bold"
    },
    "Leelawadee UI Vet": {
      "Regular": "LeelawadeeUI-Bold"
    },
    "Leelawadee UI fed": {
      "Regular": "LeelawadeeUI-Bold"
    },
    "Leelawadee UI tu\u010Dn\xE9": {
      "Regular": "LeelawadeeUI-Bold"
    },
    "Leelawadee UI \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "LeelawadeeUI-Bold"
    },
    "Leelawadee UI \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "LeelawadeeUI-Bold"
    },
    "LiSu": {
      "Regular": "LiSu"
    },
    "Liberation Mono": {
      "Bold": "LiberationMono-Bold",
      "Bold Italic": "LiberationMono-BoldItalic",
      "Italic": "LiberationMono-Italic",
      "Regular": "LiberationMono"
    },
    "Liberation Mono Bold": {
      "Bold": "LiberationMono-Bold",
      "Regular": "LiberationMono-Bold"
    },
    "Liberation Mono Bold Italic": {
      "Bold Italic": "LiberationMono-BoldItalic",
      "Regular": "LiberationMono-BoldItalic"
    },
    "Liberation Mono Italic": {
      "Italic": "LiberationMono-Italic",
      "Regular": "LiberationMono-Italic"
    },
    "Liberation Sans": {
      "Bold": "LiberationSansNarrow-Bold",
      "Bold Italic": "LiberationSans-BoldItalic",
      "Italic": "LiberationSans-Italic",
      "Regular": "LiberationSans"
    },
    "Liberation Sans Bold": {
      "Bold": "LiberationSans-Bold",
      "Regular": "LiberationSans-Bold"
    },
    "Liberation Sans Bold Italic": {
      "Bold Italic": "LiberationSans-BoldItalic",
      "Regular": "LiberationSans-BoldItalic"
    },
    "Liberation Sans Italic": {
      "Italic": "LiberationSans-Italic",
      "Regular": "LiberationSans-Italic"
    },
    "Liberation Sans Narrow": {
      "Bold": "LiberationSansNarrow-Bold",
      "Bold Italic": "LiberationSansNarrow-BoldItalic",
      "Italic": "LiberationSansNarrow-Italic",
      "Regular": "LiberationSansNarrow"
    },
    "Liberation Sans Narrow Bold": {
      "Bold": "LiberationSansNarrow-Bold",
      "Regular": "LiberationSansNarrow-Bold"
    },
    "Liberation Sans Narrow Bold Italic": {
      "Bold Italic": "LiberationSansNarrow-BoldItalic",
      "Regular": "LiberationSansNarrow-BoldItalic"
    },
    "Liberation Sans Narrow Italic": {
      "Italic": "LiberationSansNarrow-Italic",
      "Regular": "LiberationSansNarrow-Italic"
    },
    "Liberation Serif": {
      "Bold": "LiberationSerif-Bold",
      "Bold Italic": "LiberationSerif-BoldItalic",
      "Italic": "LiberationSerif-Italic",
      "Regular": "LiberationSerif"
    },
    "Liberation Serif Bold": {
      "Bold": "LiberationSerif-Bold",
      "Regular": "LiberationSerif-Bold"
    },
    "Liberation Serif Bold Italic": {
      "Bold Italic": "LiberationSerif-BoldItalic",
      "Regular": "LiberationSerif-BoldItalic"
    },
    "Liberation Serif Italic": {
      "Italic": "LiberationSerif-Italic",
      "Regular": "LiberationSerif-Italic"
    },
    "Linux Biolinum G": {
      "Bold": "LinuxBiolinumGB",
      "Italic": "LinuxBiolinumGI",
      "Regular": "LinuxBiolinumG"
    },
    "Linux Biolinum G Bold": {
      "Bold": "LinuxBiolinumGB",
      "Regular": "LinuxBiolinumGB"
    },
    "Linux Biolinum G Italic": {
      "Italic": "LinuxBiolinumGI",
      "Regular": "LinuxBiolinumGI"
    },
    "Linux Biolinum G Regular": {
      "Regular": "LinuxBiolinumG"
    },
    "Linux Libertine Display G": {
      "Regular": "LinuxLibertineDG"
    },
    "Linux Libertine G": {
      "Bold": "LinuxLibertineGB",
      "Bold Italic": "LinuxLibertineGBI",
      "Italic": "LinuxLibertineGI",
      "Regular": "LinuxLibertineG",
      "Semibold": "LinuxLibertineGZ",
      "Semibold Italic": "LinuxLibertineGZI"
    },
    "Linux Libertine G Bold": {
      "Bold": "LinuxLibertineGB",
      "Regular": "LinuxLibertineGB"
    },
    "Linux Libertine G Bold Italic": {
      "Bold Italic": "LinuxLibertineGBI",
      "Regular": "LinuxLibertineGBI"
    },
    "Linux Libertine G Display": {
      "Regular": "LinuxLibertineDG"
    },
    "Linux Libertine G Display Regular": {
      "Regular": "LinuxLibertineDG"
    },
    "Linux Libertine G Italic": {
      "Italic": "LinuxLibertineGI",
      "Regular": "LinuxLibertineGI"
    },
    "Linux Libertine G Regular": {
      "Regular": "LinuxLibertineG"
    },
    "Linux Libertine G Semibold": {
      "Regular": "LinuxLibertineGZ",
      "Semibold": "LinuxLibertineGZ"
    },
    "Linux Libertine G Semibold Italic": {
      "Regular": "LinuxLibertineGZI",
      "Semibold Italic": "LinuxLibertineGZI"
    },
    "Lucida Bright": {
      "Demibold": "LucidaBright-Demi",
      "Demibold Italic": "LucidaBright-DemiItalic",
      "Italic": "LucidaBright-Italic",
      "Regular": "LucidaBright"
    },
    "Lucida Bright Demibold": {
      "Demibold": "LucidaBright-Demi",
      "Demibold Italic": "LucidaBright-DemiItalic",
      "Regular": "LucidaBright-Demi"
    },
    "Lucida Bright Demibold Italic": {
      "Demibold Italic": "LucidaBright-DemiItalic",
      "Regular": "LucidaBright-DemiItalic"
    },
    "Lucida Bright Italic": {
      "Italic": "LucidaBright-Italic",
      "Regular": "LucidaBright-Italic"
    },
    "Lucida Calligraphy": {
      "Italic": "LucidaCalligraphy-Italic"
    },
    "Lucida Calligraphy Italic": {
      "Italic": "LucidaCalligraphy-Italic",
      "Regular": "LucidaCalligraphy-Italic"
    },
    "Lucida Console": {
      "Arrunta": "LucidaConsole",
      "Navadno": "LucidaConsole",
      "Normaali": "LucidaConsole",
      "Normal": "LucidaConsole",
      "Normale": "LucidaConsole",
      "Normalny": "LucidaConsole",
      "Norm\xE1l": "LucidaConsole",
      "Regular": "LucidaConsole",
      "Standaard": "LucidaConsole",
      "Standard": "LucidaConsole",
      "normal": "LucidaConsole",
      "oby\u010Dejn\xE9": "LucidaConsole",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "LucidaConsole",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "LucidaConsole"
    },
    "Lucida Fax": {
      "Corsivo": "LucidaFax-Italic",
      "Cursief": "LucidaFax-Italic",
      "Cursiva": "LucidaFax-Italic",
      "Demi-gras": "LucidaFax-Demi",
      "Demi-gras Italique": "LucidaFax-DemiItalic",
      "Demi-grassetto": "LucidaFax-Demi",
      "Demi-grassetto Corsivo": "LucidaFax-DemiItalic",
      "Demibold": "LucidaFax-Demi",
      "Demibold Italic": "LucidaFax-DemiItalic",
      "Halbfett": "LucidaFax-Demi",
      "Halbfett Kursiv": "LucidaFax-DemiItalic",
      "Halfvet": "LucidaFax-Demi",
      "Halfvet Cursief": "LucidaFax-DemiItalic",
      "Italic": "LucidaFax-Italic",
      "Italique": "LucidaFax-Italic",
      "It\xE1lico": "LucidaFax-Italic",
      "Kursiv": "LucidaFax-Italic",
      "Kursivoitu": "LucidaFax-Italic",
      "Normaali": "LucidaFax",
      "Normal": "LucidaFax",
      "Normale": "LucidaFax",
      "Puolilihavoitu": "LucidaFax-Demi",
      "Puolilihavoitu Kursivoitu": "LucidaFax-DemiItalic",
      "Regular": "LucidaFax",
      "Seminegrita": "LucidaFax-Demi",
      "Seminegrita Cursiva": "LucidaFax-DemiItalic",
      "Seminegrito": "LucidaFax-Demi",
      "Seminegrito It\xE1lico": "LucidaFax-DemiItalic",
      "Standaard": "LucidaFax",
      "Standard": "LucidaFax",
      "Trekvartsfet": "LucidaFax-Demi",
      "Trekvartsfet Kursiv": "LucidaFax-DemiItalic",
      "halvfed": "LucidaFax-Demi",
      "halvfed kursiv": "LucidaFax-DemiItalic",
      "kursiv": "LucidaFax-Italic",
      "normal": "LucidaFax"
    },
    "Lucida Fax Corsivo": {
      "Regular": "LucidaFax-Italic"
    },
    "Lucida Fax Cursief": {
      "Regular": "LucidaFax-Italic"
    },
    "Lucida Fax Cursiva": {
      "Regular": "LucidaFax-Italic"
    },
    "Lucida Fax Demi-gras": {
      "Regular": "LucidaFax-Demi"
    },
    "Lucida Fax Demi-gras Italique": {
      "Regular": "LucidaFax-DemiItalic"
    },
    "Lucida Fax Demi-grassetto": {
      "Regular": "LucidaFax-Demi"
    },
    "Lucida Fax Demi-grassetto Corsivo": {
      "Regular": "LucidaFax-DemiItalic"
    },
    "Lucida Fax Demibold": {
      "Demibold": "LucidaFax-Demi",
      "Demibold Italic": "LucidaFax-DemiItalic",
      "Regular": "LucidaFax-Demi"
    },
    "Lucida Fax Demibold Italic": {
      "Demibold Italic": "LucidaFax-DemiItalic",
      "Regular": "LucidaFax-DemiItalic"
    },
    "Lucida Fax Halbfett": {
      "Regular": "LucidaFax-Demi"
    },
    "Lucida Fax Halbfett Kursiv": {
      "Regular": "LucidaFax-DemiItalic"
    },
    "Lucida Fax Halfvet": {
      "Regular": "LucidaFax-Demi"
    },
    "Lucida Fax Halfvet Cursief": {
      "Regular": "LucidaFax-DemiItalic"
    },
    "Lucida Fax Italic": {
      "Italic": "LucidaFax-Italic",
      "Regular": "LucidaFax-Italic"
    },
    "Lucida Fax Italique": {
      "Regular": "LucidaFax-Italic"
    },
    "Lucida Fax It\xE1lico": {
      "Regular": "LucidaFax-Italic"
    },
    "Lucida Fax Kursiv": {
      "Regular": "LucidaFax-Italic"
    },
    "Lucida Fax Kursivoitu": {
      "Regular": "LucidaFax-Italic"
    },
    "Lucida Fax Puolilihavoitu": {
      "Regular": "LucidaFax-Demi"
    },
    "Lucida Fax Puolilihavoitu Kursivoitu": {
      "Regular": "LucidaFax-DemiItalic"
    },
    "Lucida Fax Regular": {
      "Regular": "LucidaFax"
    },
    "Lucida Fax Seminegrita": {
      "Regular": "LucidaFax-Demi"
    },
    "Lucida Fax Seminegrita Cursiva": {
      "Regular": "LucidaFax-DemiItalic"
    },
    "Lucida Fax Seminegrito": {
      "Regular": "LucidaFax-Demi"
    },
    "Lucida Fax Seminegrito It\xE1lico": {
      "Regular": "LucidaFax-DemiItalic"
    },
    "Lucida Fax Trekvartsfet": {
      "Regular": "LucidaFax-Demi"
    },
    "Lucida Fax Trekvartsfet Kursiv": {
      "Regular": "LucidaFax-DemiItalic"
    },
    "Lucida Fax halvfed": {
      "Regular": "LucidaFax-Demi"
    },
    "Lucida Fax halvfed kursiv": {
      "Regular": "LucidaFax-DemiItalic"
    },
    "Lucida Fax kursiv": {
      "Regular": "LucidaFax-Italic"
    },
    "Lucida Handwriting": {
      "Corsivo": "LucidaHandwriting-Italic",
      "Cursief": "LucidaHandwriting-Italic",
      "Cursiva": "LucidaHandwriting-Italic",
      "Italic": "LucidaHandwriting-Italic",
      "Italique": "LucidaHandwriting-Italic",
      "It\xE1lico": "LucidaHandwriting-Italic",
      "Kursiv": "LucidaHandwriting-Italic",
      "Kursivoitu": "LucidaHandwriting-Italic",
      "kursiv": "LucidaHandwriting-Italic"
    },
    "Lucida Handwriting Corsivo": {
      "Regular": "LucidaHandwriting-Italic"
    },
    "Lucida Handwriting Cursief": {
      "Regular": "LucidaHandwriting-Italic"
    },
    "Lucida Handwriting Cursiva": {
      "Regular": "LucidaHandwriting-Italic"
    },
    "Lucida Handwriting Italic": {
      "Italic": "LucidaHandwriting-Italic",
      "Regular": "LucidaHandwriting-Italic"
    },
    "Lucida Handwriting Italique": {
      "Regular": "LucidaHandwriting-Italic"
    },
    "Lucida Handwriting It\xE1lico": {
      "Regular": "LucidaHandwriting-Italic"
    },
    "Lucida Handwriting Kursiv": {
      "Regular": "LucidaHandwriting-Italic"
    },
    "Lucida Handwriting Kursivoitu": {
      "Regular": "LucidaHandwriting-Italic"
    },
    "Lucida Handwriting kursiv": {
      "Regular": "LucidaHandwriting-Italic"
    },
    "Lucida Sans": {
      "Corsivo": "LucidaSans-Italic",
      "Cursief": "LucidaSans-Italic",
      "Cursiva": "LucidaSans-Italic",
      "Demi-gras": "LucidaSans-Demi",
      "Demi-gras Italique": "LucidaSans-DemiItalic",
      "Demi-grassetto": "LucidaSans-Demi",
      "Demi-grassetto Corsivo": "LucidaSans-DemiItalic",
      "Demibold Italic": "LucidaSans-DemiItalic",
      "Demibold Roman": "LucidaSans-Demi",
      "Halbfett": "LucidaSans-Demi",
      "Halbfett Kursiv": "LucidaSans-DemiItalic",
      "Halfvet": "LucidaSans-Demi",
      "Halfvet Cursief": "LucidaSans-DemiItalic",
      "Italic": "LucidaSans-Italic",
      "Italique": "LucidaSans-Italic",
      "It\xE1lico": "LucidaSans-Italic",
      "Kursiv": "LucidaSans-Italic",
      "Kursivoitu": "LucidaSans-Italic",
      "Normaali": "LucidaSans",
      "Normal": "LucidaSans",
      "Normale": "LucidaSans",
      "Puolilihavoitu": "LucidaSans-Demi",
      "Puolilihavoitu Kursivoitu": "LucidaSans-DemiItalic",
      "Regular": "LucidaSans",
      "Seminegrita": "LucidaSans-Demi",
      "Seminegrita Cursiva": "LucidaSans-DemiItalic",
      "Seminegrito": "LucidaSans-Demi",
      "Seminegrito It\xE1lico": "LucidaSans-DemiItalic",
      "Standaard": "LucidaSans",
      "Standard": "LucidaSans",
      "Trekvartsfet": "LucidaSans-Demi",
      "Trekvartsfet Kursiv": "LucidaSans-DemiItalic",
      "halvfed": "LucidaSans-Demi",
      "halvfed kursiv": "LucidaSans-DemiItalic",
      "kursiv": "LucidaSans-Italic",
      "normal": "LucidaSans"
    },
    "Lucida Sans Corsivo": {
      "Regular": "LucidaSans-Italic"
    },
    "Lucida Sans Cursief": {
      "Regular": "LucidaSans-Italic"
    },
    "Lucida Sans Cursiva": {
      "Regular": "LucidaSans-Italic"
    },
    "Lucida Sans Demi-gras": {
      "Regular": "LucidaSans-Demi"
    },
    "Lucida Sans Demi-gras Italique": {
      "Regular": "LucidaSans-DemiItalic"
    },
    "Lucida Sans Demi-grassetto": {
      "Regular": "LucidaSans-Demi"
    },
    "Lucida Sans Demi-grassetto Corsivo": {
      "Regular": "LucidaSans-DemiItalic"
    },
    "Lucida Sans Demibold": {
      "Demibold Italic": "LucidaSans-DemiItalic"
    },
    "Lucida Sans Demibold Italic": {
      "Demibold Italic": "LucidaSans-DemiItalic",
      "Regular": "LucidaSans-DemiItalic"
    },
    "Lucida Sans Demibold Roman": {
      "Demibold Roman": "LucidaSans-Demi",
      "Regular": "LucidaSans-Demi"
    },
    "Lucida Sans Halbfett": {
      "Regular": "LucidaSans-Demi"
    },
    "Lucida Sans Halbfett Kursiv": {
      "Regular": "LucidaSans-DemiItalic"
    },
    "Lucida Sans Halfvet": {
      "Regular": "LucidaSans-Demi"
    },
    "Lucida Sans Halfvet Cursief": {
      "Regular": "LucidaSans-DemiItalic"
    },
    "Lucida Sans Italic": {
      "Italic": "LucidaSans-Italic",
      "Regular": "LucidaSans-Italic"
    },
    "Lucida Sans Italique": {
      "Regular": "LucidaSans-Italic"
    },
    "Lucida Sans It\xE1lico": {
      "Regular": "LucidaSans-Italic"
    },
    "Lucida Sans Kursiv": {
      "Regular": "LucidaSans-Italic"
    },
    "Lucida Sans Kursivoitu": {
      "Regular": "LucidaSans-Italic"
    },
    "Lucida Sans Puolilihavoitu": {
      "Regular": "LucidaSans-Demi"
    },
    "Lucida Sans Puolilihavoitu Kursivoitu": {
      "Regular": "LucidaSans-DemiItalic"
    },
    "Lucida Sans Regular": {
      "Regular": "LucidaSans"
    },
    "Lucida Sans Seminegrita": {
      "Regular": "LucidaSans-Demi"
    },
    "Lucida Sans Seminegrita Cursiva": {
      "Regular": "LucidaSans-DemiItalic"
    },
    "Lucida Sans Seminegrito": {
      "Regular": "LucidaSans-Demi"
    },
    "Lucida Sans Seminegrito It\xE1lico": {
      "Regular": "LucidaSans-DemiItalic"
    },
    "Lucida Sans Trekvartsfet": {
      "Regular": "LucidaSans-Demi"
    },
    "Lucida Sans Trekvartsfet Kursiv": {
      "Regular": "LucidaSans-DemiItalic"
    },
    "Lucida Sans Typewriter": {
      "Bold": "LucidaSans-TypewriterBold",
      "Bold Oblique": "LucidaSans-TypewriterBoldOblique",
      "Fet": "LucidaSans-TypewriterBold",
      "Fet Lutande": "LucidaSans-TypewriterBoldOblique",
      "Fett": "LucidaSans-TypewriterBold",
      "Fett Schr\xE4g": "LucidaSans-TypewriterBoldOblique",
      "Gras": "LucidaSans-TypewriterBold",
      "Gras Oblique": "LucidaSans-TypewriterBoldOblique",
      "Grassetto": "LucidaSans-TypewriterBold",
      "Grassetto Oblique": "LucidaSans-TypewriterBoldOblique",
      "Halvfet": "LucidaSans-TypewriterBold",
      "Halvfet Lutande": "LucidaSans-TypewriterBoldOblique",
      "Inclinada": "LucidaSans-TypewriterOblique",
      "Inclinado": "LucidaSans-TypewriterOblique",
      "Kallistettu": "LucidaSans-TypewriterOblique",
      "Lihavoitu": "LucidaSans-TypewriterBold",
      "Lihavoitu Kallistettu": "LucidaSans-TypewriterBoldOblique",
      "Lutande": "LucidaSans-TypewriterOblique",
      "Negrita": "LucidaSans-TypewriterBold",
      "Negrita Inclinada": "LucidaSans-TypewriterBoldOblique",
      "Negrito": "LucidaSans-TypewriterBold",
      "Negrito Inclinado": "LucidaSans-TypewriterBoldOblique",
      "Normaali": "LucidaSans-Typewriter",
      "Normal": "LucidaSans-Typewriter",
      "Normale": "LucidaSans-Typewriter",
      "Oblique": "LucidaSans-TypewriterOblique",
      "Regular": "LucidaSans-Typewriter",
      "Schr\xE4g": "LucidaSans-TypewriterOblique",
      "Schuin": "LucidaSans-TypewriterOblique",
      "Standaard": "LucidaSans-Typewriter",
      "Standard": "LucidaSans-Typewriter",
      "Vet": "LucidaSans-TypewriterBold",
      "Vet Schuin": "LucidaSans-TypewriterBoldOblique",
      "fed": "LucidaSans-TypewriterBold",
      "fed oblik": "LucidaSans-TypewriterBoldOblique",
      "normal": "LucidaSans-Typewriter",
      "oblik": "LucidaSans-TypewriterOblique"
    },
    "Lucida Sans Typewriter Bold": {
      "Bold": "LucidaSans-TypewriterBold",
      "Bold Oblique": "LucidaSans-TypewriterBoldOblique",
      "Regular": "LucidaSans-TypewriterBold"
    },
    "Lucida Sans Typewriter Bold Oblique": {
      "Bold Oblique": "LucidaSans-TypewriterBoldOblique",
      "Regular": "LucidaSans-TypewriterBoldOblique"
    },
    "Lucida Sans Typewriter Fet": {
      "Regular": "LucidaSans-TypewriterBold"
    },
    "Lucida Sans Typewriter Fet Lutande": {
      "Regular": "LucidaSans-TypewriterBoldOblique"
    },
    "Lucida Sans Typewriter Fett": {
      "Regular": "LucidaSans-TypewriterBold"
    },
    "Lucida Sans Typewriter Fett Schr\xE4g": {
      "Regular": "LucidaSans-TypewriterBoldOblique"
    },
    "Lucida Sans Typewriter Gras": {
      "Regular": "LucidaSans-TypewriterBold"
    },
    "Lucida Sans Typewriter Gras Oblique": {
      "Regular": "LucidaSans-TypewriterBoldOblique"
    },
    "Lucida Sans Typewriter Grassetto": {
      "Regular": "LucidaSans-TypewriterBold"
    },
    "Lucida Sans Typewriter Grassetto Oblique": {
      "Regular": "LucidaSans-TypewriterBoldOblique"
    },
    "Lucida Sans Typewriter Halvfet": {
      "Regular": "LucidaSans-TypewriterBold"
    },
    "Lucida Sans Typewriter Halvfet Lutande": {
      "Regular": "LucidaSans-TypewriterBoldOblique"
    },
    "Lucida Sans Typewriter Inclinada": {
      "Regular": "LucidaSans-TypewriterOblique"
    },
    "Lucida Sans Typewriter Inclinado": {
      "Regular": "LucidaSans-TypewriterOblique"
    },
    "Lucida Sans Typewriter Kallistettu": {
      "Regular": "LucidaSans-TypewriterOblique"
    },
    "Lucida Sans Typewriter Lihavoitu": {
      "Regular": "LucidaSans-TypewriterBold"
    },
    "Lucida Sans Typewriter Lihavoitu Kallistettu": {
      "Regular": "LucidaSans-TypewriterBoldOblique"
    },
    "Lucida Sans Typewriter Lutande": {
      "Regular": "LucidaSans-TypewriterOblique"
    },
    "Lucida Sans Typewriter Negrita": {
      "Regular": "LucidaSans-TypewriterBold"
    },
    "Lucida Sans Typewriter Negrita Inclinada": {
      "Regular": "LucidaSans-TypewriterBoldOblique"
    },
    "Lucida Sans Typewriter Negrito": {
      "Regular": "LucidaSans-TypewriterBold"
    },
    "Lucida Sans Typewriter Negrito Inclinado": {
      "Regular": "LucidaSans-TypewriterBoldOblique"
    },
    "Lucida Sans Typewriter Oblique": {
      "Oblique": "LucidaSans-TypewriterOblique",
      "Regular": "LucidaSans-TypewriterOblique"
    },
    "Lucida Sans Typewriter Regular": {
      "Regular": "LucidaSans-Typewriter"
    },
    "Lucida Sans Typewriter Schr\xE4g": {
      "Regular": "LucidaSans-TypewriterOblique"
    },
    "Lucida Sans Typewriter Schuin": {
      "Regular": "LucidaSans-TypewriterOblique"
    },
    "Lucida Sans Typewriter Vet": {
      "Regular": "LucidaSans-TypewriterBold"
    },
    "Lucida Sans Typewriter Vet Schuin": {
      "Regular": "LucidaSans-TypewriterBoldOblique"
    },
    "Lucida Sans Typewriter fed": {
      "Regular": "LucidaSans-TypewriterBold"
    },
    "Lucida Sans Typewriter fed oblik": {
      "Regular": "LucidaSans-TypewriterBoldOblique"
    },
    "Lucida Sans Typewriter oblik": {
      "Regular": "LucidaSans-TypewriterOblique"
    },
    "Lucida Sans Unicode": {
      "Arrunta": "LucidaSansUnicode",
      "Navadno": "LucidaSansUnicode",
      "Normaali": "LucidaSansUnicode",
      "Normal": "LucidaSansUnicode",
      "Normale": "LucidaSansUnicode",
      "Normalny": "LucidaSansUnicode",
      "Norm\xE1l": "LucidaSansUnicode",
      "Norm\xE1lne": "LucidaSansUnicode",
      "Regular": "LucidaSansUnicode",
      "Standaard": "LucidaSansUnicode",
      "Standard": "LucidaSansUnicode",
      "normal": "LucidaSansUnicode",
      "oby\u010Dejn\xE9": "LucidaSansUnicode",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "LucidaSansUnicode",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "LucidaSansUnicode"
    },
    "Lucida Sans halvfed": {
      "Regular": "LucidaSans-Demi"
    },
    "Lucida Sans halvfed kursiv": {
      "Regular": "LucidaSans-DemiItalic"
    },
    "Lucida Sans kursiv": {
      "Regular": "LucidaSans-Italic"
    },
    "MS Gothic": {
      "Regular": "MS-Gothic",
      "\u6A19\u6E96": "MS-Gothic"
    },
    "MS Outlook": {
      "Arrunta": "MSOutlook",
      "Navadno": "MSOutlook",
      "Normaali": "MSOutlook",
      "Normal": "MSOutlook",
      "Normale": "MSOutlook",
      "Normalny": "MSOutlook",
      "Norm\xE1l": "MSOutlook",
      "Regular": "MSOutlook",
      "Standaard": "MSOutlook",
      "Standard": "MSOutlook",
      "normal": "MSOutlook",
      "oby\u010Dejn\xE9": "MSOutlook",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "MSOutlook",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "MSOutlook"
    },
    "MS Reference Sans Serif": {
      "Arrunta": "MSReferenceSansSerif",
      "Navadno": "MSReferenceSansSerif",
      "Normaali": "MSReferenceSansSerif",
      "Normal": "MSReferenceSansSerif",
      "Normale": "MSReferenceSansSerif",
      "Normalny": "MSReferenceSansSerif",
      "Norm\xE1l": "MSReferenceSansSerif",
      "Norm\xE1lne": "MSReferenceSansSerif",
      "Regular": "MSReferenceSansSerif",
      "Standaard": "MSReferenceSansSerif",
      "Standard": "MSReferenceSansSerif",
      "normal": "MSReferenceSansSerif",
      "oby\u010Dejn\xE9": "MSReferenceSansSerif",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "MSReferenceSansSerif",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "MSReferenceSansSerif"
    },
    "MS Reference Specialty": {
      "Arrunta": "MSReferenceSpecialty",
      "Navadno": "MSReferenceSpecialty",
      "Normaali": "MSReferenceSpecialty",
      "Normal": "MSReferenceSpecialty",
      "Normale": "MSReferenceSpecialty",
      "Normalny": "MSReferenceSpecialty",
      "Norm\xE1l": "MSReferenceSpecialty",
      "Norm\xE1lne": "MSReferenceSpecialty",
      "Regular": "MSReferenceSpecialty",
      "Standaard": "MSReferenceSpecialty",
      "Standard": "MSReferenceSpecialty",
      "normal": "MSReferenceSpecialty",
      "oby\u010Dejn\xE9": "MSReferenceSpecialty",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "MSReferenceSpecialty",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "MSReferenceSpecialty"
    },
    "MT Extra": {
      "Regular": "MT-Extra"
    },
    "MV Boli": {
      "Arrunta": "MVBoli",
      "Navadno": "MVBoli",
      "Normaali": "MVBoli",
      "Normal": "MVBoli",
      "Normale": "MVBoli",
      "Normalny": "MVBoli",
      "Norm\xE1l": "MVBoli",
      "Norm\xE1lne": "MVBoli",
      "Regular": "MVBoli",
      "Standaard": "MVBoli",
      "Standard": "MVBoli",
      "normal": "MVBoli",
      "oby\u010Dejn\xE9": "MVBoli",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "MVBoli",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "MVBoli"
    },
    "Magneto": {
      "Bold": "Magneto-Bold",
      "Fet": "Magneto-Bold",
      "Fett": "Magneto-Bold",
      "F\xE9lk\xF6v\xE9r": "Magneto-Bold",
      "Gras": "Magneto-Bold",
      "Grassetto": "Magneto-Bold",
      "Halvfet": "Magneto-Bold",
      "Kal\u0131n": "Magneto-Bold",
      "Krepko": "Magneto-Bold",
      "Lihavoitu": "Magneto-Bold",
      "Lodia": "Magneto-Bold",
      "Negreta": "Magneto-Bold",
      "Negrita": "Magneto-Bold",
      "Negrito": "Magneto-Bold",
      "Pogrubiony": "Magneto-Bold",
      "Tu\u010Dn\xE9": "Magneto-Bold",
      "Vet": "Magneto-Bold",
      "fed": "Magneto-Bold",
      "tu\u010Dn\xE9": "Magneto-Bold",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "Magneto-Bold",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "Magneto-Bold"
    },
    "Magneto Bold": {
      "Bold": "Magneto-Bold",
      "Regular": "Magneto-Bold"
    },
    "Magneto Fet": {
      "Regular": "Magneto-Bold"
    },
    "Magneto Fett": {
      "Regular": "Magneto-Bold"
    },
    "Magneto F\xE9lk\xF6v\xE9r": {
      "Regular": "Magneto-Bold"
    },
    "Magneto Gras": {
      "Regular": "Magneto-Bold"
    },
    "Magneto Grassetto": {
      "Regular": "Magneto-Bold"
    },
    "Magneto Halvfet": {
      "Regular": "Magneto-Bold"
    },
    "Magneto Kal\u0131n": {
      "Regular": "Magneto-Bold"
    },
    "Magneto Krepko": {
      "Regular": "Magneto-Bold"
    },
    "Magneto Lihavoitu": {
      "Regular": "Magneto-Bold"
    },
    "Magneto Lodia": {
      "Regular": "Magneto-Bold"
    },
    "Magneto Negreta": {
      "Regular": "Magneto-Bold"
    },
    "Magneto Negrita": {
      "Regular": "Magneto-Bold"
    },
    "Magneto Negrito": {
      "Regular": "Magneto-Bold"
    },
    "Magneto Pogrubiony": {
      "Regular": "Magneto-Bold"
    },
    "Magneto Tu\u010Dn\xE9": {
      "Regular": "Magneto-Bold"
    },
    "Magneto Vet": {
      "Regular": "Magneto-Bold"
    },
    "Magneto fed": {
      "Regular": "Magneto-Bold"
    },
    "Magneto tu\u010Dn\xE9": {
      "Regular": "Magneto-Bold"
    },
    "Magneto \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "Magneto-Bold"
    },
    "Magneto \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "Magneto-Bold"
    },
    "Maiandra GD": {
      "Arrunta": "MaiandraGD-Regular",
      "Navadno": "MaiandraGD-Regular",
      "Normaali": "MaiandraGD-Regular",
      "Normal": "MaiandraGD-Regular",
      "Normale": "MaiandraGD-Regular",
      "Normalny": "MaiandraGD-Regular",
      "Norm\xE1l": "MaiandraGD-Regular",
      "Norm\xE1lne": "MaiandraGD-Regular",
      "Regular": "MaiandraGD-Regular",
      "Standaard": "MaiandraGD-Regular",
      "Standard": "MaiandraGD-Regular",
      "normal": "MaiandraGD-Regular",
      "oby\u010Dejn\xE9": "MaiandraGD-Regular",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "MaiandraGD-Regular",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "MaiandraGD-Regular"
    },
    "Malgun Gothic": {
      "Bold": "MalgunGothicBold",
      "Regular": "MalgunGothic",
      "Semilight": "MalgunGothic-Semilight"
    },
    "Malgun Gothic Bold": {
      "Bold": "MalgunGothicBold",
      "Regular": "MalgunGothicBold"
    },
    "Malgun Gothic SemiLight": {
      "Semilight": "MalgunGothic-Semilight"
    },
    "Malgun Gothic Semilight": {
      "Regular": "MalgunGothic-Semilight"
    },
    "Matura MT Script Capitals": {
      "Arrunta": "MaturaMTScriptCapitals",
      "Navadno": "MaturaMTScriptCapitals",
      "Normaali": "MaturaMTScriptCapitals",
      "Normal": "MaturaMTScriptCapitals",
      "Normale": "MaturaMTScriptCapitals",
      "Normalny": "MaturaMTScriptCapitals",
      "Norm\xE1l": "MaturaMTScriptCapitals",
      "Norm\xE1lne": "MaturaMTScriptCapitals",
      "Regular": "MaturaMTScriptCapitals",
      "Standaard": "MaturaMTScriptCapitals",
      "Standard": "MaturaMTScriptCapitals",
      "normal": "MaturaMTScriptCapitals",
      "oby\u010Dejn\xE9": "MaturaMTScriptCapitals",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "MaturaMTScriptCapitals",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "MaturaMTScriptCapitals"
    },
    "Microsoft Himalaya": {
      "Regular": "Microsoft Himalaya"
    },
    "Microsoft JhengHei": {
      "Arrunta": "MicrosoftJhengHeiRegular",
      "Bold": "MicrosoftJhengHeiBold",
      "Fet": "MicrosoftJhengHeiBold",
      "Fett": "MicrosoftJhengHeiBold",
      "F\xE9lk\xF6v\xE9r": "MicrosoftJhengHeiBold",
      "Gras": "MicrosoftJhengHeiBold",
      "Grassetto": "MicrosoftJhengHeiBold",
      "Halvfet": "MicrosoftJhengHeiBold",
      "Kal\u0131n": "MicrosoftJhengHeiBold",
      "Krepko": "MicrosoftJhengHeiBold",
      "Light": "MicrosoftJhengHeiLight",
      "Lihavoitu": "MicrosoftJhengHeiBold",
      "Lodia": "MicrosoftJhengHeiBold",
      "Navadno": "MicrosoftJhengHeiRegular",
      "Negreta": "MicrosoftJhengHeiBold",
      "Negrita": "MicrosoftJhengHeiBold",
      "Negrito": "MicrosoftJhengHeiBold",
      "Normaali": "MicrosoftJhengHeiRegular",
      "Normal": "MicrosoftJhengHeiRegular",
      "Normale": "MicrosoftJhengHeiRegular",
      "Normalny": "MicrosoftJhengHeiRegular",
      "Norm\xE1l": "MicrosoftJhengHeiRegular",
      "Norm\xE1lne": "MicrosoftJhengHeiRegular",
      "Pogrubiony": "MicrosoftJhengHeiBold",
      "Regular": "MicrosoftJhengHeiRegular",
      "Standaard": "MicrosoftJhengHeiRegular",
      "Standard": "MicrosoftJhengHeiRegular",
      "Tu\u010Dn\xE9": "MicrosoftJhengHeiBold",
      "Vet": "MicrosoftJhengHeiBold",
      "fed": "MicrosoftJhengHeiBold",
      "normal": "MicrosoftJhengHeiRegular",
      "oby\u010Dejn\xE9": "MicrosoftJhengHeiRegular",
      "tu\u010Dn\xE9": "MicrosoftJhengHeiBold",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "MicrosoftJhengHeiBold",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "MicrosoftJhengHeiRegular",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "MicrosoftJhengHeiRegular",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "MicrosoftJhengHeiBold"
    },
    "Microsoft JhengHei Bold": {
      "Bold": "MicrosoftJhengHeiBold",
      "Regular": "MicrosoftJhengHeiBold"
    },
    "Microsoft JhengHei Fet": {
      "Regular": "MicrosoftJhengHeiBold"
    },
    "Microsoft JhengHei Fett": {
      "Regular": "MicrosoftJhengHeiBold"
    },
    "Microsoft JhengHei F\xE9lk\xF6v\xE9r": {
      "Regular": "MicrosoftJhengHeiBold"
    },
    "Microsoft JhengHei Gras": {
      "Regular": "MicrosoftJhengHeiBold"
    },
    "Microsoft JhengHei Grassetto": {
      "Regular": "MicrosoftJhengHeiBold"
    },
    "Microsoft JhengHei Halvfet": {
      "Regular": "MicrosoftJhengHeiBold"
    },
    "Microsoft JhengHei Kal\u0131n": {
      "Regular": "MicrosoftJhengHeiBold"
    },
    "Microsoft JhengHei Krepko": {
      "Regular": "MicrosoftJhengHeiBold"
    },
    "Microsoft JhengHei Light": {
      "Light": "MicrosoftJhengHeiLight",
      "Regular": "MicrosoftJhengHeiLight"
    },
    "Microsoft JhengHei Lihavoitu": {
      "Regular": "MicrosoftJhengHeiBold"
    },
    "Microsoft JhengHei Lodia": {
      "Regular": "MicrosoftJhengHeiBold"
    },
    "Microsoft JhengHei Negreta": {
      "Regular": "MicrosoftJhengHeiBold"
    },
    "Microsoft JhengHei Negrita": {
      "Regular": "MicrosoftJhengHeiBold"
    },
    "Microsoft JhengHei Negrito": {
      "Regular": "MicrosoftJhengHeiBold"
    },
    "Microsoft JhengHei Pogrubiony": {
      "Regular": "MicrosoftJhengHeiBold"
    },
    "Microsoft JhengHei Tu\u010Dn\xE9": {
      "Regular": "MicrosoftJhengHeiBold"
    },
    "Microsoft JhengHei Vet": {
      "Regular": "MicrosoftJhengHeiBold"
    },
    "Microsoft JhengHei fed": {
      "Regular": "MicrosoftJhengHeiBold"
    },
    "Microsoft JhengHei tu\u010Dn\xE9": {
      "Regular": "MicrosoftJhengHeiBold"
    },
    "Microsoft JhengHei \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "MicrosoftJhengHeiBold"
    },
    "Microsoft JhengHei \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "MicrosoftJhengHeiBold"
    },
    "Microsoft New Tai Lue": {
      "Bold": "MicrosoftNewTaiLue-Bold",
      "Regular": "MicrosoftNewTaiLue"
    },
    "Microsoft New Tai Lue Bold": {
      "Bold": "MicrosoftNewTaiLue-Bold",
      "Regular": "MicrosoftNewTaiLue-Bold"
    },
    "Microsoft PhagsPa": {
      "Bold": "MicrosoftPhagsPa-Bold",
      "Regular": "MicrosoftPhagsPa"
    },
    "Microsoft PhagsPa Bold": {
      "Bold": "MicrosoftPhagsPa-Bold",
      "Regular": "MicrosoftPhagsPa-Bold"
    },
    "Microsoft Sans Serif": {
      "Arrunta": "MicrosoftSansSerif",
      "Navadno": "MicrosoftSansSerif",
      "Normaali": "MicrosoftSansSerif",
      "Normal": "MicrosoftSansSerif",
      "Normale": "MicrosoftSansSerif",
      "Normalny": "MicrosoftSansSerif",
      "Norm\xE1l": "MicrosoftSansSerif",
      "Norm\xE1lne": "MicrosoftSansSerif",
      "Regular": "MicrosoftSansSerif",
      "Standaard": "MicrosoftSansSerif",
      "Standard": "MicrosoftSansSerif",
      "normal": "MicrosoftSansSerif",
      "oby\u010Dejn\xE9": "MicrosoftSansSerif",
      "th\u01B0\u01A1\u0300ng": "MicrosoftSansSerif",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "MicrosoftSansSerif",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "MicrosoftSansSerif"
    },
    "Microsoft Tai Le": {
      "Bold": "MicrosoftTaiLe-Bold",
      "Regular": "MicrosoftTaiLe"
    },
    "Microsoft Tai Le Bold": {
      "Bold": "MicrosoftTaiLe-Bold",
      "Regular": "MicrosoftTaiLe-Bold"
    },
    "Microsoft YaHei": {
      "Arrunta": "MicrosoftYaHei",
      "Bold": "MicrosoftYaHei-Bold",
      "Fet": "MicrosoftYaHei-Bold",
      "Fett": "MicrosoftYaHei-Bold",
      "F\xE9lk\xF6v\xE9r": "MicrosoftYaHei-Bold",
      "Gras": "MicrosoftYaHei-Bold",
      "Grassetto": "MicrosoftYaHei-Bold",
      "Halvfet": "MicrosoftYaHei-Bold",
      "Kal\u0131n": "MicrosoftYaHei-Bold",
      "Krepko": "MicrosoftYaHei-Bold",
      "Light": "MicrosoftYaHeiLight",
      "Lihavoitu": "MicrosoftYaHei-Bold",
      "Lodia": "MicrosoftYaHei-Bold",
      "Navadno": "MicrosoftYaHei",
      "Negreta": "MicrosoftYaHei-Bold",
      "Negrita": "MicrosoftYaHei-Bold",
      "Negrito": "MicrosoftYaHei-Bold",
      "Normaali": "MicrosoftYaHei",
      "Normal": "MicrosoftYaHei",
      "Normale": "MicrosoftYaHei",
      "Normalny": "MicrosoftYaHei",
      "Norm\xE1l": "MicrosoftYaHei",
      "Norm\xE1lne": "MicrosoftYaHei",
      "Pogrubiony": "MicrosoftYaHei-Bold",
      "Regular": "MicrosoftYaHei",
      "Standaard": "MicrosoftYaHei",
      "Standard": "MicrosoftYaHei",
      "Tu\u010Dn\xE9": "MicrosoftYaHei-Bold",
      "Vet": "MicrosoftYaHei-Bold",
      "fed": "MicrosoftYaHei-Bold",
      "oby\u010Dejn\xE9": "MicrosoftYaHei",
      "tu\u010Dn\xE9": "MicrosoftYaHei-Bold",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "MicrosoftYaHei-Bold",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "MicrosoftYaHei",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "MicrosoftYaHei",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "MicrosoftYaHei-Bold"
    },
    "Microsoft YaHei Bold": {
      "Bold": "MicrosoftYaHei-Bold",
      "Regular": "MicrosoftYaHei-Bold"
    },
    "Microsoft YaHei Fet": {
      "Regular": "MicrosoftYaHei-Bold"
    },
    "Microsoft YaHei Fett": {
      "Regular": "MicrosoftYaHei-Bold"
    },
    "Microsoft YaHei F\xE9lk\xF6v\xE9r": {
      "Regular": "MicrosoftYaHei-Bold"
    },
    "Microsoft YaHei Gras": {
      "Regular": "MicrosoftYaHei-Bold"
    },
    "Microsoft YaHei Grassetto": {
      "Regular": "MicrosoftYaHei-Bold"
    },
    "Microsoft YaHei Halvfet": {
      "Regular": "MicrosoftYaHei-Bold"
    },
    "Microsoft YaHei Kal\u0131n": {
      "Regular": "MicrosoftYaHei-Bold"
    },
    "Microsoft YaHei Krepko": {
      "Regular": "MicrosoftYaHei-Bold"
    },
    "Microsoft YaHei Light": {
      "Light": "MicrosoftYaHeiLight",
      "Regular": "MicrosoftYaHeiLight"
    },
    "Microsoft YaHei Lihavoitu": {
      "Regular": "MicrosoftYaHei-Bold"
    },
    "Microsoft YaHei Lodia": {
      "Regular": "MicrosoftYaHei-Bold"
    },
    "Microsoft YaHei Negreta": {
      "Regular": "MicrosoftYaHei-Bold"
    },
    "Microsoft YaHei Negrita": {
      "Regular": "MicrosoftYaHei-Bold"
    },
    "Microsoft YaHei Negrito": {
      "Regular": "MicrosoftYaHei-Bold"
    },
    "Microsoft YaHei Pogrubiony": {
      "Regular": "MicrosoftYaHei-Bold"
    },
    "Microsoft YaHei Tu\u010Dn\xE9": {
      "Regular": "MicrosoftYaHei-Bold"
    },
    "Microsoft YaHei Vet": {
      "Regular": "MicrosoftYaHei-Bold"
    },
    "Microsoft YaHei fed": {
      "Regular": "MicrosoftYaHei-Bold"
    },
    "Microsoft YaHei tu\u010Dn\xE9": {
      "Regular": "MicrosoftYaHei-Bold"
    },
    "Microsoft YaHei \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "MicrosoftYaHei-Bold"
    },
    "Microsoft YaHei \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "MicrosoftYaHei-Bold"
    },
    "Microsoft Yi Baiti": {
      "Regular": "Microsoft-Yi-Baiti"
    },
    "MingLiU-ExtB": {
      "Regular": "MingLiU-ExtB"
    },
    "Miriam CLM": {
      "Bold": "MiriamCLM-Bold",
      "Book": "MiriamCLM-Book",
      "\u05DB\u05D1\u05D3": "MiriamCLM-Bold",
      "\u05E7\u05DC": "MiriamCLM-Book"
    },
    "Miriam CLM Bold": {
      "Bold": "MiriamCLM-Bold",
      "Regular": "MiriamCLM-Bold"
    },
    "Miriam CLM Book": {
      "Book": "MiriamCLM-Book",
      "Regular": "MiriamCLM-Book"
    },
    "Miriam Libre": {
      "Bold": "MiriamLibre-Bold",
      "Regular": "MiriamLibre-Regular"
    },
    "Miriam Libre Bold": {
      "Bold": "MiriamLibre-Bold",
      "Regular": "MiriamLibre-Bold"
    },
    "Miriam Mono CLM": {
      "Bold": "MiriamMonoCLM-Bold",
      "BoldOblique": "MiriamMonoCLM-BoldOblique",
      "Book": "MiriamMonoCLM-Book",
      "BookOblique": "MiriamMonoCLM-BookOblique"
    },
    "Miriam Mono CLM Bold": {
      "Bold": "MiriamMonoCLM-Bold",
      "BoldOblique": "MiriamMonoCLM-BoldOblique",
      "Regular": "MiriamMonoCLM-Bold"
    },
    "Miriam Mono CLM Bold Oblique": {
      "BoldOblique": "MiriamMonoCLM-BoldOblique",
      "Regular": "MiriamMonoCLM-BoldOblique"
    },
    "Miriam Mono CLM Book": {
      "Book": "MiriamMonoCLM-Book",
      "Regular": "MiriamMonoCLM-Book"
    },
    "Miriam Mono CLM Book Oblique": {
      "BookOblique": "MiriamMonoCLM-BookOblique",
      "Regular": "MiriamMonoCLM-BookOblique"
    },
    "MiriamLibre-Regular": {
      "Regular": "MiriamLibre-Regular"
    },
    "Mistral": {
      "Arrunta": "Mistral",
      "Navadno": "Mistral",
      "Normaali": "Mistral",
      "Normal": "Mistral",
      "Normale": "Mistral",
      "Normalny": "Mistral",
      "Norm\xE1l": "Mistral",
      "Norm\xE1lne": "Mistral",
      "Regular": "Mistral",
      "Standaard": "Mistral",
      "Standard": "Mistral",
      "normal": "Mistral",
      "oby\u010Dejn\xE9": "Mistral",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "Mistral",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "Mistral"
    },
    "Modern No. 20": {
      "Arrunta": "Modern-Regular",
      "Navadno": "Modern-Regular",
      "Normaali": "Modern-Regular",
      "Normal": "Modern-Regular",
      "Normale": "Modern-Regular",
      "Normalny": "Modern-Regular",
      "Norm\xE1l": "Modern-Regular",
      "Norm\xE1lne": "Modern-Regular",
      "Regular": "Modern-Regular",
      "Standaard": "Modern-Regular",
      "Standard": "Modern-Regular",
      "normal": "Modern-Regular",
      "oby\u010Dejn\xE9": "Modern-Regular",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "Modern-Regular",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "Modern-Regular"
    },
    "Mongolian Baiti": {
      "Regular": "MongolianBaiti"
    },
    "Monotype Corsiva": {
      "Arrunta": "MonotypeCorsiva",
      "Navadno": "MonotypeCorsiva",
      "Normaali": "MonotypeCorsiva",
      "Normal": "MonotypeCorsiva",
      "Normale": "MonotypeCorsiva",
      "Normalny": "MonotypeCorsiva",
      "Norm\xE1l": "MonotypeCorsiva",
      "Norm\xE1lne": "MonotypeCorsiva",
      "Regular": "MonotypeCorsiva",
      "Standaard": "MonotypeCorsiva",
      "Standard": "MonotypeCorsiva",
      "normal": "MonotypeCorsiva",
      "oby\u010Dejn\xE9": "MonotypeCorsiva",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "MonotypeCorsiva",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "MonotypeCorsiva"
    },
    "Myanmar Text": {
      "Arrunta": "MyanmarText",
      "Bold": "MyanmarText-Bold",
      "Fet": "MyanmarText-Bold",
      "Fett": "MyanmarText-Bold",
      "F\xE9lk\xF6v\xE9r": "MyanmarText-Bold",
      "Gras": "MyanmarText-Bold",
      "Grassetto": "MyanmarText-Bold",
      "Halvfet": "MyanmarText-Bold",
      "Kal\u0131n": "MyanmarText-Bold",
      "Krepko": "MyanmarText-Bold",
      "Lihavoitu": "MyanmarText-Bold",
      "Lodia": "MyanmarText-Bold",
      "Navadno": "MyanmarText",
      "Negreta": "MyanmarText-Bold",
      "Negrita": "MyanmarText-Bold",
      "Negrito": "MyanmarText-Bold",
      "Normaali": "MyanmarText",
      "Normal": "MyanmarText",
      "Normale": "MyanmarText",
      "Normalny": "MyanmarText",
      "Norm\xE1l": "MyanmarText",
      "Norm\xE1lne": "MyanmarText",
      "Pogrubiony": "MyanmarText-Bold",
      "Regular": "MyanmarText",
      "Standaard": "MyanmarText",
      "Standard": "MyanmarText",
      "Tu\u010Dn\xE9": "MyanmarText-Bold",
      "Vet": "MyanmarText-Bold",
      "fed": "MyanmarText-Bold",
      "normal": "MyanmarText",
      "oby\u010Dejn\xE9": "MyanmarText",
      "tu\u010Dn\xE9": "MyanmarText-Bold",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "MyanmarText-Bold",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "MyanmarText",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "MyanmarText",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "MyanmarText-Bold"
    },
    "Myanmar Text Bold": {
      "Bold": "MyanmarText-Bold",
      "Regular": "MyanmarText-Bold"
    },
    "Myanmar Text Fet": {
      "Regular": "MyanmarText-Bold"
    },
    "Myanmar Text Fett": {
      "Regular": "MyanmarText-Bold"
    },
    "Myanmar Text F\xE9lk\xF6v\xE9r": {
      "Regular": "MyanmarText-Bold"
    },
    "Myanmar Text Gras": {
      "Regular": "MyanmarText-Bold"
    },
    "Myanmar Text Grassetto": {
      "Regular": "MyanmarText-Bold"
    },
    "Myanmar Text Halvfet": {
      "Regular": "MyanmarText-Bold"
    },
    "Myanmar Text Kal\u0131n": {
      "Regular": "MyanmarText-Bold"
    },
    "Myanmar Text Krepko": {
      "Regular": "MyanmarText-Bold"
    },
    "Myanmar Text Lihavoitu": {
      "Regular": "MyanmarText-Bold"
    },
    "Myanmar Text Lodia": {
      "Regular": "MyanmarText-Bold"
    },
    "Myanmar Text Negreta": {
      "Regular": "MyanmarText-Bold"
    },
    "Myanmar Text Negrita": {
      "Regular": "MyanmarText-Bold"
    },
    "Myanmar Text Negrito": {
      "Regular": "MyanmarText-Bold"
    },
    "Myanmar Text Pogrubiony": {
      "Regular": "MyanmarText-Bold"
    },
    "Myanmar Text Tu\u010Dn\xE9": {
      "Regular": "MyanmarText-Bold"
    },
    "Myanmar Text Vet": {
      "Regular": "MyanmarText-Bold"
    },
    "Myanmar Text fed": {
      "Regular": "MyanmarText-Bold"
    },
    "Myanmar Text tu\u010Dn\xE9": {
      "Regular": "MyanmarText-Bold"
    },
    "Myanmar Text \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "MyanmarText-Bold"
    },
    "Myanmar Text \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "MyanmarText-Bold"
    },
    "Nachlieli CLM": {
      "Bold": "NachlieliCLM-Bold",
      "BoldOblique": "NachlieliCLM-BoldOblique",
      "Light": "NachlieliCLM-Light",
      "LightOblique": "NachlieliCLM-LightOblique"
    },
    "Nachlieli CLM Bold": {
      "Bold": "NachlieliCLM-Bold",
      "BoldOblique": "NachlieliCLM-BoldOblique",
      "Regular": "NachlieliCLM-Bold"
    },
    "Nachlieli CLM Bold Oblique": {
      "BoldOblique": "NachlieliCLM-BoldOblique",
      "Regular": "NachlieliCLM-BoldOblique"
    },
    "Nachlieli CLM Light": {
      "Light": "NachlieliCLM-Light",
      "Regular": "NachlieliCLM-Light"
    },
    "Nachlieli CLM Light Oblique": {
      "LightOblique": "NachlieliCLM-LightOblique",
      "Regular": "NachlieliCLM-LightOblique"
    },
    "Niagara Engraved": {
      "Arrunta": "NiagaraEngraved-Reg",
      "Navadno": "NiagaraEngraved-Reg",
      "Normaali": "NiagaraEngraved-Reg",
      "Normal": "NiagaraEngraved-Reg",
      "Normale": "NiagaraEngraved-Reg",
      "Normalny": "NiagaraEngraved-Reg",
      "Norm\xE1l": "NiagaraEngraved-Reg",
      "Norm\xE1lne": "NiagaraEngraved-Reg",
      "Regular": "NiagaraEngraved-Reg",
      "Standaard": "NiagaraEngraved-Reg",
      "Standard": "NiagaraEngraved-Reg",
      "normal": "NiagaraEngraved-Reg",
      "oby\u010Dejn\xE9": "NiagaraEngraved-Reg",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "NiagaraEngraved-Reg",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "NiagaraEngraved-Reg"
    },
    "Niagara Solid": {
      "Arrunta": "NiagaraSolid-Reg",
      "Navadno": "NiagaraSolid-Reg",
      "Normaali": "NiagaraSolid-Reg",
      "Normal": "NiagaraSolid-Reg",
      "Normale": "NiagaraSolid-Reg",
      "Normalny": "NiagaraSolid-Reg",
      "Norm\xE1l": "NiagaraSolid-Reg",
      "Norm\xE1lne": "NiagaraSolid-Reg",
      "Regular": "NiagaraSolid-Reg",
      "Standaard": "NiagaraSolid-Reg",
      "Standard": "NiagaraSolid-Reg",
      "normal": "NiagaraSolid-Reg",
      "oby\u010Dejn\xE9": "NiagaraSolid-Reg",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "NiagaraSolid-Reg",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "NiagaraSolid-Reg"
    },
    "Nirmala UI": {
      "Arrunta": "NirmalaUI",
      "Bold": "NirmalaUI-Bold",
      "Fet": "NirmalaUI-Bold",
      "Fett": "NirmalaUI-Bold",
      "F\xE9lk\xF6v\xE9r": "NirmalaUI-Bold",
      "Gras": "NirmalaUI-Bold",
      "Grassetto": "NirmalaUI-Bold",
      "Halvfet": "NirmalaUI-Bold",
      "Kal\u0131n": "NirmalaUI-Bold",
      "Krepko": "NirmalaUI-Bold",
      "Lihavoitu": "NirmalaUI-Bold",
      "Lodia": "NirmalaUI-Bold",
      "Navadno": "NirmalaUI",
      "Negreta": "NirmalaUI-Bold",
      "Negrita": "NirmalaUI-Bold",
      "Negrito": "NirmalaUI-Bold",
      "Normaali": "NirmalaUI",
      "Normal": "NirmalaUI",
      "Normale": "NirmalaUI",
      "Normalny": "NirmalaUI",
      "Norm\xE1l": "NirmalaUI",
      "Norm\xE1lne": "NirmalaUI",
      "Pogrubiony": "NirmalaUI-Bold",
      "Regular": "NirmalaUI",
      "Semilight": "NirmalaUI-Semilight",
      "Standaard": "NirmalaUI",
      "Standard": "NirmalaUI",
      "Tu\u010Dn\xE9": "NirmalaUI-Bold",
      "Vet": "NirmalaUI-Bold",
      "fed": "NirmalaUI-Bold",
      "normal": "NirmalaUI",
      "oby\u010Dejn\xE9": "NirmalaUI",
      "tu\u010Dn\xE9": "NirmalaUI-Bold",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "NirmalaUI-Bold",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "NirmalaUI",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "NirmalaUI",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "NirmalaUI-Bold"
    },
    "Nirmala UI Bold": {
      "Bold": "NirmalaUI-Bold",
      "Regular": "NirmalaUI-Bold"
    },
    "Nirmala UI Fet": {
      "Regular": "NirmalaUI-Bold"
    },
    "Nirmala UI Fett": {
      "Regular": "NirmalaUI-Bold"
    },
    "Nirmala UI F\xE9lk\xF6v\xE9r": {
      "Regular": "NirmalaUI-Bold"
    },
    "Nirmala UI Gras": {
      "Regular": "NirmalaUI-Bold"
    },
    "Nirmala UI Grassetto": {
      "Regular": "NirmalaUI-Bold"
    },
    "Nirmala UI Halvfet": {
      "Regular": "NirmalaUI-Bold"
    },
    "Nirmala UI Kal\u0131n": {
      "Regular": "NirmalaUI-Bold"
    },
    "Nirmala UI Krepko": {
      "Regular": "NirmalaUI-Bold"
    },
    "Nirmala UI Lihavoitu": {
      "Regular": "NirmalaUI-Bold"
    },
    "Nirmala UI Lodia": {
      "Regular": "NirmalaUI-Bold"
    },
    "Nirmala UI Negreta": {
      "Regular": "NirmalaUI-Bold"
    },
    "Nirmala UI Negrita": {
      "Regular": "NirmalaUI-Bold"
    },
    "Nirmala UI Negrito": {
      "Regular": "NirmalaUI-Bold"
    },
    "Nirmala UI Pogrubiony": {
      "Regular": "NirmalaUI-Bold"
    },
    "Nirmala UI Semilight": {
      "Arrunta": "NirmalaUI-Semilight",
      "Navadno": "NirmalaUI-Semilight",
      "Normaali": "NirmalaUI-Semilight",
      "Normal": "NirmalaUI-Semilight",
      "Normale": "NirmalaUI-Semilight",
      "Normalny": "NirmalaUI-Semilight",
      "Norm\xE1l": "NirmalaUI-Semilight",
      "Norm\xE1lne": "NirmalaUI-Semilight",
      "Regular": "NirmalaUI-Semilight",
      "Semilight": "NirmalaUI-Semilight",
      "Standaard": "NirmalaUI-Semilight",
      "Standard": "NirmalaUI-Semilight",
      "normal": "NirmalaUI-Semilight",
      "oby\u010Dejn\xE9": "NirmalaUI-Semilight",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "NirmalaUI-Semilight",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "NirmalaUI-Semilight"
    },
    "Nirmala UI Tu\u010Dn\xE9": {
      "Regular": "NirmalaUI-Bold"
    },
    "Nirmala UI Vet": {
      "Regular": "NirmalaUI-Bold"
    },
    "Nirmala UI fed": {
      "Regular": "NirmalaUI-Bold"
    },
    "Nirmala UI tu\u010Dn\xE9": {
      "Regular": "NirmalaUI-Bold"
    },
    "Nirmala UI \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "NirmalaUI-Bold"
    },
    "Nirmala UI \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "NirmalaUI-Bold"
    },
    "Noto Kufi Arabic": {
      "Bold": "NotoKufiArabic-Bold",
      "Regular": "NotoKufiArabic"
    },
    "Noto Kufi Arabic Bold": {
      "Bold": "NotoKufiArabic-Bold",
      "Regular": "NotoKufiArabic-Bold"
    },
    "Noto Mono": {
      "Regular": "NotoMono"
    },
    "Noto Naskh Arabic": {
      "Bold": "NotoNaskhArabic-Bold",
      "Regular": "NotoNaskhArabic"
    },
    "Noto Naskh Arabic Bold": {
      "Bold": "NotoNaskhArabic-Bold",
      "Regular": "NotoNaskhArabic-Bold"
    },
    "Noto Naskh Arabic UI": {
      "Bold": "NotoNaskhArabicUI-Bold",
      "Regular": "NotoNaskhArabicUI"
    },
    "Noto Naskh Arabic UI Bold": {
      "Bold": "NotoNaskhArabicUI-Bold",
      "Regular": "NotoNaskhArabicUI-Bold"
    },
    "Noto Sans": {
      "Bold": "NotoSans-Bold",
      "Bold Italic": "NotoSans-BoldItalic",
      "Condensed": "NotoSans-Condensed",
      "Condensed Bold": "NotoSans-CondensedBold",
      "Condensed Bold Italic": "NotoSans-CondensedBoldItalic",
      "Condensed Italic": "NotoSans-CondensedItalic",
      "Italic": "NotoSans-Italic",
      "Light": "NotoSans-Light",
      "Light Italic": "NotoSans-LightItalic",
      "Regular": "NotoSans-Regular"
    },
    "Noto Sans Arabic": {
      "Bold": "NotoSansArabic-Bold",
      "Regular": "NotoSansArabic-Regular"
    },
    "Noto Sans Arabic Bold": {
      "Bold": "NotoSansArabic-Bold",
      "Regular": "NotoSansArabic-Bold"
    },
    "Noto Sans Arabic Regular": {
      "Regular": "NotoSansArabic-Regular"
    },
    "Noto Sans Arabic UI": {
      "Bold": "NotoSansArabicUI-Bold",
      "Regular": "NotoSansArabicUI-Regular"
    },
    "Noto Sans Arabic UI Bold": {
      "Bold": "NotoSansArabicUI-Bold",
      "Regular": "NotoSansArabicUI-Bold"
    },
    "Noto Sans Arabic UI Regular": {
      "Regular": "NotoSansArabicUI-Regular"
    },
    "Noto Sans Armenian": {
      "Bold": "NotoSansArmenian-Bold",
      "Regular": "NotoSansArmenian-Regular"
    },
    "Noto Sans Armenian Bold": {
      "Bold": "NotoSansArmenian-Bold",
      "Regular": "NotoSansArmenian-Bold"
    },
    "Noto Sans Armenian Regular": {
      "Regular": "NotoSansArmenian-Regular"
    },
    "Noto Sans Bold": {
      "Bold": "NotoSans-Bold",
      "Regular": "NotoSans-Bold"
    },
    "Noto Sans Bold Italic": {
      "Bold Italic": "NotoSans-BoldItalic",
      "Regular": "NotoSans-BoldItalic"
    },
    "Noto Sans Cond": {
      "Bold": "NotoSans-CondensedBold",
      "Bold Italic": "NotoSans-CondensedBoldItalic",
      "Italic": "NotoSans-CondensedItalic",
      "Regular": "NotoSans-Condensed"
    },
    "Noto Sans Condensed": {
      "Condensed": "NotoSans-Condensed",
      "Regular": "NotoSans-Condensed"
    },
    "Noto Sans Condensed Bold": {
      "Condensed Bold": "NotoSans-CondensedBold",
      "Regular": "NotoSans-CondensedBold"
    },
    "Noto Sans Condensed Bold Italic": {
      "Condensed Bold Italic": "NotoSans-CondensedBoldItalic",
      "Regular": "NotoSans-CondensedBoldItalic"
    },
    "Noto Sans Condensed Italic": {
      "Condensed Italic": "NotoSans-CondensedItalic",
      "Regular": "NotoSans-CondensedItalic"
    },
    "Noto Sans Georgian": {
      "Bold": "NotoSansGeorgian-Bold",
      "Regular": "NotoSansGeorgian-Regular"
    },
    "Noto Sans Georgian Bold": {
      "Bold": "NotoSansGeorgian-Bold",
      "Regular": "NotoSansGeorgian-Bold"
    },
    "Noto Sans Georgian Regular": {
      "Regular": "NotoSansGeorgian-Regular"
    },
    "Noto Sans Hebrew": {
      "Bold": "NotoSansHebrew-Bold",
      "Regular": "NotoSansHebrew-Regular"
    },
    "Noto Sans Hebrew Bold": {
      "Bold": "NotoSansHebrew-Bold",
      "Regular": "NotoSansHebrew-Bold"
    },
    "Noto Sans Hebrew Regular": {
      "Regular": "NotoSansHebrew-Regular"
    },
    "Noto Sans Italic": {
      "Italic": "NotoSans-Italic",
      "Regular": "NotoSans-Italic"
    },
    "Noto Sans Lao": {
      "Bold": "NotoSansLao-Bold",
      "Regular": "NotoSansLao-Regular"
    },
    "Noto Sans Lao Bold": {
      "Bold": "NotoSansLao-Bold",
      "Regular": "NotoSansLao-Bold"
    },
    "Noto Sans Lao Regular": {
      "Regular": "NotoSansLao-Regular"
    },
    "Noto Sans Light": {
      "Italic": "NotoSans-LightItalic",
      "Light": "NotoSans-Light",
      "Regular": "NotoSans-Light"
    },
    "Noto Sans Light Italic": {
      "Light Italic": "NotoSans-LightItalic",
      "Regular": "NotoSans-LightItalic"
    },
    "Noto Sans Lisu": {
      "Regular": "NotoSansLisu-Regular"
    },
    "Noto Sans Lisu Regular": {
      "Regular": "NotoSansLisu-Regular"
    },
    "Noto Sans Regular": {
      "Regular": "NotoSans-Regular"
    },
    "Noto Serif": {
      "Bold": "NotoSerif-Bold",
      "Bold Italic": "NotoSerif-BoldItalic",
      "Condensed": "NotoSerif-Condensed",
      "Condensed Bold": "NotoSerif-CondensedBold",
      "Condensed Bold Italic": "NotoSerif-CondensedBoldItalic",
      "Condensed Italic": "NotoSerif-CondensedItalic",
      "Italic": "NotoSerif-Italic",
      "Light": "NotoSerif-Light",
      "Light Italic": "NotoSerif-LightItalic",
      "Regular": "NotoSerif-Regular"
    },
    "Noto Serif Armenian": {
      "Bold": "NotoSerifArmenian-Bold",
      "Regular": "NotoSerifArmenian-Regular"
    },
    "Noto Serif Armenian Bold": {
      "Bold": "NotoSerifArmenian-Bold",
      "Regular": "NotoSerifArmenian-Bold"
    },
    "Noto Serif Armenian Regular": {
      "Regular": "NotoSerifArmenian-Regular"
    },
    "Noto Serif Bold": {
      "Bold": "NotoSerif-Bold",
      "Regular": "NotoSerif-Bold"
    },
    "Noto Serif Bold Italic": {
      "Bold Italic": "NotoSerif-BoldItalic",
      "Regular": "NotoSerif-BoldItalic"
    },
    "Noto Serif Cond": {
      "Bold": "NotoSerif-CondensedBold",
      "Bold Italic": "NotoSerif-CondensedBoldItalic",
      "Italic": "NotoSerif-CondensedItalic",
      "Regular": "NotoSerif-Condensed"
    },
    "Noto Serif Condensed": {
      "Condensed": "NotoSerif-Condensed",
      "Regular": "NotoSerif-Condensed"
    },
    "Noto Serif Condensed Bold": {
      "Condensed Bold": "NotoSerif-CondensedBold",
      "Regular": "NotoSerif-CondensedBold"
    },
    "Noto Serif Condensed Bold Italic": {
      "Condensed Bold Italic": "NotoSerif-CondensedBoldItalic",
      "Regular": "NotoSerif-CondensedBoldItalic"
    },
    "Noto Serif Condensed Italic": {
      "Condensed Italic": "NotoSerif-CondensedItalic",
      "Regular": "NotoSerif-CondensedItalic"
    },
    "Noto Serif Georgian": {
      "Bold": "NotoSerifGeorgian-Bold",
      "Regular": "NotoSerifGeorgian-Regular"
    },
    "Noto Serif Georgian Bold": {
      "Bold": "NotoSerifGeorgian-Bold",
      "Regular": "NotoSerifGeorgian-Bold"
    },
    "Noto Serif Georgian Regular": {
      "Regular": "NotoSerifGeorgian-Regular"
    },
    "Noto Serif Hebrew": {
      "Bold": "NotoSerifHebrew-Bold",
      "Regular": "NotoSerifHebrew-Regular"
    },
    "Noto Serif Hebrew Bold": {
      "Bold": "NotoSerifHebrew-Bold",
      "Regular": "NotoSerifHebrew-Bold"
    },
    "Noto Serif Hebrew Regular": {
      "Regular": "NotoSerifHebrew-Regular"
    },
    "Noto Serif Italic": {
      "Italic": "NotoSerif-Italic",
      "Regular": "NotoSerif-Italic"
    },
    "Noto Serif Lao": {
      "Bold": "NotoSerifLao-Bold",
      "Regular": "NotoSerifLao-Regular"
    },
    "Noto Serif Lao Bold": {
      "Bold": "NotoSerifLao-Bold",
      "Regular": "NotoSerifLao-Bold"
    },
    "Noto Serif Lao Regular": {
      "Regular": "NotoSerifLao-Regular"
    },
    "Noto Serif Light": {
      "Italic": "NotoSerif-LightItalic",
      "Light": "NotoSerif-Light",
      "Regular": "NotoSerif-Light"
    },
    "Noto Serif Light Italic": {
      "Light Italic": "NotoSerif-LightItalic",
      "Regular": "NotoSerif-LightItalic"
    },
    "Noto Serif Regular": {
      "Regular": "NotoSerif-Regular"
    },
    "OCR A Extended": {
      "Arrunta": "OCRAExtended",
      "Navadno": "OCRAExtended",
      "Normaali": "OCRAExtended",
      "Normal": "OCRAExtended",
      "Normale": "OCRAExtended",
      "Normalny": "OCRAExtended",
      "Norm\xE1l": "OCRAExtended",
      "Norm\xE1lne": "OCRAExtended",
      "Regular": "OCRAExtended",
      "Standaard": "OCRAExtended",
      "Standard": "OCRAExtended",
      "normal": "OCRAExtended",
      "oby\u010Dejn\xE9": "OCRAExtended",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "OCRAExtended",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "OCRAExtended"
    },
    "Old English Text MT": {
      "Arrunta": "OldEnglishTextMT",
      "Navadno": "OldEnglishTextMT",
      "Normaali": "OldEnglishTextMT",
      "Normal": "OldEnglishTextMT",
      "Normale": "OldEnglishTextMT",
      "Normalny": "OldEnglishTextMT",
      "Norm\xE1l": "OldEnglishTextMT",
      "Norm\xE1lne": "OldEnglishTextMT",
      "Regular": "OldEnglishTextMT",
      "Standaard": "OldEnglishTextMT",
      "Standard": "OldEnglishTextMT",
      "normal": "OldEnglishTextMT",
      "oby\u010Dejn\xE9": "OldEnglishTextMT",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "OldEnglishTextMT",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "OldEnglishTextMT"
    },
    "Onyx": {
      "Arrunta": "Onyx",
      "Navadno": "Onyx",
      "Normaali": "Onyx",
      "Normal": "Onyx",
      "Normale": "Onyx",
      "Normalny": "Onyx",
      "Norm\xE1l": "Onyx",
      "Norm\xE1lne": "Onyx",
      "Regular": "Onyx",
      "Standaard": "Onyx",
      "Standard": "Onyx",
      "normal": "Onyx",
      "oby\u010Dejn\xE9": "Onyx",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "Onyx",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "Onyx"
    },
    "OpenSymbol": {
      "Regular": "OpenSymbol"
    },
    "Palace Script MT": {
      "Regular": "PalaceScriptMT"
    },
    "Palatino Linotype": {
      "Arrunta": "PalatinoLinotype-Roman",
      "Bold": "PalatinoLinotype-Bold",
      "Bold Italic": "PalatinoLinotype-BoldItalic",
      "Corsivo": "PalatinoLinotype-Italic",
      "Cursief": "PalatinoLinotype-Italic",
      "Cursiva": "PalatinoLinotype-Italic",
      "D\u0151lt": "PalatinoLinotype-Italic",
      "Etzana": "PalatinoLinotype-Italic",
      "Fet": "PalatinoLinotype-Bold",
      "Fet Kursiv": "PalatinoLinotype-BoldItalic",
      "Fett": "PalatinoLinotype-Bold",
      "Fett Kursiv": "PalatinoLinotype-BoldItalic",
      "F\xE9lk\xF6v\xE9r": "PalatinoLinotype-Bold",
      "F\xE9lk\xF6v\xE9r d\u0151lt": "PalatinoLinotype-BoldItalic",
      "Gras": "PalatinoLinotype-Bold",
      "Gras Italique": "PalatinoLinotype-BoldItalic",
      "Grassetto": "PalatinoLinotype-Bold",
      "Grassetto Corsivo": "PalatinoLinotype-BoldItalic",
      "Halvfet": "PalatinoLinotype-Bold",
      "Halvfet Kursiv": "PalatinoLinotype-BoldItalic",
      "Italic": "PalatinoLinotype-Italic",
      "Italique": "PalatinoLinotype-Italic",
      "It\xE1lico": "PalatinoLinotype-Italic",
      "Kal\u0131n": "PalatinoLinotype-Bold",
      "Kal\u0131n \u0130talik": "PalatinoLinotype-BoldItalic",
      "Krepko": "PalatinoLinotype-Bold",
      "Krepko po\u0161evno": "PalatinoLinotype-BoldItalic",
      "Kursiv": "PalatinoLinotype-Italic",
      "Kursivoitu": "PalatinoLinotype-Italic",
      "Kursywa": "PalatinoLinotype-Italic",
      "Kurz\xEDva": "PalatinoLinotype-Italic",
      "Lihavoitu": "PalatinoLinotype-Bold",
      "Lihavoitu Kursivoi": "PalatinoLinotype-BoldItalic",
      "Lodi etzana": "PalatinoLinotype-BoldItalic",
      "Lodia": "PalatinoLinotype-Bold",
      "Navadno": "PalatinoLinotype-Roman",
      "Negreta": "PalatinoLinotype-Bold",
      "Negreta cursiva": "PalatinoLinotype-BoldItalic",
      "Negrita": "PalatinoLinotype-Bold",
      "Negrita Cursiva": "PalatinoLinotype-BoldItalic",
      "Negrito": "PalatinoLinotype-Bold",
      "Negrito It\xE1lico": "PalatinoLinotype-BoldItalic",
      "Normaali": "PalatinoLinotype-Roman",
      "Normal": "PalatinoLinotype-Roman",
      "Normale": "PalatinoLinotype-Roman",
      "Normalny": "PalatinoLinotype-Roman",
      "Norm\xE1l": "PalatinoLinotype-Roman",
      "Norm\xE1lne": "PalatinoLinotype-Roman",
      "Pogrubiona kursywa": "PalatinoLinotype-BoldItalic",
      "Pogrubiony": "PalatinoLinotype-Bold",
      "Po\u0161evno": "PalatinoLinotype-Italic",
      "Regular": "PalatinoLinotype-Roman",
      "Standaard": "PalatinoLinotype-Roman",
      "Standard": "PalatinoLinotype-Roman",
      "Tu\u010Dn\xE1 kurz\xEDva": "PalatinoLinotype-BoldItalic",
      "Tu\u010Dn\xE9": "PalatinoLinotype-Bold",
      "Vet": "PalatinoLinotype-Bold",
      "Vet Cursief": "PalatinoLinotype-BoldItalic",
      "fed": "PalatinoLinotype-Bold",
      "fed kursiv": "PalatinoLinotype-BoldItalic",
      "kursiv": "PalatinoLinotype-Italic",
      "kurz\xEDva": "PalatinoLinotype-Italic",
      "nghi\xEAng": "PalatinoLinotype-Italic",
      "nghi\xEAng \u0111\xE2\u0323m": "PalatinoLinotype-BoldItalic",
      "normal": "PalatinoLinotype-Roman",
      "oby\u010Dejn\xE9": "PalatinoLinotype-Roman",
      "th\u01B0\u01A1\u0300ng": "PalatinoLinotype-Roman",
      "tu\u010Dn\xE9": "PalatinoLinotype-Bold",
      "tu\u010Dn\xE9 kurz\xEDva": "PalatinoLinotype-BoldItalic",
      "\u0111\xE2\u0323m": "PalatinoLinotype-Bold",
      "\u0130talik": "PalatinoLinotype-Italic",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "PalatinoLinotype-Bold",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "PalatinoLinotype-BoldItalic",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "PalatinoLinotype-Roman",
      "\u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "PalatinoLinotype-Italic",
      "\u041A\u0443\u0440\u0441\u0438\u0432": "PalatinoLinotype-Italic",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "PalatinoLinotype-Roman",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "PalatinoLinotype-Bold",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": "PalatinoLinotype-BoldItalic"
    },
    "Palatino Linotype Bold": {
      "Bold": "PalatinoLinotype-Bold",
      "Regular": "PalatinoLinotype-Bold"
    },
    "Palatino Linotype Bold Italic": {
      "Bold Italic": "PalatinoLinotype-BoldItalic",
      "Regular": "PalatinoLinotype-BoldItalic"
    },
    "Palatino Linotype Corsivo": {
      "Regular": "PalatinoLinotype-Italic"
    },
    "Palatino Linotype Cursief": {
      "Regular": "PalatinoLinotype-Italic"
    },
    "Palatino Linotype Cursiva": {
      "Regular": "PalatinoLinotype-Italic"
    },
    "Palatino Linotype D\u0151lt": {
      "Regular": "PalatinoLinotype-Italic"
    },
    "Palatino Linotype Etzana": {
      "Regular": "PalatinoLinotype-Italic"
    },
    "Palatino Linotype Fet": {
      "Regular": "PalatinoLinotype-Bold"
    },
    "Palatino Linotype Fet Kursiv": {
      "Regular": "PalatinoLinotype-BoldItalic"
    },
    "Palatino Linotype Fett": {
      "Regular": "PalatinoLinotype-Bold"
    },
    "Palatino Linotype Fett Kursiv": {
      "Regular": "PalatinoLinotype-BoldItalic"
    },
    "Palatino Linotype F\xE9lk\xF6v\xE9r": {
      "Regular": "PalatinoLinotype-Bold"
    },
    "Palatino Linotype F\xE9lk\xF6v\xE9r d\u0151lt": {
      "Regular": "PalatinoLinotype-BoldItalic"
    },
    "Palatino Linotype Gras": {
      "Regular": "PalatinoLinotype-Bold"
    },
    "Palatino Linotype Gras Italique": {
      "Regular": "PalatinoLinotype-BoldItalic"
    },
    "Palatino Linotype Grassetto": {
      "Regular": "PalatinoLinotype-Bold"
    },
    "Palatino Linotype Grassetto Corsivo": {
      "Regular": "PalatinoLinotype-BoldItalic"
    },
    "Palatino Linotype Halvfet": {
      "Regular": "PalatinoLinotype-Bold"
    },
    "Palatino Linotype Halvfet Kursiv": {
      "Regular": "PalatinoLinotype-BoldItalic"
    },
    "Palatino Linotype Italic": {
      "Italic": "PalatinoLinotype-Italic",
      "Regular": "PalatinoLinotype-Italic"
    },
    "Palatino Linotype Italique": {
      "Regular": "PalatinoLinotype-Italic"
    },
    "Palatino Linotype It\xE1lico": {
      "Regular": "PalatinoLinotype-Italic"
    },
    "Palatino Linotype Kal\u0131n": {
      "Regular": "PalatinoLinotype-Bold"
    },
    "Palatino Linotype Kal\u0131n \u0130talik": {
      "Regular": "PalatinoLinotype-BoldItalic"
    },
    "Palatino Linotype Krepko": {
      "Regular": "PalatinoLinotype-Bold"
    },
    "Palatino Linotype Krepko po\u0161evno": {
      "Regular": "PalatinoLinotype-BoldItalic"
    },
    "Palatino Linotype Kursiv": {
      "Regular": "PalatinoLinotype-Italic"
    },
    "Palatino Linotype Kursivoitu": {
      "Regular": "PalatinoLinotype-Italic"
    },
    "Palatino Linotype Kursywa": {
      "Regular": "PalatinoLinotype-Italic"
    },
    "Palatino Linotype Kurz\xEDva": {
      "Regular": "PalatinoLinotype-Italic"
    },
    "Palatino Linotype Lihavoitu": {
      "Regular": "PalatinoLinotype-Bold"
    },
    "Palatino Linotype Lihavoitu Kursivoi": {
      "Regular": "PalatinoLinotype-BoldItalic"
    },
    "Palatino Linotype Lodi etzana": {
      "Regular": "PalatinoLinotype-BoldItalic"
    },
    "Palatino Linotype Lodia": {
      "Regular": "PalatinoLinotype-Bold"
    },
    "Palatino Linotype Negreta": {
      "Regular": "PalatinoLinotype-Bold"
    },
    "Palatino Linotype Negreta cursiva": {
      "Regular": "PalatinoLinotype-BoldItalic"
    },
    "Palatino Linotype Negrita": {
      "Regular": "PalatinoLinotype-Bold"
    },
    "Palatino Linotype Negrita Cursiva": {
      "Regular": "PalatinoLinotype-BoldItalic"
    },
    "Palatino Linotype Negrito": {
      "Regular": "PalatinoLinotype-Bold"
    },
    "Palatino Linotype Negrito It\xE1lico": {
      "Regular": "PalatinoLinotype-BoldItalic"
    },
    "Palatino Linotype Pogrubiona kursywa": {
      "Regular": "PalatinoLinotype-BoldItalic"
    },
    "Palatino Linotype Pogrubiony": {
      "Regular": "PalatinoLinotype-Bold"
    },
    "Palatino Linotype Po\u0161evno": {
      "Regular": "PalatinoLinotype-Italic"
    },
    "Palatino Linotype Tu\u010Dn\xE1 kurz\xEDva": {
      "Regular": "PalatinoLinotype-BoldItalic"
    },
    "Palatino Linotype Tu\u010Dn\xE9": {
      "Regular": "PalatinoLinotype-Bold"
    },
    "Palatino Linotype Vet": {
      "Regular": "PalatinoLinotype-Bold"
    },
    "Palatino Linotype Vet Cursief": {
      "Regular": "PalatinoLinotype-BoldItalic"
    },
    "Palatino Linotype fed": {
      "Regular": "PalatinoLinotype-Bold"
    },
    "Palatino Linotype fed kursiv": {
      "Regular": "PalatinoLinotype-BoldItalic"
    },
    "Palatino Linotype kursiv": {
      "Regular": "PalatinoLinotype-Italic"
    },
    "Palatino Linotype kurz\xEDva": {
      "Regular": "PalatinoLinotype-Italic"
    },
    "Palatino Linotype nghi\xEAng": {
      "Regular": "PalatinoLinotype-Italic"
    },
    "Palatino Linotype nghi\xEAng \u0111\xE2\u0323m": {
      "Regular": "PalatinoLinotype-BoldItalic"
    },
    "Palatino Linotype tu\u010Dn\xE9": {
      "Regular": "PalatinoLinotype-Bold"
    },
    "Palatino Linotype tu\u010Dn\xE9 kurz\xEDva": {
      "Regular": "PalatinoLinotype-BoldItalic"
    },
    "Palatino Linotype \u0111\xE2\u0323m": {
      "Regular": "PalatinoLinotype-Bold"
    },
    "Palatino Linotype \u0130talik": {
      "Regular": "PalatinoLinotype-Italic"
    },
    "Palatino Linotype \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "PalatinoLinotype-Bold"
    },
    "Palatino Linotype \u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "PalatinoLinotype-BoldItalic"
    },
    "Palatino Linotype \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "PalatinoLinotype-Italic"
    },
    "Palatino Linotype \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "PalatinoLinotype-Italic"
    },
    "Palatino Linotype \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "PalatinoLinotype-Bold"
    },
    "Palatino Linotype \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "PalatinoLinotype-BoldItalic"
    },
    "Papyrus": {
      "Arrunta": "Papyrus-Regular",
      "Navadno": "Papyrus-Regular",
      "Normaali": "Papyrus-Regular",
      "Normal": "Papyrus-Regular",
      "Normale": "Papyrus-Regular",
      "Normalny": "Papyrus-Regular",
      "Norm\xE1l": "Papyrus-Regular",
      "Norm\xE1lne": "Papyrus-Regular",
      "Regular": "Papyrus-Regular",
      "Standaard": "Papyrus-Regular",
      "Standard": "Papyrus-Regular",
      "normal": "Papyrus-Regular",
      "oby\u010Dejn\xE9": "Papyrus-Regular",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "Papyrus-Regular",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "Papyrus-Regular"
    },
    "Parchment": {
      "Arrunta": "Parchment-Regular",
      "Navadno": "Parchment-Regular",
      "Normaali": "Parchment-Regular",
      "Normal": "Parchment-Regular",
      "Normale": "Parchment-Regular",
      "Normalny": "Parchment-Regular",
      "Norm\xE1l": "Parchment-Regular",
      "Norm\xE1lne": "Parchment-Regular",
      "Regular": "Parchment-Regular",
      "Standaard": "Parchment-Regular",
      "Standard": "Parchment-Regular",
      "normal": "Parchment-Regular",
      "oby\u010Dejn\xE9": "Parchment-Regular",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "Parchment-Regular",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "Parchment-Regular"
    },
    "Perpetua": {
      "Arrunta": "Perpetua",
      "Bold": "Perpetua-Bold",
      "Bold Italic": "Perpetua-BoldItalic",
      "Corsivo": "Perpetua-Italic",
      "Cursief": "Perpetua-Italic",
      "Cursiva": "Perpetua-Italic",
      "D\u0151lt": "Perpetua-Italic",
      "Etzana": "Perpetua-Italic",
      "Fet": "Perpetua-Bold",
      "Fet Kursiv": "Perpetua-BoldItalic",
      "Fett": "Perpetua-Bold",
      "Fett Kursiv": "Perpetua-BoldItalic",
      "F\xE9lk\xF6v\xE9r": "Perpetua-Bold",
      "F\xE9lk\xF6v\xE9r d\u0151lt": "Perpetua-BoldItalic",
      "Gras": "Perpetua-Bold",
      "Gras Italique": "Perpetua-BoldItalic",
      "Grassetto": "Perpetua-Bold",
      "Grassetto Corsivo": "Perpetua-BoldItalic",
      "Halvfet": "Perpetua-Bold",
      "Halvfet Kursiv": "Perpetua-BoldItalic",
      "Italic": "Perpetua-Italic",
      "Italique": "Perpetua-Italic",
      "It\xE1lico": "Perpetua-Italic",
      "Kal\u0131n": "Perpetua-Bold",
      "Kal\u0131n \u0130talik": "Perpetua-BoldItalic",
      "Krepko": "Perpetua-Bold",
      "Krepko po\u0161evno": "Perpetua-BoldItalic",
      "Kursiv": "Perpetua-Italic",
      "Kursivoitu": "Perpetua-Italic",
      "Kursywa": "Perpetua-Italic",
      "Kurz\xEDva": "Perpetua-Italic",
      "Lihavoitu": "Perpetua-Bold",
      "Lihavoitu Kursivoi": "Perpetua-BoldItalic",
      "Lodi etzana": "Perpetua-BoldItalic",
      "Lodia": "Perpetua-Bold",
      "Navadno": "Perpetua",
      "Negreta": "Perpetua-Bold",
      "Negreta cursiva": "Perpetua-BoldItalic",
      "Negrita": "Perpetua-Bold",
      "Negrita Cursiva": "Perpetua-BoldItalic",
      "Negrito": "Perpetua-Bold",
      "Negrito It\xE1lico": "Perpetua-BoldItalic",
      "Normaali": "Perpetua",
      "Normal": "Perpetua",
      "Normale": "Perpetua",
      "Normalny": "Perpetua",
      "Norm\xE1l": "Perpetua",
      "Norm\xE1lne": "Perpetua",
      "Pogrubiona kursywa": "Perpetua-BoldItalic",
      "Pogrubiony": "Perpetua-Bold",
      "Po\u0161evno": "Perpetua-Italic",
      "Regular": "Perpetua",
      "Standaard": "Perpetua",
      "Standard": "Perpetua",
      "Tu\u010Dn\xE1 kurz\xEDva": "Perpetua-BoldItalic",
      "Tu\u010Dn\xE9": "Perpetua-Bold",
      "Vet": "Perpetua-Bold",
      "Vet Cursief": "Perpetua-BoldItalic",
      "fed": "Perpetua-Bold",
      "fed kursiv": "Perpetua-BoldItalic",
      "kursiv": "Perpetua-Italic",
      "kurz\xEDva": "Perpetua-Italic",
      "normal": "Perpetua",
      "oby\u010Dejn\xE9": "Perpetua",
      "tu\u010Dn\xE9": "Perpetua-Bold",
      "tu\u010Dn\xE9 kurz\xEDva": "Perpetua-BoldItalic",
      "\u0130talik": "Perpetua-Italic",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "Perpetua-Bold",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "Perpetua-BoldItalic",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "Perpetua",
      "\u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "Perpetua-Italic",
      "\u041A\u0443\u0440\u0441\u0438\u0432": "Perpetua-Italic",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "Perpetua",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "Perpetua-Bold",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": "Perpetua-BoldItalic"
    },
    "Perpetua Bold": {
      "Bold": "Perpetua-Bold",
      "Regular": "Perpetua-Bold"
    },
    "Perpetua Bold Italic": {
      "Bold Italic": "Perpetua-BoldItalic",
      "Regular": "Perpetua-BoldItalic"
    },
    "Perpetua Corsivo": {
      "Regular": "Perpetua-Italic"
    },
    "Perpetua Cursief": {
      "Regular": "Perpetua-Italic"
    },
    "Perpetua Cursiva": {
      "Regular": "Perpetua-Italic"
    },
    "Perpetua D\u0151lt": {
      "Regular": "Perpetua-Italic"
    },
    "Perpetua Etzana": {
      "Regular": "Perpetua-Italic"
    },
    "Perpetua Fet": {
      "Regular": "Perpetua-Bold"
    },
    "Perpetua Fet Kursiv": {
      "Regular": "Perpetua-BoldItalic"
    },
    "Perpetua Fett": {
      "Regular": "Perpetua-Bold"
    },
    "Perpetua Fett Kursiv": {
      "Regular": "Perpetua-BoldItalic"
    },
    "Perpetua F\xE9lk\xF6v\xE9r": {
      "Regular": "Perpetua-Bold"
    },
    "Perpetua F\xE9lk\xF6v\xE9r d\u0151lt": {
      "Regular": "Perpetua-BoldItalic"
    },
    "Perpetua Gras": {
      "Regular": "Perpetua-Bold"
    },
    "Perpetua Gras Italique": {
      "Regular": "Perpetua-BoldItalic"
    },
    "Perpetua Grassetto": {
      "Regular": "Perpetua-Bold"
    },
    "Perpetua Grassetto Corsivo": {
      "Regular": "Perpetua-BoldItalic"
    },
    "Perpetua Halvfet": {
      "Regular": "Perpetua-Bold"
    },
    "Perpetua Halvfet Kursiv": {
      "Regular": "Perpetua-BoldItalic"
    },
    "Perpetua Italic": {
      "Italic": "Perpetua-Italic",
      "Regular": "Perpetua-Italic"
    },
    "Perpetua Italique": {
      "Regular": "Perpetua-Italic"
    },
    "Perpetua It\xE1lico": {
      "Regular": "Perpetua-Italic"
    },
    "Perpetua Kal\u0131n": {
      "Regular": "Perpetua-Bold"
    },
    "Perpetua Kal\u0131n \u0130talik": {
      "Regular": "Perpetua-BoldItalic"
    },
    "Perpetua Krepko": {
      "Regular": "Perpetua-Bold"
    },
    "Perpetua Krepko po\u0161evno": {
      "Regular": "Perpetua-BoldItalic"
    },
    "Perpetua Kursiv": {
      "Regular": "Perpetua-Italic"
    },
    "Perpetua Kursivoitu": {
      "Regular": "Perpetua-Italic"
    },
    "Perpetua Kursywa": {
      "Regular": "Perpetua-Italic"
    },
    "Perpetua Kurz\xEDva": {
      "Regular": "Perpetua-Italic"
    },
    "Perpetua Lihavoitu": {
      "Regular": "Perpetua-Bold"
    },
    "Perpetua Lihavoitu Kursivoi": {
      "Regular": "Perpetua-BoldItalic"
    },
    "Perpetua Lodi etzana": {
      "Regular": "Perpetua-BoldItalic"
    },
    "Perpetua Lodia": {
      "Regular": "Perpetua-Bold"
    },
    "Perpetua Negreta": {
      "Regular": "Perpetua-Bold"
    },
    "Perpetua Negreta cursiva": {
      "Regular": "Perpetua-BoldItalic"
    },
    "Perpetua Negrita": {
      "Regular": "Perpetua-Bold"
    },
    "Perpetua Negrita Cursiva": {
      "Regular": "Perpetua-BoldItalic"
    },
    "Perpetua Negrito": {
      "Regular": "Perpetua-Bold"
    },
    "Perpetua Negrito It\xE1lico": {
      "Regular": "Perpetua-BoldItalic"
    },
    "Perpetua Pogrubiona kursywa": {
      "Regular": "Perpetua-BoldItalic"
    },
    "Perpetua Pogrubiony": {
      "Regular": "Perpetua-Bold"
    },
    "Perpetua Po\u0161evno": {
      "Regular": "Perpetua-Italic"
    },
    "Perpetua Titling MT": {
      "Bold": "PerpetuaTitlingMT-Bold",
      "Chiarissimo": "PerpetuaTitlingMT-Light",
      "Fet": "PerpetuaTitlingMT-Bold",
      "Fett": "PerpetuaTitlingMT-Bold",
      "Fina": "PerpetuaTitlingMT-Light",
      "F\xE9lk\xF6v\xE9r": "PerpetuaTitlingMT-Bold",
      "Gras": "PerpetuaTitlingMT-Bold",
      "Grassetto": "PerpetuaTitlingMT-Bold",
      "Halvfet": "PerpetuaTitlingMT-Bold",
      "Kal\u0131n": "PerpetuaTitlingMT-Bold",
      "Krepko": "PerpetuaTitlingMT-Bold",
      "Light": "PerpetuaTitlingMT-Light",
      "Lihavoitu": "PerpetuaTitlingMT-Bold",
      "Lodia": "PerpetuaTitlingMT-Bold",
      "Mager": "PerpetuaTitlingMT-Light",
      "Maigre": "PerpetuaTitlingMT-Light",
      "Negreta": "PerpetuaTitlingMT-Bold",
      "Negrita": "PerpetuaTitlingMT-Bold",
      "Negrito": "PerpetuaTitlingMT-Bold",
      "Pogrubiony": "PerpetuaTitlingMT-Bold",
      "Tu\u010Dn\xE9": "PerpetuaTitlingMT-Bold",
      "Vet": "PerpetuaTitlingMT-Bold",
      "fed": "PerpetuaTitlingMT-Bold",
      "tu\u010Dn\xE9": "PerpetuaTitlingMT-Bold",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "PerpetuaTitlingMT-Bold",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "PerpetuaTitlingMT-Bold"
    },
    "Perpetua Titling MT Bold": {
      "Bold": "PerpetuaTitlingMT-Bold",
      "Regular": "PerpetuaTitlingMT-Bold"
    },
    "Perpetua Titling MT Chiarissimo": {
      "Regular": "PerpetuaTitlingMT-Light"
    },
    "Perpetua Titling MT Fet": {
      "Regular": "PerpetuaTitlingMT-Bold"
    },
    "Perpetua Titling MT Fett": {
      "Regular": "PerpetuaTitlingMT-Bold"
    },
    "Perpetua Titling MT Fina": {
      "Regular": "PerpetuaTitlingMT-Light"
    },
    "Perpetua Titling MT F\xE9lk\xF6v\xE9r": {
      "Regular": "PerpetuaTitlingMT-Bold"
    },
    "Perpetua Titling MT Gras": {
      "Regular": "PerpetuaTitlingMT-Bold"
    },
    "Perpetua Titling MT Grassetto": {
      "Regular": "PerpetuaTitlingMT-Bold"
    },
    "Perpetua Titling MT Halvfet": {
      "Regular": "PerpetuaTitlingMT-Bold"
    },
    "Perpetua Titling MT Kal\u0131n": {
      "Regular": "PerpetuaTitlingMT-Bold"
    },
    "Perpetua Titling MT Krepko": {
      "Regular": "PerpetuaTitlingMT-Bold"
    },
    "Perpetua Titling MT Light": {
      "Light": "PerpetuaTitlingMT-Light",
      "Regular": "PerpetuaTitlingMT-Light"
    },
    "Perpetua Titling MT Lihavoitu": {
      "Regular": "PerpetuaTitlingMT-Bold"
    },
    "Perpetua Titling MT Lodia": {
      "Regular": "PerpetuaTitlingMT-Bold"
    },
    "Perpetua Titling MT Mager": {
      "Regular": "PerpetuaTitlingMT-Light"
    },
    "Perpetua Titling MT Maigre": {
      "Regular": "PerpetuaTitlingMT-Light"
    },
    "Perpetua Titling MT Negreta": {
      "Regular": "PerpetuaTitlingMT-Bold"
    },
    "Perpetua Titling MT Negrita": {
      "Regular": "PerpetuaTitlingMT-Bold"
    },
    "Perpetua Titling MT Negrito": {
      "Regular": "PerpetuaTitlingMT-Bold"
    },
    "Perpetua Titling MT Pogrubiony": {
      "Regular": "PerpetuaTitlingMT-Bold"
    },
    "Perpetua Titling MT Tu\u010Dn\xE9": {
      "Regular": "PerpetuaTitlingMT-Bold"
    },
    "Perpetua Titling MT Vet": {
      "Regular": "PerpetuaTitlingMT-Bold"
    },
    "Perpetua Titling MT fed": {
      "Regular": "PerpetuaTitlingMT-Bold"
    },
    "Perpetua Titling MT tu\u010Dn\xE9": {
      "Regular": "PerpetuaTitlingMT-Bold"
    },
    "Perpetua Titling MT \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "PerpetuaTitlingMT-Bold"
    },
    "Perpetua Titling MT \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "PerpetuaTitlingMT-Bold"
    },
    "Perpetua Tu\u010Dn\xE1 kurz\xEDva": {
      "Regular": "Perpetua-BoldItalic"
    },
    "Perpetua Tu\u010Dn\xE9": {
      "Regular": "Perpetua-Bold"
    },
    "Perpetua Vet": {
      "Regular": "Perpetua-Bold"
    },
    "Perpetua Vet Cursief": {
      "Regular": "Perpetua-BoldItalic"
    },
    "Perpetua fed": {
      "Regular": "Perpetua-Bold"
    },
    "Perpetua fed kursiv": {
      "Regular": "Perpetua-BoldItalic"
    },
    "Perpetua kursiv": {
      "Regular": "Perpetua-Italic"
    },
    "Perpetua kurz\xEDva": {
      "Regular": "Perpetua-Italic"
    },
    "Perpetua tu\u010Dn\xE9": {
      "Regular": "Perpetua-Bold"
    },
    "Perpetua tu\u010Dn\xE9 kurz\xEDva": {
      "Regular": "Perpetua-BoldItalic"
    },
    "Perpetua \u0130talik": {
      "Regular": "Perpetua-Italic"
    },
    "Perpetua \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "Perpetua-Bold"
    },
    "Perpetua \u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "Perpetua-BoldItalic"
    },
    "Perpetua \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "Perpetua-Italic"
    },
    "Perpetua \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "Perpetua-Italic"
    },
    "Perpetua \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "Perpetua-Bold"
    },
    "Perpetua \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "Perpetua-BoldItalic"
    },
    "Playbill": {
      "Arrunta": "Playbill",
      "Navadno": "Playbill",
      "Normaali": "Playbill",
      "Normal": "Playbill",
      "Normale": "Playbill",
      "Normalny": "Playbill",
      "Norm\xE1l": "Playbill",
      "Norm\xE1lne": "Playbill",
      "Regular": "Playbill",
      "Standaard": "Playbill",
      "Standard": "Playbill",
      "normal": "Playbill",
      "oby\u010Dejn\xE9": "Playbill",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "Playbill",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "Playbill"
    },
    "Poor Richard": {
      "Arrunta": "PoorRichard-Regular",
      "Navadno": "PoorRichard-Regular",
      "Normaali": "PoorRichard-Regular",
      "Normal": "PoorRichard-Regular",
      "Normale": "PoorRichard-Regular",
      "Normalny": "PoorRichard-Regular",
      "Norm\xE1l": "PoorRichard-Regular",
      "Norm\xE1lne": "PoorRichard-Regular",
      "Regular": "PoorRichard-Regular",
      "Standaard": "PoorRichard-Regular",
      "Standard": "PoorRichard-Regular",
      "normal": "PoorRichard-Regular",
      "oby\u010Dejn\xE9": "PoorRichard-Regular",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "PoorRichard-Regular",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "PoorRichard-Regular"
    },
    "Pristina": {
      "Arrunta": "Pristina-Regular",
      "Navadno": "Pristina-Regular",
      "Normaali": "Pristina-Regular",
      "Normal": "Pristina-Regular",
      "Normale": "Pristina-Regular",
      "Normalny": "Pristina-Regular",
      "Norm\xE1l": "Pristina-Regular",
      "Norm\xE1lne": "Pristina-Regular",
      "Regular": "Pristina-Regular",
      "Standaard": "Pristina-Regular",
      "Standard": "Pristina-Regular",
      "normal": "Pristina-Regular",
      "oby\u010Dejn\xE9": "Pristina-Regular",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "Pristina-Regular",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "Pristina-Regular"
    },
    "Rage": {
      "Regular": "RageItalic"
    },
    "Rage Italic": {
      "Arrunta": "RageItalic",
      "Navadno": "RageItalic",
      "Normaali": "RageItalic",
      "Normal": "RageItalic",
      "Normale": "RageItalic",
      "Normalny": "RageItalic",
      "Norm\xE1l": "RageItalic",
      "Norm\xE1lne": "RageItalic",
      "Regular": "RageItalic",
      "Standaard": "RageItalic",
      "Standard": "RageItalic",
      "normal": "RageItalic",
      "oby\u010Dejn\xE9": "RageItalic",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "RageItalic",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "RageItalic"
    },
    "Ravie": {
      "Arrunta": "Ravie",
      "Navadno": "Ravie",
      "Normaali": "Ravie",
      "Normal": "Ravie",
      "Normale": "Ravie",
      "Normalny": "Ravie",
      "Norm\xE1l": "Ravie",
      "Norm\xE1lne": "Ravie",
      "Regular": "Ravie",
      "Standaard": "Ravie",
      "Standard": "Ravie",
      "normal": "Ravie",
      "oby\u010Dejn\xE9": "Ravie",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "Ravie",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "Ravie"
    },
    "Reem Kufi": {
      "Bold": "ReemKufi-Bold",
      "Regular": "ReemKufi-Regular"
    },
    "Reem Kufi Bold": {
      "Bold": "ReemKufi-Bold",
      "Regular": "ReemKufi-Bold"
    },
    "Reem Kufi Regular": {
      "Regular": "ReemKufi-Regular"
    },
    "Rockwell": {
      "Arrunta": "Rockwell",
      "Bold": "Rockwell-CondensedBold",
      "Bold Italic": "Rockwell-BoldItalic",
      "Corsivo": "Rockwell-Italic",
      "Cursief": "Rockwell-Italic",
      "Cursiva": "Rockwell-Italic",
      "D\u0151lt": "Rockwell-Italic",
      "Etzana": "Rockwell-Italic",
      "Fet": "Rockwell-Bold",
      "Fet Kursiv": "Rockwell-BoldItalic",
      "Fett": "Rockwell-Bold",
      "Fett Kursiv": "Rockwell-BoldItalic",
      "F\xE9lk\xF6v\xE9r": "Rockwell-Bold",
      "F\xE9lk\xF6v\xE9r d\u0151lt": "Rockwell-BoldItalic",
      "Gras": "Rockwell-Bold",
      "Gras Italique": "Rockwell-BoldItalic",
      "Grassetto": "Rockwell-Bold",
      "Grassetto Corsivo": "Rockwell-BoldItalic",
      "Halvfet": "Rockwell-Bold",
      "Halvfet Kursiv": "Rockwell-BoldItalic",
      "Italic": "Rockwell-Italic",
      "Italique": "Rockwell-Italic",
      "It\xE1lico": "Rockwell-Italic",
      "Kal\u0131n": "Rockwell-Bold",
      "Kal\u0131n \u0130talik": "Rockwell-BoldItalic",
      "Krepko": "Rockwell-Bold",
      "Krepko po\u0161evno": "Rockwell-BoldItalic",
      "Kursiv": "Rockwell-Italic",
      "Kursivoitu": "Rockwell-Italic",
      "Kursywa": "Rockwell-Italic",
      "Kurz\xEDva": "Rockwell-Italic",
      "Lihavoitu": "Rockwell-Bold",
      "Lihavoitu Kursivoi": "Rockwell-BoldItalic",
      "Lodi etzana": "Rockwell-BoldItalic",
      "Lodia": "Rockwell-Bold",
      "Navadno": "Rockwell",
      "Negreta": "Rockwell-Bold",
      "Negreta cursiva": "Rockwell-BoldItalic",
      "Negrita": "Rockwell-Bold",
      "Negrita Cursiva": "Rockwell-BoldItalic",
      "Negrito": "Rockwell-Bold",
      "Negrito It\xE1lico": "Rockwell-BoldItalic",
      "Normaali": "Rockwell",
      "Normal": "Rockwell",
      "Normale": "Rockwell",
      "Normalny": "Rockwell",
      "Norm\xE1l": "Rockwell",
      "Norm\xE1lne": "Rockwell",
      "Pogrubiona kursywa": "Rockwell-BoldItalic",
      "Pogrubiony": "Rockwell-Bold",
      "Po\u0161evno": "Rockwell-Italic",
      "Regular": "Rockwell-ExtraBold",
      "Standaard": "Rockwell",
      "Standard": "Rockwell",
      "Tu\u010Dn\xE1 kurz\xEDva": "Rockwell-BoldItalic",
      "Tu\u010Dn\xE9": "Rockwell-Bold",
      "Vet": "Rockwell-Bold",
      "Vet Cursief": "Rockwell-BoldItalic",
      "fed": "Rockwell-Bold",
      "fed kursiv": "Rockwell-BoldItalic",
      "kursiv": "Rockwell-Italic",
      "kurz\xEDva": "Rockwell-Italic",
      "normal": "Rockwell",
      "oby\u010Dejn\xE9": "Rockwell",
      "tu\u010Dn\xE9": "Rockwell-Bold",
      "tu\u010Dn\xE9 kurz\xEDva": "Rockwell-BoldItalic",
      "\u0130talik": "Rockwell-Italic",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "Rockwell-Bold",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "Rockwell-BoldItalic",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "Rockwell",
      "\u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "Rockwell-Italic",
      "\u041A\u0443\u0440\u0441\u0438\u0432": "Rockwell-Italic",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "Rockwell",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "Rockwell-Bold",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": "Rockwell-BoldItalic"
    },
    "Rockwell Bold": {
      "Bold": "Rockwell-Bold",
      "Regular": "Rockwell-Bold"
    },
    "Rockwell Bold Italic": {
      "Bold Italic": "Rockwell-BoldItalic",
      "Regular": "Rockwell-BoldItalic"
    },
    "Rockwell Condensed": {
      "Arrunta": "Rockwell-Condensed",
      "Bold": "Rockwell-CondensedBold",
      "Fet": "Rockwell-CondensedBold",
      "Fett": "Rockwell-CondensedBold",
      "F\xE9lk\xF6v\xE9r": "Rockwell-CondensedBold",
      "Gras": "Rockwell-CondensedBold",
      "Grassetto": "Rockwell-CondensedBold",
      "Halvfet": "Rockwell-CondensedBold",
      "Kal\u0131n": "Rockwell-CondensedBold",
      "Krepko": "Rockwell-CondensedBold",
      "Lihavoitu": "Rockwell-CondensedBold",
      "Lodia": "Rockwell-CondensedBold",
      "Navadno": "Rockwell-Condensed",
      "Negreta": "Rockwell-CondensedBold",
      "Negrita": "Rockwell-CondensedBold",
      "Negrito": "Rockwell-CondensedBold",
      "Normaali": "Rockwell-Condensed",
      "Normal": "Rockwell-Condensed",
      "Normale": "Rockwell-Condensed",
      "Normalny": "Rockwell-Condensed",
      "Norm\xE1l": "Rockwell-Condensed",
      "Norm\xE1lne": "Rockwell-Condensed",
      "Pogrubiony": "Rockwell-CondensedBold",
      "Regular": "Rockwell-Condensed",
      "Standaard": "Rockwell-Condensed",
      "Standard": "Rockwell-Condensed",
      "Tu\u010Dn\xE9": "Rockwell-CondensedBold",
      "Vet": "Rockwell-CondensedBold",
      "fed": "Rockwell-CondensedBold",
      "normal": "Rockwell-Condensed",
      "oby\u010Dejn\xE9": "Rockwell-Condensed",
      "tu\u010Dn\xE9": "Rockwell-CondensedBold",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "Rockwell-CondensedBold",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "Rockwell-Condensed",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "Rockwell-Condensed",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "Rockwell-CondensedBold"
    },
    "Rockwell Condensed Bold": {
      "Bold": "Rockwell-CondensedBold",
      "Regular": "Rockwell-CondensedBold"
    },
    "Rockwell Condensed Fet": {
      "Regular": "Rockwell-CondensedBold"
    },
    "Rockwell Condensed Fett": {
      "Regular": "Rockwell-CondensedBold"
    },
    "Rockwell Condensed F\xE9lk\xF6v\xE9r": {
      "Regular": "Rockwell-CondensedBold"
    },
    "Rockwell Condensed Gras": {
      "Regular": "Rockwell-CondensedBold"
    },
    "Rockwell Condensed Grassetto": {
      "Regular": "Rockwell-CondensedBold"
    },
    "Rockwell Condensed Halvfet": {
      "Regular": "Rockwell-CondensedBold"
    },
    "Rockwell Condensed Kal\u0131n": {
      "Regular": "Rockwell-CondensedBold"
    },
    "Rockwell Condensed Krepko": {
      "Regular": "Rockwell-CondensedBold"
    },
    "Rockwell Condensed Lihavoitu": {
      "Regular": "Rockwell-CondensedBold"
    },
    "Rockwell Condensed Lodia": {
      "Regular": "Rockwell-CondensedBold"
    },
    "Rockwell Condensed Negreta": {
      "Regular": "Rockwell-CondensedBold"
    },
    "Rockwell Condensed Negrita": {
      "Regular": "Rockwell-CondensedBold"
    },
    "Rockwell Condensed Negrito": {
      "Regular": "Rockwell-CondensedBold"
    },
    "Rockwell Condensed Pogrubiony": {
      "Regular": "Rockwell-CondensedBold"
    },
    "Rockwell Condensed Tu\u010Dn\xE9": {
      "Regular": "Rockwell-CondensedBold"
    },
    "Rockwell Condensed Vet": {
      "Regular": "Rockwell-CondensedBold"
    },
    "Rockwell Condensed fed": {
      "Regular": "Rockwell-CondensedBold"
    },
    "Rockwell Condensed tu\u010Dn\xE9": {
      "Regular": "Rockwell-CondensedBold"
    },
    "Rockwell Condensed \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "Rockwell-CondensedBold"
    },
    "Rockwell Condensed \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "Rockwell-CondensedBold"
    },
    "Rockwell Corsivo": {
      "Regular": "Rockwell-Italic"
    },
    "Rockwell Cursief": {
      "Regular": "Rockwell-Italic"
    },
    "Rockwell Cursiva": {
      "Regular": "Rockwell-Italic"
    },
    "Rockwell D\u0151lt": {
      "Regular": "Rockwell-Italic"
    },
    "Rockwell Etzana": {
      "Regular": "Rockwell-Italic"
    },
    "Rockwell Extra Bold": {
      "Arrunta": "Rockwell-ExtraBold",
      "Navadno": "Rockwell-ExtraBold",
      "Normaali": "Rockwell-ExtraBold",
      "Normal": "Rockwell-ExtraBold",
      "Normale": "Rockwell-ExtraBold",
      "Normalny": "Rockwell-ExtraBold",
      "Norm\xE1l": "Rockwell-ExtraBold",
      "Norm\xE1lne": "Rockwell-ExtraBold",
      "Regular": "Rockwell-ExtraBold",
      "Standaard": "Rockwell-ExtraBold",
      "Standard": "Rockwell-ExtraBold",
      "normal": "Rockwell-ExtraBold",
      "oby\u010Dejn\xE9": "Rockwell-ExtraBold",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "Rockwell-ExtraBold",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "Rockwell-ExtraBold"
    },
    "Rockwell Fet": {
      "Regular": "Rockwell-Bold"
    },
    "Rockwell Fet Kursiv": {
      "Regular": "Rockwell-BoldItalic"
    },
    "Rockwell Fett": {
      "Regular": "Rockwell-Bold"
    },
    "Rockwell Fett Kursiv": {
      "Regular": "Rockwell-BoldItalic"
    },
    "Rockwell F\xE9lk\xF6v\xE9r": {
      "Regular": "Rockwell-Bold"
    },
    "Rockwell F\xE9lk\xF6v\xE9r d\u0151lt": {
      "Regular": "Rockwell-BoldItalic"
    },
    "Rockwell Gras": {
      "Regular": "Rockwell-Bold"
    },
    "Rockwell Gras Italique": {
      "Regular": "Rockwell-BoldItalic"
    },
    "Rockwell Grassetto": {
      "Regular": "Rockwell-Bold"
    },
    "Rockwell Grassetto Corsivo": {
      "Regular": "Rockwell-BoldItalic"
    },
    "Rockwell Halvfet": {
      "Regular": "Rockwell-Bold"
    },
    "Rockwell Halvfet Kursiv": {
      "Regular": "Rockwell-BoldItalic"
    },
    "Rockwell Italic": {
      "Italic": "Rockwell-Italic",
      "Regular": "Rockwell-Italic"
    },
    "Rockwell Italique": {
      "Regular": "Rockwell-Italic"
    },
    "Rockwell It\xE1lico": {
      "Regular": "Rockwell-Italic"
    },
    "Rockwell Kal\u0131n": {
      "Regular": "Rockwell-Bold"
    },
    "Rockwell Kal\u0131n \u0130talik": {
      "Regular": "Rockwell-BoldItalic"
    },
    "Rockwell Krepko": {
      "Regular": "Rockwell-Bold"
    },
    "Rockwell Krepko po\u0161evno": {
      "Regular": "Rockwell-BoldItalic"
    },
    "Rockwell Kursiv": {
      "Regular": "Rockwell-Italic"
    },
    "Rockwell Kursivoitu": {
      "Regular": "Rockwell-Italic"
    },
    "Rockwell Kursywa": {
      "Regular": "Rockwell-Italic"
    },
    "Rockwell Kurz\xEDva": {
      "Regular": "Rockwell-Italic"
    },
    "Rockwell Lihavoitu": {
      "Regular": "Rockwell-Bold"
    },
    "Rockwell Lihavoitu Kursivoi": {
      "Regular": "Rockwell-BoldItalic"
    },
    "Rockwell Lodi etzana": {
      "Regular": "Rockwell-BoldItalic"
    },
    "Rockwell Lodia": {
      "Regular": "Rockwell-Bold"
    },
    "Rockwell Negreta": {
      "Regular": "Rockwell-Bold"
    },
    "Rockwell Negreta cursiva": {
      "Regular": "Rockwell-BoldItalic"
    },
    "Rockwell Negrita": {
      "Regular": "Rockwell-Bold"
    },
    "Rockwell Negrita Cursiva": {
      "Regular": "Rockwell-BoldItalic"
    },
    "Rockwell Negrito": {
      "Regular": "Rockwell-Bold"
    },
    "Rockwell Negrito It\xE1lico": {
      "Regular": "Rockwell-BoldItalic"
    },
    "Rockwell Pogrubiona kursywa": {
      "Regular": "Rockwell-BoldItalic"
    },
    "Rockwell Pogrubiony": {
      "Regular": "Rockwell-Bold"
    },
    "Rockwell Po\u0161evno": {
      "Regular": "Rockwell-Italic"
    },
    "Rockwell Tu\u010Dn\xE1 kurz\xEDva": {
      "Regular": "Rockwell-BoldItalic"
    },
    "Rockwell Tu\u010Dn\xE9": {
      "Regular": "Rockwell-Bold"
    },
    "Rockwell Vet": {
      "Regular": "Rockwell-Bold"
    },
    "Rockwell Vet Cursief": {
      "Regular": "Rockwell-BoldItalic"
    },
    "Rockwell fed": {
      "Regular": "Rockwell-Bold"
    },
    "Rockwell fed kursiv": {
      "Regular": "Rockwell-BoldItalic"
    },
    "Rockwell kursiv": {
      "Regular": "Rockwell-Italic"
    },
    "Rockwell kurz\xEDva": {
      "Regular": "Rockwell-Italic"
    },
    "Rockwell tu\u010Dn\xE9": {
      "Regular": "Rockwell-Bold"
    },
    "Rockwell tu\u010Dn\xE9 kurz\xEDva": {
      "Regular": "Rockwell-BoldItalic"
    },
    "Rockwell \u0130talik": {
      "Regular": "Rockwell-Italic"
    },
    "Rockwell \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "Rockwell-Bold"
    },
    "Rockwell \u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "Rockwell-BoldItalic"
    },
    "Rockwell \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "Rockwell-Italic"
    },
    "Rockwell \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "Rockwell-Italic"
    },
    "Rockwell \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "Rockwell-Bold"
    },
    "Rockwell \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "Rockwell-BoldItalic"
    },
    "Rubik": {
      "Bold": "Rubik-Bold",
      "Bold Italic": "Rubik-BoldItalic",
      "Italic": "Rubik-Italic",
      "Regular": "Rubik-Bold"
    },
    "Rubik Bold": {
      "Regular": "Rubik-Bold"
    },
    "Rubik Bold Italic": {
      "Bold Italic": "Rubik-BoldItalic",
      "Regular": "Rubik-BoldItalic"
    },
    "Rubik Italic": {
      "Italic": "Rubik-Italic",
      "Regular": "Rubik-Italic"
    },
    "Rubik-Bold": {
      "Bold": "Rubik-Bold",
      "Regular": "Rubik-Bold"
    },
    "Rubik-Regular": {
      "Regular": "Rubik-Regular"
    },
    "STCaiyun": {
      "Regular": "STCaiyun"
    },
    "STFangsong": {
      "Regular": "STFangsong"
    },
    "STHupo": {
      "Regular": "STHupo"
    },
    "STKaiti": {
      "Regular": "STKaiti"
    },
    "STLiti": {
      "Regular": "STLiti"
    },
    "STSong": {
      "Regular": "STSong"
    },
    "STXihei": {
      "Regular": "STXihei"
    },
    "STXingkai": {
      "Regular": "STXingkai"
    },
    "STXinwei": {
      "Regular": "STXinwei"
    },
    "STZhongsong": {
      "Regular": "STZhongsong"
    },
    "Sans Serif Collection": {
      "Regular": "SansSerifCollection"
    },
    "Scheherazade": {
      "Bold": "Scheherazade-Bold",
      "Regular": "Scheherazade-Regular"
    },
    "Scheherazade Bold": {
      "Bold": "Scheherazade-Bold",
      "Regular": "Scheherazade-Bold"
    },
    "Script MT": {
      "Regular": "ScriptMTBold"
    },
    "Script MT Bold": {
      "Regular": "ScriptMTBold"
    },
    "Segoe Fluent Icons": {
      "Arrunta": "SegoeFluentIcons",
      "Navadno": "SegoeFluentIcons",
      "Normaali": "SegoeFluentIcons",
      "Normal": "SegoeFluentIcons",
      "Normale": "SegoeFluentIcons",
      "Normalny": "SegoeFluentIcons",
      "Norm\xE1l": "SegoeFluentIcons",
      "Norm\xE1lne": "SegoeFluentIcons",
      "Regular": "SegoeFluentIcons",
      "Standaard": "SegoeFluentIcons",
      "Standard": "SegoeFluentIcons",
      "normal": "SegoeFluentIcons",
      "oby\u010Dejn\xE9": "SegoeFluentIcons",
      "th\u01B0\u01A1\u0300ng": "SegoeFluentIcons",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "SegoeFluentIcons",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "SegoeFluentIcons"
    },
    "Segoe MDL2 Assets": {
      "Arrunta": "SegoeMDL2Assets",
      "Navadno": "SegoeMDL2Assets",
      "Normaali": "SegoeMDL2Assets",
      "Normal": "SegoeMDL2Assets",
      "Normale": "SegoeMDL2Assets",
      "Normalny": "SegoeMDL2Assets",
      "Norm\xE1l": "SegoeMDL2Assets",
      "Norm\xE1lne": "SegoeMDL2Assets",
      "Regular": "SegoeMDL2Assets",
      "Standaard": "SegoeMDL2Assets",
      "Standard": "SegoeMDL2Assets",
      "normal": "SegoeMDL2Assets",
      "oby\u010Dejn\xE9": "SegoeMDL2Assets",
      "th\u01B0\u01A1\u0300ng": "SegoeMDL2Assets",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "SegoeMDL2Assets",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "SegoeMDL2Assets"
    },
    "Segoe Print": {
      "Bold": "SegoePrint-Bold",
      "Regular": "SegoePrint"
    },
    "Segoe Print Bold": {
      "Bold": "SegoePrint-Bold",
      "Regular": "SegoePrint-Bold"
    },
    "Segoe Script": {
      "Arrunta": "SegoeScript",
      "Bold": "SegoeScript-Bold",
      "Fet": "SegoeScript-Bold",
      "Fett": "SegoeScript-Bold",
      "F\xE9lk\xF6v\xE9r": "SegoeScript-Bold",
      "Gras": "SegoeScript-Bold",
      "Grassetto": "SegoeScript-Bold",
      "Halvfet": "SegoeScript-Bold",
      "Kal\u0131n": "SegoeScript-Bold",
      "Krepko": "SegoeScript-Bold",
      "Lihavoitu": "SegoeScript-Bold",
      "Lodia": "SegoeScript-Bold",
      "Navadno": "SegoeScript",
      "Negreta": "SegoeScript-Bold",
      "Negrita": "SegoeScript-Bold",
      "Negrito": "SegoeScript-Bold",
      "Normaali": "SegoeScript",
      "Normal": "SegoeScript",
      "Normale": "SegoeScript",
      "Normalny": "SegoeScript",
      "Norm\xE1l": "SegoeScript",
      "Norm\xE1lne": "SegoeScript",
      "Pogrubiony": "SegoeScript-Bold",
      "Regular": "SegoeScript",
      "Standaard": "SegoeScript",
      "Standard": "SegoeScript",
      "Tu\u010Dn\xE9": "SegoeScript-Bold",
      "Vet": "SegoeScript-Bold",
      "fed": "SegoeScript-Bold",
      "normal": "SegoeScript",
      "oby\u010Dejn\xE9": "SegoeScript",
      "tu\u010Dn\xE9": "SegoeScript-Bold",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "SegoeScript-Bold",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "SegoeScript",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "SegoeScript",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "SegoeScript-Bold"
    },
    "Segoe Script Bold": {
      "Bold": "SegoeScript-Bold",
      "Regular": "SegoeScript-Bold"
    },
    "Segoe Script Fet": {
      "Regular": "SegoeScript-Bold"
    },
    "Segoe Script Fett": {
      "Regular": "SegoeScript-Bold"
    },
    "Segoe Script F\xE9lk\xF6v\xE9r": {
      "Regular": "SegoeScript-Bold"
    },
    "Segoe Script Gras": {
      "Regular": "SegoeScript-Bold"
    },
    "Segoe Script Grassetto": {
      "Regular": "SegoeScript-Bold"
    },
    "Segoe Script Halvfet": {
      "Regular": "SegoeScript-Bold"
    },
    "Segoe Script Kal\u0131n": {
      "Regular": "SegoeScript-Bold"
    },
    "Segoe Script Krepko": {
      "Regular": "SegoeScript-Bold"
    },
    "Segoe Script Lihavoitu": {
      "Regular": "SegoeScript-Bold"
    },
    "Segoe Script Lodia": {
      "Regular": "SegoeScript-Bold"
    },
    "Segoe Script Negreta": {
      "Regular": "SegoeScript-Bold"
    },
    "Segoe Script Negrita": {
      "Regular": "SegoeScript-Bold"
    },
    "Segoe Script Negrito": {
      "Regular": "SegoeScript-Bold"
    },
    "Segoe Script Pogrubiony": {
      "Regular": "SegoeScript-Bold"
    },
    "Segoe Script Tu\u010Dn\xE9": {
      "Regular": "SegoeScript-Bold"
    },
    "Segoe Script Vet": {
      "Regular": "SegoeScript-Bold"
    },
    "Segoe Script fed": {
      "Regular": "SegoeScript-Bold"
    },
    "Segoe Script tu\u010Dn\xE9": {
      "Regular": "SegoeScript-Bold"
    },
    "Segoe Script \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "SegoeScript-Bold"
    },
    "Segoe Script \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "SegoeScript-Bold"
    },
    "Segoe UI": {
      "Arrunta": "SegoeUI",
      "Black": "SegoeUIBlack",
      "Black Italic": "SegoeUIBlack-Italic",
      "Bold": "SegoeUI-Bold",
      "Bold Italic": "SegoeUI-BoldItalic",
      "Corsivo": "SegoeUI-Italic",
      "Cursief": "SegoeUI-Italic",
      "Cursiva": "SegoeUI-Italic",
      "D\u0151lt": "SegoeUI-Italic",
      "Etzana": "SegoeUI-Italic",
      "Fed": "SegoeUI-Bold",
      "Fed Kursiv": "SegoeUI-BoldItalic",
      "Fet": "SegoeUI-Bold",
      "Fet Kursiv": "SegoeUI-BoldItalic",
      "Fett": "SegoeUI-Bold",
      "Fett Kursiv": "SegoeUI-BoldItalic",
      "F\xE9lk\xF6v\xE9r": "SegoeUI-Bold",
      "F\xE9lk\xF6v\xE9r D\u0151lt": "SegoeUI-BoldItalic",
      "Gras": "SegoeUI-Bold",
      "Gras Italique": "SegoeUI-BoldItalic",
      "Grassetto": "SegoeUI-Bold",
      "Grassetto Corsivo": "SegoeUI-BoldItalic",
      "Halvfet": "SegoeUI-Bold",
      "Halvfet Kursiv": "SegoeUI-BoldItalic",
      "Italic": "SegoeUI-Italic",
      "Italique": "SegoeUI-Italic",
      "It\xE1lico": "SegoeUI-Italic",
      "Kal\u0131n": "SegoeUI-Bold",
      "Kal\u0131n \u0130talik": "SegoeUI-BoldItalic",
      "Krepko": "SegoeUI-Bold",
      "Krepko Po\u0161evno": "SegoeUI-BoldItalic",
      "Kursiv": "SegoeUI-Italic",
      "Kursivoitu": "SegoeUI-Italic",
      "Kursywa": "SegoeUI-Italic",
      "Kurz\xEDva": "SegoeUI-Italic",
      "Light": "SegoeUI-Light",
      "Light Italic": "SegoeUI-LightItalic",
      "Lihavoitu": "SegoeUI-Bold",
      "Lihavoitu Kursivoi": "SegoeUI-BoldItalic",
      "Lodi Etzana": "SegoeUI-BoldItalic",
      "Lodia": "SegoeUI-Bold",
      "Navadno": "SegoeUI",
      "Negreta": "SegoeUI-Bold",
      "Negreta Cursiva": "SegoeUI-BoldItalic",
      "Negrita": "SegoeUI-Bold",
      "Negrita Cursiva": "SegoeUI-BoldItalic",
      "Negrito": "SegoeUI-Bold",
      "Negrito It\xE1lico": "SegoeUI-BoldItalic",
      "Nghi\xEAng": "SegoeUI-Italic",
      "Nghi\xEAng \u0110\xE2\u0323m": "SegoeUI-BoldItalic",
      "Normaali": "SegoeUI",
      "Normal": "SegoeUI",
      "Normale": "SegoeUI",
      "Normalny": "SegoeUI",
      "Norm\xE1l": "SegoeUI",
      "Norm\xE1lne": "SegoeUI",
      "Pogrubiona Kursywa": "SegoeUI-BoldItalic",
      "Pogrubiony": "SegoeUI-Bold",
      "Po\u0161evno": "SegoeUI-Italic",
      "Regular": "SegoeUI",
      "Semibold": "SegoeUI-Semibold",
      "Semibold Italic": "SegoeUI-SemiboldItalic",
      "Semilight": "SegoeUI-Semilight",
      "Semilight Italic": "SegoeUI-SemilightItalic",
      "Standaard": "SegoeUI",
      "Standard": "SegoeUI",
      "Tu\u010Dn\xE1 Kurz\xEDva": "SegoeUI-BoldItalic",
      "Tu\u010Dn\xE9": "SegoeUI-Bold",
      "Tu\u010Dn\xE9 Kurz\xEDva": "SegoeUI-BoldItalic",
      "Vet": "SegoeUI-Bold",
      "Vet Cursief": "SegoeUI-BoldItalic",
      "normal": "SegoeUI",
      "oby\u010Dejn\xE9": "SegoeUI",
      "\u0110\xE2\u0323m": "SegoeUI-Bold",
      "\u0130talik": "SegoeUI-Italic",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "SegoeUI-Bold",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "SegoeUI-BoldItalic",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "SegoeUI",
      "\u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "SegoeUI-Italic",
      "\u041A\u0443\u0440\u0441\u0438\u0432": "SegoeUI-Italic",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "SegoeUI",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "SegoeUI-Bold",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": "SegoeUI-BoldItalic"
    },
    "Segoe UI Black": {
      "Black": "SegoeUIBlack",
      "Italic": "SegoeUIBlack-Italic",
      "Regular": "SegoeUIBlack"
    },
    "Segoe UI Black Italic": {
      "Black Italic": "SegoeUIBlack-Italic",
      "Regular": "SegoeUIBlack-Italic"
    },
    "Segoe UI Bold": {
      "Bold": "SegoeUI-Bold",
      "Regular": "SegoeUI-Bold"
    },
    "Segoe UI Bold Italic": {
      "Bold Italic": "SegoeUI-BoldItalic",
      "Regular": "SegoeUI-BoldItalic"
    },
    "Segoe UI Corsivo": {
      "Regular": "SegoeUI-Italic"
    },
    "Segoe UI Cursief": {
      "Regular": "SegoeUI-Italic"
    },
    "Segoe UI Cursiva": {
      "Regular": "SegoeUI-Italic"
    },
    "Segoe UI D\u0151lt": {
      "Regular": "SegoeUI-Italic"
    },
    "Segoe UI Emoji": {
      "Arrunta": "SegoeUIEmoji",
      "Navadno": "SegoeUIEmoji",
      "Normaali": "SegoeUIEmoji",
      "Normal": "SegoeUIEmoji",
      "Normale": "SegoeUIEmoji",
      "Normalny": "SegoeUIEmoji",
      "Norm\xE1l": "SegoeUIEmoji",
      "Norm\xE1lne": "SegoeUIEmoji",
      "Regular": "SegoeUIEmoji",
      "Standaard": "SegoeUIEmoji",
      "Standard": "SegoeUIEmoji",
      "oby\u010Dejn\xE9": "SegoeUIEmoji",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "SegoeUIEmoji",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "SegoeUIEmoji"
    },
    "Segoe UI Etzana": {
      "Regular": "SegoeUI-Italic"
    },
    "Segoe UI Fed": {
      "Regular": "SegoeUI-Bold"
    },
    "Segoe UI Fed Kursiv": {
      "Regular": "SegoeUI-BoldItalic"
    },
    "Segoe UI Fet": {
      "Regular": "SegoeUI-Bold"
    },
    "Segoe UI Fet Kursiv": {
      "Regular": "SegoeUI-BoldItalic"
    },
    "Segoe UI Fett": {
      "Regular": "SegoeUI-Bold"
    },
    "Segoe UI Fett Kursiv": {
      "Regular": "SegoeUI-BoldItalic"
    },
    "Segoe UI F\xE9lk\xF6v\xE9r": {
      "Regular": "SegoeUI-Bold"
    },
    "Segoe UI F\xE9lk\xF6v\xE9r D\u0151lt": {
      "Regular": "SegoeUI-BoldItalic"
    },
    "Segoe UI Gras": {
      "Regular": "SegoeUI-Bold"
    },
    "Segoe UI Gras Italique": {
      "Regular": "SegoeUI-BoldItalic"
    },
    "Segoe UI Grassetto": {
      "Regular": "SegoeUI-Bold"
    },
    "Segoe UI Grassetto Corsivo": {
      "Regular": "SegoeUI-BoldItalic"
    },
    "Segoe UI Halvfet": {
      "Regular": "SegoeUI-Bold"
    },
    "Segoe UI Halvfet Kursiv": {
      "Regular": "SegoeUI-BoldItalic"
    },
    "Segoe UI Historic": {
      "Regular": "SegoeUIHistoric"
    },
    "Segoe UI Italic": {
      "Italic": "SegoeUI-Italic",
      "Regular": "SegoeUI-Italic"
    },
    "Segoe UI Italique": {
      "Regular": "SegoeUI-Italic"
    },
    "Segoe UI It\xE1lico": {
      "Regular": "SegoeUI-Italic"
    },
    "Segoe UI Kal\u0131n": {
      "Regular": "SegoeUI-Bold"
    },
    "Segoe UI Kal\u0131n \u0130talik": {
      "Regular": "SegoeUI-BoldItalic"
    },
    "Segoe UI Krepko": {
      "Regular": "SegoeUI-Bold"
    },
    "Segoe UI Krepko Po\u0161evno": {
      "Regular": "SegoeUI-BoldItalic"
    },
    "Segoe UI Kursiv": {
      "Regular": "SegoeUI-Italic"
    },
    "Segoe UI Kursivoitu": {
      "Regular": "SegoeUI-Italic"
    },
    "Segoe UI Kursywa": {
      "Regular": "SegoeUI-Italic"
    },
    "Segoe UI Kurz\xEDva": {
      "Regular": "SegoeUI-Italic"
    },
    "Segoe UI Light": {
      "Italic": "SegoeUI-LightItalic",
      "Light": "SegoeUI-Light",
      "Regular": "SegoeUI-Light"
    },
    "Segoe UI Light Italic": {
      "Light Italic": "SegoeUI-LightItalic",
      "Regular": "SegoeUI-LightItalic"
    },
    "Segoe UI Lihavoitu": {
      "Regular": "SegoeUI-Bold"
    },
    "Segoe UI Lihavoitu Kursivoi": {
      "Regular": "SegoeUI-BoldItalic"
    },
    "Segoe UI Lodi Etzana": {
      "Regular": "SegoeUI-BoldItalic"
    },
    "Segoe UI Lodia": {
      "Regular": "SegoeUI-Bold"
    },
    "Segoe UI Negreta": {
      "Regular": "SegoeUI-Bold"
    },
    "Segoe UI Negreta Cursiva": {
      "Regular": "SegoeUI-BoldItalic"
    },
    "Segoe UI Negrita": {
      "Regular": "SegoeUI-Bold"
    },
    "Segoe UI Negrita Cursiva": {
      "Regular": "SegoeUI-BoldItalic"
    },
    "Segoe UI Negrito": {
      "Regular": "SegoeUI-Bold"
    },
    "Segoe UI Negrito It\xE1lico": {
      "Regular": "SegoeUI-BoldItalic"
    },
    "Segoe UI Nghi\xEAng": {
      "Regular": "SegoeUI-Italic"
    },
    "Segoe UI Nghi\xEAng \u0110\xE2\u0323m": {
      "Regular": "SegoeUI-BoldItalic"
    },
    "Segoe UI Pogrubiona Kursywa": {
      "Regular": "SegoeUI-BoldItalic"
    },
    "Segoe UI Pogrubiony": {
      "Regular": "SegoeUI-Bold"
    },
    "Segoe UI Po\u0161evno": {
      "Regular": "SegoeUI-Italic"
    },
    "Segoe UI Semibold": {
      "Italic": "SegoeUI-SemiboldItalic",
      "Regular": "SegoeUI-Semibold",
      "Semibold": "SegoeUI-Semibold"
    },
    "Segoe UI Semibold Italic": {
      "Regular": "SegoeUI-SemiboldItalic",
      "Semibold Italic": "SegoeUI-SemiboldItalic"
    },
    "Segoe UI Semilight": {
      "Italic": "SegoeUI-SemilightItalic",
      "Regular": "SegoeUI-Semilight",
      "Semilight": "SegoeUI-Semilight",
      "Semilight Italic": "SegoeUI-SemilightItalic"
    },
    "Segoe UI Semilight Italic": {
      "Regular": "SegoeUI-SemilightItalic",
      "Semilight Italic": "SegoeUI-SemilightItalic"
    },
    "Segoe UI Symbol": {
      "Arrunta": "SegoeUISymbol",
      "Navadno": "SegoeUISymbol",
      "Normaali": "SegoeUISymbol",
      "Normal": "SegoeUISymbol",
      "Normale": "SegoeUISymbol",
      "Normalny": "SegoeUISymbol",
      "Norm\xE1l": "SegoeUISymbol",
      "Norm\xE1lne": "SegoeUISymbol",
      "Regular": "SegoeUISymbol",
      "Standaard": "SegoeUISymbol",
      "Standard": "SegoeUISymbol",
      "normal": "SegoeUISymbol",
      "oby\u010Dejn\xE9": "SegoeUISymbol",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "SegoeUISymbol",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "SegoeUISymbol"
    },
    "Segoe UI Tu\u010Dn\xE1 Kurz\xEDva": {
      "Regular": "SegoeUI-BoldItalic"
    },
    "Segoe UI Tu\u010Dn\xE9": {
      "Regular": "SegoeUI-Bold"
    },
    "Segoe UI Tu\u010Dn\xE9 Kurz\xEDva": {
      "Regular": "SegoeUI-BoldItalic"
    },
    "Segoe UI Variable": {
      "Regular": "SegoeUIVariable"
    },
    "Segoe UI Vet": {
      "Regular": "SegoeUI-Bold"
    },
    "Segoe UI Vet Cursief": {
      "Regular": "SegoeUI-BoldItalic"
    },
    "Segoe UI \u0110\xE2\u0323m": {
      "Regular": "SegoeUI-Bold"
    },
    "Segoe UI \u0130talik": {
      "Regular": "SegoeUI-Italic"
    },
    "Segoe UI \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "SegoeUI-Bold"
    },
    "Segoe UI \u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "SegoeUI-BoldItalic"
    },
    "Segoe UI \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "SegoeUI-Italic"
    },
    "Segoe UI \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "SegoeUI-Italic"
    },
    "Segoe UI \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "SegoeUI-Bold"
    },
    "Segoe UI \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "SegoeUI-BoldItalic"
    },
    "Showcard Gothic": {
      "Arrunta": "ShowcardGothic-Reg",
      "Navadno": "ShowcardGothic-Reg",
      "Normaali": "ShowcardGothic-Reg",
      "Normal": "ShowcardGothic-Reg",
      "Normale": "ShowcardGothic-Reg",
      "Normalny": "ShowcardGothic-Reg",
      "Norm\xE1l": "ShowcardGothic-Reg",
      "Norm\xE1lne": "ShowcardGothic-Reg",
      "Regular": "ShowcardGothic-Reg",
      "Standaard": "ShowcardGothic-Reg",
      "Standard": "ShowcardGothic-Reg",
      "normal": "ShowcardGothic-Reg",
      "oby\u010Dejn\xE9": "ShowcardGothic-Reg",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "ShowcardGothic-Reg",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "ShowcardGothic-Reg"
    },
    "SimHei": {
      "Arrunta": "SimHei",
      "Navadno": "SimHei",
      "Normaali": "SimHei",
      "Normal": "SimHei",
      "Normale": "SimHei",
      "Normalny": "SimHei",
      "Norm\xE1l": "SimHei",
      "Norm\xE1lne": "SimHei",
      "Regular": "SimHei",
      "Standaard": "SimHei",
      "Standard": "SimHei",
      "normal": "SimHei",
      "oby\u010Dejn\xE9": "SimHei",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "SimHei",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "SimHei"
    },
    "SimSun": {
      "Regular": "SimSun",
      "\u5E38\u89C4": "SimSun"
    },
    "SimSun-ExtB": {
      "Arrunta": "SimSun-ExtB",
      "Navadno": "SimSun-ExtB",
      "Normaali": "SimSun-ExtB",
      "Normal": "SimSun-ExtB",
      "Normale": "SimSun-ExtB",
      "Normalny": "SimSun-ExtB",
      "Norm\xE1l": "SimSun-ExtB",
      "Norm\xE1lne": "SimSun-ExtB",
      "Regular": "SimSun-ExtB",
      "Standaard": "SimSun-ExtB",
      "Standard": "SimSun-ExtB",
      "normal": "SimSun-ExtB",
      "oby\u010Dejn\xE9": "SimSun-ExtB",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "SimSun-ExtB",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "SimSun-ExtB"
    },
    "Sitka": {
      "Text": "SitkaText",
      "Text Italic": "SitkaTextItalic"
    },
    "Sitka Text": {
      "Italic": "SitkaTextItalic",
      "Regular": "SitkaText",
      "Text": "SitkaText",
      "Text Italic": "SitkaTextItalic"
    },
    "Sitka Text Italic": {
      "Regular": "SitkaTextItalic",
      "Text Italic": "SitkaTextItalic"
    },
    "Snap ITC": {
      "Arrunta": "SnapITC-Regular",
      "Navadno": "SnapITC-Regular",
      "Normaali": "SnapITC-Regular",
      "Normal": "SnapITC-Regular",
      "Normale": "SnapITC-Regular",
      "Normalny": "SnapITC-Regular",
      "Norm\xE1l": "SnapITC-Regular",
      "Norm\xE1lne": "SnapITC-Regular",
      "Regular": "SnapITC-Regular",
      "Standaard": "SnapITC-Regular",
      "Standard": "SnapITC-Regular",
      "normal": "SnapITC-Regular",
      "oby\u010Dejn\xE9": "SnapITC-Regular",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "SnapITC-Regular",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "SnapITC-Regular"
    },
    "Source Code Pro": {
      "Black": "SourceCodePro-Black",
      "Black Italic": "SourceCodePro-BlackIt",
      "Bold": "SourceCodePro-Bold",
      "Bold Italic": "SourceCodePro-BoldIt",
      "ExtraLight": "SourceCodePro-ExtraLight",
      "ExtraLight Italic": "SourceCodePro-ExtraLightIt",
      "Italic": "SourceCodePro-It",
      "Light": "SourceCodePro-Light",
      "Light Italic": "SourceCodePro-LightIt",
      "Medium": "SourceCodePro-Medium",
      "Medium Italic": "SourceCodePro-MediumIt",
      "Regular": "SourceCodePro-Regular",
      "Semibold": "SourceCodePro-Semibold",
      "Semibold Italic": "SourceCodePro-SemiboldIt"
    },
    "Source Code Pro Black": {
      "Black": "SourceCodePro-Black",
      "Italic": "SourceCodePro-BlackIt",
      "Regular": "SourceCodePro-Black"
    },
    "Source Code Pro Black Italic": {
      "Black Italic": "SourceCodePro-BlackIt",
      "Regular": "SourceCodePro-BlackIt"
    },
    "Source Code Pro Bold": {
      "Bold": "SourceCodePro-Bold",
      "Regular": "SourceCodePro-Bold"
    },
    "Source Code Pro Bold Italic": {
      "Bold Italic": "SourceCodePro-BoldIt",
      "Regular": "SourceCodePro-BoldIt"
    },
    "Source Code Pro ExtraLight": {
      "ExtraLight": "SourceCodePro-ExtraLight",
      "Italic": "SourceCodePro-ExtraLightIt",
      "Regular": "SourceCodePro-ExtraLight"
    },
    "Source Code Pro ExtraLight Italic": {
      "ExtraLight Italic": "SourceCodePro-ExtraLightIt",
      "Regular": "SourceCodePro-ExtraLightIt"
    },
    "Source Code Pro Italic": {
      "Italic": "SourceCodePro-It",
      "Regular": "SourceCodePro-It"
    },
    "Source Code Pro Light": {
      "Italic": "SourceCodePro-LightIt",
      "Light": "SourceCodePro-Light",
      "Regular": "SourceCodePro-Light"
    },
    "Source Code Pro Light Italic": {
      "Light Italic": "SourceCodePro-LightIt",
      "Regular": "SourceCodePro-LightIt"
    },
    "Source Code Pro Medium": {
      "Italic": "SourceCodePro-MediumIt",
      "Medium": "SourceCodePro-Medium",
      "Regular": "SourceCodePro-Medium"
    },
    "Source Code Pro Medium Italic": {
      "Medium Italic": "SourceCodePro-MediumIt",
      "Regular": "SourceCodePro-MediumIt"
    },
    "Source Code Pro Semibold": {
      "Italic": "SourceCodePro-SemiboldIt",
      "Regular": "SourceCodePro-Semibold",
      "Semibold": "SourceCodePro-Semibold"
    },
    "Source Code Pro Semibold Italic": {
      "Regular": "SourceCodePro-SemiboldIt",
      "Semibold Italic": "SourceCodePro-SemiboldIt"
    },
    "Source Sans Pro": {
      "Black": "SourceSansPro-Black",
      "Black Italic": "SourceSansPro-BlackIt",
      "Bold": "SourceSansPro-Bold",
      "Bold Italic": "SourceSansPro-BoldIt",
      "ExtraLight": "SourceSansPro-ExtraLight",
      "ExtraLight Italic": "SourceSansPro-ExtraLightIt",
      "Italic": "SourceSansPro-It",
      "Light": "SourceSansPro-Light",
      "Light Italic": "SourceSansPro-LightIt",
      "Regular": "SourceSansPro-Regular",
      "Semibold": "SourceSansPro-Semibold",
      "Semibold Italic": "SourceSansPro-SemiboldIt"
    },
    "Source Sans Pro Black": {
      "Black": "SourceSansPro-Black",
      "Italic": "SourceSansPro-BlackIt",
      "Regular": "SourceSansPro-Black"
    },
    "Source Sans Pro Black Italic": {
      "Black Italic": "SourceSansPro-BlackIt",
      "Regular": "SourceSansPro-BlackIt"
    },
    "Source Sans Pro Bold": {
      "Bold": "SourceSansPro-Bold",
      "Regular": "SourceSansPro-Bold"
    },
    "Source Sans Pro Bold Italic": {
      "Bold Italic": "SourceSansPro-BoldIt",
      "Regular": "SourceSansPro-BoldIt"
    },
    "Source Sans Pro ExtraLight": {
      "ExtraLight": "SourceSansPro-ExtraLight",
      "Italic": "SourceSansPro-ExtraLightIt",
      "Regular": "SourceSansPro-ExtraLight"
    },
    "Source Sans Pro ExtraLight Italic": {
      "ExtraLight Italic": "SourceSansPro-ExtraLightIt",
      "Regular": "SourceSansPro-ExtraLightIt"
    },
    "Source Sans Pro Italic": {
      "Italic": "SourceSansPro-It",
      "Regular": "SourceSansPro-It"
    },
    "Source Sans Pro Light": {
      "Italic": "SourceSansPro-LightIt",
      "Light": "SourceSansPro-Light",
      "Regular": "SourceSansPro-Light"
    },
    "Source Sans Pro Light Italic": {
      "Light Italic": "SourceSansPro-LightIt",
      "Regular": "SourceSansPro-LightIt"
    },
    "Source Sans Pro Semibold": {
      "Italic": "SourceSansPro-SemiboldIt",
      "Regular": "SourceSansPro-Semibold",
      "Semibold": "SourceSansPro-Semibold"
    },
    "Source Sans Pro Semibold Italic": {
      "Regular": "SourceSansPro-SemiboldIt",
      "Semibold Italic": "SourceSansPro-SemiboldIt"
    },
    "Source Serif Pro": {
      "Black": "SourceSerifPro-Black",
      "Black Italic": "SourceSerifPro-BlackIt",
      "Bold": "SourceSerifPro-Bold",
      "Bold Italic": "SourceSerifPro-BoldIt",
      "ExtraLight": "SourceSerifPro-ExtraLight",
      "ExtraLight Italic": "SourceSerifPro-ExtraLightIt",
      "Italic": "SourceSerifPro-It",
      "Light": "SourceSerifPro-Light",
      "Light Italic": "SourceSerifPro-LightIt",
      "Regular": "SourceSerifPro-Regular",
      "Semibold": "SourceSerifPro-Semibold",
      "Semibold Italic": "SourceSerifPro-SemiboldIt"
    },
    "Source Serif Pro Black": {
      "Black": "SourceSerifPro-Black",
      "Italic": "SourceSerifPro-BlackIt",
      "Regular": "SourceSerifPro-Black"
    },
    "Source Serif Pro Black Italic": {
      "Black Italic": "SourceSerifPro-BlackIt",
      "Regular": "SourceSerifPro-BlackIt"
    },
    "Source Serif Pro Bold": {
      "Bold": "SourceSerifPro-Bold",
      "Regular": "SourceSerifPro-Bold"
    },
    "Source Serif Pro Bold Italic": {
      "Bold Italic": "SourceSerifPro-BoldIt",
      "Regular": "SourceSerifPro-BoldIt"
    },
    "Source Serif Pro ExtraLight": {
      "ExtraLight": "SourceSerifPro-ExtraLight",
      "Italic": "SourceSerifPro-ExtraLightIt",
      "Regular": "SourceSerifPro-ExtraLight"
    },
    "Source Serif Pro ExtraLight Italic": {
      "ExtraLight Italic": "SourceSerifPro-ExtraLightIt",
      "Regular": "SourceSerifPro-ExtraLightIt"
    },
    "Source Serif Pro Italic": {
      "Italic": "SourceSerifPro-It",
      "Regular": "SourceSerifPro-It"
    },
    "Source Serif Pro Light": {
      "Italic": "SourceSerifPro-LightIt",
      "Light": "SourceSerifPro-Light",
      "Regular": "SourceSerifPro-Light"
    },
    "Source Serif Pro Light Italic": {
      "Light Italic": "SourceSerifPro-LightIt",
      "Regular": "SourceSerifPro-LightIt"
    },
    "Source Serif Pro Semibold": {
      "Italic": "SourceSerifPro-SemiboldIt",
      "Regular": "SourceSerifPro-Semibold",
      "Semibold": "SourceSerifPro-Semibold"
    },
    "Source Serif Pro Semibold Italic": {
      "Regular": "SourceSerifPro-SemiboldIt",
      "Semibold Italic": "SourceSerifPro-SemiboldIt"
    },
    "Stencil": {
      "Arrunta": "Stencil",
      "Navadno": "Stencil",
      "Normaali": "Stencil",
      "Normal": "Stencil",
      "Normale": "Stencil",
      "Normalny": "Stencil",
      "Norm\xE1l": "Stencil",
      "Norm\xE1lne": "Stencil",
      "Regular": "Stencil",
      "Standaard": "Stencil",
      "Standard": "Stencil",
      "normal": "Stencil",
      "oby\u010Dejn\xE9": "Stencil",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "Stencil",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "Stencil"
    },
    "Sylfaen": {
      "Arrunta": "Sylfaen",
      "Navadno": "Sylfaen",
      "Normaali": "Sylfaen",
      "Normal": "Sylfaen",
      "Normale": "Sylfaen",
      "Normalny": "Sylfaen",
      "Norm\xE1l": "Sylfaen",
      "Norm\xE1lne": "Sylfaen",
      "Regular": "Sylfaen",
      "Standaard": "Sylfaen",
      "Standard": "Sylfaen",
      "normal": "Sylfaen",
      "oby\u010Dejn\xE9": "Sylfaen",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "Sylfaen",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "Sylfaen"
    },
    "Symbol": {
      "Arrunta": "SymbolMT",
      "Navadno": "SymbolMT",
      "Normaali": "SymbolMT",
      "Normal": "SymbolMT",
      "Normale": "SymbolMT",
      "Normalny": "SymbolMT",
      "Norm\xE1l": "SymbolMT",
      "Norm\xE1lne": "SymbolMT",
      "Regular": "SymbolMT",
      "Standaard": "SymbolMT",
      "Standard": "SymbolMT",
      "normal": "SymbolMT",
      "oby\u010Dejn\xE9": "SymbolMT",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "SymbolMT",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "SymbolMT"
    },
    "Tahoma": {
      "Arrunta": "Tahoma",
      "Bold": "Tahoma-Bold",
      "Fet": "Tahoma-Bold",
      "Fett": "Tahoma-Bold",
      "F\xE9lk\xF6v\xE9r": "Tahoma-Bold",
      "Gras": "Tahoma-Bold",
      "Grassetto": "Tahoma-Bold",
      "Halvfet": "Tahoma-Bold",
      "Kal\u0131n": "Tahoma-Bold",
      "Krepko": "Tahoma-Bold",
      "Lihavoitu": "Tahoma-Bold",
      "Lodia": "Tahoma-Bold",
      "Navadno": "Tahoma",
      "Negreta": "Tahoma-Bold",
      "Negrita": "Tahoma-Bold",
      "Negrito": "Tahoma-Bold",
      "Normaali": "Tahoma",
      "Normal": "Tahoma",
      "Normale": "Tahoma",
      "Normalny": "Tahoma",
      "Norm\xE1l": "Tahoma",
      "Norm\xE1lne": "Tahoma",
      "Pogrubiony": "Tahoma-Bold",
      "Regular": "Tahoma",
      "Standaard": "Tahoma",
      "Standard": "Tahoma",
      "Tu\u010Dn\xE9": "Tahoma-Bold",
      "Vet": "Tahoma-Bold",
      "fed": "Tahoma-Bold",
      "normal": "Tahoma",
      "oby\u010Dejn\xE9": "Tahoma",
      "th\u01B0\u01A1\u0300ng": "Tahoma",
      "tu\u010Dn\xE9": "Tahoma-Bold",
      "\u0111\xE2\u0323m": "Tahoma-Bold",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "Tahoma-Bold",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "Tahoma",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "Tahoma",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "Tahoma-Bold"
    },
    "Tahoma Bold": {
      "Bold": "Tahoma-Bold",
      "Regular": "Tahoma-Bold"
    },
    "Tahoma Fet": {
      "Regular": "Tahoma-Bold"
    },
    "Tahoma Fett": {
      "Regular": "Tahoma-Bold"
    },
    "Tahoma F\xE9lk\xF6v\xE9r": {
      "Regular": "Tahoma-Bold"
    },
    "Tahoma Gras": {
      "Regular": "Tahoma-Bold"
    },
    "Tahoma Grassetto": {
      "Regular": "Tahoma-Bold"
    },
    "Tahoma Halvfet": {
      "Regular": "Tahoma-Bold"
    },
    "Tahoma Kal\u0131n": {
      "Regular": "Tahoma-Bold"
    },
    "Tahoma Krepko": {
      "Regular": "Tahoma-Bold"
    },
    "Tahoma Lihavoitu": {
      "Regular": "Tahoma-Bold"
    },
    "Tahoma Lodia": {
      "Regular": "Tahoma-Bold"
    },
    "Tahoma Negreta": {
      "Regular": "Tahoma-Bold"
    },
    "Tahoma Negrita": {
      "Regular": "Tahoma-Bold"
    },
    "Tahoma Negrito": {
      "Regular": "Tahoma-Bold"
    },
    "Tahoma Pogrubiony": {
      "Regular": "Tahoma-Bold"
    },
    "Tahoma Tu\u010Dn\xE9": {
      "Regular": "Tahoma-Bold"
    },
    "Tahoma Vet": {
      "Regular": "Tahoma-Bold"
    },
    "Tahoma fed": {
      "Regular": "Tahoma-Bold"
    },
    "Tahoma tu\u010Dn\xE9": {
      "Regular": "Tahoma-Bold"
    },
    "Tahoma \u0111\xE2\u0323m": {
      "Regular": "Tahoma-Bold"
    },
    "Tahoma \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "Tahoma-Bold"
    },
    "Tahoma \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "Tahoma-Bold"
    },
    "Tempus Sans ITC": {
      "Arrunta": "TempusSansITC",
      "Navadno": "TempusSansITC",
      "Normaali": "TempusSansITC",
      "Normal": "TempusSansITC",
      "Normale": "TempusSansITC",
      "Normalny": "TempusSansITC",
      "Norm\xE1l": "TempusSansITC",
      "Norm\xE1lne": "TempusSansITC",
      "Regular": "TempusSansITC",
      "Standaard": "TempusSansITC",
      "Standard": "TempusSansITC",
      "normal": "TempusSansITC",
      "oby\u010Dejn\xE9": "TempusSansITC",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "TempusSansITC",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "TempusSansITC"
    },
    "Times New Roman": {
      "Arrunta": "TimesNewRomanPSMT",
      "Bold": "TimesNewRomanPS-BoldMT",
      "Bold Italic": "TimesNewRomanPS-BoldItalicMT",
      "Corsivo": "TimesNewRomanPS-ItalicMT",
      "Cursief": "TimesNewRomanPS-ItalicMT",
      "Cursiva": "TimesNewRomanPS-ItalicMT",
      "D\u0151lt": "TimesNewRomanPS-ItalicMT",
      "Etzana": "TimesNewRomanPS-ItalicMT",
      "Fet": "TimesNewRomanPS-BoldMT",
      "Fet Kursiv": "TimesNewRomanPS-BoldItalicMT",
      "Fett": "TimesNewRomanPS-BoldMT",
      "Fett Kursiv": "TimesNewRomanPS-BoldItalicMT",
      "F\xE9lk\xF6v\xE9r": "TimesNewRomanPS-BoldMT",
      "F\xE9lk\xF6v\xE9r d\u0151lt": "TimesNewRomanPS-BoldItalicMT",
      "Gras": "TimesNewRomanPS-BoldMT",
      "Gras Italique": "TimesNewRomanPS-BoldItalicMT",
      "Grassetto": "TimesNewRomanPS-BoldMT",
      "Grassetto Corsivo": "TimesNewRomanPS-BoldItalicMT",
      "Halvfet": "TimesNewRomanPS-BoldMT",
      "Halvfet Kursiv": "TimesNewRomanPS-BoldItalicMT",
      "Italic": "TimesNewRomanPS-ItalicMT",
      "Italique": "TimesNewRomanPS-ItalicMT",
      "It\xE1lico": "TimesNewRomanPS-ItalicMT",
      "Kal\u0131n": "TimesNewRomanPS-BoldMT",
      "Kal\u0131n \u0130talik": "TimesNewRomanPS-BoldItalicMT",
      "Krepko": "TimesNewRomanPS-BoldMT",
      "Krepko po\u0161evno": "TimesNewRomanPS-BoldItalicMT",
      "Kursiv": "TimesNewRomanPS-ItalicMT",
      "Kursivoitu": "TimesNewRomanPS-ItalicMT",
      "Kurz\xEDva": "TimesNewRomanPS-ItalicMT",
      "Lihavoitu": "TimesNewRomanPS-BoldMT",
      "Lihavoitu Kursivoi": "TimesNewRomanPS-BoldItalicMT",
      "Lodi etzana": "TimesNewRomanPS-BoldItalicMT",
      "Lodia": "TimesNewRomanPS-BoldMT",
      "Navadno": "TimesNewRomanPSMT",
      "Negreta": "TimesNewRomanPS-BoldMT",
      "Negreta cursiva": "TimesNewRomanPS-BoldItalicMT",
      "Negrita": "TimesNewRomanPS-BoldMT",
      "Negrita Cursiva": "TimesNewRomanPS-BoldItalicMT",
      "Negrito": "TimesNewRomanPS-BoldMT",
      "Negrito It\xE1lico": "TimesNewRomanPS-BoldItalicMT",
      "Normaali": "TimesNewRomanPSMT",
      "Normal": "TimesNewRomanPSMT",
      "Normale": "TimesNewRomanPSMT",
      "Normalny": "TimesNewRomanPSMT",
      "Norm\xE1l": "TimesNewRomanPSMT",
      "Norm\xE1lne": "TimesNewRomanPSMT",
      "Pogrubiona": "TimesNewRomanPS-BoldMT",
      "Pogrubiona kursywa": "TimesNewRomanPS-BoldItalicMT",
      "Po\u0161evno": "TimesNewRomanPS-ItalicMT",
      "Regular": "TimesNewRomanPSMT",
      "Standaard": "TimesNewRomanPSMT",
      "Standard": "TimesNewRomanPSMT",
      "Tu\u010Dn\xE1 kurz\xEDva": "TimesNewRomanPS-BoldItalicMT",
      "Tu\u010Dn\xE9": "TimesNewRomanPS-BoldMT",
      "Vet": "TimesNewRomanPS-BoldMT",
      "Vet Cursief": "TimesNewRomanPS-BoldItalicMT",
      "cursiva": "TimesNewRomanPS-ItalicMT",
      "fed": "TimesNewRomanPS-BoldMT",
      "fed kursiv": "TimesNewRomanPS-BoldItalicMT",
      "kursiv": "TimesNewRomanPS-ItalicMT",
      "kursywa": "TimesNewRomanPS-ItalicMT",
      "kurz\xEDva": "TimesNewRomanPS-ItalicMT",
      "nghi\xEAng": "TimesNewRomanPS-ItalicMT",
      "nghi\xEAng \u0111\xE2\u0323m": "TimesNewRomanPS-BoldItalicMT",
      "normal": "TimesNewRomanPSMT",
      "oby\u010Dejn\xE9": "TimesNewRomanPSMT",
      "th\u01B0\u01A1\u0300ng": "TimesNewRomanPSMT",
      "tu\u010Dn\xE9": "TimesNewRomanPS-BoldMT",
      "tu\u010Dn\xE9 kurz\xEDva": "TimesNewRomanPS-BoldItalicMT",
      "\u0111\xE2\u0323m": "TimesNewRomanPS-BoldMT",
      "\u0130talik": "TimesNewRomanPS-ItalicMT",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "TimesNewRomanPS-BoldMT",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "TimesNewRomanPS-BoldItalicMT",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "TimesNewRomanPSMT",
      "\u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "TimesNewRomanPS-ItalicMT",
      "\u041A\u0443\u0440\u0441\u0438\u0432": "TimesNewRomanPS-ItalicMT",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "TimesNewRomanPSMT",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "TimesNewRomanPS-BoldMT",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": "TimesNewRomanPS-BoldItalicMT"
    },
    "Times New Roman Bold": {
      "Bold": "TimesNewRomanPS-BoldMT",
      "Regular": "TimesNewRomanPS-BoldMT"
    },
    "Times New Roman Bold Italic": {
      "Bold Italic": "TimesNewRomanPS-BoldItalicMT",
      "Regular": "TimesNewRomanPS-BoldItalicMT"
    },
    "Times New Roman Corsivo": {
      "Regular": "TimesNewRomanPS-ItalicMT"
    },
    "Times New Roman Cursief": {
      "Regular": "TimesNewRomanPS-ItalicMT"
    },
    "Times New Roman Cursiva": {
      "Regular": "TimesNewRomanPS-ItalicMT"
    },
    "Times New Roman D\u0151lt": {
      "Regular": "TimesNewRomanPS-ItalicMT"
    },
    "Times New Roman Etzana": {
      "Regular": "TimesNewRomanPS-ItalicMT"
    },
    "Times New Roman Fet": {
      "Regular": "TimesNewRomanPS-BoldMT"
    },
    "Times New Roman Fet Kursiv": {
      "Regular": "TimesNewRomanPS-BoldItalicMT"
    },
    "Times New Roman Fett": {
      "Regular": "TimesNewRomanPS-BoldMT"
    },
    "Times New Roman Fett Kursiv": {
      "Regular": "TimesNewRomanPS-BoldItalicMT"
    },
    "Times New Roman F\xE9lk\xF6v\xE9r": {
      "Regular": "TimesNewRomanPS-BoldMT"
    },
    "Times New Roman F\xE9lk\xF6v\xE9r d\u0151lt": {
      "Regular": "TimesNewRomanPS-BoldItalicMT"
    },
    "Times New Roman Gras": {
      "Regular": "TimesNewRomanPS-BoldMT"
    },
    "Times New Roman Gras Italique": {
      "Regular": "TimesNewRomanPS-BoldItalicMT"
    },
    "Times New Roman Grassetto": {
      "Regular": "TimesNewRomanPS-BoldMT"
    },
    "Times New Roman Grassetto Corsivo": {
      "Regular": "TimesNewRomanPS-BoldItalicMT"
    },
    "Times New Roman Halvfet": {
      "Regular": "TimesNewRomanPS-BoldMT"
    },
    "Times New Roman Halvfet Kursiv": {
      "Regular": "TimesNewRomanPS-BoldItalicMT"
    },
    "Times New Roman Italic": {
      "Italic": "TimesNewRomanPS-ItalicMT",
      "Regular": "TimesNewRomanPS-ItalicMT"
    },
    "Times New Roman Italique": {
      "Regular": "TimesNewRomanPS-ItalicMT"
    },
    "Times New Roman It\xE1lico": {
      "Regular": "TimesNewRomanPS-ItalicMT"
    },
    "Times New Roman Kal\u0131n": {
      "Regular": "TimesNewRomanPS-BoldMT"
    },
    "Times New Roman Kal\u0131n \u0130talik": {
      "Regular": "TimesNewRomanPS-BoldItalicMT"
    },
    "Times New Roman Krepko": {
      "Regular": "TimesNewRomanPS-BoldMT"
    },
    "Times New Roman Krepko po\u0161evno": {
      "Regular": "TimesNewRomanPS-BoldItalicMT"
    },
    "Times New Roman Kursiv": {
      "Regular": "TimesNewRomanPS-ItalicMT"
    },
    "Times New Roman Kursivoitu": {
      "Regular": "TimesNewRomanPS-ItalicMT"
    },
    "Times New Roman Kurz\xEDva": {
      "Regular": "TimesNewRomanPS-ItalicMT"
    },
    "Times New Roman Lihavoitu": {
      "Regular": "TimesNewRomanPS-BoldMT"
    },
    "Times New Roman Lihavoitu Kursivoi": {
      "Regular": "TimesNewRomanPS-BoldItalicMT"
    },
    "Times New Roman Lodi etzana": {
      "Regular": "TimesNewRomanPS-BoldItalicMT"
    },
    "Times New Roman Lodia": {
      "Regular": "TimesNewRomanPS-BoldMT"
    },
    "Times New Roman Negreta": {
      "Regular": "TimesNewRomanPS-BoldMT"
    },
    "Times New Roman Negreta cursiva": {
      "Regular": "TimesNewRomanPS-BoldItalicMT"
    },
    "Times New Roman Negrita": {
      "Regular": "TimesNewRomanPS-BoldMT"
    },
    "Times New Roman Negrita Cursiva": {
      "Regular": "TimesNewRomanPS-BoldItalicMT"
    },
    "Times New Roman Negrito": {
      "Regular": "TimesNewRomanPS-BoldMT"
    },
    "Times New Roman Negrito It\xE1lico": {
      "Regular": "TimesNewRomanPS-BoldItalicMT"
    },
    "Times New Roman Pogrubiona": {
      "Regular": "TimesNewRomanPS-BoldMT"
    },
    "Times New Roman Pogrubiona kursywa": {
      "Regular": "TimesNewRomanPS-BoldItalicMT"
    },
    "Times New Roman Po\u0161evno": {
      "Regular": "TimesNewRomanPS-ItalicMT"
    },
    "Times New Roman Tu\u010Dn\xE1 kurz\xEDva": {
      "Regular": "TimesNewRomanPS-BoldItalicMT"
    },
    "Times New Roman Tu\u010Dn\xE9": {
      "Regular": "TimesNewRomanPS-BoldMT"
    },
    "Times New Roman Vet": {
      "Regular": "TimesNewRomanPS-BoldMT"
    },
    "Times New Roman Vet Cursief": {
      "Regular": "TimesNewRomanPS-BoldItalicMT"
    },
    "Times New Roman cursiva": {
      "Regular": "TimesNewRomanPS-ItalicMT"
    },
    "Times New Roman fed": {
      "Regular": "TimesNewRomanPS-BoldMT"
    },
    "Times New Roman fed kursiv": {
      "Regular": "TimesNewRomanPS-BoldItalicMT"
    },
    "Times New Roman kursiv": {
      "Regular": "TimesNewRomanPS-ItalicMT"
    },
    "Times New Roman kursywa": {
      "Regular": "TimesNewRomanPS-ItalicMT"
    },
    "Times New Roman kurz\xEDva": {
      "Regular": "TimesNewRomanPS-ItalicMT"
    },
    "Times New Roman nghi\xEAng": {
      "Regular": "TimesNewRomanPS-ItalicMT"
    },
    "Times New Roman nghi\xEAng \u0111\xE2\u0323m": {
      "Regular": "TimesNewRomanPS-BoldItalicMT"
    },
    "Times New Roman tu\u010Dn\xE9": {
      "Regular": "TimesNewRomanPS-BoldMT"
    },
    "Times New Roman tu\u010Dn\xE9 kurz\xEDva": {
      "Regular": "TimesNewRomanPS-BoldItalicMT"
    },
    "Times New Roman \u0111\xE2\u0323m": {
      "Regular": "TimesNewRomanPS-BoldMT"
    },
    "Times New Roman \u0130talik": {
      "Regular": "TimesNewRomanPS-ItalicMT"
    },
    "Times New Roman \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "TimesNewRomanPS-BoldMT"
    },
    "Times New Roman \u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "TimesNewRomanPS-BoldItalicMT"
    },
    "Times New Roman \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "TimesNewRomanPS-ItalicMT"
    },
    "Times New Roman \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "TimesNewRomanPS-ItalicMT"
    },
    "Times New Roman \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "TimesNewRomanPS-BoldMT"
    },
    "Times New Roman \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "TimesNewRomanPS-BoldItalicMT"
    },
    "Trebuchet MS": {
      "Arrunta": "TrebuchetMS",
      "Bold": "TrebuchetMS-Bold",
      "Bold Italic": "Trebuchet-BoldItalic",
      "Corsivo": "TrebuchetMS-Italic",
      "Cursief": "TrebuchetMS-Italic",
      "Cursiva": "TrebuchetMS-Italic",
      "D\u0151lt": "TrebuchetMS-Italic",
      "Etzana": "TrebuchetMS-Italic",
      "Fet": "TrebuchetMS-Bold",
      "Fet Kursiv": "Trebuchet-BoldItalic",
      "Fett": "TrebuchetMS-Bold",
      "Fett Kursiv": "Trebuchet-BoldItalic",
      "F\xE9lk\xF6v\xE9r": "TrebuchetMS-Bold",
      "F\xE9lk\xF6v\xE9r d\u0151lt": "Trebuchet-BoldItalic",
      "Gras": "TrebuchetMS-Bold",
      "Gras Italique": "Trebuchet-BoldItalic",
      "Grassetto": "TrebuchetMS-Bold",
      "Grassetto Corsivo": "Trebuchet-BoldItalic",
      "Halvfet": "TrebuchetMS-Bold",
      "Halvfet Kursiv": "Trebuchet-BoldItalic",
      "Italic": "TrebuchetMS-Italic",
      "Italique": "TrebuchetMS-Italic",
      "It\xE1lico": "TrebuchetMS-Italic",
      "Kal\u0131n": "TrebuchetMS-Bold",
      "Kal\u0131n \u0130talik": "Trebuchet-BoldItalic",
      "Krepko": "TrebuchetMS-Bold",
      "Krepko po\u0161evno": "Trebuchet-BoldItalic",
      "Kursiv": "TrebuchetMS-Italic",
      "Kursivoitu": "TrebuchetMS-Italic",
      "Kursywa": "TrebuchetMS-Italic",
      "Kurz\xEDva": "TrebuchetMS-Italic",
      "Lihavoitu": "TrebuchetMS-Bold",
      "Lihavoitu Kursivoi": "Trebuchet-BoldItalic",
      "Lodi etzana": "Trebuchet-BoldItalic",
      "Lodia": "TrebuchetMS-Bold",
      "Navadno": "TrebuchetMS",
      "Negreta": "TrebuchetMS-Bold",
      "Negreta cursiva": "Trebuchet-BoldItalic",
      "Negrita": "TrebuchetMS-Bold",
      "Negrita Cursiva": "Trebuchet-BoldItalic",
      "Negrito": "TrebuchetMS-Bold",
      "Negrito It\xE1lico": "Trebuchet-BoldItalic",
      "Normaali": "TrebuchetMS",
      "Normal": "TrebuchetMS",
      "Normale": "TrebuchetMS",
      "Normalny": "TrebuchetMS",
      "Norm\xE1l": "TrebuchetMS",
      "Norm\xE1lne": "TrebuchetMS",
      "Pogrubiona kursywa": "Trebuchet-BoldItalic",
      "Pogrubiony": "TrebuchetMS-Bold",
      "Po\u0161evno": "TrebuchetMS-Italic",
      "Regular": "TrebuchetMS",
      "Standaard": "TrebuchetMS",
      "Standard": "TrebuchetMS",
      "Tu\u010Dn\xE1 kurz\xEDva": "Trebuchet-BoldItalic",
      "Tu\u010Dn\xE9": "TrebuchetMS-Bold",
      "Vet": "TrebuchetMS-Bold",
      "Vet Cursief": "Trebuchet-BoldItalic",
      "fed": "TrebuchetMS-Bold",
      "fed kursiv": "Trebuchet-BoldItalic",
      "kursiv": "TrebuchetMS-Italic",
      "kurz\xEDva": "TrebuchetMS-Italic",
      "normal": "TrebuchetMS",
      "oby\u010Dejn\xE9": "TrebuchetMS",
      "tu\u010Dn\xE9": "TrebuchetMS-Bold",
      "tu\u010Dn\xE9 kurz\xEDva": "Trebuchet-BoldItalic",
      "\u0130talik": "TrebuchetMS-Italic",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "TrebuchetMS-Bold",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "Trebuchet-BoldItalic",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "TrebuchetMS",
      "\u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "TrebuchetMS-Italic",
      "\u041A\u0443\u0440\u0441\u0438\u0432": "TrebuchetMS-Italic",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "TrebuchetMS",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "TrebuchetMS-Bold",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": "Trebuchet-BoldItalic"
    },
    "Trebuchet MS Bold": {
      "Bold": "TrebuchetMS-Bold",
      "Regular": "TrebuchetMS-Bold"
    },
    "Trebuchet MS Bold Italic": {
      "Bold Italic": "Trebuchet-BoldItalic",
      "Regular": "Trebuchet-BoldItalic"
    },
    "Trebuchet MS Corsivo": {
      "Regular": "TrebuchetMS-Italic"
    },
    "Trebuchet MS Cursief": {
      "Regular": "TrebuchetMS-Italic"
    },
    "Trebuchet MS Cursiva": {
      "Regular": "TrebuchetMS-Italic"
    },
    "Trebuchet MS D\u0151lt": {
      "Regular": "TrebuchetMS-Italic"
    },
    "Trebuchet MS Etzana": {
      "Regular": "TrebuchetMS-Italic"
    },
    "Trebuchet MS Fet": {
      "Regular": "TrebuchetMS-Bold"
    },
    "Trebuchet MS Fet Kursiv": {
      "Regular": "Trebuchet-BoldItalic"
    },
    "Trebuchet MS Fett": {
      "Regular": "TrebuchetMS-Bold"
    },
    "Trebuchet MS Fett Kursiv": {
      "Regular": "Trebuchet-BoldItalic"
    },
    "Trebuchet MS F\xE9lk\xF6v\xE9r": {
      "Regular": "TrebuchetMS-Bold"
    },
    "Trebuchet MS F\xE9lk\xF6v\xE9r d\u0151lt": {
      "Regular": "Trebuchet-BoldItalic"
    },
    "Trebuchet MS Gras": {
      "Regular": "TrebuchetMS-Bold"
    },
    "Trebuchet MS Gras Italique": {
      "Regular": "Trebuchet-BoldItalic"
    },
    "Trebuchet MS Grassetto": {
      "Regular": "TrebuchetMS-Bold"
    },
    "Trebuchet MS Grassetto Corsivo": {
      "Regular": "Trebuchet-BoldItalic"
    },
    "Trebuchet MS Halvfet": {
      "Regular": "TrebuchetMS-Bold"
    },
    "Trebuchet MS Halvfet Kursiv": {
      "Regular": "Trebuchet-BoldItalic"
    },
    "Trebuchet MS Italic": {
      "Italic": "TrebuchetMS-Italic",
      "Regular": "TrebuchetMS-Italic"
    },
    "Trebuchet MS Italique": {
      "Regular": "TrebuchetMS-Italic"
    },
    "Trebuchet MS It\xE1lico": {
      "Regular": "TrebuchetMS-Italic"
    },
    "Trebuchet MS Kal\u0131n": {
      "Regular": "TrebuchetMS-Bold"
    },
    "Trebuchet MS Kal\u0131n \u0130talik": {
      "Regular": "Trebuchet-BoldItalic"
    },
    "Trebuchet MS Krepko": {
      "Regular": "TrebuchetMS-Bold"
    },
    "Trebuchet MS Krepko po\u0161evno": {
      "Regular": "Trebuchet-BoldItalic"
    },
    "Trebuchet MS Kursiv": {
      "Regular": "TrebuchetMS-Italic"
    },
    "Trebuchet MS Kursivoitu": {
      "Regular": "TrebuchetMS-Italic"
    },
    "Trebuchet MS Kursywa": {
      "Regular": "TrebuchetMS-Italic"
    },
    "Trebuchet MS Kurz\xEDva": {
      "Regular": "TrebuchetMS-Italic"
    },
    "Trebuchet MS Lihavoitu": {
      "Regular": "TrebuchetMS-Bold"
    },
    "Trebuchet MS Lihavoitu Kursivoi": {
      "Regular": "Trebuchet-BoldItalic"
    },
    "Trebuchet MS Lodi etzana": {
      "Regular": "Trebuchet-BoldItalic"
    },
    "Trebuchet MS Lodia": {
      "Regular": "TrebuchetMS-Bold"
    },
    "Trebuchet MS Negreta": {
      "Regular": "TrebuchetMS-Bold"
    },
    "Trebuchet MS Negreta cursiva": {
      "Regular": "Trebuchet-BoldItalic"
    },
    "Trebuchet MS Negrita": {
      "Regular": "TrebuchetMS-Bold"
    },
    "Trebuchet MS Negrita Cursiva": {
      "Regular": "Trebuchet-BoldItalic"
    },
    "Trebuchet MS Negrito": {
      "Regular": "TrebuchetMS-Bold"
    },
    "Trebuchet MS Negrito It\xE1lico": {
      "Regular": "Trebuchet-BoldItalic"
    },
    "Trebuchet MS Pogrubiona kursywa": {
      "Regular": "Trebuchet-BoldItalic"
    },
    "Trebuchet MS Pogrubiony": {
      "Regular": "TrebuchetMS-Bold"
    },
    "Trebuchet MS Po\u0161evno": {
      "Regular": "TrebuchetMS-Italic"
    },
    "Trebuchet MS Tu\u010Dn\xE1 kurz\xEDva": {
      "Regular": "Trebuchet-BoldItalic"
    },
    "Trebuchet MS Tu\u010Dn\xE9": {
      "Regular": "TrebuchetMS-Bold"
    },
    "Trebuchet MS Vet": {
      "Regular": "TrebuchetMS-Bold"
    },
    "Trebuchet MS Vet Cursief": {
      "Regular": "Trebuchet-BoldItalic"
    },
    "Trebuchet MS fed": {
      "Regular": "TrebuchetMS-Bold"
    },
    "Trebuchet MS fed kursiv": {
      "Regular": "Trebuchet-BoldItalic"
    },
    "Trebuchet MS kursiv": {
      "Regular": "TrebuchetMS-Italic"
    },
    "Trebuchet MS kurz\xEDva": {
      "Regular": "TrebuchetMS-Italic"
    },
    "Trebuchet MS tu\u010Dn\xE9": {
      "Regular": "TrebuchetMS-Bold"
    },
    "Trebuchet MS tu\u010Dn\xE9 kurz\xEDva": {
      "Regular": "Trebuchet-BoldItalic"
    },
    "Trebuchet MS \u0130talik": {
      "Regular": "TrebuchetMS-Italic"
    },
    "Trebuchet MS \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "TrebuchetMS-Bold"
    },
    "Trebuchet MS \u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "Trebuchet-BoldItalic"
    },
    "Trebuchet MS \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "TrebuchetMS-Italic"
    },
    "Trebuchet MS \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "TrebuchetMS-Italic"
    },
    "Trebuchet MS \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "TrebuchetMS-Bold"
    },
    "Trebuchet MS \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "Trebuchet-BoldItalic"
    },
    "Tw Cen MT": {
      "Arrunta": "TwCenMT-Regular",
      "Bold": "TwCenMT-CondensedBold",
      "Bold Italic": "TwCenMT-BoldItalic",
      "Corsivo": "TwCenMT-Italic",
      "Cursief": "TwCenMT-Italic",
      "Cursiva": "TwCenMT-Italic",
      "D\u0151lt": "TwCenMT-Italic",
      "Etzana": "TwCenMT-Italic",
      "Fet": "TwCenMT-Bold",
      "Fet Kursiv": "TwCenMT-BoldItalic",
      "Fett": "TwCenMT-Bold",
      "Fett Kursiv": "TwCenMT-BoldItalic",
      "F\xE9lk\xF6v\xE9r": "TwCenMT-Bold",
      "F\xE9lk\xF6v\xE9r d\u0151lt": "TwCenMT-BoldItalic",
      "Gras": "TwCenMT-Bold",
      "Gras Italique": "TwCenMT-BoldItalic",
      "Grassetto": "TwCenMT-Bold",
      "Grassetto Corsivo": "TwCenMT-BoldItalic",
      "Halvfet": "TwCenMT-Bold",
      "Halvfet Kursiv": "TwCenMT-BoldItalic",
      "Italic": "TwCenMT-Italic",
      "Italique": "TwCenMT-Italic",
      "It\xE1lico": "TwCenMT-Italic",
      "Kal\u0131n": "TwCenMT-Bold",
      "Kal\u0131n \u0130talik": "TwCenMT-BoldItalic",
      "Krepko": "TwCenMT-Bold",
      "Krepko po\u0161evno": "TwCenMT-BoldItalic",
      "Kursiv": "TwCenMT-Italic",
      "Kursivoitu": "TwCenMT-Italic",
      "Kursywa": "TwCenMT-Italic",
      "Kurz\xEDva": "TwCenMT-Italic",
      "Lihavoitu": "TwCenMT-Bold",
      "Lihavoitu Kursivoi": "TwCenMT-BoldItalic",
      "Lodi etzana": "TwCenMT-BoldItalic",
      "Lodia": "TwCenMT-Bold",
      "Navadno": "TwCenMT-Regular",
      "Negreta": "TwCenMT-Bold",
      "Negreta cursiva": "TwCenMT-BoldItalic",
      "Negrita": "TwCenMT-Bold",
      "Negrita Cursiva": "TwCenMT-BoldItalic",
      "Negrito": "TwCenMT-Bold",
      "Negrito It\xE1lico": "TwCenMT-BoldItalic",
      "Normaali": "TwCenMT-Regular",
      "Normal": "TwCenMT-Regular",
      "Normale": "TwCenMT-Regular",
      "Normalny": "TwCenMT-Regular",
      "Norm\xE1l": "TwCenMT-Regular",
      "Norm\xE1lne": "TwCenMT-Regular",
      "Pogrubiona kursywa": "TwCenMT-BoldItalic",
      "Pogrubiony": "TwCenMT-Bold",
      "Po\u0161evno": "TwCenMT-Italic",
      "Regular": "TwCenMT-Regular",
      "Standaard": "TwCenMT-Regular",
      "Standard": "TwCenMT-Regular",
      "Tu\u010Dn\xE9": "TwCenMT-Bold",
      "Tu\u010Dn\xE9 kurz\xEDva": "TwCenMT-BoldItalic",
      "Vet": "TwCenMT-Bold",
      "Vet Cursief": "TwCenMT-BoldItalic",
      "fed": "TwCenMT-Bold",
      "fed kursiv": "TwCenMT-BoldItalic",
      "kursiv": "TwCenMT-Italic",
      "kurz\xEDva": "TwCenMT-Italic",
      "normal": "TwCenMT-Regular",
      "oby\u010Dejn\xE9": "TwCenMT-Regular",
      "tu\u010Dn\xE9": "TwCenMT-Bold",
      "tu\u010Dn\xE9 kurz\xEDva": "TwCenMT-BoldItalic",
      "\u0130talik": "TwCenMT-Italic",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "TwCenMT-Bold",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "TwCenMT-BoldItalic",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "TwCenMT-Regular",
      "\u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "TwCenMT-Italic",
      "\u041A\u0443\u0440\u0441\u0438\u0432": "TwCenMT-Italic",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "TwCenMT-Regular",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "TwCenMT-Bold",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": "TwCenMT-BoldItalic"
    },
    "Tw Cen MT Bold": {
      "Bold": "TwCenMT-Bold",
      "Regular": "TwCenMT-Bold"
    },
    "Tw Cen MT Bold Italic": {
      "Bold Italic": "TwCenMT-BoldItalic",
      "Regular": "TwCenMT-BoldItalic"
    },
    "Tw Cen MT Condensed": {
      "Arrunta": "TwCenMT-Condensed",
      "Bold": "TwCenMT-CondensedBold",
      "Fet": "TwCenMT-CondensedBold",
      "Fett": "TwCenMT-CondensedBold",
      "F\xE9lk\xF6v\xE9r": "TwCenMT-CondensedBold",
      "Gras": "TwCenMT-CondensedBold",
      "Grassetto": "TwCenMT-CondensedBold",
      "Halvfet": "TwCenMT-CondensedBold",
      "Kal\u0131n": "TwCenMT-CondensedBold",
      "Krepko": "TwCenMT-CondensedBold",
      "Lihavoitu": "TwCenMT-CondensedBold",
      "Lodia": "TwCenMT-CondensedBold",
      "Navadno": "TwCenMT-Condensed",
      "Negreta": "TwCenMT-CondensedBold",
      "Negrita": "TwCenMT-CondensedBold",
      "Negrito": "TwCenMT-CondensedBold",
      "Normaali": "TwCenMT-Condensed",
      "Normal": "TwCenMT-Condensed",
      "Normale": "TwCenMT-Condensed",
      "Normalny": "TwCenMT-Condensed",
      "Norm\xE1l": "TwCenMT-Condensed",
      "Norm\xE1lne": "TwCenMT-Condensed",
      "Pogrubiony": "TwCenMT-CondensedBold",
      "Regular": "TwCenMT-Condensed",
      "Standaard": "TwCenMT-Condensed",
      "Standard": "TwCenMT-Condensed",
      "Tu\u010Dn\xE9": "TwCenMT-CondensedBold",
      "Vet": "TwCenMT-CondensedBold",
      "fed": "TwCenMT-CondensedBold",
      "normal": "TwCenMT-Condensed",
      "oby\u010Dejn\xE9": "TwCenMT-Condensed",
      "tu\u010Dn\xE9": "TwCenMT-CondensedBold",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "TwCenMT-CondensedBold",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "TwCenMT-Condensed",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "TwCenMT-Condensed",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "TwCenMT-CondensedBold"
    },
    "Tw Cen MT Condensed Bold": {
      "Bold": "TwCenMT-CondensedBold",
      "Regular": "TwCenMT-CondensedBold"
    },
    "Tw Cen MT Condensed Extra Bold": {
      "Arrunta": "TwCenMT-CondensedExtraBold",
      "Navadno": "TwCenMT-CondensedExtraBold",
      "Normaali": "TwCenMT-CondensedExtraBold",
      "Normal": "TwCenMT-CondensedExtraBold",
      "Normale": "TwCenMT-CondensedExtraBold",
      "Normalny": "TwCenMT-CondensedExtraBold",
      "Norm\xE1l": "TwCenMT-CondensedExtraBold",
      "Norm\xE1lne": "TwCenMT-CondensedExtraBold",
      "Regular": "TwCenMT-CondensedExtraBold",
      "Standaard": "TwCenMT-CondensedExtraBold",
      "Standard": "TwCenMT-CondensedExtraBold",
      "normal": "TwCenMT-CondensedExtraBold",
      "oby\u010Dejn\xE9": "TwCenMT-CondensedExtraBold",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "TwCenMT-CondensedExtraBold",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "TwCenMT-CondensedExtraBold"
    },
    "Tw Cen MT Condensed Fet": {
      "Regular": "TwCenMT-CondensedBold"
    },
    "Tw Cen MT Condensed Fett": {
      "Regular": "TwCenMT-CondensedBold"
    },
    "Tw Cen MT Condensed F\xE9lk\xF6v\xE9r": {
      "Regular": "TwCenMT-CondensedBold"
    },
    "Tw Cen MT Condensed Gras": {
      "Regular": "TwCenMT-CondensedBold"
    },
    "Tw Cen MT Condensed Grassetto": {
      "Regular": "TwCenMT-CondensedBold"
    },
    "Tw Cen MT Condensed Halvfet": {
      "Regular": "TwCenMT-CondensedBold"
    },
    "Tw Cen MT Condensed Kal\u0131n": {
      "Regular": "TwCenMT-CondensedBold"
    },
    "Tw Cen MT Condensed Krepko": {
      "Regular": "TwCenMT-CondensedBold"
    },
    "Tw Cen MT Condensed Lihavoitu": {
      "Regular": "TwCenMT-CondensedBold"
    },
    "Tw Cen MT Condensed Lodia": {
      "Regular": "TwCenMT-CondensedBold"
    },
    "Tw Cen MT Condensed Negreta": {
      "Regular": "TwCenMT-CondensedBold"
    },
    "Tw Cen MT Condensed Negrita": {
      "Regular": "TwCenMT-CondensedBold"
    },
    "Tw Cen MT Condensed Negrito": {
      "Regular": "TwCenMT-CondensedBold"
    },
    "Tw Cen MT Condensed Pogrubiony": {
      "Regular": "TwCenMT-CondensedBold"
    },
    "Tw Cen MT Condensed Tu\u010Dn\xE9": {
      "Regular": "TwCenMT-CondensedBold"
    },
    "Tw Cen MT Condensed Vet": {
      "Regular": "TwCenMT-CondensedBold"
    },
    "Tw Cen MT Condensed fed": {
      "Regular": "TwCenMT-CondensedBold"
    },
    "Tw Cen MT Condensed tu\u010Dn\xE9": {
      "Regular": "TwCenMT-CondensedBold"
    },
    "Tw Cen MT Condensed \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "TwCenMT-CondensedBold"
    },
    "Tw Cen MT Condensed \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "TwCenMT-CondensedBold"
    },
    "Tw Cen MT Corsivo": {
      "Regular": "TwCenMT-Italic"
    },
    "Tw Cen MT Cursief": {
      "Regular": "TwCenMT-Italic"
    },
    "Tw Cen MT Cursiva": {
      "Regular": "TwCenMT-Italic"
    },
    "Tw Cen MT D\u0151lt": {
      "Regular": "TwCenMT-Italic"
    },
    "Tw Cen MT Etzana": {
      "Regular": "TwCenMT-Italic"
    },
    "Tw Cen MT Fet": {
      "Regular": "TwCenMT-Bold"
    },
    "Tw Cen MT Fet Kursiv": {
      "Regular": "TwCenMT-BoldItalic"
    },
    "Tw Cen MT Fett": {
      "Regular": "TwCenMT-Bold"
    },
    "Tw Cen MT Fett Kursiv": {
      "Regular": "TwCenMT-BoldItalic"
    },
    "Tw Cen MT F\xE9lk\xF6v\xE9r": {
      "Regular": "TwCenMT-Bold"
    },
    "Tw Cen MT F\xE9lk\xF6v\xE9r d\u0151lt": {
      "Regular": "TwCenMT-BoldItalic"
    },
    "Tw Cen MT Gras": {
      "Regular": "TwCenMT-Bold"
    },
    "Tw Cen MT Gras Italique": {
      "Regular": "TwCenMT-BoldItalic"
    },
    "Tw Cen MT Grassetto": {
      "Regular": "TwCenMT-Bold"
    },
    "Tw Cen MT Grassetto Corsivo": {
      "Regular": "TwCenMT-BoldItalic"
    },
    "Tw Cen MT Halvfet": {
      "Regular": "TwCenMT-Bold"
    },
    "Tw Cen MT Halvfet Kursiv": {
      "Regular": "TwCenMT-BoldItalic"
    },
    "Tw Cen MT Italic": {
      "Italic": "TwCenMT-Italic",
      "Regular": "TwCenMT-Italic"
    },
    "Tw Cen MT Italique": {
      "Regular": "TwCenMT-Italic"
    },
    "Tw Cen MT It\xE1lico": {
      "Regular": "TwCenMT-Italic"
    },
    "Tw Cen MT Kal\u0131n": {
      "Regular": "TwCenMT-Bold"
    },
    "Tw Cen MT Kal\u0131n \u0130talik": {
      "Regular": "TwCenMT-BoldItalic"
    },
    "Tw Cen MT Krepko": {
      "Regular": "TwCenMT-Bold"
    },
    "Tw Cen MT Krepko po\u0161evno": {
      "Regular": "TwCenMT-BoldItalic"
    },
    "Tw Cen MT Kursiv": {
      "Regular": "TwCenMT-Italic"
    },
    "Tw Cen MT Kursivoitu": {
      "Regular": "TwCenMT-Italic"
    },
    "Tw Cen MT Kursywa": {
      "Regular": "TwCenMT-Italic"
    },
    "Tw Cen MT Kurz\xEDva": {
      "Regular": "TwCenMT-Italic"
    },
    "Tw Cen MT Lihavoitu": {
      "Regular": "TwCenMT-Bold"
    },
    "Tw Cen MT Lihavoitu Kursivoi": {
      "Regular": "TwCenMT-BoldItalic"
    },
    "Tw Cen MT Lodi etzana": {
      "Regular": "TwCenMT-BoldItalic"
    },
    "Tw Cen MT Lodia": {
      "Regular": "TwCenMT-Bold"
    },
    "Tw Cen MT Negreta": {
      "Regular": "TwCenMT-Bold"
    },
    "Tw Cen MT Negreta cursiva": {
      "Regular": "TwCenMT-BoldItalic"
    },
    "Tw Cen MT Negrita": {
      "Regular": "TwCenMT-Bold"
    },
    "Tw Cen MT Negrita Cursiva": {
      "Regular": "TwCenMT-BoldItalic"
    },
    "Tw Cen MT Negrito": {
      "Regular": "TwCenMT-Bold"
    },
    "Tw Cen MT Negrito It\xE1lico": {
      "Regular": "TwCenMT-BoldItalic"
    },
    "Tw Cen MT Pogrubiona kursywa": {
      "Regular": "TwCenMT-BoldItalic"
    },
    "Tw Cen MT Pogrubiony": {
      "Regular": "TwCenMT-Bold"
    },
    "Tw Cen MT Po\u0161evno": {
      "Regular": "TwCenMT-Italic"
    },
    "Tw Cen MT Tu\u010Dn\xE9": {
      "Regular": "TwCenMT-Bold"
    },
    "Tw Cen MT Tu\u010Dn\xE9 kurz\xEDva": {
      "Regular": "TwCenMT-BoldItalic"
    },
    "Tw Cen MT Vet": {
      "Regular": "TwCenMT-Bold"
    },
    "Tw Cen MT Vet Cursief": {
      "Regular": "TwCenMT-BoldItalic"
    },
    "Tw Cen MT fed": {
      "Regular": "TwCenMT-Bold"
    },
    "Tw Cen MT fed kursiv": {
      "Regular": "TwCenMT-BoldItalic"
    },
    "Tw Cen MT kursiv": {
      "Regular": "TwCenMT-Italic"
    },
    "Tw Cen MT kurz\xEDva": {
      "Regular": "TwCenMT-Italic"
    },
    "Tw Cen MT tu\u010Dn\xE9": {
      "Regular": "TwCenMT-Bold"
    },
    "Tw Cen MT tu\u010Dn\xE9 kurz\xEDva": {
      "Regular": "TwCenMT-BoldItalic"
    },
    "Tw Cen MT \u0130talik": {
      "Regular": "TwCenMT-Italic"
    },
    "Tw Cen MT \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "TwCenMT-Bold"
    },
    "Tw Cen MT \u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "TwCenMT-BoldItalic"
    },
    "Tw Cen MT \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "TwCenMT-Italic"
    },
    "Tw Cen MT \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "TwCenMT-Italic"
    },
    "Tw Cen MT \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "TwCenMT-Bold"
    },
    "Tw Cen MT \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "TwCenMT-BoldItalic"
    },
    "Verdana": {
      "Arrunta": "Verdana",
      "Bold": "Verdana-Bold",
      "Bold Italic": "Verdana-BoldItalic",
      "Corsivo": "Verdana-Italic",
      "Cursief": "Verdana-Italic",
      "Cursiva": "Verdana-Italic",
      "D\u0151lt": "Verdana-Italic",
      "Etzana": "Verdana-Italic",
      "Fet": "Verdana-Bold",
      "Fet Kursiv": "Verdana-BoldItalic",
      "Fett": "Verdana-Bold",
      "Fett Kursiv": "Verdana-BoldItalic",
      "F\xE9lk\xF6v\xE9r": "Verdana-Bold",
      "F\xE9lk\xF6v\xE9r d\u0151lt": "Verdana-BoldItalic",
      "Gras": "Verdana-Bold",
      "Gras Italique": "Verdana-BoldItalic",
      "Grassetto": "Verdana-Bold",
      "Grassetto Corsivo": "Verdana-BoldItalic",
      "Halvfet": "Verdana-Bold",
      "Halvfet Kursiv": "Verdana-BoldItalic",
      "Italic": "Verdana-Italic",
      "Italique": "Verdana-Italic",
      "It\xE1lico": "Verdana-Italic",
      "Kal\u0131n": "Verdana-Bold",
      "Kal\u0131n \u0130talik": "Verdana-BoldItalic",
      "Krepko": "Verdana-Bold",
      "Krepko po\u0161evno": "Verdana-BoldItalic",
      "Kursiv": "Verdana-Italic",
      "Kursivoitu": "Verdana-Italic",
      "Kursywa": "Verdana-Italic",
      "Kurz\xEDva": "Verdana-Italic",
      "Lihavoitu": "Verdana-Bold",
      "Lihavoitu Kursivoi": "Verdana-BoldItalic",
      "Lodi etzana": "Verdana-BoldItalic",
      "Lodia": "Verdana-Bold",
      "Navadno": "Verdana",
      "Negreta": "Verdana-Bold",
      "Negreta cursiva": "Verdana-BoldItalic",
      "Negrita": "Verdana-Bold",
      "Negrita Cursiva": "Verdana-BoldItalic",
      "Negrito": "Verdana-Bold",
      "Negrito It\xE1lico": "Verdana-BoldItalic",
      "Normaali": "Verdana",
      "Normal": "Verdana",
      "Normale": "Verdana",
      "Normalny": "Verdana",
      "Norm\xE1l": "Verdana",
      "Norm\xE1lne": "Verdana",
      "Pogrubiona kursywa": "Verdana-BoldItalic",
      "Pogrubiony": "Verdana-Bold",
      "Po\u0161evno": "Verdana-Italic",
      "Regular": "Verdana",
      "Standaard": "Verdana",
      "Standard": "Verdana",
      "Tu\u010Dn\xE1 kurz\xEDva": "Verdana-BoldItalic",
      "Tu\u010Dn\xE9": "Verdana-Bold",
      "Vet": "Verdana-Bold",
      "Vet Cursief": "Verdana-BoldItalic",
      "fed": "Verdana-Bold",
      "fed kursiv": "Verdana-BoldItalic",
      "kursiv": "Verdana-Italic",
      "kurz\xEDva": "Verdana-Italic",
      "normal": "Verdana",
      "oby\u010Dejn\xE9": "Verdana",
      "tu\u010Dn\xE9": "Verdana-Bold",
      "tu\u010Dn\xE9 kurz\xEDva": "Verdana-BoldItalic",
      "\u0130talik": "Verdana-Italic",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "Verdana-Bold",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "Verdana-BoldItalic",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "Verdana",
      "\u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "Verdana-Italic",
      "\u041A\u0443\u0440\u0441\u0438\u0432": "Verdana-Italic",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "Verdana",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "Verdana-Bold",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": "Verdana-BoldItalic"
    },
    "Verdana Bold": {
      "Bold": "Verdana-Bold",
      "Regular": "Verdana-Bold"
    },
    "Verdana Bold Italic": {
      "Bold Italic": "Verdana-BoldItalic",
      "Regular": "Verdana-BoldItalic"
    },
    "Verdana Corsivo": {
      "Regular": "Verdana-Italic"
    },
    "Verdana Cursief": {
      "Regular": "Verdana-Italic"
    },
    "Verdana Cursiva": {
      "Regular": "Verdana-Italic"
    },
    "Verdana D\u0151lt": {
      "Regular": "Verdana-Italic"
    },
    "Verdana Etzana": {
      "Regular": "Verdana-Italic"
    },
    "Verdana Fet": {
      "Regular": "Verdana-Bold"
    },
    "Verdana Fet Kursiv": {
      "Regular": "Verdana-BoldItalic"
    },
    "Verdana Fett": {
      "Regular": "Verdana-Bold"
    },
    "Verdana Fett Kursiv": {
      "Regular": "Verdana-BoldItalic"
    },
    "Verdana F\xE9lk\xF6v\xE9r": {
      "Regular": "Verdana-Bold"
    },
    "Verdana F\xE9lk\xF6v\xE9r d\u0151lt": {
      "Regular": "Verdana-BoldItalic"
    },
    "Verdana Gras": {
      "Regular": "Verdana-Bold"
    },
    "Verdana Gras Italique": {
      "Regular": "Verdana-BoldItalic"
    },
    "Verdana Grassetto": {
      "Regular": "Verdana-Bold"
    },
    "Verdana Grassetto Corsivo": {
      "Regular": "Verdana-BoldItalic"
    },
    "Verdana Halvfet": {
      "Regular": "Verdana-Bold"
    },
    "Verdana Halvfet Kursiv": {
      "Regular": "Verdana-BoldItalic"
    },
    "Verdana Italic": {
      "Italic": "Verdana-Italic",
      "Regular": "Verdana-Italic"
    },
    "Verdana Italique": {
      "Regular": "Verdana-Italic"
    },
    "Verdana It\xE1lico": {
      "Regular": "Verdana-Italic"
    },
    "Verdana Kal\u0131n": {
      "Regular": "Verdana-Bold"
    },
    "Verdana Kal\u0131n \u0130talik": {
      "Regular": "Verdana-BoldItalic"
    },
    "Verdana Krepko": {
      "Regular": "Verdana-Bold"
    },
    "Verdana Krepko po\u0161evno": {
      "Regular": "Verdana-BoldItalic"
    },
    "Verdana Kursiv": {
      "Regular": "Verdana-Italic"
    },
    "Verdana Kursivoitu": {
      "Regular": "Verdana-Italic"
    },
    "Verdana Kursywa": {
      "Regular": "Verdana-Italic"
    },
    "Verdana Kurz\xEDva": {
      "Regular": "Verdana-Italic"
    },
    "Verdana Lihavoitu": {
      "Regular": "Verdana-Bold"
    },
    "Verdana Lihavoitu Kursivoi": {
      "Regular": "Verdana-BoldItalic"
    },
    "Verdana Lodi etzana": {
      "Regular": "Verdana-BoldItalic"
    },
    "Verdana Lodia": {
      "Regular": "Verdana-Bold"
    },
    "Verdana Negreta": {
      "Regular": "Verdana-Bold"
    },
    "Verdana Negreta cursiva": {
      "Regular": "Verdana-BoldItalic"
    },
    "Verdana Negrita": {
      "Regular": "Verdana-Bold"
    },
    "Verdana Negrita Cursiva": {
      "Regular": "Verdana-BoldItalic"
    },
    "Verdana Negrito": {
      "Regular": "Verdana-Bold"
    },
    "Verdana Negrito It\xE1lico": {
      "Regular": "Verdana-BoldItalic"
    },
    "Verdana Pogrubiona kursywa": {
      "Regular": "Verdana-BoldItalic"
    },
    "Verdana Pogrubiony": {
      "Regular": "Verdana-Bold"
    },
    "Verdana Po\u0161evno": {
      "Regular": "Verdana-Italic"
    },
    "Verdana Tu\u010Dn\xE1 kurz\xEDva": {
      "Regular": "Verdana-BoldItalic"
    },
    "Verdana Tu\u010Dn\xE9": {
      "Regular": "Verdana-Bold"
    },
    "Verdana Vet": {
      "Regular": "Verdana-Bold"
    },
    "Verdana Vet Cursief": {
      "Regular": "Verdana-BoldItalic"
    },
    "Verdana fed": {
      "Regular": "Verdana-Bold"
    },
    "Verdana fed kursiv": {
      "Regular": "Verdana-BoldItalic"
    },
    "Verdana kursiv": {
      "Regular": "Verdana-Italic"
    },
    "Verdana kurz\xEDva": {
      "Regular": "Verdana-Italic"
    },
    "Verdana tu\u010Dn\xE9": {
      "Regular": "Verdana-Bold"
    },
    "Verdana tu\u010Dn\xE9 kurz\xEDva": {
      "Regular": "Verdana-BoldItalic"
    },
    "Verdana \u0130talik": {
      "Regular": "Verdana-Italic"
    },
    "Verdana \u0388\u03BD\u03C4\u03BF\u03BD\u03B1": {
      "Regular": "Verdana-Bold"
    },
    "Verdana \u0388\u03BD\u03C4\u03BF\u03BD\u03B1 \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "Verdana-BoldItalic"
    },
    "Verdana \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "Verdana-Italic"
    },
    "Verdana \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "Verdana-Italic"
    },
    "Verdana \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": {
      "Regular": "Verdana-Bold"
    },
    "Verdana \u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439 \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "Verdana-BoldItalic"
    },
    "Viner Hand ITC": {
      "Arrunta": "VinerHandITC",
      "Navadno": "VinerHandITC",
      "Normaali": "VinerHandITC",
      "Normal": "VinerHandITC",
      "Normale": "VinerHandITC",
      "Normalny": "VinerHandITC",
      "Norm\xE1l": "VinerHandITC",
      "Norm\xE1lne": "VinerHandITC",
      "Regular": "VinerHandITC",
      "Standaard": "VinerHandITC",
      "Standard": "VinerHandITC",
      "normal": "VinerHandITC",
      "oby\u010Dejn\xE9": "VinerHandITC",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "VinerHandITC",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "VinerHandITC"
    },
    "Vivaldi": {
      "Corsivo": "Vivaldii",
      "Cursief": "Vivaldii",
      "Cursiva": "Vivaldii",
      "D\u0151lt": "Vivaldii",
      "Etzana": "Vivaldii",
      "Italic": "Vivaldii",
      "Italique": "Vivaldii",
      "It\xE1lico": "Vivaldii",
      "Kursiv": "Vivaldii",
      "Kursivoitu": "Vivaldii",
      "Kursywa": "Vivaldii",
      "Kurz\xEDva": "Vivaldii",
      "Po\u0161evno": "Vivaldii",
      "kursiv": "Vivaldii",
      "kurz\xEDva": "Vivaldii",
      "\u0130talik": "Vivaldii",
      "\u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": "Vivaldii",
      "\u041A\u0443\u0440\u0441\u0438\u0432": "Vivaldii"
    },
    "Vivaldi Corsivo": {
      "Regular": "Vivaldii"
    },
    "Vivaldi Cursief": {
      "Regular": "Vivaldii"
    },
    "Vivaldi Cursiva": {
      "Regular": "Vivaldii"
    },
    "Vivaldi D\u0151lt": {
      "Regular": "Vivaldii"
    },
    "Vivaldi Etzana": {
      "Regular": "Vivaldii"
    },
    "Vivaldi Italic": {
      "Italic": "Vivaldii",
      "Regular": "Vivaldii"
    },
    "Vivaldi Italique": {
      "Regular": "Vivaldii"
    },
    "Vivaldi It\xE1lico": {
      "Regular": "Vivaldii"
    },
    "Vivaldi Kursiv": {
      "Regular": "Vivaldii"
    },
    "Vivaldi Kursivoitu": {
      "Regular": "Vivaldii"
    },
    "Vivaldi Kursywa": {
      "Regular": "Vivaldii"
    },
    "Vivaldi Kurz\xEDva": {
      "Regular": "Vivaldii"
    },
    "Vivaldi Po\u0161evno": {
      "Regular": "Vivaldii"
    },
    "Vivaldi kursiv": {
      "Regular": "Vivaldii"
    },
    "Vivaldi kurz\xEDva": {
      "Regular": "Vivaldii"
    },
    "Vivaldi \u0130talik": {
      "Regular": "Vivaldii"
    },
    "Vivaldi \u03A0\u03BB\u03AC\u03B3\u03B9\u03B1": {
      "Regular": "Vivaldii"
    },
    "Vivaldi \u041A\u0443\u0440\u0441\u0438\u0432": {
      "Regular": "Vivaldii"
    },
    "Vladimir Script": {
      "Arrunta": "VladimirScript",
      "Navadno": "VladimirScript",
      "Normaali": "VladimirScript",
      "Normal": "VladimirScript",
      "Normale": "VladimirScript",
      "Normalny": "VladimirScript",
      "Norm\xE1l": "VladimirScript",
      "Norm\xE1lne": "VladimirScript",
      "Regular": "VladimirScript",
      "Standaard": "VladimirScript",
      "Standard": "VladimirScript",
      "normal": "VladimirScript",
      "oby\u010Dejn\xE9": "VladimirScript",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "VladimirScript",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "VladimirScript"
    },
    "Webdings": {
      "Arrunta": "Webdings",
      "Navadno": "Webdings",
      "Normaali": "Webdings",
      "Normal": "Webdings",
      "Normale": "Webdings",
      "Normalny": "Webdings",
      "Norm\xE1l": "Webdings",
      "Norm\xE1lne": "Webdings",
      "Regular": "Webdings",
      "Standaard": "Webdings",
      "Standard": "Webdings",
      "normal": "Webdings",
      "oby\u010Dejn\xE9": "Webdings",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "Webdings",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "Webdings"
    },
    "Wide Latin": {
      "Arrunta": "LatinWide",
      "Navadno": "LatinWide",
      "Normaali": "LatinWide",
      "Normal": "LatinWide",
      "Normale": "LatinWide",
      "Normalny": "LatinWide",
      "Norm\xE1l": "LatinWide",
      "Norm\xE1lne": "LatinWide",
      "Regular": "LatinWide",
      "Standaard": "LatinWide",
      "Standard": "LatinWide",
      "normal": "LatinWide",
      "oby\u010Dejn\xE9": "LatinWide",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "LatinWide",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "LatinWide"
    },
    "Wingdings": {
      "Navadno": "Wingdings-Regular",
      "Normaali": "Wingdings-Regular",
      "Normal": "Wingdings-Regular",
      "Normale": "Wingdings-Regular",
      "Norm\xE1lne": "Wingdings-Regular",
      "Regular": "Wingdings-Regular",
      "Standaard": "Wingdings-Regular",
      "Standard": "Wingdings-Regular",
      "normal": "Wingdings-Regular"
    },
    "Wingdings 2": {
      "Normaali": "Wingdings2",
      "Normal": "Wingdings2",
      "Normale": "Wingdings2",
      "Regular": "Wingdings2",
      "Standaard": "Wingdings2",
      "Standard": "Wingdings2",
      "normal": "Wingdings2"
    },
    "Wingdings 3": {
      "Normaali": "Wingdings3",
      "Normal": "Wingdings3",
      "Normale": "Wingdings3",
      "Regular": "Wingdings3",
      "Standaard": "Wingdings3",
      "Standard": "Wingdings3",
      "normal": "Wingdings3"
    },
    "YouYuan": {
      "Regular": "YouYuan"
    },
    "Yu Gothic": {
      "Bold": "YuGothic-Bold",
      "Light": "YuGothic-Light",
      "Medium": "YuGothic-Medium",
      "Regular": "YuGothic-Regular"
    },
    "Yu Gothic Bold": {
      "Bold": "YuGothic-Bold",
      "Regular": "YuGothic-Bold"
    },
    "Yu Gothic Light": {
      "Light": "YuGothic-Light",
      "Regular": "YuGothic-Light"
    },
    "Yu Gothic Medium": {
      "Medium": "YuGothic-Medium",
      "Regular": "YuGothic-Medium"
    },
    "Yu Gothic Regular": {
      "Regular": "YuGothic-Regular"
    },
    "\xB7\xBD\xD5\xFD\xD3\xC6\xBA\xDA_GBK": {
      "503L": "FZYOUHK_503L--GBK1-0",
      "508R": "FZYOUHK_508R--GBK1-0",
      "510M": "FZYOUHK_510M--GBK1-0",
      "513B": "FZYOUHK_513B--GBK1-0",
      "Regular": "FZYOUHK_503L--GBK1-0"
    },
    "\xB7\xBD\xD5\xFD\xD3\xC6\xBA\xDA_GBK 503L": {
      "Regular": "FZYOUHK_503L--GBK1-0"
    },
    "\xB7\xBD\xD5\xFD\xD3\xC6\xBA\xDA_GBK 508R": {
      "Regular": "FZYOUHK_508R--GBK1-0"
    },
    "\xB7\xBD\xD5\xFD\xD3\xC6\xBA\xDA_GBK 510M": {
      "Regular": "FZYOUHK_510M--GBK1-0"
    },
    "\xB7\xBD\xD5\xFD\xD3\xC6\xBA\xDA_GBK 513B": {
      "Regular": "FZYOUHK_513B--GBK1-0"
    },
    "\xBA\xBA\xD2\xC7\xD6\xD0\xD4\xB2B5": {
      "Regular": "HYZhongYuanB5"
    },
    "\xBA\xBA\xD2\xC7\xD6\xD0\xD4\xB2B5 Regular": {
      "Regular": "HYZhongYuanB5"
    },
    "\u05DE\u05E8\u05D9\u05DD": {
      "Bold": "MiriamCLM-Bold",
      "Book": "MiriamCLM-Book",
      "\u05DB\u05D1\u05D3": "MiriamCLM-Bold",
      "\u05E7\u05DC": "MiriamCLM-Book"
    },
    "\u05DE\u05E8\u05D9\u05DD \u05DB\u05D1\u05D3": {
      "Regular": "MiriamCLM-Bold"
    },
    "\u05DE\u05E8\u05D9\u05DD \u05E7\u05DC": {
      "Regular": "MiriamCLM-Book"
    },
    "\u4EFF\u5B8B": {
      "Arrunta": "FangSong",
      "Navadno": "FangSong",
      "Normaali": "FangSong",
      "Normal": "FangSong",
      "Normale": "FangSong",
      "Normalny": "FangSong",
      "Norm\xE1l": "FangSong",
      "Norm\xE1lne": "FangSong",
      "Regular": "FangSong",
      "Standaard": "FangSong",
      "Standard": "FangSong",
      "normal": "FangSong",
      "oby\u010Dejn\xE9": "FangSong",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "FangSong",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "FangSong"
    },
    "\u534E\u6587\u4E2D\u5B8B": {
      "Regular": "STZhongsong"
    },
    "\u534E\u6587\u4EFF\u5B8B": {
      "Regular": "STFangsong"
    },
    "\u534E\u6587\u5B8B\u4F53": {
      "Regular": "STSong"
    },
    "\u534E\u6587\u5F69\u4E91": {
      "Regular": "STCaiyun"
    },
    "\u534E\u6587\u65B0\u9B4F": {
      "Regular": "STXinwei"
    },
    "\u534E\u6587\u6977\u4F53": {
      "Regular": "STKaiti"
    },
    "\u534E\u6587\u7425\u73C0": {
      "Regular": "STHupo"
    },
    "\u534E\u6587\u7EC6\u9ED1": {
      "Regular": "STXihei"
    },
    "\u534E\u6587\u884C\u6977": {
      "Regular": "STXingkai"
    },
    "\u534E\u6587\u96B6\u4E66": {
      "Regular": "STLiti"
    },
    "\u5B8B\u4F53": {
      "Regular": "SimSun",
      "\u5E38\u89C4": "SimSun"
    },
    "\u5E7C\u5706": {
      "Regular": "YouYuan"
    },
    "\u5FAE\u8EDF\u6B63\u9ED1\u9AD4": {
      "Arrunta": "MicrosoftJhengHeiRegular",
      "Bold": "MicrosoftJhengHeiBold",
      "Fet": "MicrosoftJhengHeiBold",
      "Fett": "MicrosoftJhengHeiBold",
      "F\xE9lk\xF6v\xE9r": "MicrosoftJhengHeiBold",
      "Gras": "MicrosoftJhengHeiBold",
      "Grassetto": "MicrosoftJhengHeiBold",
      "Halvfet": "MicrosoftJhengHeiBold",
      "Kal\u0131n": "MicrosoftJhengHeiBold",
      "Krepko": "MicrosoftJhengHeiBold",
      "Light": "MicrosoftJhengHeiLight",
      "Lihavoitu": "MicrosoftJhengHeiBold",
      "Lodia": "MicrosoftJhengHeiBold",
      "Navadno": "MicrosoftJhengHeiRegular",
      "Negreta": "MicrosoftJhengHeiBold",
      "Negrita": "MicrosoftJhengHeiBold",
      "Negrito": "MicrosoftJhengHeiBold",
      "Normaali": "MicrosoftJhengHeiRegular",
      "Normal": "MicrosoftJhengHeiRegular",
      "Normale": "MicrosoftJhengHeiRegular",
      "Normalny": "MicrosoftJhengHeiRegular",
      "Norm\xE1l": "MicrosoftJhengHeiRegular",
      "Norm\xE1lne": "MicrosoftJhengHeiRegular",
      "Pogrubiony": "MicrosoftJhengHeiBold",
      "Regular": "MicrosoftJhengHeiRegular",
      "Standaard": "MicrosoftJhengHeiRegular",
      "Standard": "MicrosoftJhengHeiRegular",
      "Tu\u010Dn\xE9": "MicrosoftJhengHeiBold",
      "Vet": "MicrosoftJhengHeiBold",
      "fed": "MicrosoftJhengHeiBold",
      "normal": "MicrosoftJhengHeiRegular",
      "oby\u010Dejn\xE9": "MicrosoftJhengHeiRegular",
      "tu\u010Dn\xE9": "MicrosoftJhengHeiBold",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "MicrosoftJhengHeiBold",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "MicrosoftJhengHeiRegular",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "MicrosoftJhengHeiRegular",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "MicrosoftJhengHeiBold"
    },
    "\u5FAE\u8EDF\u6B63\u9ED1\u9AD4 Bold": {
      "Regular": "MicrosoftJhengHeiBold"
    },
    "\u5FAE\u8EDF\u6B63\u9ED1\u9AD4 Light": {
      "Regular": "MicrosoftJhengHeiLight"
    },
    "\u5FAE\u8F6F\u96C5\u9ED1": {
      "Arrunta": "MicrosoftYaHei",
      "Bold": "MicrosoftYaHei-Bold",
      "Fet": "MicrosoftYaHei-Bold",
      "Fett": "MicrosoftYaHei-Bold",
      "F\xE9lk\xF6v\xE9r": "MicrosoftYaHei-Bold",
      "Gras": "MicrosoftYaHei-Bold",
      "Grassetto": "MicrosoftYaHei-Bold",
      "Halvfet": "MicrosoftYaHei-Bold",
      "Kal\u0131n": "MicrosoftYaHei-Bold",
      "Krepko": "MicrosoftYaHei-Bold",
      "Light": "MicrosoftYaHeiLight",
      "Lihavoitu": "MicrosoftYaHei-Bold",
      "Lodia": "MicrosoftYaHei-Bold",
      "Navadno": "MicrosoftYaHei",
      "Negreta": "MicrosoftYaHei-Bold",
      "Negrita": "MicrosoftYaHei-Bold",
      "Negrito": "MicrosoftYaHei-Bold",
      "Normaali": "MicrosoftYaHei",
      "Normal": "MicrosoftYaHei",
      "Normale": "MicrosoftYaHei",
      "Normalny": "MicrosoftYaHei",
      "Norm\xE1l": "MicrosoftYaHei",
      "Norm\xE1lne": "MicrosoftYaHei",
      "Pogrubiony": "MicrosoftYaHei-Bold",
      "Regular": "MicrosoftYaHei",
      "Standaard": "MicrosoftYaHei",
      "Standard": "MicrosoftYaHei",
      "Tu\u010Dn\xE9": "MicrosoftYaHei-Bold",
      "Vet": "MicrosoftYaHei-Bold",
      "fed": "MicrosoftYaHei-Bold",
      "oby\u010Dejn\xE9": "MicrosoftYaHei",
      "tu\u010Dn\xE9": "MicrosoftYaHei-Bold",
      "\u0388\u03BD\u03C4\u03BF\u03BD\u03B1": "MicrosoftYaHei-Bold",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "MicrosoftYaHei",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "MicrosoftYaHei",
      "\u041F\u043E\u043B\u0443\u0436\u0438\u0440\u043D\u044B\u0439": "MicrosoftYaHei-Bold"
    },
    "\u5FAE\u8F6F\u96C5\u9ED1 Bold": {
      "Regular": "MicrosoftYaHei-Bold"
    },
    "\u5FAE\u8F6F\u96C5\u9ED1 Light": {
      "Regular": "MicrosoftYaHeiLight"
    },
    "\u65B9\u6B63\u4EFF\u5B8B_GBK": {
      "Regular": "FZFSK--GBK1-0"
    },
    "\u65B9\u6B63\u59DA\u4F53": {
      "Regular": "FZYTK--GBK1-0"
    },
    "\u65B9\u6B63\u60A0\u9ED1_GBK": {
      "503L": "FZYOUHK_503L--GBK1-0",
      "508R": "FZYOUHK_508R--GBK1-0",
      "510M": "FZYOUHK_510M--GBK1-0",
      "513B": "FZYOUHK_513B--GBK1-0"
    },
    "\u65B9\u6B63\u60A0\u9ED1_GBK 503L": {
      "503L": "FZYOUHK_503L--GBK1-0",
      "Regular": "FZYOUHK_503L--GBK1-0"
    },
    "\u65B9\u6B63\u60A0\u9ED1_GBK 503L Regular": {
      "503L": "FZYOUHK_503L--GBK1-0"
    },
    "\u65B9\u6B63\u60A0\u9ED1_GBK 508R": {
      "508R": "FZYOUHK_508R--GBK1-0",
      "Regular": "FZYOUHK_508R--GBK1-0"
    },
    "\u65B9\u6B63\u60A0\u9ED1_GBK 508R Regular": {
      "508R": "FZYOUHK_508R--GBK1-0"
    },
    "\u65B9\u6B63\u60A0\u9ED1_GBK 510M": {
      "510M": "FZYOUHK_510M--GBK1-0",
      "Regular": "FZYOUHK_510M--GBK1-0"
    },
    "\u65B9\u6B63\u60A0\u9ED1_GBK 510M Regular": {
      "510M": "FZYOUHK_510M--GBK1-0"
    },
    "\u65B9\u6B63\u60A0\u9ED1_GBK 513B": {
      "513B": "FZYOUHK_513B--GBK1-0",
      "Regular": "FZYOUHK_513B--GBK1-0"
    },
    "\u65B9\u6B63\u60A0\u9ED1_GBK 513B Regular": {
      "513B": "FZYOUHK_513B--GBK1-0"
    },
    "\u65B9\u6B63\u8212\u4F53": {
      "Regular": "FZSTK--GBK1-0"
    },
    "\u6977\u4F53": {
      "Arrunta": "KaiTi",
      "Navadno": "KaiTi",
      "Normaali": "KaiTi",
      "Normal": "KaiTi",
      "Normale": "KaiTi",
      "Normalny": "KaiTi",
      "Norm\xE1l": "KaiTi",
      "Norm\xE1lne": "KaiTi",
      "Regular": "KaiTi",
      "Standaard": "KaiTi",
      "Standard": "KaiTi",
      "normal": "KaiTi",
      "oby\u010Dejn\xE9": "KaiTi",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "KaiTi",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "KaiTi"
    },
    "\u6C49\u4EEA\u4E2D\u5706B5": {
      "Regular": "HYZhongYuanB5"
    },
    "\u6C49\u4EEA\u4E2D\u5706B5 Regular": {
      "Regular": "HYZhongYuanB5"
    },
    "\u6C49\u4EEA\u53F6\u53F6\u76F8\u601D\u4F53\u7B80": {
      "Regular": "HYYeYXSJ"
    },
    "\u6E38\u30B4\u30B7\u30C3\u30AF": {
      "Bold": "YuGothic-Bold",
      "Light": "YuGothic-Light",
      "Medium": "YuGothic-Medium",
      "Regular": "YuGothic-Regular"
    },
    "\u6E38\u30B4\u30B7\u30C3\u30AF Bold": {
      "Regular": "YuGothic-Bold"
    },
    "\u6E38\u30B4\u30B7\u30C3\u30AF Light": {
      "Regular": "YuGothic-Light"
    },
    "\u6E38\u30B4\u30B7\u30C3\u30AF Medium": {
      "Regular": "YuGothic-Medium"
    },
    "\u6E38\u30B4\u30B7\u30C3\u30AF Regular": {
      "Regular": "YuGothic-Regular"
    },
    "\u7B49\u7EBF": {
      "Bold": "DengXian-Bold",
      "Light": "DengXian-Light",
      "Regular": "DengXian"
    },
    "\u7B49\u7EBF Bold": {
      "Regular": "DengXian-Bold"
    },
    "\u7B49\u7EBF Light": {
      "Regular": "DengXian-Light"
    },
    "\u7D30\u660E\u9AD4-ExtB": {
      "Regular": "MingLiU-ExtB"
    },
    "\u96B6\u4E66": {
      "Regular": "LiSu"
    },
    "\u9ED1\u4F53": {
      "Arrunta": "SimHei",
      "Navadno": "SimHei",
      "Normaali": "SimHei",
      "Normal": "SimHei",
      "Normale": "SimHei",
      "Normalny": "SimHei",
      "Norm\xE1l": "SimHei",
      "Norm\xE1lne": "SimHei",
      "Regular": "SimHei",
      "Standaard": "SimHei",
      "Standard": "SimHei",
      "normal": "SimHei",
      "oby\u010Dejn\xE9": "SimHei",
      "\u039A\u03B1\u03BD\u03BF\u03BD\u03B9\u03BA\u03AC": "SimHei",
      "\u041E\u0431\u044B\u0447\u043D\u044B\u0439": "SimHei"
    },
    "\uB9D1\uC740 \uACE0\uB515": {
      "Bold": "MalgunGothicBold",
      "Regular": "MalgunGothic",
      "Semilight": "MalgunGothic-Semilight"
    },
    "\uB9D1\uC740 \uACE0\uB515 Bold": {
      "Regular": "MalgunGothicBold"
    },
    "\uB9D1\uC740 \uACE0\uB515 Semilight": {
      "Regular": "MalgunGothic-Semilight"
    },
    "\uFF2D\uFF33 \u30B4\u30B7\u30C3\u30AF": {
      "Regular": "MS-Gothic",
      "\u6A19\u6E96": "MS-Gothic"
    }
  };
  var FONT_METRICS_MAP = {
    "AgencyFB-Bold": { ascent: 0.76416015625, descent: 0.18017578125 },
    "AgencyFB-Reg": { ascent: 0.76416015625, descent: 0.18017578125 },
    "Alef-Bold": { ascent: 0.7998046875, descent: 0.2001953125, capHeight: 0.7021484375 },
    "Alef-Regular": { ascent: 0.7998046875, descent: 0.2001953125, capHeight: 0.7021484375 },
    "Algerian": { ascent: 0.88818359375, descent: 0.2236328125 },
    "Amiri-Bold": { ascent: 1.124, descent: 0.634, capHeight: 0.646 },
    "Amiri-BoldItalic": { ascent: 1.124, descent: 0.634, capHeight: 0.646 },
    "Amiri-BoldSlanted": { ascent: 1.124, descent: 0.634, capHeight: 0.646 },
    "Amiri-Italic": { ascent: 1.124, descent: 0.634, capHeight: 0.646 },
    "Amiri-Regular": { ascent: 1.124, descent: 0.634, capHeight: 0.646 },
    "Amiri-Slanted": { ascent: 1.124, descent: 0.634, capHeight: 0.646 },
    "AmiriQuran-Regular": { ascent: 1.815, descent: 0.634, capHeight: 0.646 },
    "Arial-Black": { ascent: 0.7158203125, descent: 0.2119140625, capHeight: 0.7158203125 },
    "Arial-BoldItalicMT": { ascent: 0.72802734375, descent: 0.21044921875, capHeight: 0.71533203125 },
    "Arial-BoldMT": { ascent: 0.72802734375, descent: 0.21044921875, capHeight: 0.7158203125 },
    "Arial-ItalicMT": { ascent: 0.72802734375, descent: 0.20751953125, capHeight: 0.7158203125 },
    "ArialMT": { ascent: 0.72802734375, descent: 0.21044921875, capHeight: 0.71630859375 },
    "ArialNarrow": { ascent: 0.72802734375, descent: 0.21044921875 },
    "ArialNarrow-Bold": { ascent: 0.72802734375, descent: 0.21044921875 },
    "ArialNarrow-BoldItalic": { ascent: 0.72802734375, descent: 0.21044921875 },
    "ArialNarrow-Italic": { ascent: 0.72802734375, descent: 0.20751953125 },
    "ArialRoundedMTBold": { ascent: 0.72802734375, descent: 0.2099609375 },
    "Bahnschrift": { ascent: 0.7939453125, descent: 0.2060546875, capHeight: 0.7099609375 },
    "BaskOldFace": { ascent: 0.6875, descent: 0.1787109375 },
    "Bauhaus93": { ascent: 0.89892578125, descent: 0.23291015625 },
    "BellMT": { ascent: 0.6689453125, descent: 0.26611328125 },
    "BellMTBold": { ascent: 0.66748046875, descent: 0.2646484375 },
    "BellMTItalic": { ascent: 0.66943359375, descent: 0.26611328125 },
    "BerlinSansFB-Bold": { ascent: 0.90673828125, descent: 0.3310546875 },
    "BerlinSansFB-Reg": { ascent: 0.89599609375, descent: 0.203125 },
    "BerlinSansFBDemi-Bold": { ascent: 0.92431640625, descent: 0.20458984375 },
    "BernardMT-Condensed": { ascent: 0.8056640625, descent: 0.12060546875 },
    "BlackadderITC-Regular": { ascent: 0.896484375, descent: 0.38623046875 },
    "BodoniMT": { ascent: 0.662109375, descent: 0.2587890625 },
    "BodoniMT-Bold": { ascent: 0.6640625, descent: 0.2568359375 },
    "BodoniMT-BoldItalic": { ascent: 0.6669921875, descent: 0.255859375 },
    "BodoniMT-Italic": { ascent: 0.6669921875, descent: 0.2509765625 },
    "BodoniMTBlack": { ascent: 0.669921875, descent: 0.22802734375 },
    "BodoniMTBlack-Italic": { ascent: 0.66015625, descent: 0.2099609375 },
    "BodoniMTCondensed": { ascent: 0.64306640625, descent: 0.2119140625 },
    "BodoniMTCondensed-Bold": { ascent: 0.64306640625, descent: 0.2119140625 },
    "BodoniMTCondensed-BoldItalic": { ascent: 0.64306640625, descent: 0.2119140625 },
    "BodoniMTCondensed-Italic": { ascent: 0.64306640625, descent: 0.2119140625 },
    "BodoniMTPosterCompressed": { ascent: 0.740234375, descent: 0.181640625 },
    "BookAntiqua": { ascent: 0.72705078125, descent: 0.2822265625 },
    "BookAntiqua-Bold": { ascent: 0.72607421875, descent: 0.26513671875 },
    "BookAntiqua-BoldItalic": { ascent: 0.72998046875, descent: 0.27490234375 },
    "BookAntiqua-Italic": { ascent: 0.72509765625, descent: 0.27978515625 },
    "BookmanOldStyle": { ascent: 0.71630859375, descent: 0.22509765625 },
    "BookmanOldStyle-Bold": { ascent: 0.716796875, descent: 0.22314453125 },
    "BookmanOldStyle-BoldItalic": { ascent: 0.71630859375, descent: 0.22314453125 },
    "BookmanOldStyle-Italic": { ascent: 0.71630859375, descent: 0.23046875 },
    "BookshelfSymbolSeven": { ascent: 0.859375, descent: 0.140625 },
    "BradleyHandITC": { ascent: 0.6982421875, descent: 0.26904296875 },
    "BritannicBold": { ascent: 0.6767578125, descent: 0.16650390625 },
    "Broadway": { ascent: 0.705078125, descent: 0.02392578125 },
    "BrushScriptMT": { ascent: 0.60009765625, descent: 0.2470703125 },
    "Caladea-Bold": { ascent: 0.778, descent: 0.222, capHeight: 0.667 },
    "Caladea-BoldItalic": { ascent: 0.778, descent: 0.222, capHeight: 0.667 },
    "Caladea-Italic": { ascent: 0.778, descent: 0.222, capHeight: 0.667 },
    "Caladea-Regular": { ascent: 0.778, descent: 0.222, capHeight: 0.667 },
    "Calibri": { ascent: 0.75, descent: 0.25, capHeight: 0.6318359375 },
    "Calibri-Bold": { ascent: 0.75, descent: 0.25, capHeight: 0.6318359375 },
    "Calibri-BoldItalic": { ascent: 0.75, descent: 0.25, capHeight: 0.6318359375 },
    "Calibri-Italic": { ascent: 0.75, descent: 0.25, capHeight: 0.63330078125 },
    "Calibri-Light": { ascent: 0.75, descent: 0.25, capHeight: 0.6318359375 },
    "Calibri-LightItalic": { ascent: 0.75, descent: 0.25, capHeight: 0.6318359375 },
    "CalifornianFB-Bold": { ascent: 0.7451171875, descent: 0.2548828125 },
    "CalifornianFB-Italic": { ascent: 0.7451171875, descent: 0.2548828125 },
    "CalifornianFB-Reg": { ascent: 0.7451171875, descent: 0.2548828125 },
    "CalisMTBol": { ascent: 0.71240234375, descent: 0.2099609375 },
    "CalistoMT": { ascent: 0.71240234375, descent: 0.2099609375 },
    "CalistoMT-BoldItalic": { ascent: 0.71240234375, descent: 0.2099609375 },
    "CalistoMT-Italic": { ascent: 0.7119140625, descent: 0.2099609375 },
    "Cambria": { ascent: 0.77783203125, descent: 0.22216796875, capHeight: 0.66650390625 },
    "Cambria-Bold": { ascent: 0.77783203125, descent: 0.22216796875, capHeight: 0.66650390625 },
    "Cambria-BoldItalic": { ascent: 0.77783203125, descent: 0.22216796875, capHeight: 0.66650390625 },
    "Cambria-Italic": { ascent: 0.77783203125, descent: 0.22216796875, capHeight: 0.66650390625 },
    "Candara": { ascent: 0.724609375, descent: 0.275390625, capHeight: 0.638671875 },
    "Candara-Bold": { ascent: 0.724609375, descent: 0.275390625, capHeight: 0.638671875 },
    "Candara-BoldItalic": { ascent: 0.724609375, descent: 0.275390625, capHeight: 0.638671875 },
    "Candara-Italic": { ascent: 0.724609375, descent: 0.275390625, capHeight: 0.638671875 },
    "Candara-Light": { ascent: 0.724609375, descent: 0.275390625, capHeight: 0.63623046875 },
    "Candara-LightItalic": { ascent: 0.724609375, descent: 0.275390625, capHeight: 0.63623046875 },
    "Carlito": { ascent: 0.75, descent: 0.25, capHeight: 0.6416015625 },
    "Carlito-Bold": { ascent: 0.75, descent: 0.25, capHeight: 0.6484375 },
    "Carlito-BoldItalic": { ascent: 0.75, descent: 0.25, capHeight: 0.6484375 },
    "Carlito-Italic": { ascent: 0.75, descent: 0.25, capHeight: 0.6416015625 },
    "Castellar": { ascent: 0.71484375, descent: 390625e-8 },
    "Centaur": { ascent: 0.6728515625, descent: 0.27783203125 },
    "Century": { ascent: 0.740234375, descent: 0.19482421875 },
    "CenturyGothic": { ascent: 0.75, descent: 0.2080078125 },
    "CenturyGothic-Bold": { ascent: 0.75, descent: 0.2080078125 },
    "CenturyGothic-BoldItalic": { ascent: 0.75, descent: 0.2080078125 },
    "CenturyGothic-Italic": { ascent: 0.75, descent: 0.2080078125 },
    "CenturySchoolbook": { ascent: 0.740234375, descent: 0.19482421875 },
    "CenturySchoolbook-Bold": { ascent: 0.74072265625, descent: 0.1953125 },
    "CenturySchoolbook-BoldItalic": { ascent: 0.7392578125, descent: 0.1923828125 },
    "CenturySchoolbook-Italic": { ascent: 0.73974609375, descent: 0.1953125 },
    "Chiller-Regular": { ascent: 0.8486328125, descent: 0.30517578125 },
    "ColonnaMT": { ascent: 0.595703125, descent: 0.3330078125 },
    "ComicSansMS": { ascent: 0.7998046875, descent: 0.275390625, capHeight: 0.7587890625 },
    "ComicSansMS-Bold": { ascent: 0.7998046875, descent: 0.275390625, capHeight: 0.7587890625 },
    "ComicSansMS-BoldItalic": { ascent: 0.7998046875, descent: 0.275390625, capHeight: 0.7587890625 },
    "ComicSansMS-Italic": { ascent: 0.7998046875, descent: 0.275390625, capHeight: 0.7587890625 },
    "Consolas": { ascent: 0.74267578125, descent: 0.25732421875, capHeight: 0.63818359375 },
    "Consolas-Bold": { ascent: 0.74267578125, descent: 0.25732421875, capHeight: 0.63818359375 },
    "Consolas-BoldItalic": { ascent: 0.74267578125, descent: 0.25732421875, capHeight: 0.63818359375 },
    "Consolas-Italic": { ascent: 0.74267578125, descent: 0.25732421875, capHeight: 0.63818359375 },
    "Constantia": { ascent: 0.7509765625, descent: 0.2490234375, capHeight: 0.6865234375 },
    "Constantia-Bold": { ascent: 0.7509765625, descent: 0.2490234375, capHeight: 0.6865234375 },
    "Constantia-BoldItalic": { ascent: 0.7509765625, descent: 0.2490234375, capHeight: 0.6865234375 },
    "Constantia-Italic": { ascent: 0.7509765625, descent: 0.2490234375, capHeight: 0.6865234375 },
    "CooperBlack": { ascent: 0.671875, descent: 0.19287109375 },
    "CopperplateGothic-Bold": { ascent: 0.578125, descent: 0.01171875 },
    "CopperplateGothic-Light": { ascent: 0.578125, descent: 0.01171875 },
    "Corbel": { ascent: 0.74365234375, descent: 0.25634765625, capHeight: 0.6533203125 },
    "Corbel-Bold": { ascent: 0.74365234375, descent: 0.25634765625, capHeight: 0.6533203125 },
    "Corbel-BoldItalic": { ascent: 0.74365234375, descent: 0.25634765625, capHeight: 0.6533203125 },
    "Corbel-Italic": { ascent: 0.74365234375, descent: 0.25634765625, capHeight: 0.6533203125 },
    "CorbelLight": { ascent: 0.74365234375, descent: 0.25634765625, capHeight: 0.6533203125 },
    "CorbelLight-Italic": { ascent: 0.74365234375, descent: 0.25634765625, capHeight: 0.6533203125 },
    "CourierNewPS-BoldItalicMT": { ascent: 0.63330078125, descent: 0.208984375, capHeight: 0.591796875 },
    "CourierNewPS-BoldMT": { ascent: 0.63330078125, descent: 0.208984375, capHeight: 0.591796875 },
    "CourierNewPS-ItalicMT": { ascent: 0.61279296875, descent: 0.1884765625, capHeight: 0.5712890625 },
    "CourierNewPSMT": { ascent: 0.61279296875, descent: 0.1884765625, capHeight: 0.5712890625 },
    "CurlzMT": { ascent: 0.71484375, descent: 0.19091796875 },
    "DINPro-Black": { ascent: 0.764, descent: 0.236, capHeight: 0.712 },
    "DINPro-Light": { ascent: 0.764, descent: 0.236, capHeight: 0.712 },
    "DINPro-Medium": { ascent: 0.764, descent: 0.236, capHeight: 0.712 },
    "DINPro-Regular": { ascent: 0.764, descent: 0.236, capHeight: 0.712 },
    "DavidCLM-Bold": { ascent: 0.8, descent: 0.2, capHeight: 0.5591666666666667 },
    "DavidCLM-BoldItalic": { ascent: 0.8, descent: 0.2, capHeight: 0.5591666666666667 },
    "DavidCLM-Medium": { ascent: 0.8, descent: 0.2, capHeight: 0.5591666666666667 },
    "DavidCLM-MediumItalic": { ascent: 0.8, descent: 0.2, capHeight: 0.5591666666666667 },
    "DavidLibre-Bold": { ascent: 0.74609375, descent: 0.21923828125, capHeight: 0.6650390625 },
    "DavidLibre-Regular": { ascent: 0.74609375, descent: 0.21923828125, capHeight: 0.6640625 },
    "DejaVuMathTeXGyre-Regular": { ascent: 0.792, descent: 0.208, capHeight: 0.729 },
    "DejaVuSans": { ascent: 0.759765625, descent: 0.240234375 },
    "DejaVuSans-Bold": { ascent: 0.759765625, descent: 0.240234375 },
    "DejaVuSans-BoldOblique": { ascent: 0.759765625, descent: 0.240234375 },
    "DejaVuSans-ExtraLight": { ascent: 0.759765625, descent: 0.240234375 },
    "DejaVuSans-Oblique": { ascent: 0.759765625, descent: 0.240234375 },
    "DejaVuSansCondensed": { ascent: 0.759765625, descent: 0.240234375 },
    "DejaVuSansCondensed-Bold": { ascent: 0.759765625, descent: 0.240234375 },
    "DejaVuSansCondensed-BoldOblique": { ascent: 0.759765625, descent: 0.240234375 },
    "DejaVuSansCondensed-Oblique": { ascent: 0.759765625, descent: 0.240234375 },
    "DejaVuSansMono": { ascent: 0.759765625, descent: 0.240234375 },
    "DejaVuSansMono-Bold": { ascent: 0.759765625, descent: 0.240234375 },
    "DejaVuSansMono-BoldOblique": { ascent: 0.759765625, descent: 0.240234375 },
    "DejaVuSansMono-Oblique": { ascent: 0.759765625, descent: 0.240234375 },
    "DejaVuSerif": { ascent: 0.759765625, descent: 0.240234375 },
    "DejaVuSerif-Bold": { ascent: 0.759765625, descent: 0.240234375 },
    "DejaVuSerif-BoldItalic": { ascent: 0.759765625, descent: 0.240234375 },
    "DejaVuSerif-Italic": { ascent: 0.759765625, descent: 0.240234375 },
    "DejaVuSerifCondensed": { ascent: 0.759765625, descent: 0.240234375 },
    "DejaVuSerifCondensed-Bold": { ascent: 0.759765625, descent: 0.240234375 },
    "DejaVuSerifCondensed-BoldItalic": { ascent: 0.759765625, descent: 0.240234375 },
    "DejaVuSerifCondensed-Italic": { ascent: 0.759765625, descent: 0.240234375 },
    "DengXian": { ascent: 0.81005859375, descent: 0.23193359375, capHeight: 0.68798828125 },
    "DengXian-Bold": { ascent: 0.81005859375, descent: 0.23193359375, capHeight: 0.68798828125 },
    "DengXian-Light": { ascent: 0.81005859375, descent: 0.23193359375, capHeight: 0.68798828125 },
    "Dubai-Bold": { ascent: 0.758, descent: 0.246, capHeight: 0.648 },
    "Dubai-Light": { ascent: 0.758, descent: 0.246, capHeight: 0.648 },
    "Dubai-Medium": { ascent: 0.758, descent: 0.246, capHeight: 0.648 },
    "Dubai-Regular": { ascent: 0.758, descent: 0.246, capHeight: 0.648 },
    "Ebrima": { ascent: 0.72802734375, descent: 0.21044921875, capHeight: 0.7001953125 },
    "Ebrima-Bold": { ascent: 0.740234375, descent: 0.22998046875, capHeight: 0.7001953125 },
    "EdwardianScriptITC": { ascent: 0.8486328125, descent: 0.328125 },
    "Elephant-Italic": { ascent: 0.967, descent: 0.264 },
    "Elephant-Regular": { ascent: 0.962, descent: 0.265 },
    "EmojiOneColorSVGinOT": { ascent: 0.7998046875, descent: 0.2001953125 },
    "EngraversMT": { ascent: 0.69580078125, descent: 0.01318359375 },
    "ErasITC-Bold": { ascent: 0.69677734375, descent: 0.23779296875 },
    "ErasITC-Demi": { ascent: 0.685546875, descent: 0.23681640625 },
    "ErasITC-Light": { ascent: 0.68115234375, descent: 0.23681640625 },
    "ErasITC-Medium": { ascent: 0.685546875, descent: 0.23681640625 },
    "FZFSK--GBK1-0": { ascent: 0.8828125, descent: 0.2421875 },
    "FZSTK--GBK1-0": { ascent: 0.91015625, descent: 0.14453125 },
    "FZYOUHK_503L--GBK1-0": { ascent: 0.85, descent: 0.15, capHeight: 0.88 },
    "FZYOUHK_508R--GBK1-0": { ascent: 0.85, descent: 0.15, capHeight: 0.88 },
    "FZYOUHK_510M--GBK1-0": { ascent: 0.85, descent: 0.15, capHeight: 0.88 },
    "FZYOUHK_513B--GBK1-0": { ascent: 0.904, descent: 0.237 },
    "FZYTK--GBK1-0": { ascent: 0.98828125, descent: 0.1484375 },
    "FangSong": { ascent: 0.859375, descent: 0.140625, capHeight: 0.66796875 },
    "FelixTitlingMT": { ascent: 0.71923828125, descent: 0.2412109375 },
    "FootlightMTLight": { ascent: 0.69140625, descent: 0.2236328125 },
    "ForteMT": { ascent: 0.6728515625, descent: 0.2138671875 },
    "FrankRuehlCLM-Bold": { ascent: 0.8, descent: 0.2 },
    "FrankRuehlCLM-BoldOblique": { ascent: 0.8, descent: 0.2 },
    "FrankRuehlCLM-Medium": { ascent: 0.8, descent: 0.2 },
    "FrankRuehlCLM-MediumOblique": { ascent: 0.8, descent: 0.2 },
    "FrankRuhlHofshi-Bold": { ascent: 0.957, descent: 0.334, capHeight: 0.66 },
    "FrankRuhlHofshi-Regular": { ascent: 0.957, descent: 0.334, capHeight: 0.66 },
    "FranklinGothic-Book": { ascent: 0.7001953125, descent: 0.18994140625 },
    "FranklinGothic-BookItalic": { ascent: 0.7001953125, descent: 0.18994140625 },
    "FranklinGothic-Demi": { ascent: 0.7001953125, descent: 0.18994140625 },
    "FranklinGothic-DemiCond": { ascent: 0.7001953125, descent: 0.18994140625 },
    "FranklinGothic-DemiItalic": { ascent: 0.7001953125, descent: 0.18994140625 },
    "FranklinGothic-Heavy": { ascent: 0.7001953125, descent: 0.18994140625 },
    "FranklinGothic-HeavyItalic": { ascent: 0.7001953125, descent: 0.18994140625 },
    "FranklinGothic-Medium": { ascent: 0.7001953125, descent: 0.18994140625 },
    "FranklinGothic-MediumCond": { ascent: 0.7001953125, descent: 0.18994140625 },
    "FranklinGothic-MediumItalic": { ascent: 0.7001953125, descent: 0.18994140625 },
    "FreestyleScript-Regular": { ascent: 0.6826171875, descent: 0.3173828125 },
    "FrenchScriptMT": { ascent: 0.57421875, descent: 0.2998046875 },
    "GWZT-EN": { ascent: 0.863, descent: 0.25, capHeight: 0.725 },
    "Gabriola": { ascent: 0.68359375, descent: 0.31640625, capHeight: 0.55810546875 },
    "Gadugi": { ascent: 0.72802734375, descent: 0.21044921875, capHeight: 0.7001953125 },
    "Gadugi-Bold": { ascent: 0.72802734375, descent: 0.21044921875, capHeight: 0.7001953125 },
    "Garamond": { ascent: 0.65380859375, descent: 0.26318359375 },
    "Garamond-Bold": { ascent: 0.65380859375, descent: 0.26318359375 },
    "Garamond-Italic": { ascent: 0.65380859375, descent: 0.26318359375 },
    "GentiumBasic": { ascent: 0.8740234375, descent: 0.283203125, capHeight: 0.615234375 },
    "GentiumBasic-Bold": { ascent: 0.8740234375, descent: 0.283203125, capHeight: 0.615234375 },
    "GentiumBasic-BoldItalic": { ascent: 0.8740234375, descent: 0.283203125, capHeight: 0.615234375 },
    "GentiumBasic-Italic": { ascent: 0.8740234375, descent: 0.283203125, capHeight: 0.615234375 },
    "GentiumBookBasic": { ascent: 0.8740234375, descent: 0.283203125, capHeight: 0.615234375 },
    "GentiumBookBasic-Bold": { ascent: 0.8740234375, descent: 0.283203125, capHeight: 0.615234375 },
    "GentiumBookBasic-BoldItalic": { ascent: 0.8740234375, descent: 0.283203125, capHeight: 0.615234375 },
    "GentiumBookBasic-Italic": { ascent: 0.8740234375, descent: 0.283203125, capHeight: 0.615234375 },
    "Georgia": { ascent: 0.75634765625, descent: 0.216796875, capHeight: 0.69287109375 },
    "Georgia-Bold": { ascent: 0.75634765625, descent: 0.216796875, capHeight: 0.69287109375 },
    "Georgia-BoldItalic": { ascent: 0.75634765625, descent: 0.216796875, capHeight: 0.69287109375 },
    "Georgia-Italic": { ascent: 0.75634765625, descent: 0.216796875, capHeight: 0.69287109375 },
    "Gigi-Regular": { ascent: 0.7958984375, descent: 0.38818359375 },
    "GillSans-UltraBold": { ascent: 0.7568359375, descent: 0.1650390625 },
    "GillSans-UltraBoldCondensed": { ascent: 0.75390625, descent: 0.1640625 },
    "GillSansMT": { ascent: 0.69091796875, descent: 0.22998046875 },
    "GillSansMT-Bold": { ascent: 0.69091796875, descent: 0.22998046875 },
    "GillSansMT-BoldItalic": { ascent: 0.69091796875, descent: 0.22998046875 },
    "GillSansMT-Condensed": { ascent: 0.69189453125, descent: 0.2451171875 },
    "GillSansMT-ExtraCondensedBold": { ascent: 0.80224609375, descent: 0.11669921875 },
    "GillSansMT-Italic": { ascent: 0.69091796875, descent: 0.22998046875 },
    "GloucesterMT-ExtraCondensed": { ascent: 0.76953125, descent: 0.16015625 },
    "GoudyOldStyleT-Bold": { ascent: 0.89453125, descent: 0.2373046875 },
    "GoudyOldStyleT-Italic": { ascent: 0.89453125, descent: 0.2373046875 },
    "GoudyOldStyleT-Regular": { ascent: 0.89453125, descent: 0.2373046875 },
    "GoudyStout": { ascent: 0.7451171875, descent: 0.0185546875 },
    "HYYeYXSJ": { ascent: 0.859375, descent: 0.140625 },
    "HYZhongYuanB5": { ascent: 0.7998046875, descent: 0.19921875 },
    "Haettenschweiler": { ascent: 0.7001953125, descent: 0.1201171875 },
    "HarlowSolid": { ascent: 0.87451171875, descent: 0.38818359375 },
    "Harrington": { ascent: 0.9453125, descent: 0.23046875 },
    "HighTowerText-Italic": { ascent: 0.7998046875, descent: 0.2001953125 },
    "HighTowerText-Reg": { ascent: 0.740234375, descent: 0.259765625 },
    "Impact": { ascent: 0.79052734375, descent: 0.11181640625, capHeight: 0.79052734375 },
    "ImprintMT-Shadow": { ascent: 0.701171875, descent: 0.240234375 },
    "InformalRoman-Regular": { ascent: 0.75, descent: 0.25 },
    "InkFree": { ascent: 0.665, descent: 0.199, capHeight: 0.817 },
    "JavaneseText": { ascent: 0.72021484375, descent: 0.27734375, capHeight: 0.70947265625 },
    "Jokerman-Regular": { ascent: 0.8671875, descent: 0.31884765625 },
    "JuiceITC-Regular": { ascent: 0.759765625, descent: 0.240234375 },
    "KacstBook": { ascent: 0.78125, descent: 0.29296875 },
    "KacstOffice": { ascent: 0.78125, descent: 0.29296875 },
    "KaiTi": { ascent: 0.859375, descent: 0.140625, capHeight: 0.6875 },
    "KingsoftUE": { ascent: 0.77099609375, descent: 0.205078125 },
    "KristenITC-Regular": { ascent: 1.02783203125, descent: 0.33203125 },
    "KunstlerScript": { ascent: 0.5341796875, descent: 0.24072265625 },
    "LatinWide": { ascent: 0.7001953125, descent: 0.22216796875 },
    "LeelawadeeUI": { ascent: 0.72802734375, descent: 0.21044921875, capHeight: 0.7001953125 },
    "LeelawadeeUI-Bold": { ascent: 0.72802734375, descent: 0.21044921875, capHeight: 0.7001953125 },
    "LeelawadeeUI-Semilight": { ascent: 0.72802734375, descent: 0.21044921875, capHeight: 0.7001953125 },
    "LiSu": { ascent: 0.859375, descent: 0.140625 },
    "LiberationMono": { ascent: 0.61279296875, descent: 0.1884765625, capHeight: 0.65869140625 },
    "LiberationMono-Bold": { ascent: 0.63330078125, descent: 0.208984375, capHeight: 0.65869140625 },
    "LiberationMono-BoldItalic": { ascent: 0.63330078125, descent: 0.208984375, capHeight: 0.65869140625 },
    "LiberationMono-Italic": { ascent: 0.61279296875, descent: 0.1884765625, capHeight: 0.65869140625 },
    "LiberationSans": { ascent: 0.72802734375, descent: 0.21044921875, capHeight: 0.68798828125 },
    "LiberationSans-Bold": { ascent: 0.72802734375, descent: 0.21044921875, capHeight: 0.68798828125 },
    "LiberationSans-BoldItalic": { ascent: 0.72802734375, descent: 0.21044921875, capHeight: 0.68798828125 },
    "LiberationSans-Italic": { ascent: 0.72802734375, descent: 0.20751953125, capHeight: 0.68798828125 },
    "LiberationSansNarrow": { ascent: 0.72802734375, descent: 0.21044921875, capHeight: 0.68798828125 },
    "LiberationSansNarrow-Bold": { ascent: 0.72802734375, descent: 0.21044921875, capHeight: 0.68798828125 },
    "LiberationSansNarrow-BoldItalic": { ascent: 0.72802734375, descent: 0.21044921875, capHeight: 0.68798828125 },
    "LiberationSansNarrow-Italic": { ascent: 0.72802734375, descent: 0.21044921875, capHeight: 0.68798828125 },
    "LiberationSerif": { ascent: 0.693359375, descent: 0.2158203125, capHeight: 0.65478515625 },
    "LiberationSerif-Bold": { ascent: 0.67724609375, descent: 0.2158203125, capHeight: 0.65478515625 },
    "LiberationSerif-BoldItalic": { ascent: 0.67724609375, descent: 0.2158203125, capHeight: 0.65478515625 },
    "LiberationSerif-Italic": { ascent: 0.6943359375, descent: 0.2158203125, capHeight: 0.65478515625 },
    "LinuxBiolinumG": { ascent: 0.89404296875, descent: 0.24609375 },
    "LinuxBiolinumGB": { ascent: 0.89404296875, descent: 0.24609375 },
    "LinuxBiolinumGI": { ascent: 0.89404296875, descent: 0.24609375 },
    "LinuxLibertineDG": { ascent: 0.89404296875, descent: 0.24609375 },
    "LinuxLibertineG": { ascent: 0.89404296875, descent: 0.24609375 },
    "LinuxLibertineGB": { ascent: 0.89404296875, descent: 0.24609375 },
    "LinuxLibertineGBI": { ascent: 0.89404296875, descent: 0.24609375 },
    "LinuxLibertineGI": { ascent: 0.89404296875, descent: 0.24609375 },
    "LinuxLibertineGZ": { ascent: 0.89404296875, descent: 0.24609375 },
    "LinuxLibertineGZI": { ascent: 0.89404296875, descent: 0.24609375 },
    "LucidaBright": { ascent: 0.77099609375, descent: 0.205078125 },
    "LucidaBright-Demi": { ascent: 0.77099609375, descent: 0.205078125 },
    "LucidaBright-DemiItalic": { ascent: 0.77099609375, descent: 0.205078125 },
    "LucidaBright-Italic": { ascent: 0.77099609375, descent: 0.205078125 },
    "LucidaCalligraphy-Italic": { ascent: 0.85546875, descent: 0.3251953125 },
    "LucidaConsole": { ascent: 0.783203125, descent: 0.205078125 },
    "LucidaFax": { ascent: 0.77099609375, descent: 0.205078125 },
    "LucidaFax-Demi": { ascent: 0.77099609375, descent: 0.205078125 },
    "LucidaFax-DemiItalic": { ascent: 0.77099609375, descent: 0.205078125 },
    "LucidaFax-Italic": { ascent: 0.77099609375, descent: 0.205078125 },
    "LucidaHandwriting-Italic": { ascent: 0.85546875, descent: 0.3251953125 },
    "LucidaSans": { ascent: 0.77099609375, descent: 0.205078125 },
    "LucidaSans-Demi": { ascent: 0.77099609375, descent: 0.205078125 },
    "LucidaSans-DemiItalic": { ascent: 0.77099609375, descent: 0.205078125 },
    "LucidaSans-Italic": { ascent: 0.77099609375, descent: 0.205078125 },
    "LucidaSans-Typewriter": { ascent: 0.77099609375, descent: 0.205078125 },
    "LucidaSans-TypewriterBold": { ascent: 0.77099609375, descent: 0.205078125 },
    "LucidaSans-TypewriterBoldOblique": { ascent: 0.77099609375, descent: 0.205078125 },
    "LucidaSans-TypewriterOblique": { ascent: 0.77099609375, descent: 0.205078125 },
    "LucidaSansUnicode": { ascent: 0.783203125, descent: 0.20458984375 },
    "MS-Gothic": { ascent: 0.859375, descent: 0.140625, capHeight: 0.6796875 },
    "MSOutlook": { ascent: 0.7998046875, descent: 0.2001953125 },
    "MSReferenceSansSerif": { ascent: 0.7646484375, descent: 0.20654296875 },
    "MSReferenceSpecialty": { ascent: 1.0126953125, descent: 0.21484375 },
    "MT-Extra": { ascent: 0.896, descent: 0.2 },
    "MVBoli": { ascent: 0.71484375, descent: 0.22607421875, capHeight: 0.71484375 },
    "Magneto-Bold": { ascent: 0.79736328125, descent: 0.20263671875 },
    "MaiandraGD-Regular": { ascent: 0.759765625, descent: 0.240234375 },
    "MalgunGothic": { ascent: 0.7998046875, descent: 0.2001953125, capHeight: 0.71826171875 },
    "MalgunGothic-Semilight": { ascent: 0.7998046875, descent: 0.2001953125, capHeight: 0.71826171875 },
    "MalgunGothicBold": { ascent: 0.7998046875, descent: 0.2001953125, capHeight: 0.7177734375 },
    "MaturaMTScriptCapitals": { ascent: 0.626953125, descent: 0.27734375 },
    "Microsoft Himalaya": { ascent: 0.591796875, descent: 0.408203125, capHeight: 0.44384765625 },
    "Microsoft-Yi-Baiti": { ascent: 0.859375, descent: 0.1416015625, capHeight: 0.5390625 },
    "MicrosoftJhengHeiBold": { ascent: 0.89013671875, descent: 0.10986328125, capHeight: 0.75634765625 },
    "MicrosoftJhengHeiLight": { ascent: 0.89013671875, descent: 0.10986328125, capHeight: 0.75634765625 },
    "MicrosoftJhengHeiRegular": { ascent: 0.89013671875, descent: 0.10986328125, capHeight: 0.75634765625 },
    "MicrosoftNewTaiLue": { ascent: 0.7509765625, descent: 0.2353515625, capHeight: 0.7001953125 },
    "MicrosoftNewTaiLue-Bold": { ascent: 0.751953125, descent: 0.23486328125, capHeight: 0.7001953125 },
    "MicrosoftPhagsPa": { ascent: 0.72802734375, descent: 0.21044921875, capHeight: 0.7001953125 },
    "MicrosoftPhagsPa-Bold": { ascent: 0.72802734375, descent: 0.21044921875, capHeight: 0.7001953125 },
    "MicrosoftSansSerif": { ascent: 0.72802734375, descent: 0.21044921875, capHeight: 0.7158203125 },
    "MicrosoftTaiLe": { ascent: 0.7509765625, descent: 0.2353515625, capHeight: 0.7001953125 },
    "MicrosoftTaiLe-Bold": { ascent: 0.751953125, descent: 0.23486328125, capHeight: 0.7001953125 },
    "MicrosoftYaHei": { ascent: 0.81201171875, descent: 0.25341796875, capHeight: 0.75634765625 },
    "MicrosoftYaHei-Bold": { ascent: 0.81201171875, descent: 0.25341796875, capHeight: 0.75634765625 },
    "MicrosoftYaHeiLight": { ascent: 0.80810546875, descent: 0.25341796875, capHeight: 0.75634765625 },
    "MingLiU-ExtB": { ascent: 0.80078125, descent: 0.19921875, capHeight: 0.6591796875 },
    "MiriamCLM-Bold": { ascent: 0.8, descent: 0.2 },
    "MiriamCLM-Book": { ascent: 0.8, descent: 0.2 },
    "MiriamLibre-Bold": { ascent: 0.969, descent: 0.344, capHeight: 0.715 },
    "MiriamLibre-Regular": { ascent: 0.969, descent: 0.344, capHeight: 0.695 },
    "MiriamMonoCLM-Bold": { ascent: 0.8, descent: 0.2 },
    "MiriamMonoCLM-BoldOblique": { ascent: 0.8, descent: 0.2 },
    "MiriamMonoCLM-Book": { ascent: 0.8, descent: 0.2 },
    "MiriamMonoCLM-BookOblique": { ascent: 0.8, descent: 0.2 },
    "Mistral": { ascent: 0.65625, descent: 0.24658203125 },
    "Modern-Regular": { ascent: 0.653, descent: 0.209 },
    "MongolianBaiti": { ascent: 0.84423828125, descent: 0.21923828125, capHeight: 0.72265625 },
    "MonotypeCorsiva": { ascent: 0.68896484375, descent: 0.2587890625 },
    "MyanmarText": { ascent: 0.6708984375, descent: 0.3291015625, capHeight: 0.7001953125 },
    "MyanmarText-Bold": { ascent: 0.72802734375, descent: 0.3291015625, capHeight: 0.7001953125 },
    "NachlieliCLM-Bold": { ascent: 0.8, descent: 0.2, capHeight: 0.6688073394495413 },
    "NachlieliCLM-BoldOblique": { ascent: 0.8, descent: 0.2, capHeight: 0.6688073394495413 },
    "NachlieliCLM-Light": { ascent: 0.8, descent: 0.2, capHeight: 0.6688073394495413 },
    "NachlieliCLM-LightOblique": { ascent: 0.8, descent: 0.2, capHeight: 0.6688073394495413 },
    "NiagaraEngraved-Reg": { ascent: 0.7998046875, descent: 0.2001953125 },
    "NiagaraSolid-Reg": { ascent: 0.7998046875, descent: 0.2001953125 },
    "NirmalaUI": { ascent: 0.72802734375, descent: 0.21044921875, capHeight: 0.7001953125 },
    "NirmalaUI-Bold": { ascent: 0.72802734375, descent: 0.21044921875, capHeight: 0.7001953125 },
    "NirmalaUI-Semilight": { ascent: 0.72802734375, descent: 0.21044921875, capHeight: 0.70166015625 },
    "NotoKufiArabic": { ascent: 1.27197265625, descent: 0.54833984375, capHeight: 1.27197265625 },
    "NotoKufiArabic-Bold": { ascent: 1.28173828125, descent: 0.615234375, capHeight: 1.28173828125 },
    "NotoMono": { ascent: 0.927734375, descent: 0.244140625, capHeight: 0.7138671875 },
    "NotoNaskhArabic": { ascent: 1.06884765625, descent: 0.6337890625 },
    "NotoNaskhArabic-Bold": { ascent: 1.06884765625, descent: 0.6337890625 },
    "NotoNaskhArabicUI": { ascent: 1.06884765625, descent: 0.29296875 },
    "NotoNaskhArabicUI-Bold": { ascent: 1.06884765625, descent: 0.29296875 },
    "NotoSans-Bold": { ascent: 1.069, descent: 0.293, capHeight: 0.714 },
    "NotoSans-BoldItalic": { ascent: 1.069, descent: 0.293, capHeight: 0.714 },
    "NotoSans-Condensed": { ascent: 1.069, descent: 0.293, capHeight: 0.714 },
    "NotoSans-CondensedBold": { ascent: 1.069, descent: 0.293, capHeight: 0.714 },
    "NotoSans-CondensedBoldItalic": { ascent: 1.069, descent: 0.293, capHeight: 0.714 },
    "NotoSans-CondensedItalic": { ascent: 1.069, descent: 0.293, capHeight: 0.714 },
    "NotoSans-Italic": { ascent: 1.069, descent: 0.293, capHeight: 0.714 },
    "NotoSans-Light": { ascent: 1.069, descent: 0.293, capHeight: 0.714 },
    "NotoSans-LightItalic": { ascent: 1.069, descent: 0.293, capHeight: 0.714 },
    "NotoSans-Regular": { ascent: 1.069, descent: 0.293, capHeight: 0.714 },
    "NotoSansArabic-Bold": { ascent: 1.374, descent: 0.738, capHeight: 0.5 },
    "NotoSansArabic-Regular": { ascent: 1.374, descent: 0.738, capHeight: 0.416 },
    "NotoSansArabicUI-Bold": { ascent: 1.069, descent: 0.293, capHeight: 0.714 },
    "NotoSansArabicUI-Regular": { ascent: 1.069, descent: 0.293, capHeight: 0.714 },
    "NotoSansArmenian-Bold": { ascent: 1.069, descent: 0.293, capHeight: 0.714 },
    "NotoSansArmenian-Regular": { ascent: 1.069, descent: 0.293, capHeight: 0.714 },
    "NotoSansGeorgian-Bold": { ascent: 1.069, descent: 0.293, capHeight: 0.714 },
    "NotoSansGeorgian-Regular": { ascent: 1.069, descent: 0.293, capHeight: 0.714 },
    "NotoSansHebrew-Bold": { ascent: 1.069, descent: 0.293, capHeight: 0.714 },
    "NotoSansHebrew-Regular": { ascent: 1.069, descent: 0.293, capHeight: 0.714 },
    "NotoSansLao-Bold": { ascent: 1.183, descent: 0.462, capHeight: 0.714 },
    "NotoSansLao-Regular": { ascent: 1.183, descent: 0.462, capHeight: 0.714 },
    "NotoSansLisu-Regular": { ascent: 1.069, descent: 0.293, capHeight: 0.714 },
    "NotoSerif-Bold": { ascent: 1.068, descent: 0.292, capHeight: 0.714 },
    "NotoSerif-BoldItalic": { ascent: 1.068, descent: 0.292, capHeight: 0.714 },
    "NotoSerif-Condensed": { ascent: 1.068, descent: 0.292, capHeight: 0.714 },
    "NotoSerif-CondensedBold": { ascent: 1.068, descent: 0.292, capHeight: 0.714 },
    "NotoSerif-CondensedBoldItalic": { ascent: 1.068, descent: 0.292, capHeight: 0.714 },
    "NotoSerif-CondensedItalic": { ascent: 1.068, descent: 0.292, capHeight: 0.714 },
    "NotoSerif-Italic": { ascent: 1.068, descent: 0.292, capHeight: 0.714 },
    "NotoSerif-Light": { ascent: 1.068, descent: 0.292, capHeight: 0.714 },
    "NotoSerif-LightItalic": { ascent: 1.068, descent: 0.292, capHeight: 0.714 },
    "NotoSerif-Regular": { ascent: 1.068, descent: 0.292, capHeight: 0.714 },
    "NotoSerifArmenian-Bold": { ascent: 1.068, descent: 0.292, capHeight: 0.714 },
    "NotoSerifArmenian-Regular": { ascent: 1.068, descent: 0.292, capHeight: 0.714 },
    "NotoSerifGeorgian-Bold": { ascent: 1.068, descent: 0.292, capHeight: 0.714 },
    "NotoSerifGeorgian-Regular": { ascent: 1.068, descent: 0.292, capHeight: 0.714 },
    "NotoSerifHebrew-Bold": { ascent: 0.896, descent: 0.29, capHeight: 0.714 },
    "NotoSerifHebrew-Regular": { ascent: 0.896, descent: 0.29, capHeight: 0.714 },
    "NotoSerifLao-Bold": { ascent: 1.174, descent: 0.482, capHeight: 0.714 },
    "NotoSerifLao-Regular": { ascent: 1.174, descent: 0.482, capHeight: 0.714 },
    "OCRAExtended": { ascent: 0.64892578125, descent: 0.17578125 },
    "OldEnglishTextMT": { ascent: 0.69970703125, descent: 0.138671875 },
    "Onyx": { ascent: 0.740234375, descent: 0.181640625 },
    "OpenSymbol": { ascent: 0.693359375, descent: 0.2158203125, capHeight: 0.65576171875 },
    "PalaceScriptMT": { ascent: 0.49462890625, descent: 0.244140625 },
    "PalatinoLinotype-Bold": { ascent: 0.73193359375, descent: 0.2841796875, capHeight: 0.7158203125 },
    "PalatinoLinotype-BoldItalic": { ascent: 0.73193359375, descent: 0.2841796875, capHeight: 0.7158203125 },
    "PalatinoLinotype-Italic": { ascent: 0.73193359375, descent: 0.2841796875, capHeight: 0.7158203125 },
    "PalatinoLinotype-Roman": { ascent: 0.73193359375, descent: 0.2841796875, capHeight: 0.7158203125 },
    "Papyrus-Regular": { ascent: 0.81591796875, descent: 0.4140625 },
    "Parchment-Regular": { ascent: 0.40625, descent: 0.14013671875 },
    "Perpetua": { ascent: 0.6279296875, descent: 0.30322265625 },
    "Perpetua-Bold": { ascent: 0.6279296875, descent: 0.30322265625 },
    "Perpetua-BoldItalic": { ascent: 0.6279296875, descent: 0.30322265625 },
    "Perpetua-Italic": { ascent: 0.6279296875, descent: 0.30322265625 },
    "PerpetuaTitlingMT-Bold": { ascent: 0.71923828125, descent: 0.14697265625 },
    "PerpetuaTitlingMT-Light": { ascent: 0.71923828125, descent: 0.13720703125 },
    "Playbill": { ascent: 0.66650390625, descent: 0.17138671875 },
    "PoorRichard-Regular": { ascent: 0.69677734375, descent: 0.2001953125 },
    "Pristina-Regular": { ascent: 0.81396484375, descent: 0.44091796875 },
    "RageItalic": { ascent: 0.64306640625, descent: 0.26513671875 },
    "Ravie": { ascent: 0.7998046875, descent: 0.2001953125 },
    "ReemKufi-Bold": { ascent: 1.1, descent: 0.4, capHeight: 0.736 },
    "ReemKufi-Regular": { ascent: 1.1, descent: 0.4, capHeight: 0.725 },
    "Rockwell": { ascent: 0.69287109375, descent: 0.22265625 },
    "Rockwell-Bold": { ascent: 0.69091796875, descent: 0.2197265625 },
    "Rockwell-BoldItalic": { ascent: 0.69287109375, descent: 0.22265625 },
    "Rockwell-Condensed": { ascent: 0.748046875, descent: 0.22412109375 },
    "Rockwell-CondensedBold": { ascent: 0.748046875, descent: 0.22412109375 },
    "Rockwell-ExtraBold": { ascent: 0.69287109375, descent: 0.21484375 },
    "Rockwell-Italic": { ascent: 0.69091796875, descent: 0.22265625 },
    "Rubik-Bold": { ascent: 0.75, descent: 0.225, capHeight: 0.7 },
    "Rubik-BoldItalic": { ascent: 0.75, descent: 0.225, capHeight: 0.7 },
    "Rubik-Italic": { ascent: 0.75, descent: 0.225, capHeight: 0.7 },
    "Rubik-Regular": { ascent: 0.75, descent: 0.225, capHeight: 0.7 },
    "STCaiyun": { ascent: 0.8, descent: 0.2 },
    "STFangsong": { ascent: 0.8, descent: 0.2 },
    "STHupo": { ascent: 0.8, descent: 0.2 },
    "STKaiti": { ascent: 0.8, descent: 0.2 },
    "STLiti": { ascent: 0.689, descent: 0.259 },
    "STSong": { ascent: 0.8, descent: 0.2 },
    "STXihei": { ascent: 0.8, descent: 0.2 },
    "STXingkai": { ascent: 0.8, descent: 0.2 },
    "STXinwei": { ascent: 0.8, descent: 0.2 },
    "STZhongsong": { ascent: 0.8, descent: 0.2 },
    "SansSerifCollection": { ascent: 1.621, descent: 0.838, capHeight: 0.8 },
    "Scheherazade-Bold": { ascent: 1.01123046875, descent: 0.6767578125, capHeight: 0.5048828125 },
    "Scheherazade-Regular": { ascent: 1.01123046875, descent: 0.6767578125, capHeight: 0.5048828125 },
    "ScriptMTBold": { ascent: 0.69580078125, descent: 0.2509765625 },
    "SegoePrint": { ascent: 0.85595703125, descent: 0.31201171875, capHeight: 0.6796875 },
    "SegoePrint-Bold": { ascent: 0.849609375, descent: 0.3115234375, capHeight: 0.6806640625 },
    "SegoeScript": { ascent: 0.7451171875, descent: 0.2412109375, capHeight: 0.67333984375 },
    "SegoeScript-Bold": { ascent: 0.74609375, descent: 0.2412109375, capHeight: 0.6806640625 },
    "SegoeUI": { ascent: 0.72802734375, descent: 0.21044921875, capHeight: 0.7001953125 },
    "SegoeUI-Bold": { ascent: 0.72802734375, descent: 0.21044921875, capHeight: 0.7001953125 },
    "SegoeUI-BoldItalic": { ascent: 0.72802734375, descent: 0.21044921875, capHeight: 0.7001953125 },
    "SegoeUI-Italic": { ascent: 0.72802734375, descent: 0.21044921875, capHeight: 0.7001953125 },
    "SegoeUI-Light": { ascent: 0.72802734375, descent: 0.21044921875, capHeight: 0.7001953125 },
    "SegoeUI-LightItalic": { ascent: 0.72802734375, descent: 0.21044921875, capHeight: 0.7001953125 },
    "SegoeUI-Semibold": { ascent: 0.72802734375, descent: 0.21044921875, capHeight: 0.7001953125 },
    "SegoeUI-SemiboldItalic": { ascent: 0.72802734375, descent: 0.21044921875, capHeight: 0.7001953125 },
    "SegoeUI-Semilight": { ascent: 0.72802734375, descent: 0.21044921875, capHeight: 0.7001953125 },
    "SegoeUI-SemilightItalic": { ascent: 0.72802734375, descent: 0.21044921875, capHeight: 0.7001953125 },
    "SegoeUIBlack": { ascent: 0.72802734375, descent: 0.21044921875, capHeight: 0.7001953125 },
    "SegoeUIBlack-Italic": { ascent: 0.740234375, descent: 0.22998046875, capHeight: 0.7001953125 },
    "SegoeUIEmoji": { ascent: 0.72802734375, descent: 0.21044921875, capHeight: 0.7001953125 },
    "SegoeUIHistoric": { ascent: 0.72802734375, descent: 0.21044921875, capHeight: 0.7001953125 },
    "SegoeUISymbol": { ascent: 0.72802734375, descent: 0.21044921875, capHeight: 0.7001953125 },
    "SegoeUIVariable": { ascent: 0.72802734375, descent: 0.21044921875, capHeight: 0.7001953125 },
    "ShowcardGothic-Reg": { ascent: 0.79736328125, descent: 0.20263671875 },
    "SimHei": { ascent: 0.859375, descent: 0.140625, capHeight: 0.6875 },
    "SimSun": { ascent: 0.859375, descent: 0.140625, capHeight: 0.68359375 },
    "SimSun-ExtB": { ascent: 0.859375, descent: 0.140625 },
    "SitkaText": { ascent: 0.7568888888888889, descent: 0.2431111111111111, capHeight: 0.6373333333333333 },
    "SitkaTextItalic": { ascent: 0.7568888888888889, descent: 0.2431111111111111, capHeight: 0.6595555555555556 },
    "SnapITC-Regular": { ascent: 0.759765625, descent: 0.240234375 },
    "SourceCodePro-Black": { ascent: 0.75, descent: 0.25, capHeight: 0.66 },
    "SourceCodePro-BlackIt": { ascent: 0.75, descent: 0.25, capHeight: 0.66 },
    "SourceCodePro-Bold": { ascent: 0.75, descent: 0.25, capHeight: 0.66 },
    "SourceCodePro-BoldIt": { ascent: 0.75, descent: 0.25, capHeight: 0.66 },
    "SourceCodePro-ExtraLight": { ascent: 0.75, descent: 0.25, capHeight: 0.66 },
    "SourceCodePro-ExtraLightIt": { ascent: 0.75, descent: 0.25, capHeight: 0.66 },
    "SourceCodePro-It": { ascent: 0.75, descent: 0.25, capHeight: 0.66 },
    "SourceCodePro-Light": { ascent: 0.75, descent: 0.25, capHeight: 0.66 },
    "SourceCodePro-LightIt": { ascent: 0.75, descent: 0.25, capHeight: 0.66 },
    "SourceCodePro-Medium": { ascent: 0.75, descent: 0.25, capHeight: 0.66 },
    "SourceCodePro-MediumIt": { ascent: 0.75, descent: 0.25, capHeight: 0.66 },
    "SourceCodePro-Regular": { ascent: 0.75, descent: 0.25, capHeight: 0.66 },
    "SourceCodePro-Semibold": { ascent: 0.75, descent: 0.25, capHeight: 0.66 },
    "SourceCodePro-SemiboldIt": { ascent: 0.75, descent: 0.25, capHeight: 0.66 },
    "SourceSansPro-Black": { ascent: 0.75, descent: 0.25, capHeight: 0.66 },
    "SourceSansPro-BlackIt": { ascent: 0.75, descent: 0.25, capHeight: 0.66 },
    "SourceSansPro-Bold": { ascent: 0.75, descent: 0.25, capHeight: 0.66 },
    "SourceSansPro-BoldIt": { ascent: 0.75, descent: 0.25, capHeight: 0.66 },
    "SourceSansPro-ExtraLight": { ascent: 0.75, descent: 0.25, capHeight: 0.66 },
    "SourceSansPro-ExtraLightIt": { ascent: 0.75, descent: 0.25, capHeight: 0.66 },
    "SourceSansPro-It": { ascent: 0.75, descent: 0.25, capHeight: 0.66 },
    "SourceSansPro-Light": { ascent: 0.75, descent: 0.25, capHeight: 0.66 },
    "SourceSansPro-LightIt": { ascent: 0.75, descent: 0.25, capHeight: 0.66 },
    "SourceSansPro-Regular": { ascent: 0.75, descent: 0.25, capHeight: 0.66 },
    "SourceSansPro-Semibold": { ascent: 0.75, descent: 0.25, capHeight: 0.66 },
    "SourceSansPro-SemiboldIt": { ascent: 0.75, descent: 0.25, capHeight: 0.66 },
    "SourceSerifPro-Black": { ascent: 1.036, descent: 0.335, capHeight: 0.67 },
    "SourceSerifPro-BlackIt": { ascent: 1.036, descent: 0.335, capHeight: 0.67 },
    "SourceSerifPro-Bold": { ascent: 1.036, descent: 0.335, capHeight: 0.67 },
    "SourceSerifPro-BoldIt": { ascent: 1.036, descent: 0.335, capHeight: 0.67 },
    "SourceSerifPro-ExtraLight": { ascent: 1.036, descent: 0.335, capHeight: 0.67 },
    "SourceSerifPro-ExtraLightIt": { ascent: 1.036, descent: 0.335, capHeight: 0.67 },
    "SourceSerifPro-It": { ascent: 1.036, descent: 0.335, capHeight: 0.67 },
    "SourceSerifPro-Light": { ascent: 1.036, descent: 0.335, capHeight: 0.67 },
    "SourceSerifPro-LightIt": { ascent: 1.036, descent: 0.335, capHeight: 0.67 },
    "SourceSerifPro-Regular": { ascent: 1.036, descent: 0.335, capHeight: 0.67 },
    "SourceSerifPro-Semibold": { ascent: 1.036, descent: 0.335, capHeight: 0.67 },
    "SourceSerifPro-SemiboldIt": { ascent: 1.036, descent: 0.335, capHeight: 0.67 },
    "Stencil": { ascent: 0.66650390625, descent: 0.2724609375 },
    "Sylfaen": { ascent: 0.7373046875, descent: 0.28125, capHeight: 0.6728515625 },
    "SymbolMT": { ascent: 0.693359375, descent: 0.2158203125 },
    "Tahoma": { ascent: 0.7646484375, descent: 0.20654296875, capHeight: 0.72705078125 },
    "Tahoma-Bold": { ascent: 0.7646484375, descent: 0.20654296875, capHeight: 0.72705078125 },
    "TempusSansITC": { ascent: 0.884765625, descent: 0.296875 },
    "TimesNewRomanPS-BoldItalicMT": { ascent: 0.67724609375, descent: 0.2158203125, capHeight: 0.662109375 },
    "TimesNewRomanPS-BoldMT": { ascent: 0.67724609375, descent: 0.2158203125, capHeight: 0.662109375 },
    "TimesNewRomanPS-ItalicMT": { ascent: 0.6943359375, descent: 0.2158203125, capHeight: 0.662109375 },
    "TimesNewRomanPSMT": { ascent: 0.693359375, descent: 0.2158203125, capHeight: 0.662109375 },
    "Trebuchet-BoldItalic": { ascent: 0.7373046875, descent: 0.205078125, capHeight: 0.71533203125 },
    "TrebuchetMS": { ascent: 0.7373046875, descent: 0.205078125, capHeight: 0.71533203125 },
    "TrebuchetMS-Bold": { ascent: 0.7373046875, descent: 0.205078125, capHeight: 0.71533203125 },
    "TrebuchetMS-Italic": { ascent: 0.7373046875, descent: 0.205078125, capHeight: 0.71533203125 },
    "TwCenMT-Bold": { ascent: 0.68994140625, descent: 0.18896484375 },
    "TwCenMT-BoldItalic": { ascent: 0.68994140625, descent: 0.18896484375 },
    "TwCenMT-Condensed": { ascent: 0.65283203125, descent: 0.18505859375 },
    "TwCenMT-CondensedBold": { ascent: 0.65283203125, descent: 0.18505859375 },
    "TwCenMT-CondensedExtraBold": { ascent: 0.68798828125, descent: 0.18505859375 },
    "TwCenMT-Italic": { ascent: 0.68994140625, descent: 0.18896484375 },
    "TwCenMT-Regular": { ascent: 0.68994140625, descent: 0.18896484375 },
    "Verdana": { ascent: 0.7646484375, descent: 0.20654296875, capHeight: 0.72705078125 },
    "Verdana-Bold": { ascent: 0.7646484375, descent: 0.20654296875, capHeight: 0.72705078125 },
    "Verdana-BoldItalic": { ascent: 0.7646484375, descent: 0.20654296875, capHeight: 0.72705078125 },
    "Verdana-Italic": { ascent: 0.7646484375, descent: 0.20654296875, capHeight: 0.72705078125 },
    "VinerHandITC": { ascent: 0.77783203125, descent: 0.615234375 },
    "Vivaldii": { ascent: 0.90380859375, descent: 0.28564453125 },
    "VladimirScript": { ascent: 0.6025390625, descent: 0.29833984375 },
    "Webdings": { ascent: 0.7998046875, descent: 0.2001953125 },
    "Wingdings-Regular": { ascent: 0.77099609375, descent: 0.205078125 },
    "Wingdings2": { ascent: 0.77099609375, descent: 0.205078125 },
    "Wingdings3": { ascent: 0.77099609375, descent: 0.205078125 },
    "YouYuan": { ascent: 0.859375, descent: 0.140625 },
    "YuGothic-Bold": { ascent: 0.8798828125, descent: 0.1201171875, capHeight: 0.77392578125 },
    "YuGothic-Light": { ascent: 0.8798828125, descent: 0.1201171875, capHeight: 0.75390625 },
    "YuGothic-Medium": { ascent: 0.8798828125, descent: 0.1201171875, capHeight: 0.77197265625 },
    "YuGothic-Regular": { ascent: 0.8798828125, descent: 0.1201171875, capHeight: 0.7509765625 }
  };

  // src/text.ts
  function isCjkFont(family) {
    return /[\u4e00-\u9fff]/.test(family) || /^(PingFang|Source Han|思源|微软雅黑|Microsoft YaHei|SimSun|SimHei|宋体|黑体|等线|DengXian|方正|FZ|汉仪|HY)/.test(family);
  }
  function normalizeFontKey(s) {
    return s.toLowerCase().replace(/[\s\-_]+/g, "");
  }
  function toPsdFontName(family, style) {
    const fam = family || "Arial";
    const sty = style || "Regular";
    const exactFam = FONT_PS_NAME_MAP[fam];
    if (exactFam && exactFam[sty]) return exactFam[sty];
    if (exactFam) {
      const styleEntries = Object.keys(exactFam);
      const want = normalizeFontKey(sty);
      for (const s of styleEntries) {
        if (normalizeFontKey(s) === want) return exactFam[s];
      }
      if (styleEntries.length === 1) return exactFam[styleEntries[0]];
    }
    const wantFam = normalizeFontKey(fam);
    const wantSty = normalizeFontKey(sty);
    for (const keyFam of Object.keys(FONT_PS_NAME_MAP)) {
      if (normalizeFontKey(keyFam) === wantFam) {
        const styles = FONT_PS_NAME_MAP[keyFam];
        for (const s of Object.keys(styles)) {
          if (normalizeFontKey(s) === wantSty) return styles[s];
        }
        if (Object.keys(styles).length === 1) return styles[Object.keys(styles)[0]];
        break;
      }
    }
    return fam.replace(/\s+/g, "") + "-" + sty.replace(/\s+/g, "");
  }
  function getFontAscentRatio(family, style) {
    const psName = toPsdFontName(family, style);
    const m = FONT_METRICS_MAP[psName];
    if (m && m.ascent > 0) return m.ascent;
    return isCjkFont(family || "") ? 0.88 : 0.72;
  }
  function getFontCapHeightRatio(family, style) {
    const psName = toPsdFontName(family, style);
    const m = FONT_METRICS_MAP[psName];
    if (m && m.capHeight && m.capHeight > 0) return m.capHeight;
    return isCjkFont(family || "") ? 0.88 : 0.7;
  }
  function getFontDescentRatio(family, style) {
    const psName = toPsdFontName(family, style);
    const m = FONT_METRICS_MAP[psName];
    if (m && m.descent > 0 && m.descent < 1) return m.descent;
    return isCjkFont(family || "") ? 0.12 : 0.2;
  }
  function isAscenderLower(char) {
    return /[bdfhkl]/.test(char);
  }
  function getTopToBaselineRatio(family, style, text) {
    const ascent = getFontAscentRatio(family, style);
    const cap = getFontCapHeightRatio(family, style);
    let hasCjk = false;
    let hasAscender = false;
    for (const ch of text || "") {
      const code = ch.codePointAt(0) || 0;
      if (isCjkFallbackChar(code) || code >= 19968 && code <= 40959) hasCjk = true;
      if (isAscenderLower(ch)) hasAscender = true;
    }
    if (hasCjk) return ascent;
    if (hasAscender) return ascent;
    return cap !== void 0 ? cap : ascent;
  }
  function isCjkFallbackChar(code) {
    return code >= 11904 && code <= 12031 || // CJK 部首
    code >= 12288 && code <= 12351 || // CJK 标点
    code >= 12352 && code <= 12543 || // 假名
    code >= 12736 && code <= 12783 || // CJK 笔画
    code >= 12800 && code <= 40959 || // 带圈汉字 / CJK 统一表意文字
    code >= 63744 && code <= 64255 || // CJK 兼容表意文字
    code >= 65072 && code <= 65103 || // CJK 兼容形式
    code >= 65280 && code <= 65519 || // 全角/半角形式（含 ￥ U+FFE5）
    code >= 44032 && code <= 55215;
  }
  function pickCjkFallbackFont() {
    const candidates = ["\u5B8B\u4F53", "SimSun", "\u7B49\u7EBF", "DengXian", "\u5FAE\u8F6F\u96C5\u9ED1", "Microsoft YaHei"];
    for (const fam of candidates) {
      const styles = FONT_PS_NAME_MAP[fam];
      if (styles) {
        const name = styles["Regular"] || Object.values(styles)[0];
        if (name) return { name, script: 3, type: 2 };
      }
    }
    return { name: "SimSun", script: 3, type: 2 };
  }
  function splitByFontFallback(text, primaryIsCjk, primaryFont, fallbackFont) {
    if (!text) return [];
    if (primaryIsCjk) return [{ length: text.length, font: primaryFont }];
    const runs = [];
    let i = 0;
    while (i < text.length) {
      const code = text.codePointAt(i) || 0;
      const unitLen = code > 65535 ? 2 : 1;
      const font = isCjkFallbackChar(code) ? fallbackFont : primaryFont;
      const last = runs[runs.length - 1];
      if (last && last.font.name === font.name) last.length += unitLen;
      else runs.push({ length: unitLen, font });
      i += unitLen;
    }
    return runs;
  }
  function getSegments(node) {
    try {
      const segs = node.getStyledTextSegments([
        "fontName",
        "fontSize",
        "fills",
        "letterSpacing",
        "lineHeight",
        "textDecoration",
        "textCase"
      ]);
      if (segs && segs.length) return segs;
    } catch (err) {
      console.warn("\u8BFB\u53D6\u6587\u672C\u6837\u5F0F\u5206\u6BB5\u5931\u8D25\uFF0C\u4F7F\u7528\u8282\u70B9\u7EA7\u6837\u5F0F:", err);
    }
    const pick = (v, d) => v === figma.mixed ? d : v;
    return [{
      characters: node.characters,
      start: 0,
      end: node.characters.length,
      fontName: pick(node.fontName, { family: "Arial", style: "Regular" }),
      fontSize: pick(node.fontSize, 16),
      fills: pick(node.fills, []),
      letterSpacing: pick(node.letterSpacing, { unit: "PIXELS", value: 0 }),
      lineHeight: pick(node.lineHeight, { unit: "AUTO" }),
      textDecoration: pick(node.textDecoration, "NONE"),
      textCase: pick(node.textCase, "ORIGINAL")
    }];
  }
  function round1(v) {
    return Math.round(v * 10) / 10;
  }
  function solidColor(fills) {
    const solid = Array.isArray(fills) ? fills.find((f) => f.visible !== false && f.type === "SOLID") : void 0;
    if (!solid) return { r: 0, g: 0, b: 0, a: 1 };
    return {
      r: solid.color.r,
      g: solid.color.g,
      b: solid.color.b,
      a: solid.opacity !== void 0 ? solid.opacity : 1
    };
  }
  function toTracking(ls, fontSize) {
    if (!ls || !ls.value) return 0;
    if (ls.unit === "PERCENT") return Math.round(ls.value * 10);
    return fontSize > 0 ? Math.round(ls.value / fontSize * 1e3) : 0;
  }
  function toLeading(lh, fontSize) {
    if (!lh || lh.unit === "AUTO") return void 0;
    if (lh.unit === "PERCENT") return round1(lh.value / 100 * fontSize);
    return round1(lh.value);
  }
  function applyTextCase(chars, textCase) {
    if (textCase === "UPPER") return { text: chars, fontCaps: 2 };
    if (textCase === "SMALL_CAPS" || textCase === "SMALL_CAPS_FORCED") return { text: chars, fontCaps: 1 };
    let out = chars;
    if (textCase === "LOWER") out = chars.toLowerCase();
    else if (textCase === "TITLE") out = chars.replace(/(^|[\s\-])(\S)/g, (_m, sep, c) => sep + c.toUpperCase());
    return { text: out.length === chars.length ? out : chars, fontCaps: 0 };
  }
  function sameRunStyle(a, b) {
    return a.fontName === b.fontName && a.fontSize === b.fontSize && a.tracking === b.tracking && a.leading === b.leading && a.underline === b.underline && a.strikethrough === b.strikethrough && a.fontCaps === b.fontCaps && a.color.r === b.color.r && a.color.g === b.color.g && a.color.b === b.color.b && a.color.a === b.color.a;
  }
  async function parseTextNode(node, scale, fallbackName, lineCount) {
    const segments = getSegments(node);
    const fallbackFont = pickCjkFallbackFont();
    let text = "";
    const runs = [];
    let firstLineMax = null;
    let inFirstLine = true;
    for (const seg of segments) {
      const family = seg.fontName.family || "Arial";
      const style = seg.fontName.style || "Regular";
      const fontSize = typeof seg.fontSize === "number" ? seg.fontSize : 16;
      const isCjk = isCjkFont(family);
      const primaryFont = { name: toPsdFontName(family, style), script: isCjk ? 3 : 0, type: isCjk ? 2 : 0 };
      const cased = applyTextCase(seg.characters.replace(/\u2028/g, "\n"), seg.textCase);
      text += cased.text;
      if (inFirstLine) {
        const nl = cased.text.indexOf("\n");
        const lineText = nl >= 0 ? cased.text.slice(0, nl) : cased.text;
        if (lineText.length && (!firstLineMax || fontSize > firstLineMax.size)) {
          firstLineMax = { size: fontSize, family, style, text: lineText };
        } else if (firstLineMax && fontSize === firstLineMax.size) {
          firstLineMax.text += lineText;
        }
        if (nl >= 0) inFirstLine = false;
      }
      const decoration = seg.textDecoration;
      const common = {
        fontSize: round1(fontSize),
        color: solidColor(seg.fills),
        tracking: toTracking(seg.letterSpacing, fontSize),
        leading: toLeading(seg.lineHeight, fontSize),
        underline: decoration === "UNDERLINE",
        strikethrough: decoration === "STRIKETHROUGH",
        fontCaps: cased.fontCaps
      };
      for (const part of splitByFontFallback(cased.text, isCjk, primaryFont, fallbackFont)) {
        const run = {
          length: part.length,
          fontName: part.font.name,
          fontScript: part.font.script,
          fontType: part.font.type,
          ...common
        };
        const last = runs[runs.length - 1];
        if (last && sameRunStyle(last, run)) last.length += run.length;
        else runs.push(run);
      }
    }
    if (!text) text = fallbackName;
    const first = runs[0] || {
      length: text.length,
      fontName: "ArialMT",
      fontScript: 0,
      fontType: 0,
      fontSize: 16,
      color: { r: 0, g: 0, b: 0, a: 1 },
      tracking: 0,
      leading: void 0,
      underline: false,
      strikethrough: false,
      fontCaps: 0
    };
    const firstSeg = segments[0];
    const baseFamily = firstLineMax ? firstLineMax.family : firstSeg ? firstSeg.fontName.family : "Arial";
    const baseStyle = firstLineMax ? firstLineMax.style : firstSeg ? firstSeg.fontName.style : "Regular";
    const baseSize = firstLineMax ? firstLineMax.size : first.fontSize;
    let align = "left";
    if (node.textAlignHorizontal === "CENTER") align = "center";
    else if (node.textAlignHorizontal === "RIGHT") align = "right";
    else if (node.textAlignHorizontal === "JUSTIFIED") align = "justify-all";
    const autoResize = node.textAutoResize;
    const hasHardBreak = text.indexOf("\n") >= 0;
    const fitsOneLine = lineCount !== void 0 && lineCount <= 1 && !hasHardBreak;
    const shapeType = autoResize === "WIDTH_AND_HEIGHT" || fitsOneLine ? "point" : "box";
    const textAlignVertical = node.textAlignVertical === "CENTER" ? "center" : node.textAlignVertical === "BOTTOM" ? "bottom" : "top";
    return {
      text,
      fontName: first.fontName,
      fontScript: first.fontScript,
      fontType: first.fontType,
      fontSize: first.fontSize,
      fontSizeScaled: round1(baseSize * scale),
      ascentRatio: getTopToBaselineRatio(baseFamily, baseStyle, firstLineMax ? firstLineMax.text : text),
      descentRatio: getFontDescentRatio(baseFamily, baseStyle),
      shapeType,
      autoHeight: autoResize === "HEIGHT",
      multiLine: hasHardBreak,
      fontAscentRatio: getFontAscentRatio(baseFamily, baseStyle),
      textAlignVertical,
      color: first.color,
      align,
      letterSpacing: first.tracking || void 0,
      lineHeight: first.leading,
      // 字体名已解析为真实字重/斜体的 PostScript 名（如 Arial-BoldMT），
      // 再开仿粗体/仿斜体会在 PS 中二次加粗/倾斜，因此始终关闭
      fauxBold: false,
      fauxItalic: false,
      underline: first.underline,
      strikethrough: first.strikethrough,
      fontCaps: first.fontCaps,
      styleRuns: runs.length > 1 ? runs : void 0
    };
  }

  // src/vector.ts
  var VALID_PSD_BLEND_MODES = {
    "PASS_THROUGH": "pass through",
    "NORMAL": "normal",
    "DARKEN": "darken",
    "MULTIPLY": "multiply",
    "COLOR_BURN": "color burn",
    "LINEAR_BURN": "linear burn",
    "DARKER_COLOR": "darker color",
    "LIGHTEN": "lighten",
    "SCREEN": "screen",
    "COLOR_DODGE": "color dodge",
    "LINEAR_DODGE": "linear dodge",
    "LIGHTER_COLOR": "lighter color",
    "OVERLAY": "overlay",
    "SOFT_LIGHT": "soft light",
    "HARD_LIGHT": "hard light",
    "VIVID_LIGHT": "vivid light",
    "LINEAR_LIGHT": "linear light",
    "PIN_LIGHT": "pin light",
    "HARD_MIX": "hard mix",
    "DIFFERENCE": "difference",
    "EXCLUSION": "exclusion",
    "SUBTRACT": "subtract",
    "DIVIDE": "divide",
    "HUE": "hue",
    "SATURATION": "saturation",
    "COLOR": "color",
    "LUMINOSITY": "luminosity"
  };
  function convertBlendMode(mode, isGroup = false) {
    if (!mode || mode === "PASS_THROUGH") {
      return isGroup ? "pass through" : "normal";
    }
    const cleanMode = String(mode).toUpperCase().replace(/-/g, "_").replace(/ /g, "_");
    const mapped = VALID_PSD_BLEND_MODES[cleanMode];
    if (!mapped) return "normal";
    if (!isGroup && mapped === "pass through") return "normal";
    return mapped;
  }

  // src/exporter.ts
  function getNodeBlendMode(node) {
    return "blendMode" in node ? node.blendMode : "NORMAL";
  }
  function preciseRect(x, y, width, height, scale) {
    const r = (v) => Math.round(v * scale * 100) / 100;
    return { x: r(x), y: r(y), width: r(width), height: r(height) };
  }
  function scaleRect(r, scale) {
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
  async function renderContainerBackground(node, scale) {
    if (!hasOwnPaint(node)) return null;
    const src = node;
    let rect = null;
    try {
      rect = figma.createRectangle();
      rect.resize(Math.max(0.01, src.width), Math.max(0.01, src.height));
      rect.fills = src.fills;
      if ("strokes" in src) {
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
      if ("cornerRadius" in src) {
        if (src.cornerRadius !== figma.mixed) {
          rect.cornerRadius = src.cornerRadius;
        } else {
          rect.topLeftRadius = src.topLeftRadius;
          rect.topRightRadius = src.topRightRadius;
          rect.bottomLeftRadius = src.bottomLeftRadius;
          rect.bottomRightRadius = src.bottomRightRadius;
        }
        if (typeof src.cornerSmoothing === "number") rect.cornerSmoothing = src.cornerSmoothing;
      }
      if ("effects" in src && Array.isArray(src.effects)) rect.effects = src.effects;
      if ("rotation" in src && src.rotation) rect.rotation = src.rotation;
      const bytes = await rect.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: scale } });
      const box = rect.absoluteBoundingBox;
      const render = rect.absoluteRenderBounds;
      const offsetX = box && render ? render.x - box.x : 0;
      const offsetY = box && render ? render.y - box.y : 0;
      return { bytes, offsetX, offsetY };
    } catch (err) {
      console.warn(`\u5BB9\u5668 ${node.name} \u80CC\u666F\u6E32\u67D3\u5931\u8D25:`, err);
      return null;
    } finally {
      if (rect) rect.remove();
    }
  }
  async function measureTextLayout(node) {
    if ("rotation" in node && Math.abs(node.rotation) > 0.01) return null;
    let clone = null;
    try {
      const fonts = /* @__PURE__ */ new Map();
      for (const seg of node.getStyledTextSegments(["fontName"])) {
        fonts.set(seg.fontName.family + "\0" + seg.fontName.style, seg.fontName);
      }
      for (const f of fonts.values()) await figma.loadFontAsync(f);
      clone = node.clone();
      figma.currentPage.appendChild(clone);
      clone.x = 0;
      clone.y = 0;
      clone.effects = [];
      clone.strokes = [];
      clone.textAlignVertical = "TOP";
      if ("textTruncation" in clone && clone.textTruncation !== "DISABLED") clone.textTruncation = "DISABLED";
      if (clone.textAutoResize !== "WIDTH_AND_HEIGHT") clone.textAutoResize = "HEIGHT";
      const contentHeight = clone.height;
      clone.characters = "H";
      clone.textDecoration = "NONE";
      const lineHeight = clone.height;
      const box = clone.absoluteBoundingBox;
      const render = clone.absoluteRenderBounds;
      if (!box || !render || lineHeight <= 0) return null;
      const firstBaseline = render.y + render.height - box.y;
      let vOffset = 0;
      if (node.textAutoResize === "NONE" || node.textAutoResize === "TRUNCATE") {
        if (node.textAlignVertical === "CENTER") vOffset = (node.height - contentHeight) / 2;
        else if (node.textAlignVertical === "BOTTOM") vOffset = node.height - contentHeight;
      }
      return {
        baselineOffset: vOffset + firstBaseline,
        lines: Math.max(1, Math.round(contentHeight / lineHeight))
      };
    } catch (err) {
      console.warn(`\u6587\u672C ${node.name} \u57FA\u7EBF\u6D4B\u91CF\u5931\u8D25\uFF0C\u6539\u7528\u50CF\u7D20\u68C0\u6D4B:`, err);
      return null;
    } finally {
      if (clone) clone.remove();
    }
  }
  async function handleExportPSD(nodeId, scale = 1, exportMode = "hierarchical") {
    const targetNode = await figma.getNodeByIdAsync(nodeId);
    if (!targetNode) {
      figma.ui.postMessage({ type: "error", message: "\u627E\u4E0D\u5230\u6307\u5B9A\u7684\u753B\u677F/\u56FE\u5C42" });
      return;
    }
    const rootBounds = targetNode.absoluteBoundingBox;
    if (!rootBounds) {
      figma.ui.postMessage({ type: "error", message: "\u65E0\u6CD5\u83B7\u53D6\u753B\u677F\u5C3A\u5BF8" });
      return;
    }
    const docWidth = Math.round(rootBounds.width * scale);
    const docHeight = Math.round(rootBounds.height * scale);
    figma.ui.postMessage({ type: "status", status: "\u5BFC\u51FA\u4E3B\u753B\u677F\u5168\u5C40\u9884\u89C8\u56FE\u50CF\u4E2D..." });
    const rootCompositeBytes = await targetNode.exportAsync({
      format: "PNG",
      constraint: { type: "SCALE", value: scale },
      useAbsoluteBounds: true
    });
    const rootCompositeBase64 = uint8ToBase64(rootCompositeBytes);
    const exportLayers = [];
    const isRootMerge = typeof targetNode.name === "string" && targetNode.name.endsWith("-\u5408\u5E76");
    const rootLayerName = isRootMerge ? targetNode.name.slice(0, -"-\u5408\u5E76".length) : targetNode.name;
    if (isRootMerge) {
      exportLayers.push({
        id: targetNode.id + "_merged",
        name: rootLayerName,
        kind: "image",
        isGroup: false,
        visible: true,
        opacity: 1,
        blendMode: "normal",
        x: 0,
        y: 0,
        width: docWidth,
        height: docHeight,
        parentId: null,
        pngBase64: rootCompositeBase64
      });
      figma.ui.postMessage({ type: "status", status: '\u68C0\u6D4B\u5230 "-\u5408\u5E76" \u547D\u540D\uFF0C\u6574\u677F\u6805\u683C\u5316\u5BFC\u51FA\u4E2D...' });
      const payloadRootMerge = {
        artboardName: rootLayerName,
        width: docWidth,
        height: docHeight,
        scale,
        rootCompositePngBase64: rootCompositeBase64,
        layers: exportLayers
      };
      figma.ui.postMessage({ type: "export-data", ...payloadRootMerge });
      return;
    }
    if (hasOwnPaint(targetNode)) {
      figma.ui.postMessage({ type: "status", status: "\u6B63\u5728\u5355\u72EC\u6E32\u67D3\u753B\u677F\u80CC\u666F\u56FE\u5C42..." });
      const bg = await renderContainerBackground(targetNode, scale);
      if (bg) {
        exportLayers.push({
          id: targetNode.id + "_bg",
          name: "\u80CC\u666F",
          kind: "image",
          isGroup: false,
          visible: true,
          opacity: 1,
          blendMode: "normal",
          x: Math.round(bg.offsetX * scale),
          y: Math.round(bg.offsetY * scale),
          width: docWidth,
          height: docHeight,
          parentId: null,
          pngBase64: uint8ToBase64(bg.bytes)
        });
      }
    }
    const nodeList = [];
    collectNodes(targetNode, targetNode, rootBounds, nodeList, exportMode, null);
    const total = nodeList.length;
    figma.ui.postMessage({
      type: "status",
      status: `\u5F00\u59CB\u5904\u7406\u5206\u5C42 (\u5171 ${total} \u4E2A\u56FE\u5C42)...`
    });
    for (let i = 0; i < total; i++) {
      const item = nodeList[i];
      figma.ui.postMessage({
        type: "progress",
        current: i + 1,
        total,
        layerName: item.name
      });
      const common = {
        id: item.id,
        name: item.name,
        visible: item.visible,
        opacity: item.opacity !== void 0 ? item.opacity : 1,
        width: Math.round(item.width * scale),
        height: Math.round(item.height * scale),
        parentId: item.parentId,
        clip: scaleRect(item.clip, scale)
      };
      if (item.isGroup) {
        const groupLayer = {
          ...common,
          kind: "group",
          isGroup: true,
          blendMode: item.maskNode ? "pass through" : convertBlendMode(getNodeBlendMode(item.node), true),
          x: Math.round(item.x * scale),
          y: Math.round(item.y * scale)
        };
        if (item.maskNode) {
          try {
            const maskBytes = await item.maskNode.exportAsync({
              format: "PNG",
              constraint: { type: "SCALE", value: scale }
            });
            groupLayer.maskPngBase64 = uint8ToBase64(maskBytes);
            groupLayer.maskX = Math.round(item.renderX * scale);
            groupLayer.maskY = Math.round(item.renderY * scale);
            groupLayer.maskLuminance = "maskType" in item.maskNode && item.maskNode.maskType === "LUMINANCE";
          } catch (err) {
            console.warn(`\u8499\u7248 ${item.name} \u5BFC\u51FA\u5931\u8D25:`, err);
          }
        }
        exportLayers.push(groupLayer);
      } else if (item.isBackground) {
        const bg = await renderContainerBackground(item.node, scale);
        if (bg) {
          exportLayers.push({
            ...common,
            kind: "image",
            isGroup: false,
            blendMode: "normal",
            x: Math.round((item.x + bg.offsetX) * scale),
            y: Math.round((item.y + bg.offsetY) * scale),
            pngBase64: uint8ToBase64(bg.bytes)
          });
        }
      } else if (item.kind === "text") {
        const layout = await measureTextLayout(item.node);
        let textData = null;
        try {
          textData = await parseTextNode(item.node, scale, item.name, layout ? layout.lines : void 0);
          if (textData && layout) {
            textData.baselineY = Math.round((item.y + layout.baselineOffset) * scale * 100) / 100;
          }
        } catch (fontErr) {
          console.warn(`\u6587\u672C\u5C5E\u6027\u89E3\u6790\u5F02\u5E38:`, fontErr);
        }
        let textPngBase64 = void 0;
        try {
          const pngBytes = await item.node.exportAsync({
            format: "PNG",
            constraint: { type: "SCALE", value: scale }
          });
          textPngBase64 = uint8ToBase64(pngBytes);
        } catch (pngErr) {
          console.warn(`\u6587\u672C\u56FE\u5C42 ${item.name} PNG \u5BFC\u51FA\u5931\u8D25\uFF08\u4ECD\u4FDD\u7559\u53EF\u7F16\u8F91\u6587\u672C\uFF09:`, pngErr);
        }
        exportLayers.push({
          ...common,
          kind: "text",
          isGroup: false,
          textData,
          blendMode: convertBlendMode(getNodeBlendMode(item.node), false),
          x: Math.round(item.x * scale),
          y: Math.round(item.y * scale),
          renderX: Math.round(item.renderX * scale),
          renderY: Math.round(item.renderY * scale),
          textBox: preciseRect(item.x, item.y, item.width, item.height, scale),
          glyphBox: (() => {
            const rb = item.node.absoluteRenderBounds;
            return rb ? preciseRect(rb.x - rootBounds.x, rb.y - rootBounds.y, rb.width, rb.height, scale) : void 0;
          })(),
          pngBase64: textPngBase64
        });
      } else {
        try {
          const pngBytes = await item.node.exportAsync({
            format: "PNG",
            constraint: { type: "SCALE", value: scale }
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
          console.warn(`\u56FE\u5C42 ${item.name} \u5BFC\u51FA\u5931\u8D25:`, err);
        }
      }
    }
    const payload = {
      artboardName: targetNode.name,
      width: docWidth,
      height: docHeight,
      scale,
      rootCompositePngBase64: rootCompositeBase64,
      layers: exportLayers
    };
    figma.ui.postMessage({
      type: "export-data",
      ...payload
    });
  }

  // src/code.ts
  figma.showUI(__html__, { width: 420, height: 640, themeColors: true });
  function updateSelection() {
    const selection = figma.currentPage.selection;
    const artboards = [];
    for (const node of selection) {
      if (node.type === "FRAME" || node.type === "COMPONENT" || node.type === "INSTANCE" || node.type === "SECTION" || node.type === "GROUP") {
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
      artboards,
      hasSelection: artboards.length > 0
    });
  }
  figma.on("selectionchange", () => {
    updateSelection();
  });
  updateSelection();
  figma.ui.onmessage = async (msg) => {
    if (msg.type === "get-selection") {
      updateSelection();
    } else if (msg.type === "export-psd") {
      try {
        await handleExportPSD(msg.nodeId, msg.scale, msg.exportMode);
      } catch (err) {
        figma.ui.postMessage({
          type: "error",
          message: "\u5BFC\u51FA\u8FC7\u7A0B\u53D1\u751F\u9519\u8BEF: " + (err.message || err)
        });
      }
    }
  };
})();
