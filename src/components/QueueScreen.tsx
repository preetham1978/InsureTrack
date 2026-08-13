import React, { useState, useEffect } from "react";
import { 
  ClipboardList, 
  Search, 
  Filter, 
  ArrowRight, 
  Play, 
  CheckCircle,
  Eye,
  RefreshCw,
  Download
} from "lucide-react";
import { api } from "../api";
import { User, Appointment, Client } from "../types";

interface QueueScreenProps {
  user: User;
  onNavigateToWorkspace: (appointmentId: string) => void;
  clientIdFilter?: string;
}

export default function QueueScreen({ user, onNavigateToWorkspace, clientIdFilter }: QueueScreenProps) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Filters & State
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedClientId, setSelectedClientId] = useState<string>(clientIdFilter || "all");
  const [selectedCarrier, setSelectedCarrier] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("pending_review"); // Default to pending_review
  const [sortBy, setSortBy] = useState<"date" | "created">("date");
  const [selectedApts, setSelectedApts] = useState<string[]>([]);

  // Pagination
  const PAGE_SIZE = 20;
  const [currentPage, setCurrentPage] = useState(1);

  const loadQueue = async () => {
    setLoading(true);
    try {
      const apts = await api.getAppointments();
      setAppointments(apts);

      const clientsData = await api.getClients();
      setClients(clientsData);
    } catch (err: any) {
      setErrorMsg("Failed to load queue. Check connection.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadQueue();
  }, [user]);

  // Handle single promote
  const handlePromote = async (id: string) => {
    try {
      const res = await api.promoteAppointment(id);
      if (res.success) {
        setSuccessMsg("Successfully promoted appointment to Verification Stage!");
        // Update local state
        setAppointments(prev => prev.map(a => a.id === id ? { ...a, status: "in_verification" } : a));
        setTimeout(() => setSuccessMsg(null), 3000);
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to promote appointment");
    }
  };

  // Handle batch promote
  const handleBatchPromote = async () => {
    if (selectedApts.length === 0) return;
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    let count = 0;
    try {
      for (const id of selectedApts) {
        const res = await api.promoteAppointment(id);
        if (res.success) count++;
      }
      setSuccessMsg(`Successfully promoted ${count} appointments to in_verification!`);
      setSelectedApts([]);
      await loadQueue();
    } catch (err: any) {
      setErrorMsg("Error during batch promotion. Some items might have been skipped.");
    } finally {
      setLoading(false);
    }
  };

  // Export Patients - writes audit logs
  const handleExportSelected = async () => {
    if (selectedApts.length === 0) return;
    try {
      const res = await api.exportPatients(selectedApts);
      if (res.success) {
        setSuccessMsg(`Successfully generated and logged export for ${res.count} patient records.`);
        // Simulate a file download
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(res.records, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", `exported_patients_${new Date().toISOString().split('T')[0]}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
        
        setSelectedApts([]);
        setTimeout(() => setSuccessMsg(null), 4000);
      }
    } catch (err: any) {
      setErrorMsg("Failed to log export. " + err.message);
    }
  };

  // Extract unique carriers for filter
  const uniqueCarriers = Array.from(new Set(appointments.map(a => a.insurance?.carrier_name).filter(Boolean)));

  // Filter application
  let filtered = appointments.filter(apt => {
    // Search filter
    const fullName = `${apt.patient?.first_name || ""} ${apt.patient?.last_name || ""}`.toLowerCase();
    const provider = (apt.provider_name || "").toLowerCase();
    const policy = (apt.insurance?.policy_number_masked || "").toLowerCase();
    const matchesSearch = fullName.includes(searchTerm.toLowerCase()) || 
                          provider.includes(searchTerm.toLowerCase()) || 
                          policy.includes(searchTerm.toLowerCase());

    // Status filter
    const matchesStatus = selectedStatus === "all" || apt.status === selectedStatus;

    // Client tenant filter
    let matchesClient = selectedClientId === "all" || apt.client_id === selectedClientId;
    if (user.role === "client_viewer") {
      matchesClient = apt.client_id === user.client_id;
    }

    // Carrier filter
    const matchesCarrier = selectedCarrier === "all" || apt.insurance?.carrier_name === selectedCarrier;

    return matchesSearch && matchesStatus && matchesClient && matchesCarrier;
  });

  // Sort application
  filtered.sort((a, b) => {
    if (sortBy === "date") {
      return new Date(a.appointment_date).getTime() - new Date(b.appointment_date).getTime();
    } else {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
  });

  // Reset to page 1 whenever the filters change.
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedClientId, selectedCarrier, selectedStatus]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPageSafe = Math.min(currentPage, totalPages);
  const paginatedFiltered = filtered.slice((currentPageSafe - 1) * PAGE_SIZE, currentPageSafe * PAGE_SIZE);

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedApts(filtered.map(a => a.id));
    } else {
      setSelectedApts([]);
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedApts(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  return (
    <div className="space-y-6 text-slate-100">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Active Scheduled Intake Queue</h2>
          <p className="text-xs text-slate-400">
            Audit and verify incoming schedules, check credentials, and elevate to Active verification.
          </p>
        </div>
        
        <div className="flex space-x-2 w-full sm:w-auto">
          <button
            onClick={loadQueue}
            className="p-1.5 border border-slate-850 hover:bg-slate-800 rounded-lg text-slate-300 hover:text-white cursor-pointer transition-colors shrink-0"
            title="Refresh queue"
            aria-label="Refresh intake queue"
          >
            <RefreshCw className="w-4.5 h-4.5" />
          </button>
          
          {selectedApts.length > 0 && (
            <div className="flex space-x-2 w-full sm:w-auto">
              <button
                onClick={handleExportSelected}
                className="bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1 shadow-sm cursor-pointer"
              >
                <Download className="w-4 h-4 text-slate-400" />
                <span>Export Selected ({selectedApts.length})</span>
              </button>
              
              {selectedStatus === "pending_review" && (
                <button
                  onClick={handleBatchPromote}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1 shadow-lg shadow-emerald-950/20 cursor-pointer"
                >
                  <Play className="w-4 h-4" />
                  <span>Promote Selected</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {successMsg && (
        <div className="bg-emerald-950/15 border border-emerald-800/85 border-l-4 border-l-emerald-500 p-3.5 rounded-lg text-xs text-emerald-200 flex items-start space-x-2 font-medium">
          <CheckCircle className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="bg-rose-950/15 border border-rose-800/85 border-l-4 border-l-rose-500 p-3.5 rounded-lg text-xs text-rose-200 flex items-start space-x-2 font-medium">
          <Filter className="w-4 h-4 mt-0.5 shrink-0 text-rose-400" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Filter and Search controls */}
      <div className="bg-slate-900/40 border border-slate-800 p-4 rounded-xl shadow-lg space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          
          {/* Search bar */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search patient name, policy..."
              className="pl-9 pr-3 py-2 bg-slate-950/60 border border-slate-850 focus:ring-2 focus:ring-blue-500 focus:outline-none rounded-lg text-xs text-white w-full placeholder-slate-500"
            />
          </div>

          {/* Client select */}
          {user.role !== "client_viewer" && (
            <div>
              <select
                value={selectedClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
                className="bg-[#030712] border border-slate-850 focus:ring-2 focus:ring-blue-500 focus:outline-none rounded-lg text-xs font-semibold text-slate-300 px-3 py-2 w-full cursor-pointer"
              >
                <option value="all">All Client Tenants</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Carrier select */}
          <div>
            <select
              value={selectedCarrier}
              onChange={(e) => setSelectedCarrier(e.target.value)}
              className="bg-[#030712] border border-slate-850 focus:ring-2 focus:ring-blue-500 focus:outline-none rounded-lg text-xs font-semibold text-slate-300 px-3 py-2 w-full cursor-pointer"
            >
              <option value="all">All Carriers</option>
              {uniqueCarriers.map(c => (
                <option key={String(c)} value={String(c)}>{String(c)}</option>
              ))}
            </select>
          </div>

          {/* Status select */}
          <div>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="bg-[#030712] border border-slate-850 focus:ring-2 focus:ring-blue-500 focus:outline-none rounded-lg text-xs font-semibold text-slate-300 px-3 py-2 w-full cursor-pointer"
            >
              <option value="pending_review">Pending Review Queue (Incoming)</option>
              <option value="in_verification">Active In Verification Workspace</option>
              <option value="approved">Approved / Cleared Billing</option>
              <option value="not_approved">Not Approved / Rejected</option>
              <option value="all">All Statuses</option>
            </select>
          </div>

        </div>

        {/* Sorting options */}
        <div className="flex justify-between items-center text-xs text-slate-400 font-medium border-t border-slate-800 pt-3 flex-wrap gap-2">
          <div className="flex items-center space-x-4">
            <span>Show Sorted By:</span>
            <button
              onClick={() => setSortBy("date")}
              className={`pb-1 px-1 font-bold border-b-2 transition-all cursor-pointer ${
                sortBy === "date" ? "border-blue-500 text-blue-400" : "border-transparent hover:text-slate-200"
              }`}
            >
              Appointment Date
            </button>
            <button
              onClick={() => setSortBy("created")}
              className={`pb-1 px-1 font-bold border-b-2 transition-all cursor-pointer ${
                sortBy === "created" ? "border-blue-500 text-blue-400" : "border-transparent hover:text-slate-200"
              }`}
            >
              Upload Timestamp
            </button>
          </div>

          <div>
            Showing <strong className="text-white">{filtered.length}</strong> patient records
          </div>
        </div>
      </div>

      {/* Main Table Card */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-xl shadow-lg overflow-hidden backdrop-blur-sm">
        {loading ? (
          <div className="p-12 text-center text-slate-500">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-3"></div>
            <span>Fetching patient queues...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <ClipboardList className="w-12 h-12 text-slate-700 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-300">No records matches the active filters.</p>
            <p className="text-xs text-slate-500">Adjust search query or switch status categories to explore more.</p>
          </div>
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-950/60 border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                  <th className="p-4 w-10">
                    <input 
                      type="checkbox" 
                      onChange={handleSelectAll} 
                      checked={selectedApts.length === filtered.length && filtered.length > 0}
                      className="rounded border-slate-700 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                  </th>
                  <th className="p-4">Patient Name & Details</th>
                  <th className="p-4">Insurance Carrier</th>
                  <th className="p-4">Policy / Group</th>
                  <th className="p-4">Provider / Date</th>
                  <th className="p-4">Current Status</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {paginatedFiltered.map((apt) => {
                  const isSelected = selectedApts.includes(apt.id);
                  const isPending = apt.status === "pending_review";
                  
                  return (
                    <tr 
                      key={apt.id} 
                      className={`hover:bg-slate-800/20 transition-colors ${
                        isSelected ? "bg-blue-950/10" : ""
                      }`}
                    >
                      <td className="p-4">
                        <input 
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelect(apt.id)}
                          className="rounded border-slate-700 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                      </td>
                      <td className="p-4">
                        <div className="font-bold text-slate-100">
                          {apt.patient ? `${apt.patient.first_name} ${apt.patient.last_name}` : "Unknown Patient"}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          DOB: {apt.patient?.dob || "—"} ({apt.patient?.gender || "—"})
                        </div>
                      </td>
                      <td className="p-4 font-semibold text-slate-200">
                        {apt.insurance?.carrier_name || "Self Pay"}
                      </td>
                      <td className="p-4">
                        <span className="font-mono bg-slate-950 text-slate-300 border border-slate-800 px-1.5 py-0.5 rounded text-[10px] font-semibold">
                          {apt.insurance?.policy_number_masked || "—"}
                        </span>
                        <div className="text-[10px] text-slate-400 mt-1 font-medium">
                          Grp: {apt.insurance?.group_number || "—"}
                        </div>
                      </td>
                      <td className="p-4">
                        <span className="block font-medium text-slate-300">{apt.provider_name}</span>
                        <span className="text-[10px] font-semibold text-slate-400 font-mono mt-0.5 block">{apt.appointment_date}</span>
                      </td>
                      <td className="p-4">
                        <span className={`inline-flex items-center text-[10px] font-extrabold px-2 py-0.5 rounded uppercase tracking-wider border ${
                          apt.status === "pending_review" ? "bg-amber-950/30 text-amber-300 border-amber-900/40" :
                          apt.status === "in_verification" ? "bg-sky-950/30 text-sky-300 border-sky-900/40" :
                          apt.status === "approved" ? "bg-emerald-950/30 text-emerald-300 border-emerald-900/40" :
                          "bg-rose-950/30 text-rose-300 border-rose-900/40"
                        }`}>
                          {apt.status.replace("_", " ")}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex justify-end items-center space-x-2">
                          <button
                            onClick={() => onNavigateToWorkspace(apt.id)}
                            className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg cursor-pointer flex items-center space-x-1 font-bold text-[11px]"
                            title="Open Workspace Details"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Workspace</span>
                          </button>
                          
                          {isPending && user.role !== "client_viewer" && (
                            <button
                              onClick={() => handlePromote(apt.id)}
                              className="p-1 text-emerald-400 hover:bg-emerald-950/30 rounded-lg cursor-pointer flex items-center space-x-0.5 text-[11px] font-bold"
                              title="Promote to Verification"
                            >
                              <Play className="w-3.5 h-3.5 shrink-0" />
                              <span>Promote</span>
                            </button>
                          )}
                        </div>
                      </td>
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
