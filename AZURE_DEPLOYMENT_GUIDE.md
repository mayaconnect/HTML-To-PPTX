# Azure Deployment Guide - HTML-To-PPTX Converter (Free/Low-Cost)

This guide shows the **simplest and cheapest** way to deploy your HTML-to-PPTX converter on Azure.

## 💰 Free/Low-Cost Options

### Best Option: Azure Container Apps (FREE TIER)

**Cost: $0/month** (within free tier limits)
- ✅ 180,000 vCPU-seconds/month FREE
- ✅ 360,000 GiB-seconds/month FREE  
- ✅ 2 million requests/month FREE
- ✅ Perfect for testing and personal use
- ✅ Works great with Puppeteer

### Alternative: App Service Free (F1)

**Cost: $0/month** but:
- ⚠️ Only 1GB RAM - Puppeteer may crash
- ⚠️ 60 minutes/day compute time limit
- ⚠️ Not recommended for Puppeteer apps

### Recommended: App Service B1 (if Container Apps doesn't work)

**Cost: ~$13/month**
- ✅ 1.75GB RAM - Works with Puppeteer
- ✅ No time limits
- ✅ Simpler than Container Apps

---

## 🚀 Quick Deployment (Container Apps - FREE)

This is the simplest and FREE option for personal use.

