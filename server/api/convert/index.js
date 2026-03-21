const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');
const PptxGenJS = require('pptxgenjs');
const formidable = require('formidable-serverless');

module.exports = async function (context, req) {
  context.log('Convert request received');

  try {
    // Parse multipart form data
    const form = new formidable.IncomingForm();
    const files = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve({ fields, files });
      });
    });

    if (!files.files || files.files.length === 0) {
      context.res = {
        status: 400,
        body: { error: 'No HTML files uploaded' }
      };
      return;
    }

    const resolution = files.fields?.resolution || '720p';
    const resolutions = {
      '720p': { width: 1280, height: 720, scale: 2 },
      '1080p': { width: 1920, height: 1080, scale: 2 }
    };
    const res = resolutions[resolution] || resolutions['720p'];

    // Launch Puppeteer with @sparticuz/chromium
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const screenshots = [];
    
    // Process each HTML file
    for (const file of Array.isArray(files.files) ? files.files : [files.files]) {
      const page = await browser.newPage();
      
      await page.setViewport({
        width: res.width,
        height: res.height,
        deviceScaleFactor: res.scale
      });

      // Read HTML content
      const fs = require('fs');
      const htmlContent = fs.readFileSync(file.path, 'utf8');
      
      await page.setContent(htmlContent, {
        waitUntil: 'networkidle0',
        timeout: 30000
      });

      await page.evaluate(() => document.fonts.ready);
      await new Promise(r => setTimeout(r, 500));

      const screenshot = await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width: res.width, height: res.height }
      });

      screenshots.push(screenshot);
      await page.close();
    }

    await browser.close();

    // Build PPTX
    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: 'CUSTOM', width: 10, height: 5.625 });
    pptx.layout = 'CUSTOM';

    for (const screenshot of screenshots) {
      const slide = pptx.addSlide();
      const base64 = screenshot.toString('base64');
      const dataUri = `data:image/png;base64,${base64}`;
      
      slide.addImage({
        data: dataUri,
        x: 0,
        y: 0,
        w: '100%',
        h: '100%'
      });
    }

    // Generate PPTX buffer
    const pptxBuffer = await pptx.write({ outputType: 'nodebuffer' });

    context.res = {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': 'attachment; filename="presentation.pptx"'
      },
      isRaw: true,
      body: pptxBuffer
    };

  } catch (error) {
    context.log.error('Conversion error:', error);
    context.res = {
      status: 500,
      body: { error: error.message || 'Conversion failed' }
    };
  }
};
