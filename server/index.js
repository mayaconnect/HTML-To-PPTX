const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const puppeteer = require("puppeteer");
const PptxGenJS = require("pptxgenjs");
const { extractSlideElements, buildEditablePptx } = require("./editableExtractor");

const app = express();
// Use Azure's PORT environment variable (8080) or default to 3000 for local dev
const PORT = process.env.PORT || 3000;

// Ensure required directories exist
const uploadsDir = path.join(__dirname, "uploads");
const outputDir = path.join(__dirname, "output");
const screenshotsDir = path.join(__dirname, "screenshots");

for (const dir of [uploadsDir, outputDir, screenshotsDir]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Configure multer to preserve original filenames and order
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    // Prefix with timestamp to avoid collisions, preserve original name for ordering
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    if (
      path.extname(file.originalname).toLowerCase() === ".html" ||
      file.mimetype === "text/html"
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only HTML files are allowed"));
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB per file
});

// Serve frontend
app.use(express.static(path.join(__dirname, "..", "client")));
// Serve prompt files for download
app.use("/prompts", express.static(path.join(__dirname, "..", ".github", "prompts")));

// Resolution presets
const RESOLUTIONS = {
  "720p": { width: 1280, height: 720, scale: 2 },
  "1080p": { width: 1920, height: 1080, scale: 2 },
};

/**
 * Render an HTML file to a PNG screenshot using Puppeteer.
 */
async function renderHtmlToImage(browser, htmlFilePath, outputImagePath, resolution) {
  const { width, height, scale } = resolution;
  const page = await browser.newPage();

  try {
    await page.setViewport({
      width,
      height,
      deviceScaleFactor: scale,
    });

    // Load the HTML file
    const fileUrl = `file:///${htmlFilePath.replace(/\\/g, "/")}`;
    await page.goto(fileUrl, {
      waitUntil: "networkidle0",
      timeout: 30000,
    });

    // Wait for web fonts to load
    await page.evaluate(() => document.fonts.ready);

    // Additional settle time for CSS animations / lazy rendering
    await new Promise((r) => setTimeout(r, 500));

    // Take screenshot at the exact viewport size (no full-page to respect slide dimensions)
    await page.screenshot({
      path: outputImagePath,
      type: "png",
      clip: { x: 0, y: 0, width, height },
    });
  } finally {
    await page.close();
  }
}

/**
 * Build a PPTX from an ordered array of slide image paths.
 */
async function buildPptx(imagePaths, outputPath, resolution) {
  const pptx = new PptxGenJS();

  // 16:9 layout
  pptx.defineLayout({ name: "CUSTOM", width: 10, height: 5.625 });
  pptx.layout = "CUSTOM";

  for (const imgPath of imagePaths) {
    const slide = pptx.addSlide();

    // Read image as base64 data URI — avoids file-path issues across OSes
    const imgData = fs.readFileSync(imgPath);
    const base64 = imgData.toString("base64");
    const dataUri = `data:image/png;base64,${base64}`;

    slide.addImage({
      data: dataUri,
      x: 0,
      y: 0,
      w: "100%",
      h: "100%",
    });
  }

  await pptx.writeFile({ fileName: outputPath });
}

/**
 * Remove a list of files and directories silently.
 */
function cleanup(files) {
  for (const f of files) {
    try {
      if (fs.existsSync(f)) {
        const stat = fs.statSync(f);
        if (stat.isDirectory()) {
          fs.rmSync(f, { recursive: true, force: true });
        } else {
          fs.unlinkSync(f);
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ---------- API ROUTES ----------

app.post("/api/convert", upload.array("htmlFiles", 100), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "No HTML files uploaded" });
  }

  const resolutionKey = req.body.resolution || "720p";
  const resolution = RESOLUTIONS[resolutionKey] || RESOLUTIONS["720p"];
  const mode = req.body.mode || "screenshot"; // "screenshot" or "editable"

  // Sort files by original filename to preserve intended order
  const sortedFiles = [...req.files].sort((a, b) =>
    a.originalname.localeCompare(b.originalname, undefined, { numeric: true })
  );

  const uploadedPaths = sortedFiles.map((f) => f.path);
  const screenshotPaths = [];
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--font-render-hinting=none",
      ],
      // Use system Chromium on Azure/Linux if available
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    });

    const outputFilename = `presentation_${Date.now()}.pptx`;
    const outputPath = path.join(outputDir, outputFilename);

    if (mode === "editable") {
      // ── Editable mode: extract DOM elements → native PPTX objects ──
      const slideDataArray = [];
      for (const file of sortedFiles) {
        const slideData = await extractSlideElements(browser, file.path, {
          width: resolution.width,
          height: resolution.height,
        });
        slideDataArray.push(slideData);
      }

      await browser.close();
      browser = null;

      await buildEditablePptx(slideDataArray, outputPath);
    } else {
      // ── Screenshot mode (original) ──
      for (let i = 0; i < sortedFiles.length; i++) {
        const file = sortedFiles[i];
        const screenshotPath = path.join(
          screenshotsDir,
          `slide_${Date.now()}_${i}.png`
        );
        await renderHtmlToImage(browser, file.path, screenshotPath, resolution);
        screenshotPaths.push(screenshotPath);
      }

      await browser.close();
      browser = null;

      await buildPptx(screenshotPaths, outputPath, resolution);
    }

    // Send the file
    res.download(outputPath, "presentation.pptx", (err) => {
      cleanup([...uploadedPaths, ...screenshotPaths, outputPath]);
      if (err && !res.headersSent) {
        res.status(500).json({ error: "Failed to send file" });
      }
    });
  } catch (err) {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
    cleanup([...uploadedPaths, ...screenshotPaths]);
    console.error("Conversion error:", err);
    res.status(500).json({ error: err.message || "Conversion failed" });
  }
});

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", resolutions: Object.keys(RESOLUTIONS) });
});

app.listen(PORT, () => {
  console.log(`HTML-to-PPTX server running at http://localhost:${PORT}`);
});