### Prerequisites
1. Azure account (get free credits at [azure.microsoft.com/free](https://azure.microsoft.com/free))
2. Azure CLI installed: [aka.ms/installazurecli](https://aka.ms/installazurecli)
3. Docker Desktop installed (for local testing)
4. GitHub repository

### Step 1: Create Azure Resources (FREE Container Apps)

Run these commands in PowerShell or Terminal:

```bash
# Login to Azure
az login

# Create resource group
az group create --name html-to-pptx-rg --location eastus

# Create Container Registry (Basic tier - ~$5/month, or use free ACR alternative)
az acr create \
  --name htmltopptxacr$(date +%s) \
  --resource-group html-to-pptx-rg \
  --sku Basic \
  --admin-enabled true

# Get ACR credentials (save these for GitHub Secrets)
az acr credential show --name htmltopptxacr* --resource-group html-to-pptx-rg

# Create Container Apps Environment (FREE tier)
az containerapp env create \
  --name html-to-pptx-env \
  --resource-group html-to-pptx-rg \
  --location eastus

# Build and push Docker image
az acr build --registry htmltopptxacr* --image html-to-pptx-app:latest .

# Create Container App (FREE tier with limits)
az containerapp create \
  --name html-to-pptx-app \
  --resource-group html-to-pptx-rg \
  --environment html-to-pptx-env \
  --image htmltopptxacr*.azurecr.io/html-to-pptx-app:latest \
  --target-port 3000 \
  --ingress external \
  --registry-server htmltopptxacr*.azurecr.io \
  --cpu 0.5 \
  --memory 1.0Gi \
  --min-replicas 0 \
  --max-replicas 1
```

**Note:** Replace `htmltopptxacr*` with your actual registry name.

### Step 2: Setup GitHub Secrets

Get your ACR credentials:
```bash
az acr credential show --name YOUR_ACR_NAME --resource-group html-to-pptx-rg
```

In GitHub → Settings → Secrets → Actions, add:
- **ACR_USERNAME**: (from command above)
- **ACR_PASSWORD**: (from command above)

Get Azure credentials for GitHub Actions:
```bash
az ad sp create-for-rbac \
  --name "html-to-pptx-github" \
  --role contributor \
  --scopes /subscriptions/YOUR_SUBSCRIPTION_ID/resourceGroups/html-to-pptx-rg \
  --sdk-auth
```

Add to GitHub Secrets as **AZURE_CREDENTIALS** (paste entire JSON output).

### Step 3: Update GitHub Workflow

Edit `.github/workflows/azure-container-deploy.yml` and update:
- `AZURE_CONTAINER_REGISTRY`: Your ACR name (without .azurecr.io)
- `RESOURCE_GROUP`: html-to-pptx-rg
- `CONTAINER_APP_NAME`: html-to-pptx-app

### Step 4: Deploy

```bash
git add .
git commit -m "Azure deployment setup"
git push origin main
```

Your app will be at: `https://html-to-pptx-app.RANDOM.eastus.azurecontainerapps.io`

---

## 🔄 Alternative: Cheaper App Service B1 ($13/month)

If Container Apps is too complex:

```bash
# Login
az login

# Create App Service Plan (B1 - cheapest that works with Puppeteer)
az appservice plan create \
  --name html-to-pptx-plan \
  --resource-group html-to-pptx-rg \
  --is-linux \
  --sku B1

# Create Web App
az webapp create \
  --name html-to-pptx-app-$(date +%s) \
  --resource-group html-to-pptx-rg \
  --plan html-to-pptx-plan \
  --runtime "NODE:18-lts"

# Configure app settings
az webapp config appsettings set \
  --name YOUR_APP_NAME \
  --resource-group html-to-pptx-rg \
  --settings \
    NODE_ENV=production \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Get publish profile for GitHub
az webapp deployment list-publishing-profiles \
  --name YOUR_APP_NAME \
  --resource-group html-to-pptx-rg \
  --xml > publish-profile.xml
```

Add `publish-profile.xml` content to GitHub Secrets as `AZURE_WEBAPP_PUBLISH_PROFILE`.

Use `.github/workflows/azure-deploy.yml` workflow (already created).

---

## Post-Deployment

### 1. Update Your Code for Azure

Modify `server/index.js` to use Azure's port:

```javascript
const PORT = process.env.PORT || 3000;
```

### 2. Test Your Deployment

```bash
# Get your app URL
az webapp show \
  --name html-to-pptx-app \
  --resource-group html-to-pptx-rg \
  --query "defaultHostName" \
  --output tsv

# Your app will be at: https://html-to-pptx-app.azurewebsites.net
```

### 3. Monitor Logs

```bash
# Stream logs
az webapp log tail \
  --name html-to-pptx-app \
  --resource-group html-to-pptx-rg
```

Or in Azure Portal: **Monitoring** → **Log stream**

### 4. Scale if Needed

```bash
# Scale up to B2 for better performance
az appservice plan update \
  --name html-to-pptx-plan \
  --resource-group html-to-pptx-rg \
  --sku B2
```

---

## Troubleshooting

### Puppeteer Issues

If Puppeteer fails to launch:

1. Check Chromium is installed:
```bash
az webapp ssh --name html-to-pptx-app --resource-group html-to-pptx-rg
which chromium
```

2. Update Puppeteer launch args in `server/index.js`:
```javascript
const browser = await puppeteer.launch({
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu'
  ],
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
});
```

### File Storage Issues

For persistent file storage, use Azure Blob Storage:

```bash
# Create storage account
az storage account create \
  --name htmltopptxstorage \
  --resource-group html-to-pptx-rg \
  --sku Standard_LRS

# Get connection string
az storage account show-connection-string \
  --name htmltopptxstorage \
  --resource-group html-to-pptx-rg
```

Add connection string to App Settings as `AZURE_STORAGE_CONNECTION_STRING`.

---

## Cost Optimization

### Scale to Zero (Container Apps only)
```bash
az containerapp update \
  --name html-to-pptx-app \
  --resource-group html-to-pptx-rg \
  --min-replicas 0 \
  --max-replicas 3
```

### Auto-stop (App Service)
Set up auto-shutdown during non-business hours using Azure Automation.

---

## Next Steps

1. ✅ Set up custom domain and SSL
2. ✅ Configure Azure Application Insights for monitoring
3. ✅ Implement Azure Blob Storage for file persistence
4. ✅ Add authentication (Azure AD B2C)
5. ✅ Set up CI/CD pipeline with staging slots

---

## Quick Start Checklist

- [ ] Create Azure Resource Group
- [ ] Create App Service or Container App
- [ ] Configure App Settings
- [ ] Get publish profile or ACR credentials
- [ ] Add secrets to GitHub
- [ ] Create GitHub Actions workflow
- [ ] Update PORT in server/index.js
- [ ] Push to main branch
- [ ] Monitor deployment
- [ ] Test application

---

## Support & Resources

- [Azure App Service Documentation](https://learn.microsoft.com/azure/app-service/)
- [Azure Container Apps Documentation](https://learn.microsoft.com/azure/container-apps/)
- [Puppeteer on Azure](https://github.com/puppeteer/puppeteer/blob/main/docs/troubleshooting.md)
- [GitHub Actions for Azure](https://github.com/Azure/actions)

---

**Need help?** Check Azure Portal → Your App → **Diagnose and solve problems**
📊 Post-Deployment

### Get Your App URL

**Container Apps:**
```bash
az containerapp show \
  --name html-to-pptx-app \
  --resource-group html-to-pptx-rg \
  --query "properties.configuration.ingress.fqdn" \
  --output tsv
```

**App Service:**
```bash
az webapp show \
  --name YOUR_APP_NAME \
  --resource-group html-to-pptx-rg \
  --query "defaultHostName" \
  --output tsv
```

### Test Your App
```bash
curl https://YOUR_APP_URL/api/health
```

### View Logs

**Container Apps:**
```bash
az containerapp logs show \
  --name html-to-pptx-app \
  --resource-group html-to-pptx-rg \
  --follow
```

**App Service:**
```bash
az webapp log tail \
  --name YOUR_APP_NAME \
  --resource-group html-to-pptx-rg
```

---

## 🐛 Troubleshooting

### App not responding
- Check logs (see commands above)
- Verify GitHub Actions workflow completed successfully
- Ensure Docker image built correctly

### Puppeteer crashes
- Container Apps: Increase memory to 1.5Gi or 2Gi
- App Service: Use B1 minimum (not F1 free tier)

### Out of free tier limits
- Container Apps free tier: 180k vCPU-seconds/month
- If exceeded, costs are very low (~$0.000012/second)
- Set `--max-replicas 1` to control costs

---

## 💡 Cost Tips

1. **Use free tier limits**: Set min-replicas to 0 (scale to zero when idle)
2. **Lower resources**: Use 0.5 vCPU and 1GB memory for testing
3. **Delete when not needed**: `az group delete --name html-to-pptx-rg --yes`
4. **Monitor usage**: Check Azure Portal → Cost Management

### Delete Everything
```bash
az group delete --name html-to-pptx-rg --yes --no-wait
```

---

## ✅ Quick Checklist

- [ ] Azure account created (free credits available)
- [ ] Azure CLI installed
- [ ] Docker installed (for local testing)
- [ ] GitHub repo with code
- [ ] Run deployment commands
- [ ] Add GitHub Secrets (ACR credentials, Azure credentials)
- [ ] Push to main to trigger deployment
- [ ] Test app URL

---

## 📚 What You Get

- **Container Apps (FREE)**: Best option, scales to zero
- **App Service B1 ($13/month)**: Simpler but always running
- **Automatic HTTPS**: SSL included free
- **GitHub Actions CI/CD**: Deploys on every push
- **Puppeteer with Chromium**: Full browser automation

---

**Need help?** Check logs first, 90% of issues show there!