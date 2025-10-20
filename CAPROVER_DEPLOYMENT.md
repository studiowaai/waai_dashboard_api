# Deploy Dashboard API to CapRover via GitHub

This guide shows you how to deploy the dashboard-api to CapRover using GitHub as the source.

## Prerequisites

- ✅ CapRover instance running and accessible
- ✅ GitHub repository: https://github.com/casperpijl/db-api
- ✅ Dashboard API code pushed to GitHub repository
- ✅ PostgreSQL database accessible from CapRover

## Step-by-Step Deployment Guide

### Step 1: Prepare Your GitHub Repository

Your repository structure should look like this:

```
db-api/
├── app/
│   ├── __init__.py
│   ├── main.py
│   ├── auth.py
│   ├── config.py
│   ├── db.py
│   ├── deps.py
│   └── routers/
│       ├── admin.py
│       ├── me.py
│       ├── runs.py
│       └── stats.py
├── requirements.txt
├── Dockerfile
├── captain-definition
└── README.md
```

**Important Files:**

1. **`captain-definition`** (already created):

```json
{
  "schemaVersion": 2,
  "dockerfilePath": "./Dockerfile"
}
```

2. **`Dockerfile`** (already created):

```dockerfile
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Step 2: Push Dashboard API to GitHub

If you haven't already pushed the code:

```bash
# Navigate to your local dashboard-api folder
cd c:\Users\User\Documents\Waai\dashboard-api

# Initialize git (if not already done)
git init

# Add all files
git add .

# Commit
git commit -m "Initial commit: Dashboard API"

# Add GitHub remote
git remote add origin https://github.com/casperpijl/db-api.git

# Push to GitHub
git push -u origin main
```

### Step 3: Create App in CapRover

1. **Log into CapRover Dashboard**

   - Navigate to your CapRover URL (e.g., `https://captain.yourdomain.com`)

2. **Create New App**
   - Click on "Apps" in the sidebar
   - Click "Create New App" button
   - Enter app name: `dashboard-api` (or `db-api`)
   - Check "Has Persistent Data" if needed (usually NO for APIs)
   - Click "Create New App"

### Step 4: Configure Environment Variables

1. **Navigate to App Settings**

   - Click on your newly created app (`dashboard-api`)
   - Go to "App Configs" tab

2. **Add Environment Variables**

   Click "Bulk Edit" and add:

   ```
   DATABASE_URL=postgresql+asyncpg://username:password@your-db-host:5432/database_name
   CORS_ORIGIN=https://your-frontend-domain.com
   JWT_SECRET=generate-a-long-random-string-here-32-characters-minimum
   JWT_EXPIRE_MIN=43200
   ```

   **Important Notes:**

   - **DATABASE_URL**: Use your actual PostgreSQL connection string
   - **CORS_ORIGIN**: Set to your frontend domain (or multiple domains separated by comma)
   - **JWT_SECRET**: Generate with `openssl rand -hex 32` - NEVER use a simple password
   - **JWT_EXPIRE_MIN**: 43200 = 30 days (adjust as needed)

3. **Save Configuration**
   - Click "Save & Update"

### Step 5: Enable HTTPS (Recommended)

1. **Enable HTTPS**

   - Still in App Configs
   - Scroll to "HTTP Settings"
   - Check "Enable HTTPS"
   - Click "Save & Update"

2. **Connect Custom Domain (Optional)**
   - Scroll to "Domain Settings"
   - Click "Connect New Domain"
   - Enter your domain: `dashboard-api.yourdomain.com`
   - Click "Connect"
   - Update your DNS to point to CapRover IP

### Step 6: Deploy from GitHub

CapRover supports two methods for GitHub deployment:

#### Method A: Using CapRover CLI (Recommended)

1. **Install CapRover CLI** (if not installed):

   ```bash
   npm install -g caprover
   ```

2. **Login to CapRover**:

   ```bash
   caprover login
   ```

   - Follow prompts to enter your CapRover URL and password

3. **Deploy from GitHub**:

   ```bash
   # Navigate to your dashboard-api folder
   cd c:\Users\User\Documents\Waai\dashboard-api

   # Deploy to CapRover
   caprover deploy
   ```

   - Select your CapRover server
   - Select your app name (`dashboard-api`)
   - Confirm deployment

#### Method B: Using GitHub Webhooks (Continuous Deployment)

1. **Generate Deploy Token in CapRover**

   - In CapRover Dashboard, go to "Apps" → Your App
   - Click "Deployment" tab
   - Scroll to "Method 3: Deploy from Github/Bitbucket/Gitlab"
   - Copy the webhook URL (looks like: `https://captain.yourdomain.com/api/v2/user/apps/webhooks/triggerbuild?namespace=captain&token=YOUR_TOKEN`)

2. **Add Webhook to GitHub**

   - Go to your GitHub repository: https://github.com/casperpijl/db-api
   - Click "Settings" → "Webhooks" → "Add webhook"
   - Paste the CapRover webhook URL
   - Content type: `application/json`
   - Select "Just the push event"
   - Click "Add webhook"

3. **Configure Branch (Optional)**

   - In CapRover app settings, under "Deployment" tab
   - Set "Branch Name" to `main` (or your preferred branch)

4. **Test Deployment**
   - Make a small change to your repository
   - Push to GitHub
   - CapRover will automatically build and deploy!

