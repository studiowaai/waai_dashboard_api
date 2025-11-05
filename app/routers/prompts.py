from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional
import httpx
import logging

from ..deps import authed, Authed
from ..db import get_session

router = APIRouter(prefix="/prompts", tags=["prompts"])
logger = logging.getLogger(__name__)

# ============================================================================
# PYDANTIC MODELS
# ============================================================================

class PromptSubmitRequest(BaseModel):
    """Submit a text prompt for processing"""
    prompt_text: str
    target: Optional[str] = "linkedin_post"  # linkedin_post, email, etc.


class PromptSubmitResponse(BaseModel):
    """Response after submitting a prompt"""
    ok: bool
    message: str


class TranscribeResponse(BaseModel):
    """Response after transcribing audio"""
    ok: bool
    transcription: str
    message: Optional[str] = None


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

async def get_org_webhook_urls(db: AsyncSession, org_id: str):
    """Fetch organization's n8n webhook URLs"""
    query = text("""
        SELECT n8n_transcribe_webhook_url, n8n_prompt_webhook_url
        FROM organizations
        WHERE id = :org_id
    """)
    result = await db.execute(query, {"org_id": org_id})
    row = result.fetchone()
    
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found"
        )
    
    return {
        "transcribe_url": row[0],
        "prompt_url": row[1]
    }


# ============================================================================
# ENDPOINTS
# ============================================================================

@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe_audio(
    audio: UploadFile = File(...),
    auth: Authed = Depends(authed),
    db: AsyncSession = Depends(get_session)
):
    """
    Upload audio file and get transcription from n8n.
    
    The audio file is sent to the organization's n8n transcription webhook,
    which should return the transcribed text.
    """
    # Get org's webhook URLs
    urls = await get_org_webhook_urls(db, auth.org_id)
    transcribe_url = urls["transcribe_url"]
    
    if not transcribe_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Transcription webhook URL not configured for your organization. Please contact administrator."
        )
    
    try:
        # Read audio file
        audio_content = await audio.read()
        
        logger.info(f"Transcribing audio for org {auth.org_id}, file: {audio.filename}, size: {len(audio_content)} bytes")
        
        # Send to n8n webhook
        async with httpx.AsyncClient(timeout=60.0) as client:
            # Send as multipart form data
            files = {"audio": (audio.filename, audio_content, audio.content_type)}
            
            response = await client.post(
                transcribe_url,
                files=files,
                data={
                    "org_id": auth.org_id,
                    "user_id": auth.user_id
                }
            )
            
            if response.status_code == 200:
                # Expect n8n to return JSON with transcription
                result = response.json()
                transcription = result.get("transcription", result.get("text", ""))
                
                if not transcription:
                    logger.warning(f"Empty transcription from n8n for org {auth.org_id}")
                    return TranscribeResponse(
                        ok=False,
                        transcription="",
                        message="Transcription returned empty. Please try again."
                    )
                
                logger.info(f"Transcription successful for org {auth.org_id}")
                return TranscribeResponse(
                    ok=True,
                    transcription=transcription
                )
            else:
                logger.error(f"n8n transcription webhook failed: {response.status_code} - {response.text}")
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Transcription service returned error: {response.status_code}"
                )
                
    except httpx.TimeoutException:
        logger.error(f"Transcription timeout for org {auth.org_id}")
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Transcription service timed out. Please try again."
        )
    except httpx.RequestError as e:
        logger.error(f"Transcription request error for org {auth.org_id}: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to connect to transcription service"
        )
    except Exception as e:
        logger.error(f"Unexpected error during transcription for org {auth.org_id}: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred during transcription"
        )


@router.post("/submit", response_model=PromptSubmitResponse)
async def submit_prompt(
    request: PromptSubmitRequest,
    auth: Authed = Depends(authed),
    db: AsyncSession = Depends(get_session)
):
    """
    Submit a text prompt to n8n for processing.
    
    The prompt is sent to the organization's n8n prompt webhook,
    which will process it and create an approval.
    """
    # Get org's webhook URLs
    urls = await get_org_webhook_urls(db, auth.org_id)
    prompt_url = urls["prompt_url"]
    
    if not prompt_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Prompt webhook URL not configured for your organization. Please contact administrator."
        )
    
    try:
        logger.info(f"Submitting prompt for org {auth.org_id}, target: {request.target}")
        
        # Send to n8n webhook
        async with httpx.AsyncClient(timeout=30.0) as client:
            payload = {
                "prompt_text": request.prompt_text,
                "target": request.target,
                "org_id": auth.org_id,
                "user_id": auth.user_id,
                "user_email": auth.user_email
            }
            
            response = await client.post(
                prompt_url,
                json=payload
            )
            
            if response.status_code == 200:
                logger.info(f"Prompt submitted successfully for org {auth.org_id}")
                return PromptSubmitResponse(
                    ok=True,
                    message="Prompt submitted successfully. An approval will be created shortly."
                )
            else:
                logger.error(f"n8n prompt webhook failed: {response.status_code} - {response.text}")
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Prompt service returned error: {response.status_code}"
                )
                
    except httpx.TimeoutException:
        logger.error(f"Prompt submission timeout for org {auth.org_id}")
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Prompt service timed out. Please try again."
        )
    except httpx.RequestError as e:
        logger.error(f"Prompt submission request error for org {auth.org_id}: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to connect to prompt service"
        )
    except Exception as e:
        logger.error(f"Unexpected error during prompt submission for org {auth.org_id}: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred during prompt submission"
        )
