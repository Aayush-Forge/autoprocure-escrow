import asyncio
import json
import os
from typing import Optional
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import httpx

from agent_engine import (
    load_shared_contract,
    search_channel3_catalog_items,
    generate_live_negotiation_events,
    run_auditor_inspection,
)

app = FastAPI(
    title="AutoProcure Escrow - Multi-Agent Brain & Channel3 Service",
    version="1.1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BACKEND_PAYPAL_URL = os.getenv("NEXT_PUBLIC_API_URL", "http://localhost:4000")


class AuditRequest(BaseModel):
    order_id: str
    paypal_auth_id: str
    delivery_proof_ok: bool
    evidence_notes: Optional[str] = ""


@app.get("/")
async def root():
    return {
        "service": "AutoProcure Escrow Agent Brain",
        "status": "online",
        "docs_url": "/docs",
        "stream_url": "/api/negotiate/stream"
    }


@app.get("/health")
async def health_check():
    has_gemini = bool(os.getenv("GEMINI_API_KEY", "").strip())
    has_channel3 = bool(os.getenv("CHANNEL3_API_KEY", "").strip())
    return {
        "status": "online",
        "service": "agents-catalog",
        "branch": "aayush-agents",
        "gemini_configured": has_gemini,
        "channel3_configured": has_channel3
    }


@app.get("/api/campaign")
async def get_campaign_state():
    """Returns the current procurement campaign and order ledger."""
    return load_shared_contract()


@app.get("/api/catalog/search")
async def search_channel3_catalog(q: str = "industrial iot sensor"):
    """Queries Channel3 API for clean B2B product data (with deterministic fallback)."""
    return await search_channel3_catalog_items(q)


@app.get("/api/negotiate/stream")
async def stream_agent_negotiation(
    prompt: str = Query(
        default="Procure 25x industrial temp sensors, 25x ESP32 edge gateways, and an automated firmware load-test suite under a $1,000 hard budget cap."
    ),
    budget_cap: float = Query(default=1000.0)
):
    """Streams real-time Buyer <-> Seller <-> PayPal Escrow <-> Auditor events via SSE."""
    events = generate_live_negotiation_events(prompt=prompt, budget_cap=budget_cap)

    async def event_generator():
        for item in events:
            yield f"data: {json.dumps(item)}\n\n"
            await asyncio.sleep(1.5)
        yield f"data: {json.dumps({'agent': 'SYSTEM', 'step': 'COMPLETE', 'message': 'Procurement cycle finished.'})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/api/audit/verify")
async def verify_and_settle_escrow(payload: AuditRequest):
    """Auditor AI inspects delivery evidence and triggers PayPal CAPTURE or VOID."""
    verdict = run_auditor_inspection(
        order_id=payload.order_id,
        paypal_auth_id=payload.paypal_auth_id,
        delivery_proof_ok=payload.delivery_proof_ok,
        evidence_notes=payload.evidence_notes or ""
    )

    # Attempt to call Teammate 2's PayPal Vault service if running on port 4000
    vault_endpoint = "/api/escrow/capture" if verdict["auditor_decision"] == "CAPTURE" else "/api/escrow/void"
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            vault_resp = await client.post(
                f"{BACKEND_PAYPAL_URL}{vault_endpoint}",
                json={
                    "order_id": payload.order_id,
                    "authorization_id": payload.paypal_auth_id
                }
            )
            if vault_resp.status_code == 200:
                verdict["paypal_vault_sync"] = vault_resp.json()
    except Exception:
        verdict["paypal_vault_sync"] = "Standalone_Sandbox_Mode (Vault port 4000 offline)"

    return verdict