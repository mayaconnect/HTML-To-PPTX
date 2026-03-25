/**
 * editableExtractor.js — v3
 *
 * Extracts rendered HTML elements from Puppeteer and maps them to native
 * PowerPoint objects with correct sizing, fonts, z-ordering, and layout.
 *
 * Key design decisions:
 *  - Only LEAF text nodes generate text boxes (avoids parent+child overlap)
 *  - Leaf text nodes with bg/border are emitted as a SINGLE text box (no separate shape)
 *  - Font sizes are scaled using the actual viewport→slide DPI ratio
 *  - Pseudo-elements (::before/::after) are extracted for accent bars & strips
 *  - Thick left-borders (card color strips) are rendered as thin rect shapes
 *  - Padding is preserved in text boxes via margin settings
 *  - FontAwesome icons are rasterized to PNG via element.screenshot()
 *  - Inline SVGs are serialized to data-URI images
 *  - CSS gradients are mapped to PptxGenJS gradient fills
 *  - box-shadow is converted to a shadow shape behind the element
 *  - CSS transform: rotate() is extracted and applied as PPTX rotation
 *  - Full-viewport container divs are absorbed into the slide background
 */

const puppeteer = require("puppeteer");
const path = require("path");
const fs = require("fs");
const https = require("https");
const http = require("http");

// ── Constants ──
const SLIDE_W = 10;      // inches
const SLIDE_H = 5.625;   // inches (16:9)

// ── Pixel → Inch ──
function px2inX(px, vpW) { return (px / vpW) * SLIDE_W; }
function px2inY(px, vpH) { return (px / vpH) * SLIDE_H; }

// Font: CSS px → PT.  At 1280px viewport = 10in → 128 DPI.  PT = px * 72 / DPI.
function pxToPt(px, vpW) {
  const dpi = vpW / SLIDE_W;
  return px * 72 / dpi;
}

// ── Color helpers ──
const CSS_NAMED_COLORS = {
  black:"000000",white:"FFFFFF",red:"FF0000",green:"008000",blue:"0000FF",
  yellow:"FFFF00",cyan:"00FFFF",magenta:"FF00FF",orange:"FFA500",purple:"800080",
  gray:"808080",grey:"808080",silver:"C0C0C0",maroon:"800000",olive:"808000",
  lime:"00FF00",aqua:"00FFFF",teal:"008080",navy:"000080",fuchsia:"FF00FF",
  coral:"FF7F50",tomato:"FF6347",gold:"FFD700",indigo:"4B0082",violet:"EE82EE",
  pink:"FFC0CB",brown:"A52A2A",beige:"F5F5DC",ivory:"FFFFF0",khaki:"F0E68C",
  salmon:"FA8072",crimson:"DC143C",chocolate:"D2691E",tan:"D2B48C",
  skyblue:"87CEEB",steelblue:"4682B4",slategray:"708090",darkgray:"A9A9A9",
  lightgray:"D3D3D3",dimgray:"696969",darkblue:"00008B",darkgreen:"006400",
  darkred:"8B0000",dodgerblue:"1E90FF",firebrick:"B22222",forestgreen:"228B22",
  midnightblue:"191970",royalblue:"4169E1",seagreen:"2E8B57",sienna:"A0522D",
  whitesmoke:"F5F5F5",lavender:"E6E6FA",linen:"FAF0E6",mintcream:"F5FFFA",
};

function rgbaToHex(rgba) {
  if (!rgba || rgba === "transparent" || rgba === "rgba(0, 0, 0, 0)") return null;

  // Handle rgb()/rgba() format
  const m = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) {
    // Check alpha — if fully transparent, return null
    const alphaMatch = rgba.match(/rgba?\(\d+,\s*\d+,\s*\d+,\s*([\d.]+)\)/);
    if (alphaMatch && parseFloat(alphaMatch[1]) === 0) return null;
    return ((1 << 24) + (parseInt(m[1]) << 16) + (parseInt(m[2]) << 8) + parseInt(m[3]))
      .toString(16).slice(1).toUpperCase();
  }

  // Handle hex format: #RGB, #RRGGBB, #RGBA, #RRGGBBAA
  const hexMatch = rgba.match(/^#([0-9a-fA-F]+)$/);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    else if (hex.length === 4) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2]; // ignore alpha shorthand
    else if (hex.length === 8) hex = hex.slice(0, 6); // strip alpha
    if (hex.length === 6) return hex.toUpperCase();
  }

  // Handle named CSS colors
  const named = CSS_NAMED_COLORS[rgba.toLowerCase().trim()];
  if (named) return named;

  return null;
}

