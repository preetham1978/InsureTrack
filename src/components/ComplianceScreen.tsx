import React, { useState, useEffect } from "react";
import { api } from "../api";
import { 
  ShieldCheck, 
  AlertTriangle, 
  CheckCircle, 
  RefreshCw,
  FileText
} from "lucide-react";

export default function ComplianceScreen() {
  const [selectedCategory, setSelectedCategory] = useState<string>("ANOM");

  const currentUser = api.getCurrentUser();
  const isOpsOrSuper = currentUser?.role === "ops_admin" || currentUser?.role === "super_admin";

  const [clients, setClients] = useState<any[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("client_apc");
  const [anomaliesData, setAnomaliesData] = useState<any>(null);
  const [loadingAnomalies, setLoadingAnomalies] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [reviewStatusChoice, setReviewStatusChoice] = useState("Reviewed - no issue");

  useEffect(() => {
    const fetchClients = async (attempt = 1) => {
      try {
        const clientList = await api.getClients();
        setClients(clientList);
        if (clientList.length > 0) {
          setSelectedClientId(prev => clientList.some((c: any) => c.id === prev) ? prev : clientList[0].id);
        }
      } catch (err) {
        console.error("Failed to fetch clients in ComplianceScreen", err);
        // Retry once after a short delay in case of a transient network/server blip.
        if (attempt < 2) {
          setTimeout(() => fetchClients(attempt + 1), 1500);
        }
      }
    };
    if (isOpsOrSuper) {
      fetchClients();
    }
  }, [isOpsOrSuper]);

  const loadAnomalies = async (clientId: string) => {
    if (!isOpsOrSuper) return;
    setLoadingAnomalies(true);
    try {
      const data = await api.getBillingAnomalies(clientId);
      setAnomaliesData(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingAnomalies(false);
    }
  };

  useEffect(() => {
    if (isOpsOrSuper) {
      loadAnomalies(selectedClientId);
    }
  }, [selectedClientId]);

  const handleReviewAnomaly = async (anomalyId: string) => {
    try {
      await api.reviewBillingAnomaly(selectedClientId, anomalyId, reviewStatusChoice, reviewNotes);
      setReviewingId(null);
      setReviewNotes("");
      loadAnomalies(selectedClientId);
    } catch (err: any) {
      alert(err.message || "Failed to submit review");
    }
  };

  const navItems = [
    { id: "ANOM", label: "Billing Anomalies", icon: AlertTriangle, desc: "Ops Admin Claims & Billing Outlier Review" },
    { id: "QA", label: "Compliance & QA Status", icon: ShieldCheck, desc: "QA & Verification Documentation Status" }
  ];

  return (
    <div className="space-y-6 text-slate-100 font-sans">
      
      {/* Header Panel */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Compliance & Operational Review Center</h2>
          <p className="text-xs text-slate-400">
            Claims outlier review and operational compliance documentation status.
          </p>
        </div>
      </div>

      {/* Filter and Categorization Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
        
        {/* Categories Sidebar */}
        <div className="bg-slate-900/30 border border-slate-800/80 p-4 rounded-xl space-y-3">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Navigation</h3>
          <div className="space-y-1">
            {navItems.map(item => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => setSelectedCategory(item.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg text-xs flex items-center justify-between transition-all border cursor-pointer ${
                    selectedCategory === item.id
                      ? "bg-blue-600/10 border-blue-500/50 text-blue-400 font-bold"
                      : "bg-transparent border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
                  }`}
                  title={item.desc}
                >
                  <div className="flex items-center space-x-2">
                    <Icon className="w-3.5 h-3.5 opacity-70" />
                    <span>{item.label}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Content Area */}
        <div className="lg:col-span-3 space-y-4">
          
          {selectedCategory === "ANOM" ? (
            <div className="space-y-4">
              {!isOpsOrSuper ? (
                <div className="bg-rose-950/30 border border-rose-900/60 p-8 rounded-xl text-center text-rose-300">
                  <AlertTriangle className="w-10 h-10 mx-auto mb-2 text-rose-400" />
                  <h3 className="font-bold text-sm">Restricted Access</h3>
                  <p className="text-xs text-rose-300/80 mt-1">Billing Anomalies & Claims Review is restricted to Ops Admins and Super Admins.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-slate-900/50 border border-slate-800 p-4 rounded-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                      <h3 className="font-bold text-white text-sm">Billing Anomalies & Claims Review</h3>
                      <p className="text-xs text-slate-400">Review statistical outliers, duplicate patterns, and elevated denial clusters. Flagged for human review — not fraud accusations.</p>
                      <span className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-950/40 text-blue-300 border border-blue-800/50">
                        Reviewing: {anomaliesData?.clientName || clients.find((c: any) => c.id === selectedClientId)?.name || "..."}
                      </span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className="text-xs text-slate-400 font-medium">Select Tenant:</span>
                      <select
                        value={selectedClientId}
                        onChange={(e) => setSelectedClientId(e.target.value)}
                        className="bg-slate-950 border border-slate-700 text-white text-xs rounded px-3 py-1.5 focus:ring-2 focus:ring-blue-500"
                      >
                        {clients.length === 0 && (
                          <option value={selectedClientId}>
                            {anomaliesData?.clientName || "Loading tenants..."}
                          </option>
                        )}
                        {clients.map((c: any) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => loadAnomalies(selectedClientId)}
                        className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded text-slate-300 transition-colors cursor-pointer"
                        title="Refresh Anomalies"
                        aria-label="Refresh billing anomalies"
                      >
                        <RefreshCw className={`w-4 h-4 ${loadingAnomalies ? "animate-spin" : ""}`} />
                      </button>
                    </div>
                  </div>

                  {loadingAnomalies ? (
                    <div className="text-center py-12 text-slate-400 text-xs flex items-center justify-center space-x-2">
                      <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
                      <span>Analyzing client claims and billing patterns...</span>
                    </div>
                  ) : anomaliesData?.anomalies?.length === 0 ? (
                    <div className="text-center p-12 bg-slate-900/20 border border-slate-800 rounded-xl text-slate-400 text-xs">
                      <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                      <p className="font-semibold text-white">No Billing Anomalies Detected</p>
                      <p className="text-[11px] text-slate-500 mt-1">All appointments and verification records for {anomaliesData?.clientName || "this tenant"} are within normal statistical ranges.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {anomaliesData?.anomalies?.map((anomaly: any) => (
                        <div key={anomaly.id} className="bg-slate-900/40 border border-amber-900/40 rounded-xl p-4 space-y-3 shadow-md">
                          <div className="flex justify-between items-start">
                            <div className="space-y-1">
                              <div className="flex items-center space-x-2">
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-950/60 text-amber-300 border border-amber-800">
                                  {anomaly.severity} Severity
                                </span>
                                <span className="text-[10px] font-mono text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-850">
                                  {anomaly.id}
                                </span>
                              </div>
                              <h4 className="text-sm font-bold text-white">{anomaly.title}</h4>
                            </div>
                            <span className="text-xs font-semibold px-2.5 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700">
                              {anomaly.status}
                            </span>
                          </div>

                          <p className="text-xs text-slate-300 leading-relaxed">
                            {anomaly.description}
                          </p>

                          <div className="pt-2 border-t border-slate-800/80 flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                            <div className="text-[11px] text-slate-400">
                              Tenant: <strong className="text-slate-200">{anomaliesData.clientName}</strong> ({anomaliesData.totalAppointments} total appointments analyzed)
                            </div>

                            {reviewingId === anomaly.id ? (
                              <div className="flex flex-col md:flex-row items-center gap-2 w-full md:w-auto">
                                <select
                                  value={reviewStatusChoice}
                                  onChange={(e) => setReviewStatusChoice(e.target.value)}
                                  className="bg-slate-950 border border-slate-700 text-white text-xs rounded px-2 py-1"
                                >
                                  <option value="Reviewed - no issue">Reviewed - no issue</option>
                                  <option value="Reviewed - escalated">Reviewed - escalated</option>
                                </select>
                                <input
                                  type="text"
                                  placeholder="Optional reviewer notes..."
                                  value={reviewNotes}
                                  onChange={(e) => setReviewNotes(e.target.value)}
                                  className="bg-slate-950 border border-slate-700 text-white text-xs rounded px-2 py-1"
                                />
                                <button
                                  onClick={() => handleReviewAnomaly(anomaly.id)}
                                  className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded cursor-pointer"
                                >
                                  Save Review
                                </button>
                                <button
                                  onClick={() => setReviewingId(null)}
                                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => {
                                  setReviewingId(anomaly.id);
                                  setReviewStatusChoice("Reviewed - no issue");
                                  setReviewNotes("");
                                }}
                                className="px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 border border-blue-500/30 text-xs font-bold rounded transition-colors cursor-pointer"
                              >
                                Review & Resolve...
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-slate-900/30 border border-slate-800 p-6 rounded-xl space-y-4">
              <div className="flex items-center space-x-3">
                <FileText className="w-6 h-6 text-blue-400" />
                <h3 className="text-lg font-bold text-white">Compliance & QA Status</h3>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Compliance verification for this application is tracked in the project's QA documentation, not generated automatically by this screen.
              </p>
              <div className="pt-4 border-t border-slate-800 text-xs text-slate-500 italic">
                [QA Documentation Link Placeholder]
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
