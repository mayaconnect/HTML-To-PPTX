# Quick Start - FREE Azure Static Web Apps

## 🆓 Deploy with ONE Resource (100% FREE)

**Azure Static Web Apps** - Everything you need in one resource!
- **Cost: $0/month** (Free tier)
- **Includes:** Hosting + API + SSL + CI/CD
- **No credit card required**

⚠️ **Important:** Puppeteer has limitations on Static Web Apps (Azure Functions). For heavy usage, see alternatives at the end.

---

## 🚀 Simple 2-Step Deployment

### Step 1: Create Static Web App (3 minutes)

#### Option A: Azure Portal (Easiest)

1. Go to [Azure Portal](https://portal.azure.com)
2. Click **"Create a resource"** → Search **"Static Web App"**
3. Configure:
   - **Subscription:** Your subscription
   - **Resource Group:** Create new `html-to-pptx-rg`
   - **Name:** `html-to-pptx-app`
   - **Plan type:** **Free**
   - **Region:** East US 2 (or closest to you)
   - **Deployment source:** **GitHub**
4. Sign in to GitHub when prompted
5. Select:
   - **Organization:** Your GitHub account
   - **Repository:** Your repo name
   - **Branch:** main
6. **Build Presets:** Custom
   - **App location:** `/client`
   - **Api location:** `/server`
   - **Output location:** (leave empty)
7. Click **"Review + create"** → **"Create"**

Done! Azure automatically creates a GitHub Actions workflow.

#### Option B: Azure CLI (Fast)

```bash
# Login to Azure
az login

# Create Static Web App
az staticwebapp create \
  --name html-to-pptx-app \
  --resource-group html-to-pptx-rg \
  --source https://github.com/YOUR_USERNAME/YOUR_REPO \
  --location eastus2 \
  --branch main \
  --app-location "/client" \
  --api-location "/server" \
  --login-with-github
```

### Step 2: Configure for Azure Functions API (2 minutes)

Azure Static Web Apps runs your backend as **Azure Functions**. You need to adapt your Express server.

**Create `server/api/convert/function.json`:**
```json
{
  "bindings": [
    {
      "authLevel": "anonymous",
      "type": "httpTrigger",
      "direction": "in",
      "name": "req",
      "methods": ["post"],
      "route": "convert"
    },
    {
      "type": "http",
      "direction": "out",
      "name": "res"
    }
  ]
}
```

**Create `server/api/convert/index.js`:**
```javascript
const multipart = require('parse-multipart');
const puppeteer = require('puppeteer');
const PptxGenJS = require('pptxgenjs');

module.exports = async function (context, req) {
  try {
    // Parse multipart form data
    const bodyBuffer = Buffer.from(req.body);
    const boundary = multipart.getBoundary(req.headers['content-type']);
    const parts = multipart.Parse(bodyBuffer, boundary);
    
    // Initialize Puppeteer (with Azure Functions support)
    const browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process'
      ]
    });

    // Process files and generate PPTX
    // ... your conversion logic here ...

    await browser.close();

    context.res = {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': 'attachment; filename="presentation.pptx"'
      },
      body: pptxBuffer
    };
  } catch (error) {
    context.res = {
      status: 500,
      body: { error: error.message }
    };
  }
};
```

**Create `server/api/host.json`:**
```json
{
  "version": "2.0",
  "extensions": {
    "http": {
      "routePrefix": "api"
    }
  },
  "functionTimeout": "00:10:00"
}
```

**Update client to use `/api/` prefix:**

In `client/script.js`, change API endpoint:
```javascript
// Old: fetch('/api/convert', ...)
// New:
fetch('/api/convert', {
  method: 'POST',
  body: formData
})
```

---

## 📍 Your App URL

After deployment:
```
https://html-to-pptx-app.azurestaticapps.net
```

Check deployment status:
```bash
az staticwebapp show \
  --name html-to-pptx-app \
  --resource-group html-to-pptx-rg
```

---

## ⚙️ GitHub Actions (Auto-Created)

Azure creates `.github/workflows/azure-static-web-apps-*.yml` automatically.

If you need to create manually:

```yaml
name: Deploy to Azure Static Web Apps

on:
  push:
    branches:
      - main
  pull_request:
    types: [opened, synchronize, reopened, closed]
    branches:
      - main

jobs:
  build_and_deploy:
    if: github.event_name == 'push' || (github.event_name == 'pull_request' && github.event.action != 'closed')
    runs-on: ubuntu-latest
    name: Build and Deploy
    steps:
      - uses: actions/checkout@v3
        with:
          submodules: true

      - name: Build And Deploy
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          repo_token: ${{ secrets.GITHUB_TOKEN }}
          action: "upload"
          app_location: "/client"
          api_location: "/server"
          output_location: ""

  close_pull_request:
    if: github.event_name == 'pull_request' && github.event.action == 'closed'
    runs-on: ubuntu-latest
    name: Close Pull Request
    steps:
      - name: Close Pull Request
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          action: "close"
```

---

## ⚠️ Important: Puppeteer Limitations

**Static Web Apps use Azure Functions** which have constraints:

1. **Memory:** 1.5GB max (free tier)
2. **Timeout:** 10 minutes max
3. **Cold starts:** 5-10 seconds for first request
4. **Chromium size:** Can cause deployment issues (~150MB)

### Workarounds:

**Option 1: Use puppeteer-core with chrome-aws-lambda**
```bash
npm install puppeteer-core chrome-aws-lambda
```

**Option 2: Use lightweight alternative**
```bash
npm install playwright-aws-lambda
```

**Option 3: If Puppeteer doesn't work on Static Web Apps**

Switch to Container Apps (still mostly free) - see [AZURE_DEPLOYMENT_GUIDE.md](./AZURE_DEPLOYMENT_GUIDE.md)

---

## 🎯 What's Included (FREE)

| Feature | Free Tier |
|---------|-----------|
| **Bandwidth** | 100 GB/month |
| **API (Functions)** | 2 included apps |
| **SSL Certificate** | ✅ Automatic |
| **Custom domains** | ✅ Unlimited |
| **Build minutes** | Unlimited |
| **Environments** | 3 (prod + 2 staging) |

---

## 🐛 Troubleshooting

**Puppeteer fails to install:**
Add to `server/package.json`:
```json
{
  "dependencies": {
    "chrome-aws-lambda": "^10.1.0",
    "puppeteer-core": "^22.6.0"
  }
}
```

Update code:
```javascript
const chromium = require('chrome-aws-lambda');
const puppeteer = require('puppeteer-core');

const browser = await puppeteer.launch({
  args: chromium.args,
  executablePath: await chromium.executablePath,
  headless: chromium.headless
});
```

**Deployment fails:**
- Check GitHub Actions logs
- Verify folder paths (`/client`, `/server`)
- Check Azure Portal → Static Web App → Logs

**API not responding:**
- Wait 2 minutes after first deployment
- Check `/api/health` endpoint
- View logs in Azure Portal

**Delete everything:**
```bash
az staticwebapp delete \
  --name html-to-pptx-app \
  --resource-group html-to-pptx-rg
```

---

## ✅ Quick Checklist

- [ ] Azure account (free)
- [ ] GitHub repository
- [ ] Created Static Web App (Portal or CLI)
- [ ] Added Functions structure (`server/api/`)
- [ ] Updated client API calls
- [ ] Pushed to GitHub
- [ ] Deployment succeeded
- [ ] Tested at `yourapp.azurestaticapps.net`

---

## 🔄 If Puppeteer Doesn't Work

Static Web Apps may struggle with Puppeteer. If so, use **Container Apps instead** (~$5/month):

See → [AZURE_DEPLOYMENT_GUIDE.md](./AZURE_DEPLOYMENT_GUIDE.md)

**Container Apps advantages:**
- ✅ Full Node.js server (no Functions conversion needed)
- ✅ More memory (up to 4GB)
- ✅ No timeout limits
- ✅ Better Puppeteer support
- ✅ Still cheap (~$5/month)

---

**Static Web Apps = Simplest option, but has Puppeteer limitations**  
**Container Apps = Slightly more setup, but better for Puppeteer**
