import React, { useState, useEffect } from "react";
import { 
  ShieldAlert, 
  Search, 
  Filter, 
  RefreshCw, 
  Trash2, 
  CheckCircle,
  FileDown,
  Activity
} from "lucide-react";
import { api } from "../api";
import { AuditLog, Client } from "../types";

export default function AuditLogsScreen() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedAction, setSelectedAction] = useState<string>("all");
  const [selectedClientId, setSelectedClientId] = useState<string>("all");

  // Pagination
  const PAGE_SIZE = 20;
  const [currentPage, setCurrentPage] = useState(1);

  const loadLogsAndClients = async () => {
    setLoading(true);
    try {
      const logsData = await api.getAuditLogs();
      setLogs(logsData);

      const clientsData = await api.getClients();
      setClients(clientsData);
    } catch (err: any) {
      setErrorMsg("Failed to load audit catalogs. Access Restricted.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogsAndClients();
  }, []);

  const handleClearLogs = async () => {
    if (!confirm("CRITICAL WARNING: Are you absolutely sure you want to permanently purge all security and operational audit trail logs? This action is irreversible.")) {
      return;
    }

    setLoading(true);
    try {
      const res = await api.clearAuditLogs();
      if (res.success) {
        setSuccessMsg("Audit log repository has been successfully purged. Fresh audit session initiated.");
        setLogs(res.logs || []);
        setTimeout(() => setSuccessMsg(null), 3000);
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to clear logs.");
    } finally {
      setLoading(false);
    }
  };

  const handleExportCsv = () => {
    if (logs.length === 0) return;
    
    // Helper to sanitize fields against CSV formula injection (=, +, -, @, tab, CR)
    const sanitizeCell = (val: string | null | undefined) => {
      if (!val) return '""';
      let str = String(val).replace(/"/g, '""');
      if (/^[=+\-@\t\r]/.test(str)) {
        str = "'" + str;
      }
      return `"${str}"`;
    };

    const csvHeaders = "Log ID,User ID,User Email,Client ID,Action,Record ID,Details,Timestamp\n";
    const csvRows = logs.map(l => {
      return `${sanitizeCell(l.id)},${sanitizeCell(l.user_id)},${sanitizeCell(l.user_email)},${sanitizeCell(l.client_id)},${sanitizeCell(l.action)},${sanitizeCell(l.record_id)},${sanitizeCell(l.details)},${sanitizeCell(l.created_at)}`;
    }).join("\n");
    
    const blob = new Blob([csvHeaders + csvRows], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", `insuretrack_audit_export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Extract unique actions for filters
  const uniqueActions = Array.from(new Set(logs.map(l => l.action).filter(Boolean)));

  // Filter application
  const filtered = logs.filter(log => {
    const term = searchTerm.toLowerCase();
    const matchesSearch = log.user_email.toLowerCase().includes(term) ||
                          log.details.toLowerCase().includes(term) ||
                          log.action.toLowerCase().includes(term);

    const matchesAction = selectedAction === "all" || log.action === selectedAction;
    const matchesClient = selectedClientId === "all" || log.client_id === selectedClientId;

    return matchesSearch && matchesAction && matchesClient;
  });

  // Reset to page 1 whenever the filters change, so you can't get stuck on
  // a page number that no longer has any results.
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedAction, selectedClientId]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPageSafe = Math.min(currentPage, totalPages);
  const paginatedLogs = filtered.slice((currentPageSafe - 1) * PAGE_SIZE, currentPageSafe * PAGE_SIZE);

  return (
    <div className="space-y-6 text-slate-100">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Regulatory Security & Audit Log</h2>
          <p className="text-xs text-slate-400">
            Cryptographically logged operations, record view histories, decrypt checks, and database intake trace.
          </p>
        </div>

        <div className="flex space-x-2 w-full sm:w-auto shrink-0">
          <button
            onClick={loadLogsAndClients}
            className="p-1.5 border border-slate-800 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white cursor-pointer shrink-0 transition-colors"
            title="Refresh logs"
            aria-label="Refresh audit logs"
          >
            <RefreshCw className="w-4.5 h-4.5" />
          </button>
          
          <button
            onClick={handleExportCsv}
            disabled={filtered.length === 0}
            className="bg-[#030712] border border-slate-850 hover:bg-slate-800 text-slate-300 hover:text-white px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1 shadow-md cursor-pointer disabled:opacity-50 transition-colors"
          >
            <FileDown className="w-4 h-4 text-slate-500" />
            <span>Export CSV Report</span>
          </button>

          <button
            onClick={handleClearLogs}
            className="bg-rose-600 hover:bg-rose-500 text-white px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1 shadow-lg shadow-rose-950/20 cursor-pointer transition-colors border-0"
          >
            <Trash2 className="w-4 h-4" />
            <span>Purge Logs</span>
          </button>
        </div>
      </div>

      {successMsg && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-lg bg-emerald-950/95 border border-emerald-800/85 border-l-4 border-l-emerald-500 p-3.5 rounded-lg text-xs text-emerald-200 flex items-start space-x-2 font-medium shadow-2xl backdrop-blur-sm">
          <CheckCircle className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-lg bg-rose-950/95 border border-rose-800/85 border-l-4 border-l-rose-500 p-3.5 rounded-lg text-xs text-rose-200 flex items-start space-x-2 font-medium shadow-2xl backdrop-blur-sm">
          <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0 text-rose-400" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Filter panel */}
      <div className="bg-slate-900/40 border border-slate-800 p-4 rounded-xl shadow-lg backdrop-blur-sm grid grid-cols-1 md:grid-cols-3 gap-4">
        
        {/* Search */}
        <div className="relative text-xs text-slate-200">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search email, action details..."
            className="pl-9 pr-3 py-2 bg-slate-950 border border-slate-850 text-white focus:ring-2 focus:ring-blue-500 focus:outline-none rounded-lg text-xs placeholder-slate-600 w-full"
          />
        </div>

        {/* Action filter */}
        <div>
          <select
            value={selectedAction}
            onChange={(e) => setSelectedAction(e.target.value)}
            className="bg-slate-950 border border-slate-850 text-slate-300 focus:ring-2 focus:ring-blue-500 focus:outline-none rounded-lg text-xs font-semibold px-3 py-2 w-full cursor-pointer"
          >
            <option value="all" className="bg-slate-900">All Operations</option>
            {uniqueActions.map(act => (
              <option key={act} value={act} className="bg-slate-900">{act}</option>
            ))}
          </select>
        </div>

        {/* Tenant filter */}
        <div>
          <select
            value={selectedClientId}
            onChange={(e) => setSelectedClientId(e.target.value)}
            className="bg-slate-950 border border-slate-850 text-slate-300 focus:ring-2 focus:ring-blue-500 focus:outline-none rounded-lg text-xs font-semibold px-3 py-2 w-full cursor-pointer"
          >
            <option value="all" className="bg-slate-900">All Tenant Channels</option>
            {clients.map(c => (
              <option key={c.id} value={c.id} className="bg-slate-900">{c.name}</option>
            ))}
          </select>
        </div>

      </div>

      {/* Logs Table Card */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-xl shadow-lg overflow-hidden backdrop-blur-sm">
        {loading && logs.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-3"></div>
            <span>Fetching secure audit trace...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <Activity className="w-12 h-12 text-slate-700 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-400">No audit logs matched filters.</p>
          </div>
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-950/60 border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                  <th className="p-4 w-28">Timestamp</th>
                  <th className="p-4 w-40">User Email</th>
                  <th className="p-4 w-52">Operational Action</th>
                  <th className="p-4">Details Summary</th>
                  <th className="p-4 w-28">Client Tenant</th>
                  <th className="p-4 w-24">Log Hash ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {paginatedLogs.map((log) => {
                  const clientObj = clients.find(c => c.id === log.client_id);
                  const isCritical = log.action === "DECRYPT_POLICY_NUMBER" || log.action === "AUDIT_LOG_CLEARED" || log.action === "ADMIN_DELETE_USER";
                  
                  return (
                    <tr 
                      key={log.id} 
                      className={`hover:bg-slate-800/20 transition-colors ${
                        isCritical ? "bg-rose-950/10" : ""
                      }`}
                    >
                      <td className="p-4 text-slate-400 font-medium font-sans">
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                      <td className="p-4 font-semibold text-white font-sans">{log.user_email}</td>
                      <td className="p-4">
                        <span className={`inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                          isCritical ? "bg-rose-950/40 text-rose-300 border-rose-900/40" :
                          log.action.includes("CREATE") || log.action.includes("IMPORT") ? "bg-emerald-950/40 text-emerald-300 border-emerald-900/40" :
                          "bg-slate-950 text-slate-400 border-slate-800"
                        }`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="p-4 text-slate-300 font-sans leading-relaxed">{log.details}</td>
                      <td className="p-4 font-sans font-semibold text-slate-400">
                        {clientObj ? clientObj.code : <span className="text-slate-500 font-normal italic">Global</span>}
                      </td>
                      <td className="p-4 text-[10px] text-slate-500 font-bold uppercase">{log.id.substring(6)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-800 text-xs text-slate-400">
            <span>
              Showing {(currentPageSafe - 1) * PAGE_SIZE + 1}–{Math.min(currentPageSafe * PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPageSafe === 1}
                aria-label="Previous page"
                className="px-3 py-1.5 rounded-lg border border-slate-800 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer font-semibold"
              >
                Prev
              </button>
              <span className="font-semibold text-slate-300">Page {currentPageSafe} of {totalPages}</span>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPageSafe === totalPages}
                aria-label="Next page"
                className="px-3 py-1.5 rounded-lg border border-slate-800 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer font-semibold"
              >
                Next
              </button>
            </div>
          </div>
          </>
        )}
      </div>
    </div>
  );
}