function rgbaOpacity(rgba) {
  if (!rgba) return 1;
  const m = rgba.match(/rgba?\(\d+,\s*\d+,\s*\d+,?\s*([\d.]+)?\)/);
  return (m && m[1] !== undefined) ? parseFloat(m[1]) : 1;
}

// ── Parse CSS gradient into PptxGenJS-compatible structure ──
function parseGradient(bgImage) {
  if (!bgImage) return null;

  // linear-gradient
  const linMatch = bgImage.match(/linear-gradient\((.+)\)/);
  if (linMatch) {
    const inner = linMatch[1];
    // Extract angle (e.g., "135deg", "to right")
    let angleDeg = 180; // default top-to-bottom
    const angleMatch = inner.match(/^(\d+(?:\.\d+)?)deg/);
    const dirMatch = inner.match(/^to\s+(top|bottom|left|right|top left|top right|bottom left|bottom right)/);
    if (angleMatch) {
      angleDeg = parseFloat(angleMatch[1]);
    } else if (dirMatch) {
      const dirMap = { "top": 0, "right": 90, "bottom": 180, "left": 270,
        "top right": 45, "bottom right": 135, "bottom left": 225, "top left": 315 };
      angleDeg = dirMap[dirMatch[1]] ?? 180;
    }

    // Extract color stops
    const colorStopRegex = /(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))\s*(\d+%)?/g;
    const stops = [];
    let cm;
    while ((cm = colorStopRegex.exec(inner)) !== null) {
      const hex = rgbaToHex(cm[1]);
      if (hex) {
        const pos = cm[2] ? parseInt(cm[2]) : null;
        stops.push({ color: hex, position: pos });
      }
    }
    if (stops.length < 2) return null;

    // Assign positions if not specified
    for (let i = 0; i < stops.length; i++) {
      if (stops[i].position === null) {
        stops[i].position = Math.round((i / (stops.length - 1)) * 100);
      }
    }

    // Map CSS angle to OOXML rotation (PptxGenJS uses degrees * 60000)
    // CSS: 0deg = to top, 90deg = to right; OOXML: 0 = right, 90 = bottom
    const ooxmlAngle = (angleDeg + 90) % 360;

    return { type: "linear", angle: ooxmlAngle, stops };
  }

  // radial-gradient — approximate as a linear gradient with same colors
  const radMatch = bgImage.match(/radial-gradient\((.+)\)/);
  if (radMatch) {
    const inner = radMatch[1];
    const colorStopRegex = /(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))\s*(\d+%)?/g;
    const stops = [];
    let cm;
    while ((cm = colorStopRegex.exec(inner)) !== null) {
      const hex = rgbaToHex(cm[1]);
      if (hex) {
        const pos = cm[2] ? parseInt(cm[2]) : null;
        stops.push({ color: hex, position: pos });
      }
    }
    if (stops.length < 2) return null;
    for (let i = 0; i < stops.length; i++) {
      if (stops[i].position === null) {
        stops[i].position = Math.round((i / (stops.length - 1)) * 100);
      }
    }
    // Use a diagonal gradient as approximate for radial
    return { type: "radial", angle: 135, stops };
  }

  return null;
}

// ── Parse box-shadow ──
function parseBoxShadow(shadow) {
  if (!shadow || shadow === "none") return null;
  // Match: [inset] offsetX offsetY [blur] [spread] color
  const m = shadow.match(/(?:inset\s+)?(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+(?:(\d+(?:\.\d+)?)px\s*)?(?:(-?\d+(?:\.\d+)?)px\s*)?(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/);
  if (!m) return null;
  if (shadow.startsWith("inset")) return null; // skip inset shadows
  return {
    offsetX: parseFloat(m[1]),
    offsetY: parseFloat(m[2]),
    blur: parseFloat(m[3]) || 0,
    spread: parseFloat(m[4]) || 0,
    color: m[5],
  };
}

// ── Parse transform: rotate() ──
function parseRotation(transform) {
  if (!transform || transform === "none") return 0;
  const m = transform.match(/rotate\((-?\d+(?:\.\d+)?)deg\)/);
  return m ? parseFloat(m[1]) : 0;
}

// ── Fetch image → data URI ──
function fetchImage(url) {
  return new Promise((resolve) => {
    const mod = url.startsWith("https") ? https : http;
    mod.get(url, { timeout: 8000 }, (res) => {
      if (res.statusCode !== 200) return resolve(null);
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        const ct = res.headers["content-type"] || "image/png";
        resolve(`data:${ct};base64,${buf.toString("base64")}`);
      });
      res.on("error", () => resolve(null));
    }).on("error", () => resolve(null));
  });
}

