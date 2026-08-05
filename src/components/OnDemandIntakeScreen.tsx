import React, { useState, useEffect } from "react";
import { User, Client } from "../types";
import { api } from "../api";
import { 
  FileText, 
  ArrowRight, 
  AlertCircle, 
  CheckCircle2, 
  Loader2, 
  Building2
} from "lucide-react";

interface OnDemandIntakeScreenProps {
  user: User;
}

export default function OnDemandIntakeScreen({ user }: OnDemandIntakeScreenProps) {
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [textInput, setTextInput] = useState("");
  const [extractedData, setExtractedData] = useState<any>(null);
  
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    const fetchClients = async () => {
      try {
        const data = await api.getClients();
        setClients(data);
        if (data.length > 0) {
          setSelectedClientId(data[0].id);
        }
      } catch (err) {
        console.error("Failed to load clients", err);
      }
    };
    fetchClients();
  }, []);

  const handleExtract = async () => {
    if (!textInput.trim()) {
      setErrorMsg("Please paste some text to extract from.");
      return;
    }
    if (!selectedClientId) {
      setErrorMsg("Please select a target client workspace.");
      return;
    }
    
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await api.extractOnDemandRecord(selectedClientId, textInput);
      setExtractedData({
        patient_first_name: res.patient_first_name || "",
        patient_last_name: res.patient_last_name || "",
        patient_dob: res.patient_dob || "",
        appointment_date: res.appointment_date || "",
        provider_name: res.provider_name || "",
        carrier_name: res.carrier_name || ""
      });
      setSuccessMsg("Extraction complete. Please review and edit the fields below before saving.");
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to extract text.");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateDraft = async () => {
    if (!extractedData) return;
    if (!selectedClientId) {
      setErrorMsg("Please select a target client workspace.");
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      await api.commitOnDemandRecord(selectedClientId, extractedData);
      setSuccessMsg("Draft record created successfully! It is now pending review.");
      setExtractedData(null);
      setTextInput("");
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to create draft record.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in zoom-in-95 duration-200">
      <div className="flex items-center space-x-3 mb-6">
        <div className="bg-blue-600/20 p-2.5 rounded-xl border border-blue-500/30">
          <FileText className="w-6 h-6 text-blue-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">On-Demand Intake</h2>
          <p className="text-xs text-slate-400 mt-1">Paste raw email text to automatically extract and draft appointment records.</p>
        </div>
      </div>

      {errorMsg && (
        <div className="bg-red-500/10 border border-red-500/30 p-3 rounded-lg flex items-center space-x-3 text-red-400 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 p-3 rounded-lg flex items-center space-x-3 text-emerald-400 text-sm">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {!extractedData ? (
        <div className="bg-[#030712] rounded-xl border border-slate-800 shadow-xl overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-800 bg-slate-950/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
              Step 1: Paste Email / Text
            </span>
            
            {/* Client Selector */}
            <div className="flex items-center space-x-2">
              <Building2 className="w-4 h-4 text-slate-500" />
              <select
                value={selectedClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
                className="bg-[#020617] border border-slate-800 rounded-lg text-xs px-3 py-1.5 text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer min-w-[200px]"
              >
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>
          
          <div className="p-5 space-y-4">
            <textarea
              className="w-full h-64 bg-[#020617] border border-slate-800 rounded-lg p-4 text-sm text-slate-300 placeholder-slate-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 resize-y"
              placeholder="Paste the raw text of the appointment request email here..."
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
            />
            
            <div className="flex justify-end">
              <button
                onClick={handleExtract}
                disabled={loading || !textInput.trim() || !selectedClientId}
                className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg font-bold text-sm transition-colors shadow-lg shadow-blue-900/20"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                <span>Extract Information</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-[#030712] rounded-xl border border-slate-800 shadow-xl overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-800 bg-slate-950/40 flex justify-between items-center">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
              Step 2: Review & Edit Draft Record
            </span>
          </div>
          
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wider">First Name</label>
                <input
                  type="text"
                  className="w-full bg-[#020617] border border-slate-800 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                  value={extractedData.patient_first_name}
                  onChange={e => setExtractedData({...extractedData, patient_first_name: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wider">Last Name</label>
                <input
                  type="text"
                  className="w-full bg-[#020617] border border-slate-800 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                  value={extractedData.patient_last_name}
                  onChange={e => setExtractedData({...extractedData, patient_last_name: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wider">DOB</label>
                <input
                  type="text"
                  className="w-full bg-[#020617] border border-slate-800 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                  value={extractedData.patient_dob}
                  onChange={e => setExtractedData({...extractedData, patient_dob: e.target.value})}
                  placeholder="YYYY-MM-DD"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wider">Appointment Date</label>
                <input
                  type="text"
                  className="w-full bg-[#020617] border border-slate-800 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                  value={extractedData.appointment_date}
                  onChange={e => setExtractedData({...extractedData, appointment_date: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wider">Provider Name</label>
                <input
                  type="text"
                  className="w-full bg-[#020617] border border-slate-800 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                  value={extractedData.provider_name}
                  onChange={e => setExtractedData({...extractedData, provider_name: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wider">Insurance Carrier</label>
                <input
                  type="text"
                  className="w-full bg-[#020617] border border-slate-800 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                  value={extractedData.carrier_name}
                  onChange={e => setExtractedData({...extractedData, carrier_name: e.target.value})}
                />
              </div>
            </div>
            
            <div className="flex justify-between mt-6 pt-6 border-t border-slate-800">
              <button
                onClick={() => setExtractedData(null)}
                className="px-4 py-2 text-sm font-semibold text-slate-400 hover:text-white transition-colors"
              >
                Cancel / Start Over
              </button>
              <button
                onClick={handleCreateDraft}
                disabled={loading}
                className="flex items-center space-x-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg font-bold text-sm transition-colors shadow-lg shadow-emerald-900/20"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                <span>Create Draft Record</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
