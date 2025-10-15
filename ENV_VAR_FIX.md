# Environment Variables Not Loading - Fix

## Problem Identified ✅

Your startup log shows:

```
🌐 CORS Origins configured: ['http://localhost:3000']
```

But you set `CORS_ORIGIN=https://dashboard.apps.studiowaai.nl` in CapRover.

**This means the environment variable is NOT being loaded!**

---

## Root Cause

CapRover environment variables are set, but the Python app isn't seeing them at runtime.

---

## Solution: Verify & Fix Environment Variables in CapRover

### Step 1: Double-Check Environment Variables

1. Go to **CapRover Dashboard** → **Apps** → **db-api**
2. Click **App Configs** tab
3. Scroll down to **Environmental Variables** section
4. **Make sure you're adding variables in the RIGHT place:**

There are TWO sections in CapRover:

- ❌ **Build Args** (used during build - not what you want)
- ✅ **Environmental Variables** (used at runtime - what you want!)

**You should see:**

```
Key: CORS_ORIGIN
Value: https://dashboard.apps.studiowaai.nl

Key: DATABASE_URL
Value: postgresql+asyncpg://reporting_owner:Dikkevetteai123@srv-captain--postgres:5432/reporting

Key: JWT_SECRET
Value: 67186de21be25208258ffbee4a998cb897a48aee565308c26e5984dfacc67a87

Key: JWT_EXPIRE_MIN
Value: 43200
```

### Step 2: Use Bulk Edit (Easier)

1. In **App Configs** tab, click **"Bulk Edit"** button
2. Paste this EXACTLY:
   ```
   CORS_ORIGIN=https://dashboard.apps.studiowaai.nl
   DATABASE_URL=postgresql+asyncpg://reporting_owner:Dikkevetteai123@srv-captain--postgres:5432/reporting
   JWT_SECRET=67186de21be25208258ffbee4a998cb897a48aee565308c26e5984dfacc67a87
   JWT_EXPIRE_MIN=43200
   ```
3. Click **"Save & Update"**
4. Wait for the app to restart (30 seconds)

### Step 3: Force Restart (if needed)

Sometimes CapRover needs a hard restart:

1. Go to **App Configs**
2. Scroll down to **Default Nginx Configurations**
3. Just click **"Save & Update"** again (even without changes)
4. This forces a full restart with fresh env vars

---

## Verify the Fix

### Method 1: Check Startup Logs

After restart, check logs again:

1. CapRover → Apps → db-api → **App Logs**
2. Look for the startup message
3. Should now show:
   ```
   INFO:app.main:🌐 CORS Origins configured: ['https://dashboard.apps.studiowaai.nl']
   ```

### Method 2: Check Debug Endpoint

Visit:

```
https://db-api.apps.studiowaai.nl/debug/cors
```

Should show:

```json
{
  "CORS_ORIGIN_env": "https://dashboard.apps.studiowaai.nl",
  "CORS_ORIGINS_config": ["https://dashboard.apps.studiowaai.nl"],
  "all_env_vars": {
    "CORS_ORIGIN": "https://dashboard.apps.studiowaai.nl",
    ...
  }
}
```

---

## Alternative: Set ENV in Dockerfile (Not Recommended)

If CapRover env vars still don't work, you can hardcode for testing:

```dockerfile
# Add after WORKDIR /app
ENV CORS_ORIGIN=https://dashboard.apps.studiowaai.nl
ENV DATABASE_URL=postgresql+asyncpg://reporting_owner:Dikkevetteai123@srv-captain--postgres:5432/reporting
ENV JWT_SECRET=67186de21be25208258ffbee4a998cb897a48aee565308c26e5984dfacc67a87
ENV JWT_EXPIRE_MIN=43200
```

**But this is BAD practice** - environment variables should be in CapRover, not hardcoded.

---

## Screenshot Guide

When in CapRover App Configs, you should see:

```
┌─────────────────────────────────────────┐
│ Environmental Variables                 │
├─────────────────────────────────────────┤
│ [Add More Environmental Variables]      │
│                                         │
│ Key                   Value             │
│ CORS_ORIGIN          https://...        │
│ DATABASE_URL         postgresql+...     │
│ JWT_SECRET           67186de2...        │
│ JWT_EXPIRE_MIN       43200              │
│                                         │
│        or use                           │
│                                         │
│ [Bulk Edit]  ← Click this              │
└─────────────────────────────────────────┘
```

---

## Why This Happens

CapRover environment variables are injected into the container at runtime, but sometimes:

1. Variables are set in wrong section (Build Args vs Environmental Variables)
2. App needs restart to pick up changes
3. Caching issues in CapRover

---

## Next Steps

1. ✅ Go to CapRover → db-api → App Configs
2. ✅ Use **Bulk Edit** to set all env vars
3. ✅ Click **Save & Update**
4. ✅ Wait 30 seconds
5. ✅ Check startup logs - should show correct CORS origin
6. ✅ Visit `/debug/cors` to verify
7. ✅ Test login from frontend

---

**Once the startup log shows the correct CORS origin, the CORS errors will be fixed! 🎉**
