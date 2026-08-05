import React, { useState, useEffect, useRef } from "react";
import { 
  ArrowLeft, 
  User, 
  FileText, 
  CheckSquare, 
  PhoneCall, 
  Clock, 
  Eye, 
  EyeOff, 
  CheckCircle, 
  AlertCircle,
  HelpCircle,
  Loader2,
  CheckCircle2
} from "lucide-react";
import { api } from "../api";
import { User as UserType, Appointment } from "../types";

interface WorkspaceScreenProps {
  user: UserType;
  appointmentId: string;
  onBack: () => void;
}

export default function WorkspaceScreen({ user, appointmentId, onBack }: WorkspaceScreenProps) {
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Decryption state
  const [decryptedPolicy, setDecryptedPolicy] = useState<string | null>(null);
  const [decrypting, setDecrypting] = useState(false);

  // Call timer state
  const [duration, setDuration] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Verification outcome form state
  const [outcome, setOutcome] = useState<"approved" | "not_approved" | "no_answer" | "callback_needed">("approved");
  const [notes, setNotes] = useState("");
  const [checklist, setChecklist] = useState({
    activeStatus: false,
    coPayInfo: false,
    deductibleMet: false,
    priorAuthRequired: false,
  });
  
  const [generatedScript, setGeneratedScript] = useState<string | null>(null);
  const [generatingScript, setGeneratingScript] = useState(false);

  const loadDetail = async () => {
    setLoading(true);
    try {
      const data = await api.getAppointmentDetail(appointmentId);
      setDetail(data);
      
      // Auto pre-populate from previous calls if exist
      if (data.calls && data.calls.length > 0) {
        const lastCall = data.calls[data.calls.length - 1];
        setOutcome(lastCall.call_outcome);
        setNotes(lastCall.notes || "");
        setChecklist({
          activeStatus: lastCall.checklist?.activeStatus || false,
          coPayInfo: lastCall.checklist?.coPayInfo || false,
          deductibleMet: lastCall.checklist?.deductibleMet || false,
          priorAuthRequired: lastCall.checklist?.priorAuthRequired || false,
        });
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to load patient record.");
    } finally {
      setLoading(true);
      // Wait a tiny bit then disable loading for transition feel
      setTimeout(() => setLoading(false), 200);
    }
  };

  useEffect(() => {
    loadDetail();

    // Start Call Duration Timer
    setDuration(0);
    timerRef.current = setInterval(() => {
      setDuration(prev => prev + 1);
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [appointmentId]);

  const handleDecryptPolicyNumber = async () => {
    if (!detail?.appointment?.id) return;
    setDecrypting(true);
    try {
      const decrypted = await api.decryptPolicy(detail.appointment.id);
      setDecryptedPolicy(decrypted);
      // Update local detailed info
      setDetail((prev: any) => ({
        ...prev,
        insurance: {
          ...prev.insurance,
          policy_number_decrypted: decrypted
        }
      }));
    } catch (err: any) {
      setErrorMsg("Failed to decrypt policy number: " + err.message);
    } finally {
      setDecrypting(false);
    }
  };

  const handleChecklistToggle = (field: keyof typeof checklist) => {
    setChecklist(prev => ({
      ...prev,
      [field]: !prev[field]
    }));
  };

  const handleGenerateScript = async () => {
    if (!detail?.appointment?.insurance?.carrier_name) return;
    setGeneratingScript(true);
    setGeneratedScript(null);
    try {
      const res = await api.getCallScript(
        detail.appointment.client_id, 
        detail.appointment.insurance.carrier_name,
        detail.appointment.provider_name
      );
      setGeneratedScript(res.script);
    } catch (err) {
      console.error(err);
      setGeneratedScript("Failed to generate checklist.");
    } finally {
      setGeneratingScript(false);
    }
  };

  const handleSubmitOutcome = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail?.appointment?.id) return;
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await api.submitVerificationCall(
        detail.appointment.id,
        outcome,
        checklist,
        notes.trim() + ` (Call duration: ${formatTime(duration)})`
      );
      if (res.success) {
        setSuccessMsg(`Verification call outcome logged successfully! Appointment status updated to ${res.appointment.status}.`);
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        setTimeout(() => {
          onBack();
        }, 2000);
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to submit verification outcome.");
      setLoading(false);
    }
  };

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainingSecs = secs % 60;
    return `${mins.toString().padStart(2, "0")}:${remainingSecs.toString().padStart(2, "0")}`;
  };

  if (loading && !detail) {
    return (
      <div className="flex justify-center items-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        <span className="ml-3 text-sm text-slate-400 font-semibold">Opening secure client workspace...</span>
      </div>
    );
  }

  const apt = detail?.appointment;
  const patient = detail?.patient;
  const insurance = detail?.insurance;
  const calls = detail?.calls || [];

  return (
    <div className="space-y-6 text-slate-100">
      {/* Header and Timer */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-800 pb-5">
        <div className="flex items-center space-x-3">
          <button
            onClick={onBack}
            className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white cursor-pointer transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight">Verification Workspace</h2>
            <p className="text-xs text-slate-400">
              Provider Client: <strong className="text-slate-200">{detail?.appointment?.provider_name}</strong> • Record ID: {appointmentId}
            </p>
          </div>
        </div>

        {/* Stopwatch timer */}
        <div className="bg-[#030712] text-white px-4 py-2 rounded-xl flex items-center space-x-2.5 shadow-sm border border-slate-800/80 shrink-0 w-full sm:w-auto justify-center">
          <Clock className="w-4 h-4 text-emerald-400 animate-pulse" />
          <div className="text-right">
            <span className="font-mono text-sm font-bold block leading-none">{formatTime(duration)}</span>
            <span className="text-[9px] text-slate-500 uppercase tracking-widest font-semibold font-sans">Active Call Timer</span>
          </div>
        </div>
      </div>

      {successMsg && (
        <div className="bg-emerald-950/15 border border-emerald-800/85 border-l-4 border-l-emerald-500 p-4 rounded-lg text-xs text-emerald-200 flex items-start space-x-2 font-medium">
          <CheckCircle className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="bg-rose-950/15 border border-rose-800/85 border-l-4 border-l-rose-500 p-4 rounded-lg text-xs text-rose-200 flex items-start space-x-2 font-medium">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-rose-400" />
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Patient Details & Insurance Coverage details - 2 Columns */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Patient Card */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl shadow-lg backdrop-blur-sm">
            <div className="px-5 py-3.5 border-b border-slate-800 bg-slate-950/40 rounded-t-xl flex items-center space-x-2">
              <User className="w-4.5 h-4.5 text-blue-400" />
              <h3 className="font-bold text-sm text-slate-200">Verified Patient Demographics</h3>
            </div>
            <div className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div>
                <span className="block text-[10px] uppercase text-slate-500 font-bold tracking-wider mb-0.5">First Name</span>
                <span className="font-bold text-white">{patient?.first_name}</span>
              </div>
              <div>
                <span className="block text-[10px] uppercase text-slate-500 font-bold tracking-wider mb-0.5">Last Name</span>
                <span className="font-bold text-white">{patient?.last_name}</span>
              </div>
              <div>
                <span className="block text-[10px] uppercase text-slate-500 font-bold tracking-wider mb-0.5">Date of Birth</span>
                <span className="font-bold text-white font-mono">{patient?.dob}</span>
              </div>
              <div>
                <span className="block text-[10px] uppercase text-slate-500 font-bold tracking-wider mb-0.5">Gender / Sex</span>
                <span className="font-bold text-white">{patient?.gender}</span>
              </div>
            </div>
          </div>

          {/* Insurance Card */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl shadow-lg backdrop-blur-sm">
            <div className="px-5 py-3.5 border-b border-slate-800 bg-slate-950/40 rounded-t-xl flex items-center space-x-2">
              <FileText className="w-4.5 h-4.5 text-blue-400" />
              <h3 className="font-bold text-sm text-slate-200">Insurance & Policy Enrollment</h3>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
                <div>
                  <span className="block text-[10px] uppercase text-slate-500 font-bold tracking-wider mb-0.5">Insurance Carrier</span>
                  <span className="font-bold text-white">{insurance?.carrier_name}</span>
                </div>
                <div>
                  <span className="block text-[10px] uppercase text-slate-500 font-bold tracking-wider mb-0.5">Group Number</span>
                  <span className="font-bold text-white font-mono">{insurance?.group_number || "N/A"}</span>
                </div>
                <div>
                  <span className="block text-[10px] uppercase text-slate-500 font-bold tracking-wider mb-0.5">Relationship to Sub</span>
                  <span className="font-bold text-white">{insurance?.relationship}</span>
                </div>
                <div>
                  <span className="block text-[10px] uppercase text-slate-500 font-bold tracking-wider mb-0.5">Subscriber Name</span>
                  <span className="font-bold text-white">{insurance?.subscriber_name}</span>
                </div>
                <div>
                  <span className="block text-[10px] uppercase text-slate-500 font-bold tracking-wider mb-0.5">Subscriber DOB</span>
                  <span className="font-bold text-white font-mono">{insurance?.subscriber_dob}</span>
                </div>
              </div>

              {/* Policy Number section with decryption button */}
              <div className="bg-slate-950/60 border border-slate-850 p-4 rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div className="text-xs">
                  <span className="block text-[10px] uppercase text-slate-400 font-bold tracking-wider mb-1">
                    Policy Number (Encrypted at rest)
                  </span>
                  <div className="flex items-center space-x-2">
                    <span className="text-base font-mono font-bold text-white tracking-wider">
                      {decryptedPolicy || insurance?.policy_number_masked}
                    </span>
                    {decryptedPolicy ? (
                      <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/40 px-2 py-0.2 rounded border border-emerald-800">
                        DECRYPTED
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold text-slate-400 bg-slate-900 px-2 py-0.2 rounded border border-slate-800">
                        MASKED
                      </span>
                    )}
                  </div>
                </div>

                {user.role !== "client_viewer" && !decryptedPolicy && (
                  <button
                    onClick={handleDecryptPolicyNumber}
                    disabled={decrypting}
                    className="bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 px-3.5 py-2 rounded-lg text-xs font-bold shadow-md transition-colors cursor-pointer shrink-0 flex items-center space-x-1"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>{decrypting ? "Decrypting..." : "Decrypt Policy No"}</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Call log history for this appointment */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl shadow-lg backdrop-blur-sm">
            <div className="px-5 py-3.5 border-b border-slate-800 bg-slate-950/40 rounded-t-xl">
              <h3 className="font-bold text-sm text-slate-200">Verification Call Log History ({calls.length})</h3>
            </div>
            <div className="p-4 space-y-3.5 max-h-[220px] overflow-y-auto">
              {calls.length === 0 ? (
                <p className="text-xs text-slate-500 italic text-center py-4">No verification calls logged for this record yet.</p>
              ) : (
                calls.map((call: any, idx: number) => (
                  <div key={call.id || idx} className="text-xs bg-slate-950/40 p-3 rounded-lg border border-slate-850">
                    <div className="flex justify-between items-center mb-1 flex-wrap gap-1">
                      <span className={`inline-flex items-center font-bold uppercase text-[9px] px-1.5 py-0.2 rounded border ${
                        call.call_outcome === "approved" ? "bg-emerald-950/30 text-emerald-300 border-emerald-900/40" :
                        call.call_outcome === "not_approved" ? "bg-rose-950/30 text-rose-300 border-rose-900/40" :
                        "bg-slate-900 text-slate-300 border border-slate-800"
                      }`}>
                        {call.call_outcome.replace("_", " ")}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">
                        {new Date(call.created_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-slate-300 leading-relaxed italic">"{call.notes}"</p>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>

        {/* Verification Checksheet / Logging Form - Right Column */}
        <div>
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl shadow-lg backdrop-blur-sm h-fit sticky top-6">
            <div className="px-5 py-3.5 border-b border-slate-800 bg-slate-950/40 rounded-t-xl flex items-center space-x-2">
              <PhoneCall className="w-4.5 h-4.5 text-blue-400" />
              <h3 className="font-bold text-sm text-slate-200">Call Outcome & Verifications</h3>
            </div>

            {user.role === "client_viewer" ? (
              <div className="p-5 text-center text-xs text-slate-500">
                <HelpCircle className="w-10 h-10 text-slate-700 mx-auto mb-2" />
                <p className="font-semibold text-slate-300">Ready-only Client View</p>
                <p className="text-[10px] text-slate-500 mt-1">Client Viewers are restricted from submitting call outcomes or viewing logs directly.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmitOutcome} className="p-5 space-y-4">
                
                {/* 1. Interactive checklist */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="block text-[10px] uppercase text-slate-500 font-extrabold tracking-wider">
                      Interactive Verification Checklist
                    </span>
                    <button
                      type="button"
                      onClick={handleGenerateScript}
                      disabled={generatingScript}
                      className="text-[10px] bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 border border-blue-500/30 px-2 py-1 rounded transition-colors flex items-center space-x-1"
                    >
                      {generatingScript ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                      <span>Generate Call Checklist</span>
                    </button>
                  </div>

                  {generatedScript && (
                    <div className="bg-slate-900 border border-blue-500/30 rounded p-3 text-xs text-slate-300">
                      <div className="text-blue-400 font-semibold mb-2 flex items-center space-x-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>AI Suggested Reference Checklist</span>
                      </div>
                      <div className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed">
                        {generatedScript}
                      </div>
                    </div>
                  )}
                  
                  <div className="space-y-1.5">
                    <button
                      type="button"
                      onClick={() => handleChecklistToggle("activeStatus")}
                      className="w-full text-left p-2 bg-slate-950/60 hover:bg-slate-950/90 rounded border border-slate-850 flex items-center space-x-2.5 transition-colors cursor-pointer text-xs"
                    >
                      <input 
                        type="checkbox" 
                        checked={checklist.activeStatus}
                        onChange={() => {}} // dummy to avoid react error, handled on container click
                        className="rounded border-slate-750 text-blue-600 focus:ring-blue-500 cursor-pointer pointer-events-none"
                      />
                      <span className="font-medium text-slate-300">Insurance Status is Active</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleChecklistToggle("coPayInfo")}
                      className="w-full text-left p-2 bg-slate-950/60 hover:bg-slate-950/90 rounded border border-slate-850 flex items-center space-x-2.5 transition-colors cursor-pointer text-xs"
                    >
                      <input 
                        type="checkbox" 
                        checked={checklist.coPayInfo}
                        onChange={() => {}}
                        className="rounded border-slate-750 text-blue-600 focus:ring-blue-500 cursor-pointer pointer-events-none"
                      />
                      <span className="font-medium text-slate-300">Co-Pay / Benefit Info Confirmed</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleChecklistToggle("deductibleMet")}
                      className="w-full text-left p-2 bg-slate-950/60 hover:bg-slate-950/90 rounded border border-slate-850 flex items-center space-x-2.5 transition-colors cursor-pointer text-xs"
                    >
                      <input 
                        type="checkbox" 
                        checked={checklist.deductibleMet}
                        onChange={() => {}}
                        className="rounded border-slate-750 text-blue-600 focus:ring-blue-500 cursor-pointer pointer-events-none"
                      />
                      <span className="font-medium text-slate-300">Deductible Met status verified</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleChecklistToggle("priorAuthRequired")}
                      className="w-full text-left p-2 bg-slate-950/60 hover:bg-slate-950/90 rounded border border-slate-850 flex items-center space-x-2.5 transition-colors cursor-pointer text-xs"
                    >
                      <input 
                        type="checkbox" 
                        checked={checklist.priorAuthRequired}
                        onChange={() => {}}
                        className="rounded border-slate-750 text-blue-600 focus:ring-blue-500 cursor-pointer pointer-events-none"
                      />
                      <span className="font-medium text-slate-300">Prior Auth required for code</span>
                    </button>
                  </div>
                </div>

                {/* 2. Call outcome picker */}
                <div>
                  <label htmlFor="outcome" className="block text-[10px] uppercase text-slate-500 font-extrabold tracking-wider mb-1">
                    Call Verification Outcome
                  </label>
                  <select
                    id="outcome"
                    value={outcome}
                    onChange={(e: any) => setOutcome(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-850 rounded-lg text-xs font-semibold text-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                  >
                    <option value="approved">Approved & Cleared for Visit</option>
                    <option value="not_approved">Not Approved / Rejected Coverage</option>
                    <option value="no_answer">No Answer / Left Voicemail</option>
                    <option value="callback_needed">Call back needed / Representative busy</option>
                  </select>
                </div>

                {/* 3. Call notes */}
                <div>
                  <label htmlFor="notes" className="block text-[10px] uppercase text-slate-500 font-extrabold tracking-wider mb-1">
                    Detailed Call Notes & References
                  </label>
                  <textarea
                    id="notes"
                    rows={4}
                    required
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Spoke to BCBS agent Linda. Confirmed policy active..."
                    className="w-full text-xs p-2.5 bg-slate-950 border border-slate-850 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-600 text-white"
                  />
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white py-2 px-4 rounded-lg text-xs font-bold shadow-lg shadow-emerald-950/20 transition-colors cursor-pointer border-0"
                  >
                    {loading ? "Submitting outcome..." : "Submit Verification Outcome"}
                  </button>
                </div>
              </form>
            )}

          </div>
        </div>

      </div>
    </div>
  );
}