// ════════════════════════════════════════════════════════════════════════════
// DOM EXTRACTION (Puppeteer evaluate)
// ════════════════════════════════════════════════════════════════════════════

async function extractSlideElements(browser, htmlFilePath, viewport) {
  const { width, height } = viewport;
  const page = await browser.newPage();

  try {
    await page.setViewport({ width, height, deviceScaleFactor: 2 });
    const fileUrl = `file:///${htmlFilePath.replace(/\\/g, "/")}`;
    await page.goto(fileUrl, { waitUntil: "networkidle0", timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    await new Promise((r) => setTimeout(r, 600));

    // ── Phase 1: DOM extraction ──
    const rawElements = await page.evaluate((vp) => {
      const W = vp.width, H = vp.height;
      const results = [];
      let nextId = 0;

      const SKIP = new Set(["html","head","script","style","link","meta","noscript","title"]);
      const INLINE = new Set(["span","strong","b","em","i","u","a","small","sub","sup","abbr","mark","code","br","wbr"]);

      function vis(el) {
        const s = getComputedStyle(el);
        return s.display !== "none" && s.visibility !== "hidden";
      }

      function inBounds(r) {
        return !(r.right <= 0 || r.bottom <= 0 || r.left >= W || r.top >= H);
      }

      function fullText(el) {
        let t = "";
        for (const n of el.childNodes) {
          if (n.nodeType === 3) t += n.textContent;
          else if (n.nodeType === 1) {
            if (n.tagName.toLowerCase() === "br") t += "\n";
            else t += fullText(n);
          }
        }
        return t;
      }

      function isLeafText(el) {
        for (const c of el.children) {
          if (!INLINE.has(c.tagName.toLowerCase())) return false;
        }
        return fullText(el).trim().length > 0;
      }

      function hasBg(cs) {
        const bg = cs.backgroundColor;
        return bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
      }

      // Detect FontAwesome icon elements
      function isFontAwesomeIcon(el) {
        const tag = el.tagName.toLowerCase();
        if (tag !== "i" && tag !== "span") return false;
        const cls = el.className || "";
        if (/\bfa[srltdb]?\b/.test(cls) || /\bfa-/.test(cls)) return true;
        const cs = getComputedStyle(el);
        const ff = cs.fontFamily.toLowerCase();
        if (ff.includes("font awesome") || ff.includes("fontawesome")) return true;
        return false;
      }

      // Detect inline SVG elements
      function isInlineSvg(el) {
        return el.tagName.toLowerCase() === "svg";
      }

      // Check if element is a full-viewport container (slide-container)
      function isFullViewportContainer(el, rect) {
        return rect.left <= 1 && rect.top <= 1 &&
               Math.abs(rect.width - W) < 2 && Math.abs(rect.height - H) < 2;
      }

      function extractPseudo(el, which, parentRect, parentZ) {
        try {
          const ps = getComputedStyle(el, which);
          if (!ps || ps.display === "none") return;
          if (ps.content === "none" || ps.content === "normal" || ps.content === '""') return;

          const bg = ps.backgroundColor;
          const hasPsBg = bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
          if (!hasPsBg) return;

          let w = parseFloat(ps.width) || 0;
          let h = parseFloat(ps.height) || 0;
          if (w < 1 && h < 1) return;

          let x = parentRect.left, y = parentRect.top;
          if (ps.position === "absolute") {
            const l = parseFloat(ps.left), t = parseFloat(ps.top), b = parseFloat(ps.bottom);
            if (!isNaN(l)) x = parentRect.left + l;
            if (!isNaN(t)) y = parentRect.top + t;
            else if (!isNaN(b)) y = parentRect.bottom - b - h;
          }

          results.push({
            id: nextId++, type: "shape", tag: "pseudo",
            x, y, w, h,
            bgColor: bg,
            opacity: parseFloat(ps.opacity) || 1,
            borderRadius: parseFloat(ps.borderRadius) || 0,
            zIndex: parentZ,
          });
        } catch { /* ignore */ }
      }

      function walk(el, inheritedZ) {
        if (!(el instanceof HTMLElement)) return;
        if (!vis(el)) return;

        const tag = el.tagName.toLowerCase();
        if (SKIP.has(tag)) return;

        if (tag === "body") {
          const r = el.getBoundingClientRect();
          extractPseudo(el, "::before", r, 0);
          extractPseudo(el, "::after", r, 0);
          for (const c of el.children) walk(c, 0);
          return;
        }

        const rect = el.getBoundingClientRect();
        if (!inBounds(rect)) return;
        if (rect.width < 1 && rect.height < 1) return;

        const cs = getComputedStyle(el);
        const rawZ = parseInt(cs.zIndex);
        const zIdx = !isNaN(rawZ) ? rawZ : (inheritedZ || 0);
        const opacity = parseFloat(cs.opacity);

        // ── FIX: Skip full-viewport containers ──
        // (slide-container and explicit full-slide background divs)
        // Absorb their bg color into the slide background instead
        if (isFullViewportContainer(el, rect)) {
          const bg = hasBg(cs) ? cs.backgroundColor : null;
          if (bg) {
            results.push({
              id: nextId++, type: "_slideBg", tag: "slide-bg",
              bgColor: bg,
            });
          }
          // Still recurse into children
          extractPseudo(el, "::before", rect, zIdx);
          extractPseudo(el, "::after", rect, zIdx);
          for (const c of el.children) walk(c, zIdx);
          return;
        }

        // ── FIX: Handle inline SVG elements ──
        if (isInlineSvg(el)) {
          // Mark for screenshot-based rasterization
          const svgHtml = el.outerHTML;
          results.push({
            id: nextId++, type: "svg", tag: "svg",
            x: rect.left, y: rect.top, w: rect.width, h: rect.height,
            svgHtml,
            zIndex: zIdx, opacity,
            _selector: buildSelector(el),
          });
          return;
        }

        // ── FIX: Handle FontAwesome icons ──
        if (isFontAwesomeIcon(el)) {
          results.push({
            id: nextId++, type: "icon", tag,
            x: rect.left, y: rect.top, w: rect.width, h: rect.height,
            zIndex: zIdx, opacity,
            _selector: buildSelector(el),
          });
          return; // will be rasterized via element.screenshot()
        }

        extractPseudo(el, "::before", rect, zIdx);
        extractPseudo(el, "::after", rect, zIdx);

        const bgPresent = hasBg(cs);
        const blw = parseFloat(cs.borderLeftWidth) || 0;
        const btw = parseFloat(cs.borderTopWidth) || 0;
        const blc = cs.borderLeftColor;
        const btc = cs.borderTopColor;
        const bls = cs.borderLeftStyle;
        const bts = cs.borderTopStyle;
        const bRadius = parseFloat(cs.borderRadius) || 0;

        const solidBorderL = blw > 0 && blc !== "rgba(0, 0, 0, 0)" && blc !== "transparent" && bls !== "none";
        const solidBorderT = btw > 0 && btc !== "rgba(0, 0, 0, 0)" && btc !== "transparent" && bts !== "none";
        const hasSomeBorder = solidBorderL || solidBorderT;
        const isDashed = bls === "dashed" || bls === "dotted" || bts === "dashed" || bts === "dotted";

        // Emit thick left-border as a separate color-strip shape
        if (blw >= 3 && solidBorderL) {
          results.push({
            id: nextId++, type: "shape", tag: "border-strip",
            x: rect.left, y: rect.top, w: blw, h: rect.height,
            bgColor: blc, opacity, borderRadius: 0, zIndex: zIdx + 1,
          });
        }

        // ── FIX: Extract box-shadow ──
        const boxShadow = cs.boxShadow;
        let shadowData = null;
        if (boxShadow && boxShadow !== "none") {
          const sm = boxShadow.match(/(?:inset\s+)?(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+(?:(\d+(?:\.\d+)?)px\s*)?(?:(-?\d+(?:\.\d+)?)px\s*)?(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/);
          if (sm && !boxShadow.startsWith("inset")) {
            shadowData = {
              offsetX: parseFloat(sm[1]),
              offsetY: parseFloat(sm[2]),
              blur: parseFloat(sm[3]) || 0,
              spread: parseFloat(sm[4]) || 0,
              color: sm[5],
            };
          }
        }

        if (shadowData) {
          const sX = rect.left + shadowData.offsetX - shadowData.spread;
          const sY = rect.top + shadowData.offsetY - shadowData.spread;
          const sW = rect.width + shadowData.spread * 2 + shadowData.blur;
          const sH = rect.height + shadowData.spread * 2 + shadowData.blur;
          results.push({
            id: nextId++, type: "shape", tag: "shadow",
            x: sX, y: sY, w: sW, h: sH,
            bgColor: shadowData.color,
            opacity: opacity,
            borderRadius: bRadius + shadowData.blur / 2,
            zIndex: zIdx - 1,
          });
        }

        // ── FIX: Extract gradient from backgroundImage ──
        const bgImg = cs.backgroundImage;
        let bgImageUrl = null;
        let gradientData = null;
        if (bgImg && bgImg !== "none") {
          const urlMatch = bgImg.match(/url\(["']?(.*?)["']?\)/);
          if (urlMatch) {
            bgImageUrl = urlMatch[1];
          } else if (bgImg.includes("gradient")) {
            gradientData = bgImg; // store raw CSS gradient string for parsing outside evaluate
          }
        }

        // ── FIX: Extract CSS transform rotation ──
        const transform = cs.transform;
        let rotation = 0;
        if (transform && transform !== "none") {
          // matrix(a, b, c, d, tx, ty) → rotation = atan2(b, a)
          const matMatch = transform.match(/matrix\(([^)]+)\)/);
          if (matMatch) {
            const vals = matMatch[1].split(",").map(Number);
            if (vals.length >= 2) {
              rotation = Math.round(Math.atan2(vals[1], vals[0]) * (180 / Math.PI));
            }
          }
        }

        // <img> tag
        if (tag === "img") {
          results.push({
            id: nextId++, type: "image", tag,
            x: rect.left, y: rect.top, w: rect.width, h: rect.height,
            imgSrc: el.src || el.getAttribute("src"),
            zIndex: zIdx, opacity, rotation,
          });
          return;
        }

        let leaf = isLeafText(el);

        // ── FIX: Flex/grid containers must NOT be treated as leaf text ──
        // Each flex/grid item has its own bounding box and styling;
        // treating the parent as leaf would concatenate all child text into
        // one text box and lose individual child backgrounds/borders.
        if (leaf) {
          const disp = cs.display;
          if (disp === 'flex' || disp === 'inline-flex' || disp === 'grid' || disp === 'inline-grid') {
            leaf = false;
          }
        }

        // ── FIX: Don't emit separate shape when element is a leaf text node ──
        // The text element already carries bgColor, borderColor, borderRadius
        if (!leaf && (bgPresent || hasSomeBorder || bgImageUrl || gradientData)) {
          results.push({
            id: nextId++,
            type: bgImageUrl ? "bgImage" : "shape",
            tag,
            x: rect.left, y: rect.top, w: rect.width, h: rect.height,
            bgColor: bgPresent ? cs.backgroundColor : null,
            opacity,
            borderRadius: bRadius,
            borderWidth: hasSomeBorder ? Math.max(blw, btw) : 0,
            borderColor: hasSomeBorder ? (solidBorderL ? blc : btc) : null,
            isDashed,
            bgImageUrl,
            gradientData,
            zIndex: zIdx,
            rotation,
          });
        }

        // Leaf text element → emit text box (carries its own bg/border/radius)
        if (leaf) {
          const txt = fullText(el).trim();
          if (txt) {
            results.push({
              id: nextId++, type: "text", tag,
              x: rect.left, y: rect.top,
              w: rect.width, h: rect.height,
              text: txt,
              fontSize: parseFloat(cs.fontSize),
              fontFamily: cs.fontFamily.replace(/['"]/g, "").split(",")[0].trim(),
              fontWeight: cs.fontWeight,
              fontStyle: cs.fontStyle,
              color: cs.color,
              textTransform: cs.textTransform,
              textAlign: cs.textAlign,
              lineHeight: cs.lineHeight,
              letterSpacing: cs.letterSpacing,
              pL: parseFloat(cs.paddingLeft) || 0,
              pT: parseFloat(cs.paddingTop) || 0,
              pR: parseFloat(cs.paddingRight) || 0,
              pB: parseFloat(cs.paddingBottom) || 0,
              opacity, zIndex: zIdx,
              bgColor: bgPresent ? cs.backgroundColor : null,
              borderWidth: hasSomeBorder ? Math.max(blw, btw) : 0,
              borderColor: hasSomeBorder ? (solidBorderL ? blc : btc) : null,
              borderRadius: bRadius,
              gradientData,
              rotation,
            });
          }
          return;
        }

        for (const c of el.children) walk(c, zIdx);
      }

      // Build a unique CSS selector for an element (for later querySelectorAll)
      function buildSelector(el) {
        const parts = [];
        let cur = el;
        while (cur && cur !== document.body && cur !== document.documentElement) {
          let sel = cur.tagName.toLowerCase();
          if (cur.id) {
            sel += "#" + CSS.escape(cur.id);
            parts.unshift(sel);
            break;
          }
          const parent = cur.parentElement;
          if (parent) {
            const sibs = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
            if (sibs.length > 1) {
              sel += ":nth-of-type(" + (sibs.indexOf(cur) + 1) + ")";
            }
          }
          parts.unshift(sel);
          cur = cur.parentElement;
        }
        return parts.join(" > ");
      }

      if (document.body) walk(document.body);
      return results;
    }, { width, height });

    const rootBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    // ── Phase 2: Rasterize icons and SVGs ──
    const iconElements = rawElements.filter(el => el.type === "icon" || el.type === "svg");
    const iconImages = {};

    for (const el of iconElements) {
      if (!el._selector) continue;
      try {
        const handle = await page.$(el._selector);
        if (handle) {
          // Force transparent background so only the icon/SVG glyph is captured
          await page.evaluate(sel => {
            const e = document.querySelector(sel);
            if (e) e.style.backgroundColor = 'transparent';
          }, el._selector);
          const screenshotBuf = await handle.screenshot({ type: "png", omitBackground: true });
          iconImages[el.id] = `data:image/png;base64,${screenshotBuf.toString("base64")}`;
          await handle.dispose();
        }
      } catch (err) {
        console.warn(`Icon rasterize failed for ${el._selector}: ${err.message}`);
      }
    }

    // ── Phase 3: Determine slide background ──
    // Collect _slideBg entries for final background (last one wins)
    let slideBg = rgbaToHex(rootBg) || "FFFFFF";
    for (const el of rawElements) {
      if (el.type === "_slideBg" && el.bgColor) {
        const hex = rgbaToHex(el.bgColor);
        if (hex) slideBg = hex;
      }
    }

    // ── Phase 4: Convert to PPTX units ──
    const TEXT_PAD_PX = 15;

    const elements = rawElements
      .filter(el => el.type !== "_slideBg") // remove pseudo-entries
      .map((el) => {
        // Convert icons/SVGs to image type with rasterized data
        if (el.type === "icon" || el.type === "svg") {
          const data = iconImages[el.id];
          if (!data) return null; // skip if rasterization failed
          return {
            id: el.id,
            type: "image",
            tag: el.tag,
            x: px2inX(Math.max(0, el.x), width),
            y: px2inY(Math.max(0, el.y), height),
            w: px2inX(el.w, width),
            h: px2inY(el.h, height),
            zIndex: el.zIndex || 0,
            opacity: el.opacity ?? 1,
            imgSrc: data,
          };
        }

        const o = {
          id: el.id,
          type: el.type,
          tag: el.tag,
          x: px2inX(Math.max(0, el.x), width),
          y: px2inY(Math.max(0, el.y), height),
          w: px2inX(el.type === "text" ? el.w + TEXT_PAD_PX : el.w, width),
          h: px2inY(el.h, height),
          zIndex: el.zIndex || 0,
          opacity: el.opacity ?? 1,
        };

        // Clamp to slide
        if (o.x + o.w > SLIDE_W) o.w = SLIDE_W - o.x;
        if (o.y + o.h > SLIDE_H) o.h = SLIDE_H - o.y;
        if (o.w < 0) o.w = 0;
        if (o.h < 0) o.h = 0;

        // Rotation
        if (el.rotation) o.rotation = el.rotation;

        if (el.type === "text") {
          o.text = el.text;
          o.fontSize = Math.round(pxToPt(el.fontSize, width) * 10) / 10;
          o.fontFamily = el.fontFamily;
          o.bold = parseInt(el.fontWeight) >= 700;
          o.italic = el.fontStyle === "italic";
          o.color = rgbaToHex(el.color) || "000000";
          o.textTransform = el.textTransform;
          o.textAlign = el.textAlign === "start" ? "left" : el.textAlign;
          o.letterSpacing = (el.letterSpacing && el.letterSpacing !== "normal")
            ? parseFloat(el.letterSpacing) : 0;
          o.pL = px2inX(el.pL, width);
          o.pT = px2inY(el.pT, height);
          o.pR = px2inX(el.pR, width);
          o.pB = px2inY(el.pB, height);
          o.bgColor = rgbaToHex(el.bgColor);
          o.bgOpacity = el.bgColor ? rgbaOpacity(el.bgColor) : 1;
          o.borderWidth = el.borderWidth > 0 ? px2inX(el.borderWidth, width) : 0;
          o.borderColor = rgbaToHex(el.borderColor);
          o.borderRadius = el.borderRadius;
          if (el.gradientData) o.gradient = parseGradient(el.gradientData);
          if (el.lineHeight && el.lineHeight !== "normal") {
            const lhPx = parseFloat(el.lineHeight);
            if (!isNaN(lhPx) && el.fontSize > 0) {
              o.lineSpacingPct = Math.round((lhPx / el.fontSize) * 100);
            }
          }
        }

        if (el.type === "shape" || el.type === "bgImage") {
          o.bgColor = rgbaToHex(el.bgColor);
          o.bgOpacity = el.bgColor ? rgbaOpacity(el.bgColor) : 1;
          o.borderRadius = el.borderRadius || 0;
          o.borderWidth = el.borderWidth > 0 ? px2inX(el.borderWidth, width) : 0;
          o.borderColor = rgbaToHex(el.borderColor);
          o.isDashed = el.isDashed || false;
          o.bgImageUrl = el.bgImageUrl || null;
          if (el.gradientData) o.gradient = parseGradient(el.gradientData);
        }

        if (el.type === "image") {
          o.imgSrc = el.imgSrc;
        }

        return o;
      })
      .filter(Boolean);

    return { elements, background: slideBg, width, height };
  } finally {
    await page.close();
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PPTX GENERATION
// ════════════════════════════════════════════════════════════════════════════

async function buildEditablePptx(slideDataArray, outputPath) {
  const PptxGenJS = require("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "CUSTOM", width: SLIDE_W, height: SLIDE_H });
  pptx.layout = "CUSTOM";

  for (const sd of slideDataArray) {
    const slide = pptx.addSlide();
    if (sd.background) slide.background = { color: sd.background };

    // Ensure text always renders on top: bump every text element's zIndex
    // above the highest shape zIndex so text is never covered.
    const maxNonTextZ = sd.elements
      .filter(e => e.type !== "text")
      .reduce((mx, e) => Math.max(mx, e.zIndex || 0), 0);

    for (const el of sd.elements) {
      if (el.type === "text") {
        el.zIndex = Math.max(el.zIndex, maxNonTextZ + 1);
      }
    }

    // Render in strict layer order: shapes → images → text (always last)
    const byZ = (a, b) => (a.zIndex - b.zIndex) || (a.id - b.id);

    const shapes = sd.elements.filter(e => e.type === "shape" || e.type === "bgImage").sort(byZ);
    const images = sd.elements.filter(e => e.type === "image").sort(byZ);
    const texts  = sd.elements.filter(e => e.type === "text").sort(byZ);

    for (const group of [shapes, images, texts]) {
      for (const el of group) {
        try {
          await renderElement(slide, el, sd);
        } catch (err) {
          console.warn(`Skip ${el.tag}/${el.type}: ${err.message}`);
        }
      }
    }
  }

  await pptx.writeFile({ fileName: outputPath });
}

async function renderElement(slide, el, sd) {
  if (el.w <= 0.01 || el.h <= 0.01) return;

  const trans = Math.round((1 - el.opacity) * 100);

  // ── Image (including rasterized icons/SVGs) ──
  if (el.type === "image") {
    let data = await resolveImage(el.imgSrc);
    if (data) {
      const imgOpts = { data, x: el.x, y: el.y, w: el.w, h: el.h };
      if (el.rotation) imgOpts.rotate = el.rotation;
      slide.addImage(imgOpts);
    }
    return;
  }

  // ── BG Image ──
  if (el.type === "bgImage" && el.bgImageUrl) {
    let data = el.bgImageUrl.startsWith("http") ? await fetchImage(el.bgImageUrl) : null;
    if (data) slide.addImage({ data, x: el.x, y: el.y, w: el.w, h: el.h });
    return;
  }

  // ── Helper: build fill object (solid or gradient) ──
  function buildFill(bgColor, bgOpacity, gradient, extraTrans) {
    const totalTrans = Math.min(100, Math.round((1 - (bgOpacity ?? 1)) * 100) + (extraTrans || 0));
    if (gradient && gradient.stops && gradient.stops.length >= 2) {
      return {
        color: gradient.stops[0].color,
        transparency: totalTrans,
      };
    }
    if (bgColor) {
      return { color: bgColor, transparency: totalTrans };
    }
    return null;
  }

  // ── Shape ──
  if (el.type === "shape") {
    const opts = { x: el.x, y: el.y, w: el.w, h: el.h };

    // Gradient fill support
    if (el.gradient && el.gradient.stops && el.gradient.stops.length >= 2) {
      const bgT = Math.round((1 - (el.bgOpacity ?? 1)) * 100);
      // PptxGenJS doesn't support multi-stop gradients natively on shapes via fill
      // Use the first color as fill and add a second overlapping shape for gradient effect
      // For now, use the dominant (first) color as solid fill
      opts.fill = { color: el.gradient.stops[0].color, transparency: Math.min(100, bgT + trans) };
    } else if (el.bgColor) {
      const bgT = Math.round((1 - (el.bgOpacity ?? 1)) * 100);
      opts.fill = { color: el.bgColor, transparency: Math.min(100, bgT + trans) };
    }

    if (el.borderWidth > 0 && el.borderColor) {
      opts.border = {
        type: el.isDashed ? "dash" : "solid",
        pt: Math.max(0.5, Math.round(el.borderWidth * 72)),
        color: el.borderColor,
      };
    }

    if (el.rotation) opts.rotate = el.rotation;

    const isCircle = el.borderRadius >= 100 && Math.abs(el.w - el.h) < 0.15;
    if (isCircle) {
      slide.addShape("ellipse", opts);
    } else if (el.borderRadius > 0) {
      opts.rectRadius = Math.min(0.15, px2inX(el.borderRadius, sd.width));
      slide.addShape("roundRect", opts);
    } else {
      slide.addShape("rect", opts);
    }
    return;
  }

  // ── Text ──
  if (el.type === "text") {
    let txt = el.text || "";
    if (el.textTransform === "uppercase") txt = txt.toUpperCase();
    else if (el.textTransform === "lowercase") txt = txt.toLowerCase();
    if (!txt.trim()) return;

    const fontSize = Math.max(4, el.fontSize || 8);

    const opts = {
      x: el.x,
      y: el.y,
      w: Math.max(0.2, el.w),
      h: Math.max(0.12, el.h),
      fontSize,
      fontFace: mapFont(el.fontFamily),
      bold: el.bold,
      italic: el.italic,
      color: el.color || "000000",
      align: mapAlign(el.textAlign),
      valign: "top",
      wrap: true,
      shrinkText: false,
      transparency: trans,
      margin: [
        Math.round((el.pT || 0) * 72),
        Math.round((el.pR || 0) * 72),
        Math.round((el.pB || 0) * 72),
        Math.round((el.pL || 0) * 72),
      ],
    };

    if (el.lineSpacingPct && el.lineSpacingPct > 50 && el.lineSpacingPct < 300) {
      opts.lineSpacingMultiple = el.lineSpacingPct / 100;
    }

    if (el.letterSpacing > 0) {
      opts.charSpacing = Math.round(el.letterSpacing * 100) / 100;
    }

    // Gradient or solid background fill on text box
    if (el.gradient && el.gradient.stops && el.gradient.stops.length >= 2) {
      opts.fill = {
        color: el.gradient.stops[0].color,
        transparency: Math.round((1 - (el.bgOpacity ?? 1)) * 100),
      };
    } else if (el.bgColor) {
      opts.fill = {
        color: el.bgColor,
        transparency: Math.round((1 - (el.bgOpacity ?? 1)) * 100),
      };
    }

    if (el.borderWidth > 0 && el.borderColor) {
      opts.border = {
        type: "solid",
        pt: Math.max(0.5, Math.round(el.borderWidth * 72)),
        color: el.borderColor,
      };
    }

    if (el.borderRadius > 0) {
      opts.rectRadius = Math.min(0.15, px2inX(el.borderRadius, sd.width));
    }

    if (el.rotation) opts.rotate = el.rotation;

    slide.addText(txt, opts);
  }
}

async function resolveImage(src) {
  if (!src) return null;
  if (src.startsWith("data:")) return src;
  if (src.startsWith("http")) return fetchImage(src);
  try {
    const buf = fs.readFileSync(src);
    const ext = path.extname(src).replace(".", "").toLowerCase();
    const mime = ext === "svg" ? "image/svg+xml" : `image/${ext === "jpg" ? "jpeg" : ext}`;
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch { return null; }
}

function mapFont(f) {
  if (!f) return "Calibri";
  const l = f.toLowerCase();
  if (l.includes("montserrat")) return "Montserrat";
  if (l.includes("inter")) return "Inter";
  if (l.includes("arial")) return "Arial";
  if (l.includes("georgia")) return "Georgia";
  if (l.includes("times")) return "Times New Roman";
  if (l.includes("courier")) return "Courier New";
  if (l.includes("segoe")) return "Segoe UI";
  if (l.includes("roboto")) return "Roboto";
  if (l.includes("open sans")) return "Open Sans";
  if (l.includes("lato")) return "Lato";
  if (l.includes("poppins")) return "Poppins";
  return f;
}

function mapAlign(a) {
  return { left:"left", right:"right", center:"center", justify:"justify", start:"left", end:"right" }[a] || "left";
}

module.exports = { extractSlideElements, buildEditablePptx };
