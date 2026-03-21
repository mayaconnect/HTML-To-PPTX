# Azure Static Web Apps - HTML to PPTX

## ✅ ONE Resource Deployment

Your app is now configured for **Azure Static Web Apps** - the simplest free option!

### ✅ Configuration Fixed

The GitHub Actions workflow has been updated with correct paths:
- ✅ **App location**: `/client` (your static HTML/JS files)
- ✅ **API location**: `/server/api` (Azure Functions)
- ✅ **Skip app build**: `true` (no build needed for static files)

### What Changed

1. **Frontend** (`/client`): Served as static files
2. **Backend** (`/server/api`): Runs as Azure Functions (serverless)
3. **No Express needed**: Functions handle HTTP requests directly

### Structure

```
HTML-To-PPTX/
├── client/                    # Static frontend
│   ├── index.html
│   └── script.js
├── server/
│   └── api/                   # Azure Functions
│       ├── host.json          # Functions config
│       ├── package.json       # API dependencies
│       ├── health/            # Health check endpoint
│       │   ├── function.json
│       │   └── index.js
│       └── convert/           # Conversion endpoint
│           ├── function.json
│           └── index.js
├── staticwebapp.config.json   # Static Web Apps config
└── .github/workflows/
    └── azure-static-web-apps.yml
```

### Deploy Now

**Option 1: Azure Portal (Easiest)**
1. Go to https://portal.azure.com
2. Create resource → Static Web App
3. Connect to GitHub
4. Set locations:
   - App: `/client`
   - API: `/server/api`
5. Deploy!

**Option 2: Azure CLI**
```bash
az staticwebapp create \
  --name html-to-pptx-app \
  --resource-group html-to-pptx-rg \
  --source https://github.com/YOUR_USERNAME/YOUR_REPO \
  --location eastus2 \
  --branch main \
  --app-location "/client" \
  --api-location "/server/api" \
  --login-with-github
```

### Endpoints

After deployment:
- **App**: `https://html-to-pptx-app.azurestaticapps.net`
- **Health**: `https://html-to-pptx-app.azurestaticapps.net/api/health`
- **Convert**: `https://html-to-pptx-app.azurestaticapps.net/api/convert`

### Cost

**$0/month** (Free tier includes):
- 100 GB bandwidth
- 2 API apps
- Unlimited build minutes
- SSL certificate
- Custom domains

### Important Notes

⚠️ **Puppeteer on Azure Functions:**
- Uses `chrome-aws-lambda` for smaller bundle size
- May have cold starts (5-10 seconds)
- 1.5GB memory limit
- 10-minute timeout

If Puppeteer causes issues, see [AZURE_DEPLOYMENT_GUIDE.md](./AZURE_DEPLOYMENT_GUIDE.md) for Container Apps alternative.

### Testing Locally

```bash
# Install Azure Functions Core Tools
npm install -g azure-functions-core-tools@4

# Start API locally
cd server/api
npm install
func start

# In another terminal, serve frontend
cd client
npx http-server -p 3000
```

Visit: http://localhost:3000

### Troubleshooting

**Deployment fails:**
- Check GitHub Actions logs
- Verify folder paths in workflow

**API not working:**
- Check `staticwebapp.config.json` routes
- View logs in Azure Portal
- Wait 2-3 minutes after first deployment

**Puppeteer too large:**
- Already using `chrome-aws-lambda` (optimized)
- Alternative: Use headless browsers service API

**Still having issues?**
Consider Container Apps (~$5/month) with full Node.js support - no Functions conversion needed!

### Next Steps

1. Push code to GitHub
2. Azure auto-deploys via GitHub Actions
3. Test at your `.azurestaticapps.net` URL
4. Add custom domain (optional, free)

**That's it! One resource, no management, 100% free.** 🎉
