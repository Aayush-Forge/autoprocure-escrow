"use client";

import React, { useState, useEffect, useRef } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, ValidationModule, ColDef } from "ag-grid-community";
import {
  ShieldCheck,
  Play,
  CheckCircle,
  XCircle,
  Clock,
  Terminal,
  TrendingDown,
  DollarSign,
  Layers,
  Cpu,
  RefreshCw,
  Calendar,
  AlertTriangle,
} from "lucide-react";

ModuleRegistry.registerModules([AllCommunityModule, ValidationModule]);

interface OrderRecord {
  order_id: string;
  sku: string;
  item_name: string;
  vendor_name: string;
  initial_price_usd: number;
  negotiated_price_usd: number;
  savings_usd: number;
  savings_pct: number;
  paypal_order_id: string;
  paypal_auth_id: string;
  escrow_status: "AUTHORIZED" | "CAPTURED" | "VOIDED";
  auditor_verdict: string;
  start_date: string;
  end_date: string;
}

interface StreamEvent {
  agent: string;
  step: string;
  message: string;
  engine?: string;
  timestamp: string;
}

export default function AutoProcureDashboard() {
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [streamEvents, setStreamEvents] = useState<StreamEvent[]>([]);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [customPrompt, setCustomPrompt] = useState<string>(
    "Procure 25x industrial temp sensors, 25x ESP32 edge gateways, and automated firmware test suite under $1,000 cap."
  );
  const [budgetCap, setBudgetCap] = useState<number>(1000);
  const [auditorLog, setAuditorLog] = useState<string | null>(null);

  const streamEndRef = useRef<HTMLDivElement>(null);

  // 1. Fetch initial orders from shared contract via Port 8000 / 4000
  const fetchOrders = async () => {
    try {
      const res = await fetch("http://localhost:8000/api/campaign");
      if (res.ok) {
        const data = await res.json();
        setOrders(data.orders);
      }
    } catch {
      // Fallback local baseline if services are rebooting
      setOrders([
        {
          order_id: "ORD-101",
          sku: "CH3-SNS-9921",
          item_name: "Industrial IoT Temp/Humidity Sensor Batch (25x)",
          vendor_name: "OmniSense Hardware (Channel3)",
          initial_price_usd: 620,
          negotiated_price_usd: 510,
          savings_usd: 110,
          savings_pct: 17.7,
          paypal_order_id: "5O190127TN364715T",
          paypal_auth_id: "0VF52814937998046",
          escrow_status: "CAPTURED",
          auditor_verdict: "PASSED_SPEC_CHECK",
          start_date: "2026-11-03",
          end_date: "2026-11-06",
        },
        {
          order_id: "ORD-102",
          sku: "CH3-MCU-4410",
          item_name: "ESP32-S3 Edge Gateway Modules (25x)",
          vendor_name: "SiliconSupply Co. (Channel3)",
          initial_price_usd: 310,
          negotiated_price_usd: 265,
          savings_usd: 45,
          savings_pct: 14.5,
          paypal_order_id: "8KL20948XM112390B",
          paypal_auth_id: "9PL44102837461920",
          escrow_status: "AUTHORIZED",
          auditor_verdict: "PENDING_DELIVERY_AUDIT",
          start_date: "2026-11-04",
          end_date: "2026-11-08",
        },
        {
          order_id: "ORD-103",
          sku: "A2A-QA-088",
          item_name: "Automated Firmware & Load Test Suite (Worker Agent)",
          vendor_name: "TestBot-Alpha (A2A Worker)",
          initial_price_usd: 220,
          negotiated_price_usd: 175,
          savings_usd: 45,
          savings_pct: 20.5,
          paypal_order_id: "3MN99812ZP445120C",
          paypal_auth_id: "7GH11203948576102",
          escrow_status: "VOIDED",
          auditor_verdict: "VOIDED",
          start_date: "2026-11-04",
          end_date: "2026-11-07",
        },
      ]);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [streamEvents]);

  // 2. Start Live Agent Negotiation Stream (SSE)
  const startAutonomousCampaign = () => {
    setIsStreaming(true);
    setStreamEvents([]);
    const encodedPrompt = encodeURIComponent(customPrompt);
    const eventSource = new EventSource(
      `http://localhost:8000/api/negotiate/stream?prompt=${encodedPrompt}&budget_cap=${budgetCap}`
    );

    eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        const newEvent: StreamEvent = {
          ...parsed,
          timestamp: new Date().toLocaleTimeString(),
        };
        setStreamEvents((prev) => [...prev, newEvent]);

        if (parsed.step === "COMPLETE") {
          eventSource.close();
          setIsStreaming(false);
          fetchOrders();
        }
      } catch (err) {
        console.error("SSE parse error", err);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      setIsStreaming(false);
    };
  };

  // 3. Trigger Auditor Verification (Capture / Void Cross-Service Action)
  const triggerAuditorAction = async (order: OrderRecord, approved: boolean) => {
    try {
      const response = await fetch("http://localhost:8000/api/audit/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: order.order_id,
          paypal_auth_id: order.paypal_auth_id,
          delivery_proof_ok: approved,
          evidence_notes: approved
            ? "Manual audit confirmed: Deliverable matches hardware BOM."
            : "Quality Guardrail triggered: Deliverable failed automated unit testing.",
        }),
      });

      const resData = await response.json();
      setAuditorLog(
        `Auditor Agent executed [${resData.auditor_decision}] for ${resData.order_id}. Vault Sync: ${
          typeof resData.paypal_vault_sync === "object"
            ? resData.paypal_vault_sync.action
            : resData.paypal_vault_sync
        }`
      );

      // Update local state for immediate UI reflection
      setOrders((prev) =>
        prev.map((o) =>
          o.order_id === order.order_id
            ? {
                ...o,
                escrow_status: resData.escrow_status,
                auditor_verdict:
                  resData.escrow_status === "CAPTURED"
                    ? "PASSED_SPEC_CHECK"
                    : "FAILED_REJECTED",
              }
            : o
        )
      );
    } catch {
      alert("Error reaching Auditor Agent on Port 8000.");
    }
  };

  // 4. Financial KPI Calculations
  const initialTotal = orders.reduce((acc, o) => acc + o.initial_price_usd, 0);
  const negotiatedTotal = orders.reduce((acc, o) => acc + o.negotiated_price_usd, 0);
  const totalSavings = initialTotal - negotiatedTotal;
  const lockedInEscrow = orders
    .filter((o) => o.escrow_status === "AUTHORIZED")
    .reduce((acc, o) => acc + o.negotiated_price_usd, 0);

  // 5. AG Grid Column Definitions
  const columnDefs: ColDef<OrderRecord>[] = [
    { field: "order_id", headerName: "Order ID", width: 110, pinned: "left" },
    { field: "item_name", headerName: "Deliverable / SKU", flex: 2, minWidth: 220 },
    { field: "vendor_name", headerName: "Vendor / Source", flex: 1.5, minWidth: 180 },
    {
      field: "initial_price_usd",
      headerName: "List Price",
      width: 110,
      valueFormatter: (p) => `$${p.value?.toFixed(2)}`,
    },
    {
      field: "negotiated_price_usd",
      headerName: "Negotiated",
      width: 120,
      cellClass: "font-semibold text-emerald-400",
      valueFormatter: (p) => `$${p.value?.toFixed(2)}`,
    },
    {
      field: "savings_pct",
      headerName: "Discount",
      width: 105,
      cellRenderer: (p: any) => (
        <span className="text-cyan-400 font-medium">-{p.value}%</span>
      ),
    },
    {
      field: "escrow_status",
      headerName: "PayPal Escrow",
      width: 140,
      cellRenderer: (p: any) => {
        const status = p.value;
        if (status === "CAPTURED") {
          return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              <CheckCircle className="w-3 h-3" /> CAPTURED
            </span>
          );
        }
        if (status === "AUTHORIZED") {
          return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
              <Clock className="w-3 h-3" /> AUTHORIZED
            </span>
          );
        }
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30">
            <XCircle className="w-3 h-3" /> VOIDED
          </span>
        );
      },
    },
    {
      headerName: "Auditor AI Actions",
      width: 190,
      pinned: "right",
      cellRenderer: (p: any) => {
        const order: OrderRecord = p.data;
        if (order.escrow_status !== "AUTHORIZED") {
          return (
            <span className="text-xs text-slate-500 font-mono">
              Settled ({order.escrow_status})
            </span>
          );
        }
        return (
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => triggerAuditorAction(order, true)}
              className="px-2 py-1 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded transition shadow font-medium"
              title="Pass delivery proof and trigger PayPal Capture"
            >
              Capture
            </button>
            <button
              onClick={() => triggerAuditorAction(order, false)}
              className="px-2 py-1 text-xs bg-rose-600 hover:bg-rose-500 text-white rounded transition shadow font-medium"
              title="Reject delivery proof and trigger PayPal Void"
            >
              Void Hold
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <main className="min-h-screen p-6 text-slate-100 flex flex-col gap-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl bg-slate-900/60 backdrop-blur-xl border border-slate-800 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-gradient-to-tr from-cyan-600 to-blue-600 rounded-xl shadow-lg">
            <ShieldCheck className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-200 to-cyan-400 bg-clip-text text-transparent">
              AutoProcure Escrow
            </h1>
            <p className="text-xs text-slate-400">
              Autonomous B2B Procurement Swarm with PayPal Authorization & Auditor AI Escrow
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/60 text-xs font-mono">
            <Cpu className="w-3.5 h-3.5 text-cyan-400" />
            <span>Brain: Port 8000</span>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/60 text-xs font-mono">
            <Layers className="w-3.5 h-3.5 text-blue-400" />
            <span>Vault: Port 4000</span>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          </div>
          <button
            onClick={fetchOrders}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition"
            title="Refresh Ledger"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* KPI Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-slate-900/40 backdrop-blur-md border border-slate-800 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase text-slate-400 font-semibold tracking-wider">
              Procurement Budget Cap
            </p>
            <p className="text-2xl font-bold text-white mt-1">
              ${budgetCap.toFixed(2)}
            </p>
          </div>
          <div className="p-3 bg-blue-500/10 text-blue-400 rounded-lg">
            <DollarSign className="w-6 h-6" />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/40 backdrop-blur-md border border-slate-800 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase text-slate-400 font-semibold tracking-wider">
              Negotiated BOM Spend
            </p>
            <p className="text-2xl font-bold text-emerald-400 mt-1">
              ${negotiatedTotal.toFixed(2)}
            </p>
          </div>
          <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-lg">
            <TrendingDown className="w-6 h-6" />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/40 backdrop-blur-md border border-slate-800 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase text-slate-400 font-semibold tracking-wider">
              Total Discount Captured
            </p>
            <p className="text-2xl font-bold text-cyan-400 mt-1">
              ${totalSavings.toFixed(2)}
            </p>
          </div>
          <div className="p-3 bg-cyan-500/10 text-cyan-400 rounded-lg">
            <ShieldCheck className="w-6 h-6" />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/40 backdrop-blur-md border border-slate-800 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase text-slate-400 font-semibold tracking-wider">
              Locked in Escrow Hold
            </p>
            <p className="text-2xl font-bold text-amber-400 mt-1">
              ${lockedInEscrow.toFixed(2)}
            </p>
          </div>
          <div className="p-3 bg-amber-500/10 text-amber-400 rounded-lg">
            <Clock className="w-6 h-6" />
          </div>
        </div>
      </section>

      {/* Campaign Launcher Bar */}
      <section className="p-4 rounded-xl bg-slate-900/40 backdrop-blur-md border border-slate-800 flex flex-col md:flex-row items-center gap-3">
        <input
          type="text"
          value={customPrompt}
          onChange={(e) => setCustomPrompt(e.target.value)}
          placeholder="Enter procurement prompt or component BOM requirement..."
          className="flex-1 w-full bg-slate-950/70 border border-slate-700/80 rounded-lg px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-cyan-500 transition font-mono"
        />
        <div className="flex items-center gap-3 w-full md:w-auto">
          <input
            type="number"
            value={budgetCap}
            onChange={(e) => setBudgetCap(Number(e.target.value))}
            className="w-28 bg-slate-950/70 border border-slate-700/80 rounded-lg px-3 py-2.5 text-sm text-slate-100 font-mono text-center focus:outline-none focus:border-cyan-500"
            title="Budget Cap in USD"
          />
          <button
            onClick={startAutonomousCampaign}
            disabled={isStreaming}
            className={`flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition shadow-lg w-full md:w-auto ${
              isStreaming
                ? "bg-slate-700 text-slate-400 cursor-not-allowed"
                : "bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white"
            }`}
          >
            <Play className={`w-4 h-4 ${isStreaming ? "animate-spin" : ""}`} />
            {isStreaming ? "Swarm Negotiating..." : "Launch Swarm"}
          </button>
        </div>
      </section>

      {/* Main Grid & Stream Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: AG Grid & Bryntum Timeline (7 Cols) */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          {/* AG Grid Section */}
          <div className="p-4 rounded-2xl bg-slate-900/50 backdrop-blur-xl border border-slate-800 shadow-xl flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <Layers className="w-4 h-4 text-cyan-400" />
                AG Grid B2B Escrow Ledger
              </h2>
              <span className="text-xs text-slate-500">Live Orders v2 Authorizations</span>
            </div>
            <div className="ag-theme-quartz-dark w-full h-[320px]">
              <AgGridReact
                theme="legacy"
                rowData={orders}
                columnDefs={columnDefs}
                defaultColDef={{
                  sortable: true,
                  filter: true,
                }}
              />
            </div>
          </div>

          {/* Bryntum Schedule / Timeline Section */}
          <div className="p-4 rounded-2xl bg-slate-900/50 backdrop-blur-xl border border-slate-800 shadow-xl flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-400" />
                Bryntum Delivery & Escrow Timeline
              </h2>
              <span className="text-xs text-slate-500">Procurement Schedule & Milestones</span>
            </div>

            <div className="flex flex-col gap-3 bg-slate-950/60 p-4 rounded-xl border border-slate-800/80">
              {orders.map((order) => (
                <div key={order.order_id} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-200">
                      {order.order_id} — {order.item_name}
                    </span>
                    <span className="text-slate-400 font-mono">
                      {order.start_date} → {order.end_date}
                    </span>
                  </div>
                  {/* Timeline Bar representation */}
                  <div className="w-full bg-slate-800 h-6 rounded-md overflow-hidden relative flex items-center">
                    <div
                      className={`h-full transition-all duration-500 flex items-center px-2 text-[11px] font-mono font-medium ${
                        order.escrow_status === "CAPTURED"
                          ? "w-full bg-emerald-600/70 text-emerald-100"
                          : order.escrow_status === "AUTHORIZED"
                          ? "w-3/4 bg-amber-600/70 text-amber-100"
                          : "w-1/2 bg-rose-600/70 text-rose-100"
                      }`}
                    >
                      {order.escrow_status === "CAPTURED" && "Verified & Released"}
                      {order.escrow_status === "AUTHORIZED" && "In Transit / Awaiting Spec Audit"}
                      {order.escrow_status === "VOIDED" && "Audit Failed / Escrow Voided"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Live Swarm Stream (5 Cols) */}
        <div className="lg:col-span-5 flex flex-col">
          <div className="p-4 rounded-2xl bg-slate-900/50 backdrop-blur-xl border border-slate-800 shadow-xl flex flex-col h-[670px]">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                Live Multi-Agent Stream
              </h2>
              {isStreaming && (
                <span className="flex items-center gap-1.5 text-xs text-cyan-400 font-mono">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                  Streaming SSE
                </span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto mt-3 pr-1 flex flex-col gap-2.5 font-mono text-xs">
              {streamEvents.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-500 gap-2">
                  <Cpu className="w-8 h-8 text-slate-600 animate-pulse" />
                  <span>Click &quot;Launch Swarm&quot; to stream live multi-agent negotiations</span>
                </div>
              ) : (
                streamEvents.map((evt, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-lg bg-slate-950/70 border border-slate-800/80 flex flex-col gap-1"
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          evt.agent === "SYSTEM"
                            ? "bg-slate-800 text-slate-300"
                            : evt.agent === "BUYER_AGENT"
                            ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                            : evt.agent === "SELLER_AGENT"
                            ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                            : evt.agent === "PAYPAL_VAULT"
                            ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                            : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                        }`}
                      >
                        {evt.agent}
                      </span>
                      <span className="text-slate-500 text-[10px]">{evt.timestamp}</span>
                    </div>
                    <span className="text-slate-400 text-[10px] font-semibold tracking-wider">
                      [{evt.step}]
                    </span>
                    <p className="text-slate-200 mt-0.5 leading-relaxed">{evt.message}</p>
                  </div>
                ))
              )}
              <div ref={streamEndRef} />
            </div>

            {/* Auditor Status Alert Footer */}
            {auditorLog && (
              <div className="mt-3 p-2.5 rounded-lg bg-blue-950/50 border border-blue-800/60 text-xs text-blue-200 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <span className="font-mono">{auditorLog}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}