# Static Web Apps Deployment - Quick Fix Guide

## ✅ Issue Fixed!

The deployment was failing because the workflow had incorrect paths. This has been corrected:

### Changes Made

1. **Workflow file updated** (`.github/workflows/azure-static-web-apps-*.yml`):
   ```yaml
   app_location: "/client"        # ✅ Fixed (was "/")
   api_location: "/server/api"    # ✅ Fixed (was "")
   skip_app_build: true            # ✅ Added (no build needed)
   ```

2. **Created `.funcignore`** to exclude unnecessary files from API deployment

3. **Created `local.settings.json`** for local Azure Functions development

## 🚀 Deploy Again

Simply commit and push these changes:

```bash
git add .
git commit -m "Fix Static Web Apps deployment configuration"
git push origin main
```

The deployment should succeed now!

## 📍 Verify Deployment

After pushing (wait ~2-3 minutes):

1. **Check GitHub Actions**: Your repository → Actions tab
   - Should show green ✅ checkmark

2. **Get your URL**:
   ```bash
   # View in Azure Portal
   az staticwebapp show --name html-to-pptx-app --resource-group html-to-pptx-rg
   ```
   
   Your app will be at: `https://witty-pebble-0bb4bc803.azurestaticapps.net` (or similar)

3. **Test endpoints**:
   - Frontend: `https://YOUR_URL/`
   - Health: `https://YOUR_URL/api/health`
   - Convert: `https://YOUR_URL/api/convert`

## 🐛 If Still Failing

### Check API Dependencies

Make sure `server/api/package.json` includes:
```json
{
  "dependencies": {
    "pptxgenjs": "^3.12.0",
    "puppeteer-core": "^22.6.0",
    "chrome-aws-lambda": "^10.1.0",
    "formidable-serverless": "^1.1.1"
  }
}
```

### Check Workflow Logs

Go to GitHub → Actions → Click on failed run → "Build and Deploy Job"

Common issues:
- **API build fails**: Check `package.json` in `server/api/`
- **Function runtime error**: Ensure Node.js 18+ is used
- **Puppeteer timeout**: Normal on first cold start

### Alternative: Skip API for Now

To test just the frontend, temporarily set:
```yaml
api_location: ""
```

Then add the API back once frontend works.

## 💰 Cost Reminder

**$0/month** for Static Web Apps free tier:
- 100 GB bandwidth/month
- 2 API apps included
- Unlimited builds
- Free SSL

## 📚 Next Steps

Once deployed successfully:
1. Test the health endpoint: `/api/health`
2. Try uploading an HTML file
3. Check function logs in Azure Portal
4. Add custom domain (optional)

---

**The fix is applied. Push to GitHub and your deployment should work!** ✅
