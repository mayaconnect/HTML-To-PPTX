/**
 * converter.js — Client-side HTML → PPTX converter
 *
 * Mirrors the server-side editableExtractor.js logic but runs entirely
 * in the browser using a hidden <iframe> for DOM extraction and
 * PptxGenJS (browser build) for PPTX generation.
 */
const ClientConverter = (() => {
  // ── Constants ──
  const SLIDE_W = 10;      // inches
  const SLIDE_H = 5.625;   // inches (16:9)

  // ── Pixel → Inch ──
  function px2inX(px, vpW) { return (px / vpW) * SLIDE_W; }
  function px2inY(px, vpH) { return (px / vpH) * SLIDE_H; }

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

    const m = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (m) {
      const alphaMatch = rgba.match(/rgba?\(\d+,\s*\d+,\s*\d+,\s*([\d.]+)\)/);
      if (alphaMatch && parseFloat(alphaMatch[1]) === 0) return null;
      return ((1 << 24) + (parseInt(m[1]) << 16) + (parseInt(m[2]) << 8) + parseInt(m[3]))
        .toString(16).slice(1).toUpperCase();
    }

    const hexMatch = rgba.match(/^#([0-9a-fA-F]+)$/);
    if (hexMatch) {
      let hex = hexMatch[1];
      if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
      else if (hex.length === 4) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
      else if (hex.length === 8) hex = hex.slice(0, 6);
      if (hex.length === 6) return hex.toUpperCase();
    }

    const named = CSS_NAMED_COLORS[rgba.toLowerCase().trim()];
    if (named) return named;

    return null;
  }

  function rgbaOpacity(rgba) {
    if (!rgba) return 1;
    const m = rgba.match(/rgba?\(\d+,\s*\d+,\s*\d+,?\s*([\d.]+)?\)/);
    return (m && m[1] !== undefined) ? parseFloat(m[1]) : 1;
  }

  // ── Fetch image → data URI (browser) ──
  function fetchImageAsDataUri(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          canvas.getContext("2d").drawImage(img, 0, 0);
          resolve(canvas.toDataURL("image/png"));
        } catch { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  // ── DOM Extraction from iframe document ──
  function extractElementsFromDocument(doc, vpWidth, vpHeight) {
    const W = vpWidth, H = vpHeight;
    const results = [];
    let nextId = 0;

    const SKIP = new Set(["html","head","script","style","link","meta","noscript","title"]);
    const INLINE = new Set(["span","strong","b","em","i","u","a","small","sub","sup","abbr","mark","code","br","wbr"]);

    function vis(el) {
      const s = el.ownerDocument.defaultView.getComputedStyle(el);
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

    function extractPseudo(el, which, parentRect, parentZ) {
      try {
        const win = el.ownerDocument.defaultView;
        const ps = win.getComputedStyle(el, which);
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
      if (!(el instanceof el.ownerDocument.defaultView.HTMLElement)) return;
      if (!vis(el)) return;

      const tag = el.tagName.toLowerCase();
      if (SKIP.has(tag)) return;

      const win = el.ownerDocument.defaultView;

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

      const cs = win.getComputedStyle(el);
      const rawZ = parseInt(cs.zIndex);
      const zIdx = !isNaN(rawZ) ? rawZ : (inheritedZ || 0);
      const opacity = parseFloat(cs.opacity);

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

      if (blw >= 3 && solidBorderL) {
        results.push({
          id: nextId++, type: "shape", tag: "border-strip",
          x: rect.left, y: rect.top, w: blw, h: rect.height,
          bgColor: blc, opacity, borderRadius: 0, zIndex: zIdx + 1,
        });
      }

      const bgImg = cs.backgroundImage;
      let bgImageUrl = null;
      if (bgImg && bgImg !== "none") {
        const m = bgImg.match(/url\(["']?(.*?)["']?\)/);
        if (m) bgImageUrl = m[1];
      }

      if (tag === "img") {
        results.push({
          id: nextId++, type: "image", tag,
          x: rect.left, y: rect.top, w: rect.width, h: rect.height,
          imgSrc: el.src || el.getAttribute("src"),
          zIndex: zIdx, opacity,
        });
        return;
      }

      const leaf = isLeafText(el);

      if (bgPresent || (hasSomeBorder && !leaf) || bgImageUrl) {
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
          zIndex: zIdx,
        });
      }

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
          });
        }
        return;
      }

      for (const c of el.children) walk(c, zIdx);
    }

    if (doc.body) walk(doc.body, 0);

    const rootBg = doc.defaultView.getComputedStyle(doc.body).backgroundColor;
    return { rawElements: results, rootBg };
  }

  // ── Convert raw DOM elements to PPTX units ──
  function convertToSlideUnits(rawElements, rootBg, width, height) {
    const elements = rawElements.map((el) => {
      const o = {
        id: el.id,
        type: el.type,
        tag: el.tag,
        x: px2inX(Math.max(0, el.x), width),
        y: px2inY(Math.max(0, el.y), height),
        w: px2inX(el.w, width),
        h: px2inY(el.h, height),
        zIndex: el.zIndex || 0,
        opacity: el.opacity ?? 1,
      };

      if (o.x + o.w > SLIDE_W) o.w = SLIDE_W - o.x;
      if (o.y + o.h > SLIDE_H) o.h = SLIDE_H - o.y;
      if (o.w < 0) o.w = 0;
      if (o.h < 0) o.h = 0;

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
      }

      if (el.type === "image") {
        o.imgSrc = el.imgSrc;
      }

      return o;
    });

    return { elements, background: rgbaToHex(rootBg) || "FFFFFF", width, height };
  }

  // ── Font mapping ──
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

  // ── Resolve image to data URI (browser) ──
  async function resolveImage(src) {
    if (!src) return null;
    if (src.startsWith("data:")) return src;
    if (src.startsWith("http")) return fetchImageAsDataUri(src);
    return null;
  }

  // ── Render a single element onto a PptxGenJS slide ──
  async function renderElement(slide, el, sd) {
    if (el.w <= 0.01 || el.h <= 0.01) return;

    const trans = Math.round((1 - el.opacity) * 100);

    if (el.type === "image") {
      const data = await resolveImage(el.imgSrc);
      if (data) slide.addImage({ data, x: el.x, y: el.y, w: el.w, h: el.h });
      return;
    }

    if (el.type === "bgImage" && el.bgImageUrl) {
      const data = el.bgImageUrl.startsWith("http") ? await fetchImageAsDataUri(el.bgImageUrl) : null;
      if (data) slide.addImage({ data, x: el.x, y: el.y, w: el.w, h: el.h });
      return;
    }

    if (el.type === "shape") {
      const opts = { x: el.x, y: el.y, w: el.w, h: el.h };

      if (el.bgColor) {
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

      if (el.bgColor) {
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

      slide.addText(txt, opts);
    }
  }

  // ── Load HTML file into a hidden iframe and wait for render ──
  function loadHtmlInIframe(htmlContent, width, height) {
    return new Promise((resolve, reject) => {
      const iframe = document.createElement("iframe");
      iframe.style.cssText = `position:fixed;left:-9999px;top:0;width:${width}px;height:${height}px;border:none;visibility:hidden;`;
      iframe.sandbox = "allow-same-origin";
      document.body.appendChild(iframe);

      iframe.onload = () => {
        // Wait for fonts + rendering
        const win = iframe.contentWindow;
        const doc = iframe.contentDocument;
        if (!doc || !doc.body) {
          document.body.removeChild(iframe);
          return reject(new Error("Failed to load HTML in iframe"));
        }

        const fontsReady = doc.fonts ? doc.fonts.ready : Promise.resolve();
        fontsReady.then(() => {
          setTimeout(() => resolve({ iframe, doc, win }), 600);
        });
      };

      iframe.onerror = () => {
        document.body.removeChild(iframe);
        reject(new Error("Iframe load error"));
      };

      // Write HTML content via srcdoc
      iframe.srcdoc = htmlContent;
    });
  }

  // ── Screenshot mode: capture iframe as image using html2canvas ──
  async function captureScreenshot(doc, win, width, height) {
    // html2canvas must be loaded globally
    if (typeof html2canvas === "undefined") {
      throw new Error("html2canvas library not loaded — screenshot mode unavailable");
    }
    const canvas = await html2canvas(doc.body, {
      width,
      height,
      windowWidth: width,
      windowHeight: height,
      useCORS: true,
      allowTaint: false,
      backgroundColor: null,
      scale: 2,
    });
    return canvas.toDataURL("image/png");
  }

  // ════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Convert an array of HTML File objects to a PPTX Blob.
   * @param {File[]} files - HTML files
   * @param {Object} options - { resolution: "720p"|"1080p", mode: "editable"|"screenshot" }
   * @param {Function} onProgress - callback(fileIndex, totalFiles, message)
   * @returns {Promise<Blob>}
   */
  async function convert(files, options, onProgress) {
    const { resolution = "720p", mode = "editable" } = options || {};
    const width = resolution === "1080p" ? 1920 : 1280;
    const height = resolution === "1080p" ? 1080 : 720;

    if (typeof PptxGenJS === "undefined") {
      throw new Error("PptxGenJS library not loaded");
    }

    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: "CUSTOM", width: SLIDE_W, height: SLIDE_H });
    pptx.layout = "CUSTOM";

    const totalFiles = files.length;

    for (let i = 0; i < totalFiles; i++) {
      const file = files[i];
      if (onProgress) onProgress(i, totalFiles, `Processing ${file.name}…`);

      const htmlContent = await file.text();

      if (mode === "screenshot") {
        // Screenshot mode: render in iframe, capture as image
        const { iframe, doc, win } = await loadHtmlInIframe(htmlContent, width, height);
        try {
          const dataUri = await captureScreenshot(doc, win, width, height);
          const slide = pptx.addSlide();
          slide.addImage({ data: dataUri, x: 0, y: 0, w: SLIDE_W, h: SLIDE_H });
        } finally {
          document.body.removeChild(iframe);
        }
      } else {
        // Editable mode: extract DOM elements and build native PPTX objects
        const { iframe, doc } = await loadHtmlInIframe(htmlContent, width, height);
        try {
          const { rawElements, rootBg } = extractElementsFromDocument(doc, width, height);
          const slideData = convertToSlideUnits(rawElements, rootBg, width, height);

          const slide = pptx.addSlide();
          if (slideData.background) slide.background = { color: slideData.background };

          // Ensure text always renders on top: bump every text element's zIndex
          // above the highest shape zIndex so text is never covered.
          const maxNonTextZ = slideData.elements
            .filter(e => e.type !== "text")
            .reduce((mx, e) => Math.max(mx, e.zIndex || 0), 0);

          for (const el of slideData.elements) {
            if (el.type === "text") {
              el.zIndex = Math.max(el.zIndex, maxNonTextZ + 1);
            }
          }

          // Render in strict layer order: shapes → images → text (always last)
          const byZ = (a, b) => (a.zIndex - b.zIndex) || (a.id - b.id);
          const shapes = slideData.elements.filter(e => e.type === "shape" || e.type === "bgImage").sort(byZ);
          const images = slideData.elements.filter(e => e.type === "image").sort(byZ);
          const texts  = slideData.elements.filter(e => e.type === "text").sort(byZ);

          for (const group of [shapes, images, texts]) {
            for (const el of group) {
              try {
                await renderElement(slide, el, slideData);
              } catch (err) {
                console.warn(`Skip ${el.tag}/${el.type}: ${err.message}`);
              }
            }
          }
        } finally {
          document.body.removeChild(iframe);
        }
      }
    }

    if (onProgress) onProgress(totalFiles, totalFiles, "Generating PPTX…");

    // PptxGenJS browser build returns a Blob when using write("blob")
    const blob = await pptx.write({ outputType: "blob" });
    return blob;
  }

  return { convert };
})();
