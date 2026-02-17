from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import declarative_base
from .config import DATABASE_URL

# Only create engine if DATABASE_URL is set
# This prevents crash during startup if DB is not configured yet
if DATABASE_URL:
    engine = create_async_engine(
        DATABASE_URL, 
        future=True, 
        pool_pre_ping=True,
        echo=False  # Set to True for SQL query logging
    )
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
else:
    # No DATABASE_URL configured - app will start but database endpoints will fail
    import logging
    logging.warning("⚠️  DATABASE_URL not set - database functionality will not work")
    engine = None
    SessionLocal = None

Base = declarative_base()

async def get_session():
    if SessionLocal is None:
        raise RuntimeError("Database not configured - DATABASE_URL environment variable is missing")
    async with SessionLocal() as session:
        yield session
