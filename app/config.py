import os
from dotenv import load_dotenv

# Load .env only if it exists (for local development)
# In CapRover, environment variables are injected directly
load_dotenv()

API_NAME = "n8n Dashboard API"
DATABASE_URL = os.getenv("DATABASE_URL", "")

# Support multiple CORS origins separated by comma
# WARNING: Wildcards "*" are NOT allowed when using credentials (cookies)
_cors_origins = os.getenv("CORS_ORIGIN", "http://localhost:8000")
if _cors_origins.strip() == "*":
    # CRITICAL: Cannot use wildcard with credentials, fallback to localhost
    import sys
    print("⚠️  WARNING: CORS_ORIGIN='*' is not allowed with credentials. Using localhost fallback.", file=sys.stderr)
    CORS_ORIGINS = ["http://localhost:8000"]
else:
    CORS_ORIGINS = [origin.strip() for origin in _cors_origins.split(",") if origin.strip()]

# Optional: allow origin regex, e.g. r"https://.*\\.apps\\.studiowaai\\.nl"
CORS_ORIGIN_REGEX = os.getenv("CORS_ORIGIN_REGEX")

JWT_SECRET   = os.getenv("JWT_SECRET", "change-me")
JWT_EXPIRE_MIN = int(os.getenv("JWT_EXPIRE_MIN", "43200"))
