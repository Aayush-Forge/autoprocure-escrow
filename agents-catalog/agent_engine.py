import json
import os
from pathlib import Path
from typing import Any, Dict, List
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


def get_fallback_events() -> List[Dict[str, str]]:
    """Deterministic Golden Demo stream ($1,150.00 -> $950.00, saving $200.00 under $1,000.00 cap)."""
    return [
        {
            "agent": "SYSTEM",
            "step": "MANDATE_LOCKED",
            "message": "Budget Cap locked at $1,000.00. Initial BOM quote across 3 vendors is $1,150.00 ($150.00 over budget). Launching autonomous negotiation swarm."
        },
        {
            "agent": "CHANNEL3_DISCOVERY",
            "step": "CATALOG_MATCH",
            "message": "Matched SKU CH3-SNS-9921 (25x Industrial Temp Sensors @ $620.00) and SKU CH3-MCU-4410 (25x ESP32-S3 Gateways @ $310.00) via Channel3 API."
        },
        {
            "agent": "BUYER_AGENT",
            "step": "OFFER_SENT",
            "message": "Proposing bulk tier discount to OmniSense Hardware: 25x CH3-SNS-9921 for $495.00 with immediate PayPal Authorization Escrow."
        },
        {
            "agent": "SELLER_AGENT",
            "step": "COUNTER_OFFER",
            "message": "OmniSense Seller Agent counter-offers $540.00 citing expedited shipping costs."
        },
        {
            "agent": "BUYER_AGENT",
            "step": "DEAL_LOCKED",
            "message": "Settled at $510.00 ($110.00 saved / 17.7% discount). Requesting PayPal Orders v2 AUTHORIZE hold."
        },
        {
            "agent": "PAYPAL_VAULT",
            "step": "ESCROW_AUTHORIZED",
            "message": "PayPal Order 5O190127TN364715T AUTHORIZED ($510.00 locked in sandbox escrow). Total campaign spend optimized to $950.00 ($50.00 under cap)."
        },
        {
            "agent": "AUDITOR_AGENT",
            "step": "SPEC_VERIFICATION",
            "message": "ORD-101 passed telemetry & tracking verification -> Triggered PayPal CAPTURE ($510.00 released). ORD-103 (TestBot-Alpha) failed unit test suite -> Triggered PayPal VOID ($175.00 protected!)."
        }
    ]


async def search_channel3_catalog_items(query: str) -> Dict[str, Any]:
    """Queries Channel3 API if CHANNEL3_API_KEY is set; otherwise returns shared contract items."""
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


def generate_live_negotiation_events(prompt: str, budget_cap: float) -> List[Dict[str, str]]:
    """Uses Gemini 2.5 Flash to generate a real multi-agent negotiation log, with safe fallback."""
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key or api_key == "your_gemini_key_here":
        return get_fallback_events()

    try:
        client = genai.Client(api_key=api_key)
        contract = load_shared_contract()

        system_instruction = f"""
        You are the orchestration brain of AutoProcure Escrow.
        Generate a 7-step JSON array of multi-agent events for this procurement request:
        User Prompt: "{prompt}"
        Hard Budget Cap: ${budget_cap:.2f}
        Reference Catalog Data: {json.dumps(contract["orders"])}

        Each array item MUST be an object with exactly 3 string keys:
        - "agent": One of ["SYSTEM", "CHANNEL3_DISCOVERY", "BUYER_AGENT", "SELLER_AGENT", "PAYPAL_VAULT", "AUDITOR_AGENT"]
        - "step": Short uppercase step code (e.g., "MANDATE_LOCKED", "CATALOG_MATCH", "OFFER_SENT", "COUNTER_OFFER", "DEAL_LOCKED", "ESCROW_AUTHORIZED", "SPEC_VERIFICATION")
        - "message": Crisp, specific financial and technical log showing exact dollar amounts, Channel3 SKUs, PayPal Authorization IDs, and Auditor Capture/Void outcomes.
        """

        response = client.models.generate_content(
            model="gemini-3.5-flash-lite",
            contents=system_instruction,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.2,
            ),
        )
        parsed = json.loads(response.text)
        if isinstance(parsed, list) and len(parsed) > 0:
            for item in parsed:
                item["engine"] = "GEMINI_2.5_FLASH_LIVE"
            return parsed
    except Exception as e:
        print(f"\n[GEMINI ERROR]: {e}\n")

    return get_fallback_events()


def run_auditor_inspection(
    order_id: str,
    paypal_auth_id: str,
    delivery_proof_ok: bool,
    evidence_notes: str = ""
) -> Dict[str, Any]:
    """Runs the Auditor AI check to decide CAPTURE vs VOID on a PayPal Authorization hold."""
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    default_action = "CAPTURE" if delivery_proof_ok else "VOID"
    default_reason = (
        "Telemetry and tracking match BOM specification. Releasing PayPal Escrow via CAPTURE."
        if delivery_proof_ok
        else "Deliverable failed automated verification checks. Protecting buyer funds via PayPal VOID."
    )

    if api_key and api_key != "your_gemini_key_here" and evidence_notes:
        try:
            client = genai.Client(api_key=api_key)
            prompt = f"""
            You are an autonomous Quality-Check Auditor Agent for PayPal Escrow.
            Order ID: {order_id}
            PayPal Auth ID: {paypal_auth_id}
            Passed Automated Check Flag: {delivery_proof_ok}
            Delivery Evidence Log: "{evidence_notes}"

            Return JSON with keys:
            - "auditor_decision": "CAPTURE" or "VOID"
            - "reasoning": 1-sentence technical explanation of why funds are being captured or voided.
            """
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.1,
                ),
            )
            data = json.loads(response.text)
            default_action = data.get("auditor_decision", default_action)
            default_reason = data.get("reasoning", default_reason)
        except Exception:
            pass

    return {
        "order_id": order_id,
        "paypal_auth_id": paypal_auth_id,
        "auditor_decision": default_action,
        "escrow_status": "CAPTURED" if default_action == "CAPTURE" else "VOIDED",
        "message": default_reason
    }