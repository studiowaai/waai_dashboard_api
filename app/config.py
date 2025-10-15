import os
from dotenv import load_dotenv

# Load .env only if it exists (for local development)
# In CapRover, environment variables are injected directly
load_dotenv()

API_NAME = "n8n Dashboard API"
DATABASE_URL = os.getenv("DATABASE_URL", "")

# Support multiple CORS origins separated by comma, or "*" for all origins
_cors_origins = os.getenv("CORS_ORIGIN", "http://localhost:3000")
if _cors_origins.strip() == "*":
    CORS_ORIGINS = ["*"]
else:
    CORS_ORIGINS = [origin.strip() for origin in _cors_origins.split(",")]

JWT_SECRET   = os.getenv("JWT_SECRET", "change-me")
JWT_EXPIRE_MIN = int(os.getenv("JWT_EXPIRE_MIN", "43200"))
