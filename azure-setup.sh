#!/bin/bash

# Azure Deployment Setup Script
# This script helps you deploy your HTML-to-PPTX app to Azure

echo "================================"
echo "Azure Deployment Setup"
echo "================================"
echo ""

# Check if Azure CLI is installed
if ! command -v az &> /dev/null; then
    echo "❌ Azure CLI is not installed."
    echo "Please install it from: https://aka.ms/installazurecli"
    exit 1
fi

echo "✅ Azure CLI found"
echo ""

# Login to Azure
echo "Logging in to Azure..."
az login

# Set variables
RESOURCE_GROUP="html-to-pptx-rg"
LOCATION="eastus"
APP_NAME="html-to-pptx-app-$(date +%s)"  # Add timestamp for uniqueness
PLAN_NAME="html-to-pptx-plan"
SKU="B2"  # Basic B2 - 3.5GB RAM for Puppeteer

echo ""
echo "Configuration:"
echo "  Resource Group: $RESOURCE_GROUP"
echo "  Location: $LOCATION"
echo "  App Name: $APP_NAME"
echo "  Plan: $PLAN_NAME"
echo "  SKU: $SKU"
echo ""

read -p "Continue with deployment? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Deployment cancelled."
    exit 0
fi

echo ""
echo "Step 1: Creating Resource Group..."
az group create \
  --name $RESOURCE_GROUP \
  --location $LOCATION

echo ""
echo "Step 2: Creating App Service Plan (Linux)..."
az appservice plan create \
  --name $PLAN_NAME \
  --resource-group $RESOURCE_GROUP \
  --is-linux \
  --sku $SKU

echo ""
echo "Step 3: Creating Web App..."
az webapp create \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --plan $PLAN_NAME \
  --runtime "NODE:18-lts"

echo ""
echo "Step 4: Configuring App Settings..."
az webapp config appsettings set \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --settings \
    NODE_ENV=production \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    WEBSITES_ENABLE_APP_SERVICE_STORAGE=true

echo ""
echo "Step 5: Enabling Application Logging..."
az webapp log config \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --application-logging filesystem \
  --level information

echo ""
echo "Step 6: Getting Publish Profile for GitHub Actions..."
az webapp deployment list-publishing-profiles \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --xml > publish-profile.xml

echo ""
echo "================================"
echo "✅ Azure Resources Created!"
echo "================================"
echo ""
echo "App URL: https://$APP_NAME.azurewebsites.net"
echo ""
echo "Next Steps:"
echo "1. Copy the publish profile from: publish-profile.xml"
echo "2. Go to GitHub → Settings → Secrets → Actions"
echo "3. Create a new secret: AZURE_WEBAPP_PUBLISH_PROFILE"
echo "4. Paste the content from publish-profile.xml"
echo "5. Update .github/workflows/azure-deploy.yml:"
echo "   Change AZURE_WEBAPP_NAME to: $APP_NAME"
echo "6. Push to main branch to trigger deployment"
echo ""
echo "To view logs:"
echo "  az webapp log tail --name $APP_NAME --resource-group $RESOURCE_GROUP"
echo ""
echo "To delete resources:"
echo "  az group delete --name $RESOURCE_GROUP --yes --no-wait"
echo ""
