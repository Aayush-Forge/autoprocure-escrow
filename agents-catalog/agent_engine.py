import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional
import httpx
from dotenv import load_dotenv
from google import genai
from google.genai import types

ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")

MOCK_ORDERS_PATH = ROOT_DIR / "shared" / "mock_orders.json"


def load_shared_contract() -> Dict[str, Any]:
    with open(MOCK_ORDERS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def get_fallback_events() -> List[Dict[str, Any]]:
    """Deterministic Enterprise Demo stream with embedded order payloads for AG Grid."""
    return [
        {
            "agent": "SYSTEM",
            "step": "MANDATE_LOCKED",
            "message": "Procurement mandate initialized: Budget cap locked at $1,000.00. Deploying autonomous negotiation swarm across Channel3 B2B suppliers.",
            "order_data": None
        },
        {
            "agent": "CHANNEL3_DISCOVERY",
            "step": "CATALOG_MATCH",
            "message": "Matched 3 validated enterprise SKUs via Channel3 API: Industrial Sensors (OmniSense), ESP32-S3 Gateways (SiliconSupply), and Automated QA Suite (TestBot-Alpha).",
            "order_data": {
                "order_id": "ORD-101",
                "sku": "CH3-SNS-9921",
                "item_name": "Industrial IoT Temp/Humidity Sensor Batch (25x)",
                "vendor_name": "OmniSense Hardware (Channel3)",
                "initial_price_usd": 620.00,
                "negotiated_price_usd": 620.00,
                "savings_usd": 0.00,
                "savings_pct": 0.0,
                "paypal_order_id": "5O190127TN364715T",
                "paypal_auth_id": "0VF52814937998046",
                "escrow_status": "PENDING_DISCOVERY",
                "auditor_verdict": "AWAITING_NEGOTIATION",
                "start_date": "2026-11-04",
                "end_date": "2026-11-08"
            }
        },
        {
            "agent": "BUYER_AGENT",
            "step": "OFFER_SENT",
            "message": "Transmitted bundled volume offer: Proposing $510.00 for CH3-SNS-9921 (-17.7%) backed by guaranteed PayPal Authorization Escrow.",
            "order_data": None
        },
        {
            "agent": "SELLER_AGENT",
            "step": "COUNTER_OFFER",
            "message": "OmniSense Seller Agent accepted terms: Counter-signed escrow conditions with delivery milestone SLA fixed at 4 days.",
            "order_data": None
        },
        {
            "agent": "BUYER_AGENT",
            "step": "DEAL_LOCKED",
            "message": "BOM pricing secured across all 3 suppliers. Baseline reduced from $1,150.00 down to $950.00 ($200.00 savings secured).",
            "order_data": {
                "order_id": "ORD-101",
                "negotiated_price_usd": 510.00,
                "savings_usd": 110.00,
                "savings_pct": 17.7,
                "escrow_status": "DEAL_AGREED"
            }
        },
        {
            "agent": "PAYPAL_VAULT",
            "step": "ESCROW_AUTHORIZED",
            "message": "PayPal Orders v2 AUTHORIZE executed: $510.00 locked under Auth ID 0VF52814937998046 for ORD-101.",
            "order_data": {
                "order_id": "ORD-101",
                "escrow_status": "AUTHORIZED",
                "auditor_verdict": "PENDING_DELIVERY_AUDIT"
            }
        },
        {
            "agent": "PAYPAL_VAULT",
            "step": "ESCROW_AUTHORIZED",
            "message": "Secondary order authorized: ORD-102 ($265.00 Auth 9PL44102837461920).",
            "order_data": {
                "order_id": "ORD-102",
                "sku": "CH3-MCU-4410",
                "item_name": "ESP32-S3 Edge Gateway Modules (25x)",
                "vendor_name": "SiliconSupply Co. (Channel3)",
                "initial_price_usd": 310.00,
                "negotiated_price_usd": 265.00,
                "savings_usd": 45.00,
                "savings_pct": 14.5,
                "paypal_order_id": "8KL20948XM112390B",
                "paypal_auth_id": "9PL44102837461920",
                "escrow_status": "AUTHORIZED",
                "auditor_verdict": "PENDING_DELIVERY_AUDIT",
                "start_date": "2026-11-04",
                "end_date": "2026-11-09"
            }
        },
        {
            "agent": "PAYPAL_VAULT",
            "step": "ESCROW_AUTHORIZED",
            "message": "Secondary order authorized: ORD-103 ($175.00 Auth 7GH11203948576102).",
            "order_data": {
                "order_id": "ORD-103",
                "sku": "A2A-QA-088",
                "item_name": "Automated Firmware QA Suite (Worker Agent)",
                "vendor_name": "TestBot-Alpha (A2A Worker)",
                "initial_price_usd": 220.00,
                "negotiated_price_usd": 175.00,
                "savings_usd": 45.00,
                "savings_pct": 20.5,
                "paypal_order_id": "3MN99812ZP445120C",
                "paypal_auth_id": "7GH11203948576102",
                "escrow_status": "AUTHORIZED",
                "auditor_verdict": "PENDING_DELIVERY_AUDIT",
                "start_date": "2026-11-04",
                "end_date": "2026-11-07"
            }
        },
        {
            "agent": "AUDITOR_AGENT",
            "step": "SPEC_VERIFICATION",
            "message": "Auditor Agent running telemetry verification: Telemetry stream online. Ready for manual or automated SLA partial capture / void.",
            "order_data": None
        }
    ]


async def search_channel3_catalog_items(query: str) -> Dict[str, Any]:
    channel3_key = os.getenv("CHANNEL3_API_KEY", "").strip()
    contract = load_shared_contract()

    if channel3_key and channel3_key != "your_channel3_key_here":
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.get(
                    "https://api.channel3.com/v1/products/search",
                    params={"q": query, "limit": 5},
                    headers={"Authorization": f"Bearer {channel3_key}"}
                )
                if resp.status_code == 200:
                    return {
                        "source": "Channel3_API_Live",
                        "query": query,
                        "live_data": resp.json(),
                        "matched_items": contract["orders"]
                    }
        except Exception:
            pass

    return {
        "source": "Channel3_Catalog_Engine",
        "query": query,
        "matched_items": contract["orders"]
    }


def generate_live_negotiation_events(prompt: str, budget_cap: float) -> List[Dict[str, Any]]:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key or api_key == "your_gemini_key_here":
        return get_fallback_events()

    for model_candidate in ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"]:
        try:
            client = genai.Client(api_key=api_key)
            contract = load_shared_contract()

            system_instruction = f"""
            You are the enterprise orchestration brain of AutoProcure Escrow.
            User Request: "{prompt}"
            Budget Cap: ${budget_cap:.2f}
            Catalog Reference: {json.dumps(contract["orders"])}

            Generate an 8-step JSON array representing the autonomous lifecycle.
            Each array item MUST have:
            - "agent": One of ["SYSTEM", "CHANNEL3_DISCOVERY", "BUYER_AGENT", "SELLER_AGENT", "PAYPAL_VAULT", "AUDITOR_AGENT"]
            - "step": One of ["MANDATE_LOCKED", "CATALOG_MATCH", "OFFER_SENT", "COUNTER_OFFER", "DEAL_LOCKED", "ESCROW_AUTHORIZED", "SPEC_VERIFICATION"]
            - "message": Financial log detailing exact dollar amounts, SKUs, and PayPal Auth IDs.
            - "order_data": An optional object (or null) containing the order fields when introducing or updating a row in the ledger.
            """

            response = client.models.generate_content(
                model=model_candidate,
                contents=system_instruction,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.2,
                ),
            )
            parsed = json.loads(response.text)
            if isinstance(parsed, list) and len(parsed) > 0:
                for item in parsed:
                    item["engine"] = f"{model_candidate.upper()}_LIVE"
                return parsed
        except Exception as e:
            print(f"[Model {model_candidate} Notice]: {e}")
            continue

    return get_fallback_events()


def run_auditor_inspection(
    order_id: str,
    paypal_auth_id: str,
    delivery_proof_ok: bool,
    capture_percentage: float = 100.0,
    evidence_notes: str = ""
) -> Dict[str, Any]:
    """Evaluates SLA delivery and decides CAPTURE, PARTIAL_CAPTURE, or VOID."""
    if not delivery_proof_ok:
        action = "VOID"
        reason = evidence_notes or "Deliverable failed automated inspection. Voiding authorization hold to protect buyer treasury."
    elif capture_percentage < 100.0:
        action = "PARTIAL_CAPTURE"
        reason = f"Auditor applied SLA settlement penalty: Capturing {capture_percentage}% of authorized funds; releasing remainder to buyer."
    else:
        action = "CAPTURE"
        reason = "Deliverable verified against hardware BOM. Executing 100% final escrow capture."

    return {
        "order_id": order_id,
        "paypal_auth_id": paypal_auth_id,
        "auditor_decision": action,
        "capture_percentage": capture_percentage,
        "escrow_status": "CAPTURED" if action == "CAPTURE" else ("PARTIALLY_CAPTURED" if action == "PARTIAL_CAPTURE" else "VOIDED"),
        "message": reason
    }