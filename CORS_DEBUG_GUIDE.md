# CORS Still Not Working - Debug & Fix Guide

## Current Situation

- ✅ Environment variable `CORS_ORIGIN=https://dashboard.apps.studiowaai.nl` is set in CapRover
- ❌ CORS errors still occurring
- ❌ No request logs in db-api (requests blocked by CORS preflight)

## Root Cause Analysis

The CORS preflight request (OPTIONS) is being rejected **before** it reaches your FastAPI application. This could mean:

1. Environment variable not being loaded properly
2. App is using cached/old code
3. CORS configuration has an issue

---

## Fix Steps

### Step 1: Update Your Code with Debug Endpoints

I've added debug logging to your `dashboard-api/app/main.py`. You need to:

1. **Commit and push the changes:**
   ```bash
   cd c:\Users\User\Documents\Waai\dashboard-api
   git add .
   git commit -m "Add CORS debugging"
   git push
   ```

2. **Redeploy to CapRover:**
   - If using webhooks, it will auto-deploy
   - Or use: `caprover deploy`

### Step 2: Check the Startup Logs

After redeployment:

1. Go to CapRover → Apps → **db-api** → **App Logs**
2. Look for these lines at startup:
   ```
   🚀 Starting n8n Dashboard API
   🌐 CORS Origins configured: ['https://dashboard.apps.studiowaai.nl']
   ```

3. **If you see:**
   - `['http://localhost:3000']` → Environment variable NOT loaded
   - `['*']` → CORS_ORIGIN is still set to `*`
   - `['https://dashboard.apps.studiowaai.nl']` → ✅ Correct!

### Step 3: Test the Debug Endpoint

Visit this URL in your browser:
```
https://db-api.apps.studiowaai.nl/debug/cors
```

This will show you:
- What environment variables the app can see
- What CORS configuration is actually being used

**Expected output:**
```json
{
  "CORS_ORIGIN_env": "https://dashboard.apps.studiowaai.nl",
  "CORS_ORIGINS_config": ["https://dashboard.apps.studiowaai.nl"],
  "all_env_vars": {
    "CORS_ORIGIN": "https://dashboard.apps.studiowaai.nl",
    "DATABASE_URL": "postgresql+asyncpg://...",
    "JWT_SECRET": "67186de...",
    "JWT_EXPIRE_MIN": "43200"
  }
}
```

**If you see different values**, the environment variables aren't being loaded!

---

## Common Issues & Solutions

### Issue 1: Environment Variable Not Loading

**Symptoms:**
- Debug endpoint shows `CORS_ORIGIN_env: "NOT SET"`
- Or shows `http://localhost:3000`

**Solution:**
1. Double-check in CapRover → db-api → App Configs
2. Make sure `CORS_ORIGIN` (singular, not plural) is set
3. Click "Save & Update" again
4. Check logs after restart

### Issue 2: Old Code Still Running

**Symptoms:**
- Logs don't show the 🚀 and 🌐 emojis
- Debug endpoint returns 404

**Solution:**
1. Make sure you pushed the updated code to GitHub
2. Force rebuild in CapRover:
   - Go to Deployment tab
   - Click "Force Build"
3. Or redeploy via CLI: `caprover deploy`

### Issue 3: CapRover Reverse Proxy Issue

**Symptoms:**
- Everything looks correct but CORS still fails
- OPTIONS requests never reach the app

**Solution:**
Try accessing the API directly without HTTPS:
```bash
curl -I http://srv-captain--db-api/health
```

If this works but HTTPS doesn't, it's a CapRover SSL/proxy issue.

---

## Quick Test After Each Step

After making changes, test with this curl command:

```bash
curl -X OPTIONS https://db-api.apps.studiowaai.nl/auth/login \
  -H "Origin: https://dashboard.apps.studiowaai.nl" \
  -H "Access-Control-Request-Method: POST" \
  -v
```

**Expected response headers:**
```
< HTTP/2 200
< access-control-allow-origin: https://dashboard.apps.studiowaai.nl
< access-control-allow-credentials: true
< access-control-allow-methods: *
< access-control-allow-headers: *
```

**If you get:**
- `access-control-allow-origin: *` → Still using wildcard
- No CORS headers → CORS middleware not working
- 404 → CapRover routing issue

---

## Nuclear Option: Rebuild Everything

If nothing works, try this:

### 1. Delete and Recreate the App

1. **Export environment variables** (copy them somewhere safe)
2. In CapRover, delete the `db-api` app
3. Create a new app with the same name
4. Set all environment variables again
5. Deploy fresh

### 2. Verify the Code is Correct

Make sure your local `dashboard-api` folder has:

```python
# app/config.py
_cors_origins = os.getenv("CORS_ORIGIN", "http://localhost:3000")
```

Not `CORS_ORIGINS` (plural) - it should be singular!

---

## Alternative: Hardcode for Testing

**Temporary test** - to verify if it's an env var issue:

Edit `dashboard-api/app/config.py`:

```python
# TEMPORARY TEST - Remove after confirming it works
CORS_ORIGINS = ["https://dashboard.apps.studiowaai.nl"]

# Comment out the original code:
# _cors_origins = os.getenv("CORS_ORIGIN", "http://localhost:3000")
# if _cors_origins.strip() == "*":
#     CORS_ORIGINS = ["*"]
# else:
#     CORS_ORIGINS = [origin.strip() for origin in _cors_origins.split(",")]
```

Then deploy. If this works, you know it's an environment variable loading issue.

---

## Next Steps

1. ✅ Push the debug code changes
2. ✅ Redeploy to CapRover
3. ✅ Check startup logs for 🌐 CORS configuration
4. ✅ Visit `/debug/cors` endpoint
5. ✅ Test the curl command
6. ✅ Try login from frontend

---

## What to Send Me

If it still doesn't work, provide:

1. **Output from** `https://db-api.apps.studiowaai.nl/debug/cors`
2. **Startup logs** showing the CORS configuration line
3. **Browser console error** (exact CORS error message)
4. **Network tab** showing the OPTIONS request and response headers

This will help diagnose the exact issue!

---

**After you deploy the debug changes, check the logs and debug endpoint - that will tell us exactly what's wrong! 🔍**
