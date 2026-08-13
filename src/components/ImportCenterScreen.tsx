import React, { useState, useEffect } from "react";
import { 
  Upload, 
  FileSpreadsheet, 
  CheckCircle2, 
  AlertCircle, 
  History, 
  MapPin, 
  Database,
  ArrowRight,
  ClipboardList
} from "lucide-react";
import { api } from "../api";
import { User, Client, ImportBatch } from "../types";

interface ImportCenterScreenProps {
  user: User;
}

export default function ImportCenterScreen({ user }: ImportCenterScreenProps) {
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Parse state
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("manual_pasted_data.csv");
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([]);
  const [parsedRows, setParsedRows] = useState<string[][]>([]);
  const [columnMappings, setColumnMappings] = useState<Record<string, string>>({});
  const [aiSuggestedColumns, setAiSuggestedColumns] = useState<Record<string, boolean>>({});
  const [step, setStep] = useState<"upload" | "map" | "preview">("upload");
  const [duplicates, setDuplicates] = useState<Record<number, any>>({});
  const [rowDecisions, setRowDecisions] = useState<Record<number, "create" | "skip">>({});

  // Load clients and batch history
  const loadInitialData = async () => {
    try {
      const clientsData = await api.getClients();
      setClients(clientsData);
      if (clientsData.length > 0) {
        // Default to user's client if they are client viewer
        if (user.role === "client_viewer" && user.client_id) {
          setSelectedClientId(user.client_id);
        } else {
          setSelectedClientId(clientsData[0].id);
        }
      }

      const batchesData = await api.getImportBatches();
      setBatches(batchesData);
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to load historical import batches.");
    }
  };

  useEffect(() => {
    loadInitialData();
  }, [user]);

  // Pre-configured templates to make testing simple
  const sampleTemplates = [
    {
      name: "Apex Primary Care Aug Intake",
      data: `First Name,Last Name,DOB,Gender,Insurance Carrier,Policy No,Group No,Provider Name,Appt Date\nRobert,Gomez,1974-04-18,Male,Blue Cross Blue Shield,BCBS998822,TX-40291,Dr. Lisa Cuddy,2026-08-15\nJessica,Miller,1989-11-02,Female,Aetna,AET-993821-D,AE-GRP-90,Dr. Gregory House,2026-08-16\nJames,Kovacs,1966-07-25,Male,UnitedHealthcare,UHC-8829481,UH-90412,Dr. James Wilson,2026-08-17`,
      filename: "appointments_apc_aug.csv",
      clientId: "client_apc"
    },
    {
      name: "Metropolitan Health Aug Intake",
      data: `first_name,last_name,date_of_birth,gender,carrier,policy_id,group_id,provider,appointment_date\nWilliam,Shatner,1951-03-22,Male,Cigna,CIG-88293,CI-GRP-22,Dr. Meredith Grey,2026-08-18\nLeonard,Nimoy,1961-03-26,Male,Aetna,AET-11022,AE-GRP-90,Dr. Derek Shepherd,2026-08-19`,
      filename: "appointments_mhg_aug_2.csv",
      clientId: "client_mhg"
    }
  ];

  const handleApplyTemplate = (tpl: typeof sampleTemplates[0]) => {
    setCsvText(tpl.data);
    setFileName(tpl.filename);
    setSelectedClientId(tpl.clientId);
    setSuccessMsg(`Applied template: ${tpl.name}. You can click "Parse and Analyze Columns" below.`);
  };

  // Robust CSV parser for a single line
  const parseCsvLine = (text: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '"') {
        if (inQuotes && text[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  // Standard CSV parsing helper
  const handleParseCsv = async () => {
    if (!csvText.trim()) {
      setErrorMsg("Please paste CSV data or apply a template first.");
      return;
    }
    
    if (selectedClientId === "all" || !selectedClientId) {
      setErrorMsg("Please select a target client workspace before proceeding.");
      return;
    }

    try {
      setLoading(true);
      const lines = csvText.trim().split("\n");
      if (lines.length < 2) {
        setErrorMsg("CSV must contain at least a header row and one data row.");
        setLoading(false);
        return;
      }

      // Parse headers
      const headers = parseCsvLine(lines[0]);
      
      // Parse rows
      const rows = lines.slice(1).map(line => parseCsvLine(line));

      setParsedHeaders(headers);
      setParsedRows(rows);
      setErrorMsg(null);
      setSuccessMsg(`Successfully parsed ${headers.length} columns and ${rows.length} rows. Analyzing mapping...`);

      // Call AI endpoint
      const sampleRows = rows.slice(0, 5);
      const res = await api.analyzeMapping(selectedClientId, headers, sampleRows);
      
      const mapping = res.mapping || {};
      const aiSuggested: Record<string, boolean> = {};
      const initialMappings: Record<string, string> = {};
      
      headers.forEach(header => {
        if (mapping[header]) {
          initialMappings[header] = mapping[header];
          if (res.source === "ai") {
            aiSuggested[header] = true;
          }
        } else {
          initialMappings[header] = "ignore";
        }
      });

      setColumnMappings(initialMappings);
      setAiSuggestedColumns(aiSuggested);
      setStep("map");
      if (res.source === "ai") {
        setSuccessMsg(`Analyzed with AI and suggested column mappings.`);
      } else {
        setSuccessMsg(`Found previously confirmed mapping for these columns. Pre-filled automatically.`);
      }
    } catch (e: any) {
      setErrorMsg("Parsing error: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setCsvText(text);
      setSuccessMsg(`File "${file.name}" loaded successfully.`);
    };
    reader.onerror = () => {
      setErrorMsg("Failed to read the uploaded file.");
    };
    reader.readAsText(file);
  };

  // Convert mapped rows to standard format
  const getMappedRecords = () => {
    return parsedRows.map(row => {
      const record: Record<string, any> = {};
      parsedHeaders.forEach((header, colIdx) => {
        const fieldName = columnMappings[header];
        if (fieldName && fieldName !== "ignore") {
          record[fieldName] = row[colIdx] || "";
        }
      });
      return record;
    });
  };

  const handleProceedToPreview = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const records = getMappedRecords();
      const res = await api.checkDuplicates(selectedClientId, records);
      const dupMap: Record<number, any> = {};
      res.duplicates.forEach((d: any) => {
        dupMap[d.rowIndex] = d.existingPatient;
      });
      setDuplicates(dupMap);
      setRowDecisions({});
      setStep("preview");
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to check for duplicates");
    } finally {
      setLoading(false);
    }
  };

  const handleCommitBatch = async () => {
    // Check if any duplicates are pending decision
    const pendingDecisions = Object.keys(duplicates).some(rIdx => !rowDecisions[Number(rIdx)]);
    if (pendingDecisions) {
      setErrorMsg("Please make a decision for all flagged duplicates before committing.");
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const records = getMappedRecords();
      // Filter out skipped rows, and we also pass the decisions for audit logging if we want
      const recordsToCommit = records.filter((_, idx) => rowDecisions[idx] !== "skip");
      const skippedCount = records.length - recordsToCommit.length;
      
      // Basic fields validation check
      const missingFields = recordsToCommit.some(r => !r.first_name || !r.last_name || !r.policy_number);
      if (missingFields) {
        if (!confirm("Some records are missing essential fields (first_name, last_name, or policy_number). Proceed anyway?")) {
          setLoading(false);
          return;
        }
      }

      const res = await api.commitImportBatch(selectedClientId, fileName, recordsToCommit, parsedHeaders, columnMappings, rowDecisions);
      if (res.success) {
        setSuccessMsg(`Batch committed successfully! Created ${recordsToCommit.length} records. ${skippedCount > 0 ? `Skipped ${skippedCount} duplicate rows.` : ""}`);
        setStep("upload");
        setCsvText("");
        setFileName("manual_pasted_data.csv");
        
        // Reload batch history
        const batchesData = await api.getImportBatches();
        setBatches(batchesData);
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to commit import batch to database.");
    } finally {
      setLoading(false);
    }
  };

  // Fields to map to
  const schemaFields = [
    { value: "ignore", label: "Ignore column" },
    { value: "first_name", label: "Patient: First Name *" },
    { value: "last_name", label: "Patient: Last Name *" },
    { value: "dob", label: "Patient: Date of Birth *" },
    { value: "gender", label: "Patient: Gender" },
    { value: "carrier_name", label: "Insurance: Carrier Name" },
    { value: "policy_number", label: "Insurance: Policy Number (Encrypted) *" },
    { value: "group_number", label: "Insurance: Group Number" },
    { value: "provider_name", label: "Appt: Provider Name" },
    { value: "appointment_date", label: "Appt: Appointment Date (YYYY-MM-DD)" },
  ];

  return (
    <div className="space-y-6 text-slate-100">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-white tracking-tight">Manual Import & Intake Center</h2>
        <p className="text-xs text-slate-400">
          Upload provider intake spreadsheets, map custom file structures, and commit verified records.
        </p>
      </div>

      {successMsg && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-lg bg-emerald-950/95 border border-emerald-800/85 border-l-4 border-l-emerald-500 p-3.5 rounded-lg text-xs text-emerald-200 flex items-start space-x-2 font-medium shadow-2xl backdrop-blur-sm">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-lg bg-rose-950/95 border border-rose-800/85 border-l-4 border-l-rose-500 p-3.5 rounded-lg text-xs text-rose-200 flex items-start space-x-2 font-medium shadow-2xl backdrop-blur-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-rose-400" />
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Importer Steps Card - Left & Center */}
        <div className="lg:col-span-2 bg-slate-900/40 border border-slate-800 rounded-xl shadow-lg backdrop-blur-sm">
          
          {/* Header tabs */}
          <div className="px-5 py-4 border-b border-slate-800 bg-slate-950/40 rounded-t-xl flex justify-between items-center">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
              {step === "upload" && "Step 1: Raw CSV Upload / Input"}
              {step === "map" && "Step 2: Interactive Column Mapping"}
              {step === "preview" && "Step 3: Direct Database Commit"}
            </span>
            <div className="flex space-x-1">
              <span className={`w-2 h-2 rounded-full ${step === "upload" ? "bg-emerald-500" : "bg-slate-700"}`}></span>
              <span className={`w-2 h-2 rounded-full ${step === "map" ? "bg-emerald-500" : "bg-slate-700"}`}></span>
              <span className={`w-2 h-2 rounded-full ${step === "preview" ? "bg-emerald-500" : "bg-slate-700"}`}></span>
            </div>
          </div>

          <div className="p-5">
            {/* STEP 1: UPLOAD */}
            {step === "upload" && (
              <div className="space-y-4">
                {/* File input / Pasting area */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {/* File Select */}
                  <div className="sm:col-span-1 flex flex-col justify-center items-center border-2 border-dashed border-slate-800 hover:border-blue-500 rounded-xl p-5 text-center cursor-pointer relative bg-slate-950/40 transition-colors">
                    <input 
                      type="file" 
                      accept=".csv,.txt"
                      onChange={handleFileUpload} 
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" 
                    />
                    <Upload className="w-7 h-7 text-slate-500 mb-2" />
                    <span className="text-xs font-bold text-slate-200">Choose File</span>
                    <span className="text-[10px] text-slate-500 mt-0.5">CSV or plain TXT</span>
                  </div>

                  {/* Templates Quick Start */}
                  <div className="sm:col-span-2 border border-slate-800 rounded-xl p-4 bg-slate-950/30">
                    <div className="flex items-center space-x-2 mb-2">
                      <FileSpreadsheet className="w-4 h-4 text-blue-400" />
                      <span className="text-xs font-bold text-slate-200">Apply Sandbox Template Data</span>
                    </div>
                    <div className="space-y-2">
                      {sampleTemplates.map((tpl, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => handleApplyTemplate(tpl)}
                          className="w-full text-left px-3 py-1.5 bg-slate-950 hover:bg-slate-850 border border-slate-850 rounded-lg text-xs font-medium text-slate-300 flex justify-between items-center transition-colors cursor-pointer"
                        >
                          <span>{tpl.name}</span>
                          <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Tenant selection for the batch */}
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                    Select Client Intake Tenant
                  </label>
                  {user.role === "client_viewer" ? (
                    <div className="p-2 border border-slate-850 bg-slate-950 text-xs font-bold text-slate-200 rounded-lg">
                      {clients.find(c => c.id === user.client_id)?.name}
                    </div>
                  ) : (
                    <select
                      value={selectedClientId}
                      onChange={(e) => setSelectedClientId(e.target.value)}
                      className="w-full bg-[#030712] border border-slate-850 rounded-lg text-xs font-semibold text-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                    >
                      {clients.map(c => (
                        <option key={c.id} value={c.id} className="bg-slate-900">{c.name} ({c.code})</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* CSV Raw Text Area */}
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                    Or Paste Comma-Separated (CSV) Text
                  </label>
                  <textarea
                    rows={6}
                    value={csvText}
                    onChange={(e) => setCsvText(e.target.value)}
                    placeholder="First Name,Last Name,DOB,Gender,Carrier,Policy No,Group No,Provider,Appt Date&#10;John,Doe,1985-05-12,Male,Blue Cross,BCBS9948,TX-40,Dr. House,2026-08-20"
                    className="w-full font-mono text-xs p-3 bg-slate-950 border border-slate-850 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-700"
                  />
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-slate-500 font-medium">File name for log: {fileName}</span>
                  <button
                    onClick={handleParseCsv}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-xs font-bold shadow-lg shadow-emerald-950/20 cursor-pointer transition-colors border-0"
                  >
                    Parse and Analyze Columns
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: MAPPING */}
            {step === "map" && (
              <div className="space-y-4">
                <div className="text-xs text-slate-300 font-medium bg-slate-950 border border-slate-850 p-2.5 rounded-lg">
                  Assign each column header from your CSV to the appropriate database fields. Required fields are marked with (*).
                </div>

                <div className="border border-slate-800 rounded-lg overflow-hidden max-h-[300px] overflow-y-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-950/60 border-b border-slate-800">
                        <th className="p-3 font-bold text-slate-400">CSV Column Header</th>
                        <th className="p-3 font-bold text-slate-400">Database Map Field</th>
                        <th className="p-3 font-bold text-slate-400">Sample Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 bg-slate-900/10">
                      {parsedHeaders.map((header, colIdx) => (
                        <tr key={header} className="hover:bg-slate-800/10 transition-colors">
                          <td className="p-3 font-semibold text-white">{header}</td>
                          <td className="p-3">
                            <select
                              value={columnMappings[header] || "ignore"}
                              onChange={(e) => {
                                setColumnMappings({
                                  ...columnMappings,
                                  [header]: e.target.value
                                });
                                if (aiSuggestedColumns[header]) {
                                  setAiSuggestedColumns(prev => {
                                    const next = { ...prev };
                                    delete next[header];
                                    return next;
                                  });
                                }
                              }}
                              className="bg-[#030712] border border-slate-850 rounded text-xs px-2 py-1 text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer font-medium w-full max-w-[220px]"
                            >
                              {schemaFields.map(f => (
                                <option key={f.value} value={f.value} className="bg-slate-900">{f.label}</option>
                              ))}
                            </select>
                            {aiSuggestedColumns[header] && (
                              <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                AI Suggested
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-slate-400 italic font-mono truncate max-w-[150px]">
                            {parsedRows[0]?.[colIdx] || "(empty)"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-between items-center pt-2">
                  <button
                    onClick={() => setStep("upload")}
                    className="border border-slate-800 hover:bg-slate-800 text-slate-300 hover:text-white px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors"
                  >
                    Go Back
                  </button>
                  <button
                    onClick={handleProceedToPreview}
                    disabled={loading}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-1.5 rounded-lg text-xs font-bold cursor-pointer flex items-center space-x-1.5 border-0 shadow-lg shadow-emerald-950/20 disabled:opacity-50"
                  >
                    <span>{loading ? "Checking..." : "Proceed to Preview"}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: PREVIEW & COMMIT */}
            {step === "preview" && (
              <div className="space-y-4">
                <div className="text-xs text-slate-300 font-medium bg-slate-950 border border-slate-850 p-2.5 rounded-lg">
                  Confirm the parsed data is mapped correctly below before committing directly to the persistent database.
                </div>

                <div className="border border-slate-800 rounded-lg overflow-hidden max-h-[300px] overflow-y-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-950/60 border-b border-slate-800 text-slate-400 font-bold">
                        <th className="p-3">Patient Name</th>
                        <th className="p-3">DOB / Gender</th>
                        <th className="p-3">Carrier / Policy</th>
                        <th className="p-3">Provider / Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 bg-slate-900/10">
                      {getMappedRecords().map((record, rIdx) => {
                        const dup = duplicates[rIdx];
                        const decision = rowDecisions[rIdx];
                        const isSkipped = decision === "skip";
                        
                        return (
                          <React.Fragment key={rIdx}>
                            <tr className={`hover:bg-slate-800/10 transition-colors ${isSkipped ? "opacity-40 bg-slate-900/30" : ""} ${dup && !decision ? "bg-amber-900/20" : ""}`}>
                              <td className="p-3 font-semibold text-white">
                                {record.first_name || <span className="text-rose-400 font-normal">Missing first_name</span>}{" "}
                                {record.last_name || <span className="text-rose-400 font-normal">Missing last_name</span>}
                              </td>
                              <td className="p-3 text-slate-400 font-mono">
                                {record.dob || "—"} / {record.gender || "—"}
                              </td>
                              <td className="p-3">
                                <span className="block font-medium text-slate-300">{record.carrier_name || "—"}</span>
                                <span className="text-[10px] bg-slate-950 text-slate-400 px-1 py-0.5 rounded font-mono font-semibold border border-slate-850">
                                  {record.policy_number || <span className="text-rose-400 font-normal">Missing policy</span>}
                                </span>
                              </td>
                              <td className="p-3 text-slate-400">
                                <span className="block font-medium text-slate-300">{record.provider_name || "—"}</span>
                                <span className="text-[10px]">{record.appointment_date || "—"}</span>
                              </td>
                            </tr>
                            {dup && !decision && (
                              <tr className="bg-amber-900/10 border-b border-slate-800/60">
                                <td colSpan={4} className="p-3">
                                  <div className="flex items-start sm:items-center justify-between flex-col sm:flex-row gap-2 bg-amber-950/40 p-2.5 rounded border border-amber-900/50">
                                    <div className="flex items-center space-x-2 text-amber-500">
                                      <AlertCircle className="w-4 h-4" />
                                      <span className="font-medium">
                                        Possible duplicate of {dup.first_name} {dup.last_name} ({dup.dob})
                                      </span>
                                    </div>
                                    <div className="flex space-x-2">
                                      <button 
                                        onClick={() => setRowDecisions({...rowDecisions, [rIdx]: "skip"})}
                                        className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs font-semibold"
                                      >
                                        Skip this row
                                      </button>
                                      <button 
                                        onClick={() => setRowDecisions({...rowDecisions, [rIdx]: "create"})}
                                        className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-bold"
                                      >
                                        Create anyway
                                      </button>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                            {dup && decision && (
                              <tr className="border-b border-slate-800/60">
                                <td colSpan={4} className="px-3 py-1.5 bg-slate-950/50 text-[10px] text-slate-400 font-medium">
                                  Duplicate flagged. User decided to: <strong className={decision === "skip" ? "text-rose-400" : "text-emerald-400"}>{decision === "skip" ? "Skip" : "Create Anyway"}</strong>.
                                  <button onClick={() => {
                                    const next = {...rowDecisions};
                                    delete next[rIdx];
                                    setRowDecisions(next);
                                  }} className="ml-2 text-blue-400 hover:underline">Change</button>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-between items-center pt-2">
                  <button
                    onClick={() => setStep("map")}
                    className="border border-slate-800 hover:bg-slate-800 text-slate-300 hover:text-white px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer"
                  >
                    Adjust Mapping
                  </button>
                  <button
                    onClick={handleCommitBatch}
                    disabled={loading}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2 rounded-lg text-xs font-extrabold shadow-lg shadow-emerald-950/20 flex items-center space-x-2 cursor-pointer disabled:opacity-50 transition-colors border-0"
                  >
                    <Database className="w-4 h-4" />
                    <span>{loading ? "Committing..." : "Commit Batch to Database"}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Batch History Log - Right */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl shadow-lg h-fit backdrop-blur-sm">
          <div className="px-5 py-4 border-b border-slate-800 bg-slate-950/40 rounded-t-xl flex items-center space-x-2">
            <History className="w-4 h-4 text-blue-400" />
            <h3 className="font-bold text-sm text-slate-200">Batch Upload History</h3>
          </div>

          <div className="p-4 space-y-3 max-h-[460px] overflow-y-auto">
            {batches.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center">No batches have been imported yet.</p>
            ) : (
              batches.map((batch) => {
                const clientObj = clients.find(c => c.id === batch.client_id);
                return (
                  <div key={batch.id} className="border-b border-slate-800/60 last:border-b-0 pb-3 last:pb-0 text-xs">
                    <div className="flex justify-between items-start">
                      <span className="font-semibold text-white truncate max-w-[160px]" title={batch.filename}>
                        {batch.filename}
                      </span>
                      <span className="text-[10px] font-bold bg-emerald-950/40 text-emerald-300 px-1.5 py-0.2 rounded border border-emerald-900/40">
                        {batch.record_count} rows
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1 flex justify-between items-center">
                      <span>Tenant: <strong className="text-slate-300">{clientObj?.code || "APC"}</strong></span>
                      <span>{new Date(batch.created_at).toLocaleString()}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