#### Method C: Manual Tarball Upload

If you prefer not to use GitHub directly:

1. **Create Tarball**:

   ```bash
   cd c:\Users\User\Documents\Waai\dashboard-api
   tar -czf dashboard-api.tar.gz .
   ```

2. **Upload in CapRover**:
   - Go to your app in CapRover
   - Click "Deployment" tab
   - Scroll to "Method 2: Tarball"
   - Upload `dashboard-api.tar.gz`
   - Click "Deploy"

### Step 7: Monitor Deployment

1. **Check Build Logs**

   - In CapRover Dashboard → Your App
   - Click "Deployment" tab
   - Watch the build logs in real-time
   - Look for successful build messages

2. **Check App Logs**

   - Click "App Logs" tab
   - Monitor for any startup errors
   - You should see: `Uvicorn running on http://0.0.0.0:8000`

3. **Verify Deployment**
   - Test health endpoint:
     ```bash
     curl https://dashboard-api.yourdomain.com/health
     # Expected: {"ok":true}
     ```

### Step 8: Test Your API

```bash
# Health check
curl https://dashboard-api.yourdomain.com/health

# Test login (replace with your credentials)
curl -X POST https://dashboard-api.yourdomain.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"yourpassword"}'

# Should return: {"ok":true}
```

### Step 9: Update Frontend Configuration

Update your frontend to use the new API URL:

```typescript
// Before
const API_BASE_URL = "http://localhost:8000";

// After
const API_BASE_URL = "https://dashboard-api.yourdomain.com";
```

---

## Common Issues & Solutions

### Issue 1: Build Fails - "No such file or directory"

**Solution**: Ensure all files are committed and pushed to GitHub

```bash
git add .
git commit -m "Add missing files"
git push
```

### Issue 2: Database Connection Error

**Solution**:

- Verify `DATABASE_URL` is correct in CapRover environment variables
- Ensure database is accessible from CapRover server
- Check firewall rules allow connections

### Issue 3: CORS Errors in Browser

**Solution**:

- Update `CORS_ORIGIN` in CapRover to match your frontend URL exactly
- Include protocol: `https://yourdomain.com` not `yourdomain.com`
- For multiple domains: `https://app1.com,https://app2.com`

### Issue 4: 502 Bad Gateway

**Solution**:

- Check app logs in CapRover
- Verify app is running (should see Uvicorn logs)
- Ensure port 8000 is exposed in Dockerfile
- Restart the app

### Issue 5: JWT Errors / Login Fails

**Solution**:

- Verify `JWT_SECRET` is set in environment variables
- Check database has users table with correct credentials
- Verify password hashes are correct in database

---

## Updating Your Deployment

### Automatic Updates (if using GitHub webhook):

Simply push to GitHub:

```bash
git add .
git commit -m "Update API"
git push
```

CapRover will automatically rebuild and redeploy.

### Manual Updates via CLI:

```bash
cd c:\Users\User\Documents\Waai\dashboard-api
caprover deploy
```

---

## Rollback Plan

If deployment fails:

1. **Revert to Previous Version**

   - CapRover keeps previous Docker images
   - In App settings, you can manually select previous image

2. **Check Logs**

   - Review build logs and app logs
   - Identify the error

3. **Fix and Redeploy**
   - Fix the issue in code
   - Push to GitHub or redeploy via CLI

---

## Environment Variables Reference

| Variable         | Required | Example                                       | Description                                  |
| ---------------- | -------- | --------------------------------------------- | -------------------------------------------- |
| `DATABASE_URL`   | ✅ Yes   | `postgresql+asyncpg://user:pass@host:5432/db` | PostgreSQL connection string                 |
| `CORS_ORIGIN`    | ✅ Yes   | `https://dashboard.yourdomain.com`            | Allowed frontend URL(s)                      |
| `JWT_SECRET`     | ✅ Yes   | `a1b2c3d4e5f6...` (32+ chars)                 | Secret key for JWT signing                   |
| `JWT_EXPIRE_MIN` | ❌ No    | `43200`                                       | JWT expiration in minutes (default: 30 days) |

---

## Security Checklist

Before deploying to production:

- [ ] Generate strong `JWT_SECRET` (32+ random characters)
- [ ] Use HTTPS (enable in CapRover)
- [ ] Set specific `CORS_ORIGIN` (not `*`)
- [ ] Use strong database password
- [ ] Restrict database access to CapRover IP
- [ ] Enable CapRover firewall if available
- [ ] Set up monitoring and alerts
- [ ] Back up database regularly

---

## Next Steps

1. ✅ Deploy dashboard-api to CapRover
2. ⏳ Test all endpoints
3. ⏳ Update frontend to use new API URL
4. ⏳ Deploy node-api (separate guide)
5. ⏳ Test complete workflow

---

## Quick Reference Commands

```bash
# Deploy via CLI
caprover deploy

# View logs
caprover logs -a dashboard-api

# SSH into container
caprover logs -a dashboard-api --follow

# Test health endpoint
curl https://dashboard-api.yourdomain.com/health
```

---

**Congratulations! Your Dashboard API should now be deployed on CapRover! 🚀**

For issues, check:

1. CapRover app logs
2. Build logs
3. Database connectivity
4. Environment variables
