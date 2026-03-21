# Azure Deployment Setup Script for Windows PowerShell
# This script helps you deploy your HTML-to-PPTX app to Azure

Write-Host "================================" -ForegroundColor Cyan
Write-Host "Azure Deployment Setup" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# Check if Azure CLI is installed
try {
    az version | Out-Null
    Write-Host "✅ Azure CLI found" -ForegroundColor Green
} catch {
    Write-Host "❌ Azure CLI is not installed." -ForegroundColor Red
    Write-Host "Please install it from: https://aka.ms/installazurecli" -ForegroundColor Yellow
    exit 1
}

Write-Host ""

# Login to Azure
Write-Host "Logging in to Azure..." -ForegroundColor Yellow
az login

# Set variables
$RESOURCE_GROUP = "html-to-pptx-rg"
$LOCATION = "eastus"
$TIMESTAMP = [int](Get-Date -UFormat %s)
$APP_NAME = "html-to-pptx-app-$TIMESTAMP"
$PLAN_NAME = "html-to-pptx-plan"
$SKU = "B2"  # Basic B2 - 3.5GB RAM for Puppeteer

Write-Host ""
Write-Host "Configuration:" -ForegroundColor Cyan
Write-Host "  Resource Group: $RESOURCE_GROUP"
Write-Host "  Location: $LOCATION"
Write-Host "  App Name: $APP_NAME"
Write-Host "  Plan: $PLAN_NAME"
Write-Host "  SKU: $SKU"
Write-Host ""

$confirmation = Read-Host "Continue with deployment? (y/n)"
if ($confirmation -ne 'y') {
    Write-Host "Deployment cancelled." -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "Step 1: Creating Resource Group..." -ForegroundColor Yellow
az group create `
  --name $RESOURCE_GROUP `
  --location $LOCATION

Write-Host ""
Write-Host "Step 2: Creating App Service Plan (Linux)..." -ForegroundColor Yellow
az appservice plan create `
  --name $PLAN_NAME `
  --resource-group $RESOURCE_GROUP `
  --is-linux `
  --sku $SKU

Write-Host ""
Write-Host "Step 3: Creating Web App..." -ForegroundColor Yellow
az webapp create `
  --name $APP_NAME `
  --resource-group $RESOURCE_GROUP `
  --plan $PLAN_NAME `
  --runtime "NODE:18-lts"

Write-Host ""
Write-Host "Step 4: Configuring App Settings..." -ForegroundColor Yellow
az webapp config appsettings set `
  --name $APP_NAME `
  --resource-group $RESOURCE_GROUP `
  --settings `
    NODE_ENV=production `
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false `
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium `
    WEBSITES_ENABLE_APP_SERVICE_STORAGE=true

Write-Host ""
Write-Host "Step 5: Enabling Application Logging..." -ForegroundColor Yellow
az webapp log config `
  --name $APP_NAME `
  --resource-group $RESOURCE_GROUP `
  --application-logging filesystem `
  --level information

Write-Host ""
Write-Host "Step 6: Getting Publish Profile for GitHub Actions..." -ForegroundColor Yellow
az webapp deployment list-publishing-profiles `
  --name $APP_NAME `
  --resource-group $RESOURCE_GROUP `
  --xml | Out-File -FilePath "publish-profile.xml" -Encoding UTF8

Write-Host ""
Write-Host "================================" -ForegroundColor Green
Write-Host "✅ Azure Resources Created!" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Green
Write-Host ""
Write-Host "App URL: https://$APP_NAME.azurewebsites.net" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "1. Copy the publish profile from: publish-profile.xml"
Write-Host "2. Go to GitHub → Settings → Secrets → Actions"
Write-Host "3. Create a new secret: AZURE_WEBAPP_PUBLISH_PROFILE"
Write-Host "4. Paste the content from publish-profile.xml"
Write-Host "5. Update .github/workflows/azure-deploy.yml:"
Write-Host "   Change AZURE_WEBAPP_NAME to: $APP_NAME"
Write-Host "6. Push to main branch to trigger deployment"
Write-Host ""
Write-Host "To view logs:" -ForegroundColor Cyan
Write-Host "  az webapp log tail --name $APP_NAME --resource-group $RESOURCE_GROUP"
Write-Host ""
Write-Host "To delete resources:" -ForegroundColor Cyan
Write-Host "  az group delete --name $RESOURCE_GROUP --yes --no-wait"
Write-Host ""
