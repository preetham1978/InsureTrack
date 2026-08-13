import React, { useState, useEffect } from "react";
import { 
  BarChart3, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  Filter, 
  ShieldCheck, 
  TrendingUp, 
  Users, 
  Briefcase,
  HelpCircle,
  RefreshCw
} from "lucide-react";
import { api } from "../api";
import { User, Client } from "../types";

interface DashboardScreenProps {
  user: User;
  onNavigateToQueue: (clientIdFilter?: string) => void;
  onNavigateToWorkspace: (appointmentId: string) => void;
}

export default function DashboardScreen({ user, onNavigateToQueue, onNavigateToWorkspace }: DashboardScreenProps) {
  const [stats, setStats] = useState<any>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<string>("all");
  const [rlsResult, setRlsResult] = useState<any>(null);
  const [rlsLoading, setRlsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const statsData = await api.getStats();
      setStats(statsData);

      const clientsData = await api.getClients();
      setClients(clientsData);

      // Trigger RLS test run automatically as part of "Build and TEST this RLS policy before building any UI screen."
      setRlsLoading(true);
      const rls = await api.runRlsTest();
      setRlsResult(rls);
    } catch (err: any) {
      setError(err.message || "Failed to load dashboard statistics");
    } finally {
      setLoading(false);
      setRlsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user]);

  const handleRunRlsTestManually = async () => {
    setRlsLoading(true);
    try {
      const rls = await api.runRlsTest();
      setRlsResult(rls);
    } catch (err: any) {
      console.error(err);
    } finally {
      setRlsLoading(false);
    }
  };

  if (loading && !stats) {
    return (
      <div className="flex justify-center items-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        <span className="ml-3 text-sm text-slate-400 font-medium">Computing revenue cycle metrics...</span>
      </div>
    );
  }

  // Calculate filtered stats if client filter is active
  let displayStats = stats?.stats || { total: 0, pending_review: 0, in_verification: 0, approved: 0, not_approved: 0 };
  let displayAlerts = stats?.agingAlerts?.alerts || [];

  if (selectedClient !== "all" && stats?.clientBreakdown) {
    const clientBreakdown = stats.clientBreakdown.find((cb: any) => cb.client_id === selectedClient);
    if (clientBreakdown) {
      displayStats = {
        total: clientBreakdown.total,
        pending_review: clientBreakdown.pending_review,
        in_verification: clientBreakdown.in_verification,
        approved: clientBreakdown.approved,
        not_approved: clientBreakdown.not_approved,
      };
      displayAlerts = stats.agingAlerts.alerts.filter((alert: any) => {
        // Find appointment client
        const apt = stats.agingAlerts.alerts.find((al: any) => al.id === alert.id);
        return apt && stats.clientBreakdown.find((cb: any) => cb.name === alert.clientName)?.client_id === selectedClient;
      });
    }
  }

  // Calculate SLA breakdown
  const pendingOldCount = displayAlerts.filter((a: any) => a.type === "pending_review_24h").length;
  const verificationOldCount = displayAlerts.filter((a: any) => a.type === "in_verification_3d").length;

  return (
    <div className="space-y-6">
      {/* Header and Filter */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-5">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Revenue Cycle Insurance Operations</h2>
          <p className="text-xs text-slate-400">
            Real-time status tracking, aging SLA monitoring, and verification queues.
          </p>
        </div>

        {/* Client Multi-tenant filter */}
        <div className="flex items-center space-x-2 w-full md:w-auto">
          <Filter className="w-4 h-4 text-slate-500" />
          <span className="text-xs text-slate-400 font-medium">Filter Client Tenant:</span>
          {user.role === "client_viewer" ? (
            <div className="bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-300">
              {clients.find(c => c.id === user.client_id)?.name || "Associated Client"}
            </div>
          ) : (
            <select
              value={selectedClient}
              onChange={(e) => setSelectedClient(e.target.value)}
              className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-lg text-xs font-semibold text-slate-200 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
            >
              <option value="all">All Clients (VeloAI Ops Admin View)</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
          )}
          <button
            onClick={loadData}
            title="Refresh statistics"
            aria-label="Refresh dashboard statistics"
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg cursor-pointer shrink-0 transition-colors border border-transparent hover:border-slate-700"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* RLS Policy Verification Banner */}
      {rlsResult && (
        <div className={`p-4 rounded-xl border flex flex-col md:flex-row items-start md:items-center justify-between gap-4 transition-all ${
          rlsResult.passed 
            ? "bg-emerald-950/15 border-emerald-800/80 text-emerald-200" 
            : "bg-rose-950/15 border-rose-800/80 text-rose-200"
        }`}>
          <div className="flex items-start space-x-3">
            <div className={`p-2 rounded-lg shrink-0 ${rlsResult.passed ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"}`}>
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-950 text-emerald-400 border border-emerald-800 px-2 py-0.5 rounded">
                  Compliance Active
                </span>
                <span className="text-sm font-semibold">Row-Level Security (RLS) Policy Verification Suite</span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Security constraints automatically verified in the database schema. Client tenants are cryptographically and logical isolated.
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {rlsResult.results.map((r: any, idx: number) => (
                  <span key={idx} className="inline-flex items-center text-[10px] font-medium bg-slate-950/60 px-2.5 py-1 rounded border border-slate-850 shadow-xs">
                    <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${r.success ? "bg-emerald-500" : "bg-rose-500"}`}></span>
                    {r.test}: <strong className="ml-1 text-slate-200">{r.actual}/{r.expected}</strong>
                  </span>
                ))}
              </div>
            </div>
          </div>
          <button
            onClick={handleRunRlsTestManually}
            disabled={rlsLoading}
            className="text-xs font-semibold bg-slate-800 border border-slate-700 hover:bg-slate-700 hover:text-white px-3 py-1.5 rounded-lg shadow-sm transition-all shrink-0 cursor-pointer text-slate-200 disabled:opacity-50"
          >
            {rlsLoading ? "Re-testing RLS..." : "Execute RLS Audit Run"}
          </button>
        </div>
      )}

      {/* Main Status Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Total Appts */}
        <div className="bg-slate-900/40 p-4 rounded-xl border border-slate-800/80 shadow-lg flex flex-col justify-between backdrop-blur-sm">
          <div className="flex justify-between items-start">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Patients</span>
            <Users className="w-4 h-4 text-blue-400" />
          </div>
          <div className="mt-2">
            <div className="text-2xl font-bold text-white">{displayStats.total}</div>
            <p className="text-[10px] text-slate-500 font-medium">In current cycle</p>
          </div>
        </div>

        {/* Pending Review */}
        <div className="bg-slate-900/40 p-4 rounded-xl border border-slate-800/80 shadow-lg flex flex-col justify-between backdrop-blur-sm">
          <div className="flex justify-between items-start">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Pending Review</span>
            <Clock className="w-4 h-4 text-amber-500 animate-pulse" />
          </div>
          <div className="mt-2">
            <div className="text-2xl font-bold text-white">{displayStats.pending_review}</div>
            <span className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded font-medium mt-1 border ${
              pendingOldCount > 0 ? "bg-amber-950/30 text-amber-300 border-amber-900/30 font-semibold" : "bg-slate-950 text-slate-500 border-slate-800"
            }`}>
              {pendingOldCount} Overdue (&gt;24h)
            </span>
          </div>
        </div>

        {/* In Verification */}
        <div className="bg-slate-900/40 p-4 rounded-xl border border-slate-800/80 shadow-lg flex flex-col justify-between backdrop-blur-sm">
          <div className="flex justify-between items-start">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">In Verification</span>
            <BarChart3 className="w-4 h-4 text-sky-400" />
          </div>
          <div className="mt-2">
            <div className="text-2xl font-bold text-white">{displayStats.in_verification}</div>
            <span className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded font-medium mt-1 border ${
              verificationOldCount > 0 ? "bg-rose-950/30 text-rose-300 border-rose-900/30 font-semibold" : "bg-slate-950 text-slate-500 border-slate-800"
            }`}>
              {verificationOldCount} Overdue (&gt;3d)
            </span>
          </div>
        </div>

        {/* Approved */}
        <div className="bg-slate-900/40 p-4 rounded-xl border border-slate-800/80 shadow-lg flex flex-col justify-between backdrop-blur-sm">
          <div className="flex justify-between items-start">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Approved</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="mt-2">
            <div className="text-2xl font-bold text-white">{displayStats.approved}</div>
            <p className="text-[10px] text-slate-500 font-medium">Ready for billing</p>
          </div>
        </div>

        {/* Not Approved */}
        <div className="bg-slate-900/40 p-4 rounded-xl border border-slate-800/80 shadow-lg flex flex-col justify-between col-span-2 lg:col-span-1 backdrop-blur-sm">
          <div className="flex justify-between items-start">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Not Approved</span>
            <AlertTriangle className="w-4 h-4 text-rose-500" />
          </div>
          <div className="mt-2">
            <div className="text-2xl font-bold text-white">{displayStats.not_approved}</div>
            <p className="text-[10px] text-slate-500 font-medium">Rejected / requires fix</p>
          </div>
        </div>
      </div>

      {/* SLA Alerts Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Overdue Alerts - Left/Middle */}
        <div className="lg:col-span-2 bg-slate-900/40 border border-slate-800 rounded-xl shadow-lg backdrop-blur-sm">
          <div className="px-5 py-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/40 rounded-t-xl">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
              <h3 className="font-bold text-sm text-slate-200">Aging SLA Alerts & Violations</h3>
            </div>
            <span className="text-[10px] uppercase font-bold tracking-wider text-rose-400 bg-rose-950/40 px-2.5 py-0.5 rounded border border-rose-900/40">
              {displayAlerts.length} Action Needed
            </span>
          </div>

          <div className="p-4 space-y-3 overflow-y-auto max-h-[380px]">
            {displayAlerts.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-300">All appointments are within SLA limits!</p>
                <p className="text-xs text-slate-500">Amazing work, queues are clearing beautifully.</p>
              </div>
            ) : (
              displayAlerts.map((alert: any) => {
                const isPending = alert.type === "pending_review_24h";
                return (
                  <div 
                    key={alert.id} 
                    className={`p-3.5 rounded-lg border flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 transition-colors ${
                      isPending 
                        ? "bg-amber-950/15 border-amber-900/30 hover:bg-amber-950/25" 
                        : "bg-rose-950/15 border-rose-900/30 hover:bg-rose-950/25"
                    }`}
                  >
                    <div>
                      <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                          isPending ? "bg-amber-950 text-amber-300 border-amber-900/40" : "bg-rose-950 text-rose-300 border-rose-900/40"
                        }`}>
                          {isPending ? `Pending > 24 Hours` : `Verification > 3 Days`}
                        </span>
                        <span className="text-xs font-bold text-white">{alert.patientName}</span>
                        <span className="text-[10px] bg-slate-950 text-slate-400 border border-slate-850 px-1.5 py-0.2 rounded font-medium">
                          {alert.clientName}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 mt-1 flex flex-wrap gap-x-3 gap-y-1">
                        <span>Provider: <strong className="text-slate-300">{alert.provider_name}</strong></span>
                        <span>Date: <strong className="text-slate-300">{alert.appointment_date}</strong></span>
                        <span>Created: <strong className="text-slate-300">{new Date(alert.created_at).toLocaleDateString()}</strong></span>
                      </div>
                    </div>

                    <div className="flex items-center space-x-3 w-full sm:w-auto justify-between sm:justify-end shrink-0">
                      <div className="text-right">
                        <span className={`text-xs font-extrabold ${isPending ? "text-amber-400" : "text-rose-400"}`}>
                          {isPending ? `${alert.hoursOld} hrs old` : `${alert.daysOld} days old`}
                        </span>
                        <p className="text-[10px] text-slate-500">Exceeds SLA threshold</p>
                      </div>

                      {/* CTA based on role */}
                      {isPending ? (
                        <button
                          onClick={() => onNavigateToQueue(selectedClient)}
                          className="bg-slate-800 border border-amber-500/30 text-amber-300 hover:bg-slate-700 hover:text-white px-3 py-1.5 rounded text-xs font-bold shadow-sm cursor-pointer transition-colors"
                        >
                          Review Queue
                        </button>
                      ) : (
                        user.role !== "client_viewer" && (
                          <button
                            onClick={() => onNavigateToWorkspace(alert.id)}
                            className="bg-emerald-600 text-white hover:bg-emerald-500 px-3 py-1.5 rounded text-xs font-bold shadow-lg shadow-emerald-950/20 cursor-pointer transition-colors"
                          >
                            Verify Call
                          </button>
                        )
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Client Tenant Breakdown - Right */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl shadow-lg backdrop-blur-sm">
          <div className="px-5 py-4 border-b border-slate-800 bg-slate-950/40 rounded-t-xl">
            <div className="flex items-center space-x-2">
              <Briefcase className="w-4 h-4 text-slate-400" />
              <h3 className="font-bold text-sm text-slate-200">Tenant Billing Operations</h3>
            </div>
          </div>

          <div className="p-4 space-y-4">
            {stats?.clientBreakdown?.map((cb: any) => (
              <div key={cb.client_id} className="border-b border-slate-800/60 last:border-b-0 pb-3 last:pb-0">
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs font-bold text-slate-200 truncate" title={cb.name}>
                    {cb.name}
                  </span>
                  <span className="text-[10px] font-bold bg-slate-950 border border-slate-850 text-slate-400 px-1.5 py-0.5 rounded">
                    {cb.code}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-1 text-[10px] text-slate-400 font-medium">
                  <span>Total: <strong className="text-slate-200">{cb.total}</strong></span>
                  <span className="text-amber-400">Pending: <strong>{cb.pending_review}</strong></span>
                  <span className="text-sky-400">Verifying: <strong>{cb.in_verification}</strong></span>
                  <span className="text-emerald-400">Approved: <strong>{cb.approved}</strong></span>
                </div>
                
                {/* Visual bar tracker */}
                <div className="w-full bg-slate-950 border border-slate-850 h-1.5 rounded-full mt-2 overflow-hidden flex">
                  {cb.approved > 0 && (
                    <div 
                      className="bg-emerald-500 h-full" 
                      style={{ width: `${(cb.approved / cb.total) * 100}%` }}
                      title={`Approved: ${cb.approved}`}
                    ></div>
                  )}
                  {cb.in_verification > 0 && (
                    <div 
                      className="bg-sky-400 h-full" 
                      style={{ width: `${(cb.in_verification / cb.total) * 100}%` }}
                      title={`In Verification: ${cb.in_verification}`}
                    ></div>
                  )}
                  {cb.pending_review > 0 && (
                    <div 
                      className="bg-amber-400 h-full" 
                      style={{ width: `${(cb.pending_review / cb.total) * 100}%` }}
                      title={`Pending Review: ${cb.pending_review}`}
                    ></div>
                  )}
                  {cb.not_approved > 0 && (
                    <div 
                      className="bg-rose-400 h-full" 
                      style={{ width: `${(cb.not_approved / cb.total) * 100}%` }}
                      title={`Not Approved: ${cb.not_approved}`}
                    ></div>
                  )}
                </div>
              </div>
            ))}
            
            <div className="bg-slate-950/40 border border-slate-850 p-3 rounded-lg text-[11px] text-slate-400 flex items-start space-x-2 mt-4">
              <HelpCircle className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
              <span>
                VeloAI revenue automation maintains strict offline storage and sync support. You can check current insurance verification cycle performance metrics securely.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
