# Quick Setup: Push Dashboard API to GitHub (db-api)

## If you need to initialize the GitHub repository with your dashboard-api code:

### Option 1: Clone and Copy (Recommended)

```bash
# 1. Clone your empty GitHub repo
cd c:\Users\User\Documents
git clone https://github.com/casperpijl/db-api.git
cd db-api

# 2. Copy all files from dashboard-api to db-api
# In Windows Command Prompt:
xcopy /E /I /Y "c:\Users\User\Documents\Waai\dashboard-api\*" "c:\Users\User\Documents\db-api\"

# 3. Remove the .git folder if copied (to avoid conflicts)
rmdir /S /Q .git

# 4. Initialize git
git init

# 5. Add all files
git add .

# 6. Commit
git commit -m "Initial commit: Dashboard API for CapRover deployment"

# 7. Add remote (if not already added)
git remote add origin https://github.com/casperpijl/db-api.git

# 8. Push to GitHub
git branch -M main
git push -u origin main
```

### Option 2: Push from Existing Folder

```bash
# 1. Navigate to dashboard-api
cd c:\Users\User\Documents\Waai\dashboard-api

# 2. Initialize git (if not already)
git init

# 3. Add all files
git add .

# 4. Commit
git commit -m "Initial commit: Dashboard API"

# 5. Add GitHub remote
git remote add origin https://github.com/casperpijl/db-api.git

# 6. Push to main branch
git branch -M main
git push -u origin main
```

## Files That Should Be in Your GitHub Repository

Verify these files are present:

```
✅ app/__init__.py
✅ app/main.py
✅ app/auth.py
✅ app/config.py
✅ app/db.py
✅ app/deps.py
✅ app/routers/admin.py
✅ app/routers/me.py
✅ app/routers/runs.py
✅ app/routers/stats.py
✅ requirements.txt
✅ Dockerfile
✅ captain-definition
✅ README.md
✅ CAPROVER_DEPLOYMENT.md
✅ .env.example
```

**Do NOT commit:**
- ❌ `.env` (contains secrets)
- ❌ `__pycache__/` (Python cache)
- ❌ `*.pyc` (Python compiled files)

## Create .gitignore

Create a `.gitignore` file in your repository root:

```bash
# Create .gitignore
echo. > .gitignore
```

Add this content to `.gitignore`:

```
# Environment files
.env
.env.local

# Python
__pycache__/
*.py[cod]
*$py.class
*.so
.Python
env/
venv/
ENV/
build/
develop-eggs/
dist/
downloads/
eggs/
.eggs/
lib/
lib64/
parts/
sdist/
var/
wheels/
*.egg-info/
.installed.cfg
*.egg

# IDEs
.vscode/
.idea/
*.swp
*.swo
*~

# OS
.DS_Store
Thumbs.db

# Testing
.pytest_cache/
.coverage
htmlcov/

# Logs
*.log
```

Then commit the .gitignore:

```bash
git add .gitignore
git commit -m "Add .gitignore"
git push
```

## Verify GitHub Repository

Visit: https://github.com/casperpijl/db-api

You should see:
- All the files listed above
- README.md displayed on the main page
- captain-definition in the root

## Next: Deploy to CapRover

Once your code is on GitHub, follow the deployment guide:

📖 See `CAPROVER_DEPLOYMENT.md` for detailed instructions.

**Quick deployment via CapRover CLI:**

```bash
# Install CapRover CLI (if not installed)
npm install -g caprover

# Navigate to your local copy
cd c:\Users\User\Documents\db-api

# Login to CapRover
caprover login

# Deploy
caprover deploy
```

Or set up automatic deployment with GitHub webhooks (see full guide).
