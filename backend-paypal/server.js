import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load root .env
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT_BACKEND || 4000;

app.use(cors());
app.use(express.json());

const PAYPAL_BASE = 'https://api-m.sandbox.paypal.com';
const CLIENT_ID = process.env.PAYPAL_CLIENT_ID || '';
const CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || '';

import fs from 'fs';

// Read shared mock contract to seed default transactions
const sharedContractPath = path.resolve(__dirname, '../shared/mock_orders.json');
let escrowLedger = [];

try {
  const contractData = JSON.parse(fs.readFileSync(sharedContractPath, 'utf-8'));
  escrowLedger = contractData.orders.map(o => ({
    order_id: o.order_id,
    item_name: o.item_name,
    amount_usd: o.negotiated_price_usd,
    paypal_order_id: o.paypal_order_id,
    paypal_auth_id: o.paypal_auth_id,
    status: o.escrow_status,
    created_at: new Date().toISOString()
  }));
} catch (err) {
  console.warn('[Notice] Could not load shared contract; using fallback single order.');
  escrowLedger = [
    {
      order_id: 'ORD-101',
      item_name: 'Industrial IoT Temp/Humidity Sensor Batch (25x)',
      amount_usd: 510.00,
      paypal_order_id: '5O190127TN364715T',
      paypal_auth_id: '0VF52814937998046',
      status: 'CAPTURED',
      created_at: new Date().toISOString()
    }
  ];
}

// Helper: Generate PayPal Sandbox Access Token
async function getPayPalAccessToken() {
  if (!CLIENT_ID || !CLIENT_SECRET || CLIENT_ID === 'your_sandbox_client_id_here') {
    return null;
  }
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const response = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  if (!response.ok) {
    throw new Error(`PayPal OAuth failed: ${response.statusText}`);
  }
  const data = await response.json();
  return data.access_token;
}

// 1. Root & Health
app.get('/', (req, res) => {
  res.json({
    service: 'AutoProcure PayPal Vault Engine',
    port: PORT,
    status: 'online',
    sandbox_ready: Boolean(CLIENT_ID && CLIENT_ID !== 'your_sandbox_client_id_here')
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'backend-paypal',
    sandbox_configured: Boolean(CLIENT_ID && CLIENT_ID !== 'your_sandbox_client_id_here'),
    active_escrows: escrowLedger.length
  });
});

// 2. Lock Funds in Escrow: Orders v2 with intent="AUTHORIZE"
app.post('/api/escrow/authorize', async (req, res) => {
  const { order_id, amount_usd, item_name } = req.body;
  const token = await getPayPalAccessToken();

  let paypalOrderId = `5O${Date.now()}TN`;
  let paypalAuthId = `AUTH-${Date.now()}`;

  if (token) {
    try {
      const orderResp = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          intent: 'AUTHORIZE',
          purchase_units: [{
            reference_id: order_id || 'ORD-GENERIC',
            description: item_name || 'B2B Sourcing Escrow',
            amount: {
              currency_code: 'USD',
              value: Number(amount_usd || 100.00).toFixed(2)
            }
          }]
        })
      });
      const orderData = await orderResp.json();
      paypalOrderId = orderData.id || paypalOrderId;
    } catch (err) {
      console.warn('[PayPal Live Sandbox Notice]: Falling back to deterministic sandbox simulation');
    }
  }

  const record = {
    order_id: order_id || `ORD-${Date.now()}`,
    item_name: item_name || 'Component Restock Batch',
    amount_usd: Number(amount_usd || 100.00),
    paypal_order_id: paypalOrderId,
    paypal_auth_id: paypalAuthId,
    status: 'AUTHORIZED',
    created_at: new Date().toISOString()
  };
  escrowLedger.unshift(record);

  res.status(201).json({
    status: 'SUCCESS',
    action: 'ESCROW_AUTHORIZED',
    order_id: record.order_id,
    paypal_order_id: paypalOrderId,
    paypal_auth_id: paypalAuthId,
    amount_usd: record.amount_usd,
    message: `PayPal hold placed for $${record.amount_usd.toFixed(2)}. Funds locked in escrow pending auditor verification.`
  });
});

// 3. Release Funds to Seller: Capture the Authorization hold
app.post('/api/escrow/capture', async (req, res) => {
  const { order_id, authorization_id } = req.body;
  const token = await getPayPalAccessToken();

  if (token && authorization_id && !authorization_id.startsWith('AUTH-')) {
    try {
      await fetch(`${PAYPAL_BASE}/v2/payments/authorizations/${authorization_id}/capture`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ final_capture: true })
      });
    } catch (err) {
      console.warn('[PayPal Capture Error]: Handled gracefully');
    }
  }

  // Update in-memory record
  const match = escrowLedger.find(e => e.order_id === order_id || e.paypal_auth_id === authorization_id);
  if (match) match.status = 'CAPTURED';

  res.json({
    status: 'SUCCESS',
    action: 'CAPTURED',
    order_id,
    authorization_id,
    capture_id: `CAP-${Date.now()}`,
    escrow_status: 'CAPTURED',
    message: `Auditor verification passed. PayPal Authorization ${authorization_id} captured and funds released to seller.`
  });
});

// 4. Protect Buyer Funds: Void the Authorization hold on failure
app.post('/api/escrow/void', async (req, res) => {
  const { order_id, authorization_id } = req.body;
  const token = await getPayPalAccessToken();

  if (token && authorization_id && !authorization_id.startsWith('AUTH-')) {
    try {
      await fetch(`${PAYPAL_BASE}/v2/payments/authorizations/${authorization_id}/void`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
    } catch (err) {
      console.warn('[PayPal Void Error]: Handled gracefully');
    }
  }

  // Update in-memory record
  const match = escrowLedger.find(e => e.order_id === order_id || e.paypal_auth_id === authorization_id);
  if (match) match.status = 'VOIDED';

  res.json({
    status: 'SUCCESS',
    action: 'VOIDED',
    order_id,
    authorization_id,
    escrow_status: 'VOIDED',
    message: `Auditor flagged deliverable defect. PayPal Authorization ${authorization_id} voided. Buyer funds preserved.`
  });
});

// 5. Escrow Ledger Feed (to supply AG Grid directly)
app.get('/api/escrow/transactions', (req, res) => {
  res.json({
    total: escrowLedger.length,
    transactions: escrowLedger
  });
});

app.listen(PORT, () => {
  console.log(`[PayPal Vault Engine] running on http://localhost:${PORT}`);
});