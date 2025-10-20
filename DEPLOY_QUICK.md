# 🚀 Deploy to CapRover - Quick Guide

## Step 1: Push Code to GitHub ✅

```bash
cd c:\Users\User\Documents\Waai\dashboard-api

git init
git add .
git commit -m "Initial commit: Dashboard API"
git remote add origin https://github.com/casperpijl/db-api.git
git branch -M main
git push -u origin main
```

## Step 2: Create App in CapRover 🎯

1. Open CapRover Dashboard: `https://captain.yourdomain.com`
2. Click **Apps** → **Create New App**
3. App Name: `dashboard-api` or `db-api`
4. Click **Create New App**

## Step 3: Set Environment Variables 🔧

1. Click on your new app → **App Configs** tab
2. Click **Bulk Edit** and paste:

```
DATABASE_URL=postgresql+asyncpg://user:pass@host:5432/dbname
CORS_ORIGIN=https://your-frontend-domain.com
JWT_SECRET=GENERATE_RANDOM_32_CHARS_HERE
JWT_EXPIRE_MIN=43200
```

3. Click **Save & Update**

💡 **Generate JWT_SECRET**: Run `openssl rand -hex 32` in terminal

## Step 4: Enable HTTPS 🔒

1. In **App Configs** → **HTTP Settings**
2. Check ☑️ **Enable HTTPS**
3. Click **Save & Update**

## Step 5: Deploy! 🎉

### Method A: CapRover CLI (Easiest)

```bash
# Install CLI
npm install -g caprover

# Login
caprover login

# Deploy
cd c:\Users\User\Documents\Waai\dashboard-api
caprover deploy
```

### Method B: GitHub Webhook (Auto-deploy)

1. In CapRover → Your App → **Deployment** tab
2. Copy webhook URL from "Method 3: Deploy from Github"
3. Go to GitHub repo → **Settings** → **Webhooks** → **Add webhook**
4. Paste webhook URL
5. Click **Add webhook**

Now every `git push` will auto-deploy! 🎊

## Step 6: Test Your API ✨

```bash
# Health check
curl https://dashboard-api.yourdomain.com/health

# Expected: {"ok":true}
```

## Troubleshooting 🔍

**Build failed?**

- Check CapRover build logs
- Ensure all files are pushed to GitHub

**Database error?**

- Verify DATABASE_URL is correct
- Check database is accessible from CapRover

**CORS error?**

- Update CORS_ORIGIN to match frontend URL exactly
- Include `https://` protocol

**502 Bad Gateway?**

- Check app logs in CapRover
- Verify app is running
- Restart app if needed

---

## ✅ Success Checklist

- [✓] Code pushed to GitHub
- [✓] App created in CapRover
- [✓] Environment variables set
- [✓] HTTPS enabled
- [✓] Deployment successful
- [✓] `/health` endpoint returns `{"ok":true}`
- [✓] Can login via `/auth/login`

## 📚 Full Documentation

- Detailed guide: `CAPROVER_DEPLOYMENT.md`
- GitHub setup: `GITHUB_SETUP.md`
- API docs: `README.md`

**You're all set! 🎉**
