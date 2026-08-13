import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";
import { initializeApp } from "firebase/app";
import { 
  getFirestore, 
  collection, 
  doc, 
  getDocs, 
  getDoc, 
  setDoc, 
  deleteDoc, 
  initializeFirestore,
  setLogLevel
} from "firebase/firestore";

setLogLevel("silent");

const app = express();
const PORT = 3000;

// Basic security headers on every response.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'"
  );
  next();
});
const DB_FILE = path.join(process.cwd(), "database.json");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ---------------------------------------------------------------------------
// PHI redaction helpers — used before sending any free-text or sample data to
// the Gemini API. These reduce the amount of identifiable patient information
// that leaves the application boundary.
// ---------------------------------------------------------------------------

// Redacts common direct identifiers from free-text notes.
function redactPhiText(input: string | null | undefined): string {
  if (!input) return "";
  let out = String(input);

  // Email addresses
  out = out.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[redacted-email]");
  // Phone numbers (10+ digits, allowing separators)
  out = out.replace(/\b(?:\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "[redacted-phone]");
  // SSN
  out = out.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[redacted-ssn]");
  // Dates: YYYY-MM-DD, MM/DD/YYYY, MM-DD-YY, etc.
  out = out.replace(/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g, "[redacted-date]");
  out = out.replace(/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g, "[redacted-date]");
  // Member / policy / MRN style identifiers: 6+ chars mixing letters and digits
  out = out.replace(/\b(?=[A-Za-z0-9-]{6,})(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]+\b/g, "[redacted-id]");
  // Long bare digit runs (6+) not already caught
  out = out.replace(/\b\d{6,}\b/g, "[redacted-id]");
  // Capitalized word pairs, which are usually person names
  out = out.replace(/\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g, "[redacted-name]");
  // Remaining standalone capitalized words (conservative catch-all)
  out = out.replace(/\b[A-Z][a-z]{2,}\b/g, "[redacted]");

  return out;
}

// Converts a raw CSV cell into a non-identifying shape descriptor, so the AI
// column-mapper can reason about data format without seeing real patient data.
function describeCellShape(value: any): string {
  const v = value === null || value === undefined ? "" : String(value).trim();
  if (v === "") return "<empty>";
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(v) || /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(v)) return "<date>";
  if (/^(m|f|male|female|other|unknown)$/i.test(v)) return "<gender-like>";
  if (/^\d+$/.test(v)) return `<digits:${v.length}>`;
  if (/^[A-Za-z]+$/.test(v)) return `<word:${v.length}>`;
  if (/^[A-Za-z][A-Za-z\s.'-]*$/.test(v)) return `<words:${v.split(/\s+/).length}>`;
  if (/\d/.test(v) && /[A-Za-z]/.test(v)) return `<alphanumeric:${v.length}>`;
  return `<text:${v.length}>`;
}

// Maps a 2D array of sample CSV rows to shape descriptors only.
function describeSampleRows(rows: any[][]): string[][] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => (Array.isArray(row) ? row.map(describeCellShape) : []));
}

// Simple Reversible Encryption for Policy Numbers
const ENCRYPTION_KEY_RAW = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY_RAW) {
  console.error("[SECURITY] ENCRYPTION_KEY is not set. Policy-number encryption/decryption will fail until it is configured.");
}
const ENCRYPTION_KEY = ENCRYPTION_KEY_RAW ? Buffer.from(ENCRYPTION_KEY_RAW.padEnd(32, "0").slice(0, 32)) : null;

function encrypt(text: string): string {
  if (!ENCRYPTION_KEY) return "enc_failed:" + text;
  try {
    const iv = crypto.randomBytes(16); // unique, random IV per record
    const cipher = crypto.createCipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    return "encv2:" + iv.toString("hex") + ":" + encrypted;
  } catch (err) {
    return "enc_failed:" + text;
  }
}

function decrypt(cipherText: string): string {
  if (cipherText.startsWith("encv2:")) {
    if (!ENCRYPTION_KEY) return "decryption_error";
    try {
      const [, ivHex, dataHex] = cipherText.split(":");
      const iv = Buffer.from(ivHex, "hex");
      const decipher = crypto.createDecipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
      let decrypted = decipher.update(dataHex, "hex", "utf8");
      decrypted += decipher.final("utf8");
      return decrypted;
    } catch (err) {
      return "decryption_error";
    }
  }
  if (!cipherText.startsWith("enc:")) {
    return cipherText;
  }
  // Old, weaker encryption format — no longer supported once the key rotates.
  return "decryption_error";
}

// Ensure database file exists with initial mock data
function ensureDatabase() {
  if (fs.existsSync(DB_FILE)) {
    try {
      JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
      return;
    } catch (e) {
      console.error("Invalid database file. Re-creating...");
    }
  }

  // Create Seed Data
  const clients = [
    { id: "client_apc", name: "Apex Primary Care", code: "APC", created_at: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString() },
    { id: "client_mhg", name: "Metropolitan Health Group", code: "MHG", created_at: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString() },
    { id: "client_vap", name: "Valley Pediatrics", code: "VAP", created_at: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString() }
  ];

  const users = [
    { id: "user_rev", email: "reviewer@veloai.com", role: "team1_reviewer", client_id: null, name: "Prasad Preetham (Reviewer)", created_at: new Date().toISOString() },
    { id: "user_ver", email: "verifier@veloai.com", role: "team2_verifier", client_id: null, name: "Sarah Connor (Verifier)", created_at: new Date().toISOString() },
    { id: "user_ops", email: "ops_admin@veloai.com", role: "ops_admin", client_id: null, name: "John Doe (Ops Admin)", created_at: new Date().toISOString() },
    { id: "user_super", email: "super_admin@veloai.com", role: "super_admin", client_id: null, name: "Admin (Super)", created_at: new Date().toISOString() },
    { id: "user_client_apc", email: "apc_viewer@veloai.com", role: "client_viewer", client_id: "client_apc", name: "Dr. James Carter (APC)", created_at: new Date().toISOString() },
    { id: "user_client_mhg", email: "mhg_viewer@veloai.com", role: "client_viewer", client_id: "client_mhg", name: "Jane Smith (MHG)", created_at: new Date().toISOString() }
  ];

  const import_batches = [
    {
      id: "batch_1",
      client_id: "client_apc",
      uploaded_by: "user_rev",
      filename: "appointments_apc_july.xlsx",
      record_count: 5,
      status: "completed",
      created_at: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString()
    },
    {
      id: "batch_2",
      client_id: "client_mhg",
      uploaded_by: "user_rev",
      filename: "appointments_mhg_aug.csv",
      record_count: 4,
      status: "completed",
      created_at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString()
    }
  ];

  const patients = [
    // Client APC Patients
    { id: "pat_apc_1", client_id: "client_apc", first_name: "John", last_name: "Doe", dob: "1985-05-12", gender: "Male", created_at: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString() },
    { id: "pat_apc_2", client_id: "client_apc", first_name: "Alice", last_name: "Johnson", dob: "1990-11-23", gender: "Female", created_at: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString() },
    { id: "pat_apc_3", client_id: "client_apc", first_name: "Robert", last_name: "Miller", dob: "1962-07-04", gender: "Male", created_at: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString() },
    { id: "pat_apc_4", client_id: "client_apc", first_name: "Emily", last_name: "Davis", dob: "1995-02-18", gender: "Female", created_at: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString() },
    { id: "pat_apc_5", client_id: "client_apc", first_name: "David", last_name: "Wilson", dob: "1978-09-30", gender: "Male", created_at: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString() },
    
    // Client MHG Patients
    { id: "pat_mhg_1", client_id: "client_mhg", first_name: "Michael", last_name: "Brown", dob: "1970-03-15", gender: "Male", created_at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString() },
    { id: "pat_mhg_2", client_id: "client_mhg", first_name: "Sophia", last_name: "Martinez", dob: "1988-12-05", gender: "Female", created_at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString() },
    { id: "pat_mhg_3", client_id: "client_mhg", first_name: "William", last_name: "Anderson", dob: "1955-06-25", gender: "Male", created_at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString() },
    { id: "pat_mhg_4", client_id: "client_mhg", first_name: "Emma", last_name: "Taylor", dob: "2001-10-10", gender: "Female", created_at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString() }
  ];

  const appointments = [
    // APC Appointments
    // 1. Pending Review > 24 hours (creates alert!)
    {
      id: "apt_apc_1",
      client_id: "client_apc",
      patient_id: "pat_apc_1",
      appointment_date: new Date(Date.now() + 1 * 24 * 3600 * 1000).toISOString().split("T")[0],
      provider_name: "Dr. Gregory House",
      status: "pending_review",
      created_at: new Date(Date.now() - 36 * 3600 * 1000).toISOString(), // 36 hours ago
      updated_at: new Date(Date.now() - 36 * 3600 * 1000).toISOString()
    },
    // 2. In Verification > 3 days (creates alert!)
    {
      id: "apt_apc_2",
      client_id: "client_apc",
      patient_id: "pat_apc_2",
      appointment_date: new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString().split("T")[0],
      provider_name: "Dr. Lisa Cuddy",
      status: "in_verification",
      created_at: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString(), // 4 days ago
      updated_at: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString()
    },
    // 3. Approved
    {
      id: "apt_apc_3",
      client_id: "client_apc",
      patient_id: "pat_apc_3",
      appointment_date: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString().split("T")[0],
      provider_name: "Dr. James Wilson",
      status: "approved",
      created_at: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString(),
      updated_at: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString()
    },
    // 4. Pending Review (recent, no alert)
    {
      id: "apt_apc_4",
      client_id: "client_apc",
      patient_id: "pat_apc_4",
      appointment_date: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString().split("T")[0],
      provider_name: "Dr. Allison Cameron",
      status: "pending_review",
      created_at: new Date(Date.now() - 4 * 3600 * 1000).toISOString(), // 4 hours ago
      updated_at: new Date(Date.now() - 4 * 3600 * 1000).toISOString()
    },
    // 5. Not Approved
    {
      id: "apt_apc_5",
      client_id: "client_apc",
      patient_id: "pat_apc_5",
      appointment_date: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString().split("T")[0],
      provider_name: "Dr. Eric Foreman",
      status: "not_approved",
      created_at: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString(),
      updated_at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString()
    },

    // MHG Appointments
    // 6. In Verification (recent, no alert)
    {
      id: "apt_mhg_1",
      client_id: "client_mhg",
      patient_id: "pat_mhg_1",
      appointment_date: new Date(Date.now() + 1 * 24 * 3600 * 1000).toISOString().split("T")[0],
      provider_name: "Dr. Meredith Grey",
      status: "in_verification",
      created_at: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString(), // 1 day ago
      updated_at: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString()
    },
    // 7. In Verification > 3 days (creates alert!)
    {
      id: "apt_mhg_2",
      client_id: "client_mhg",
      patient_id: "pat_mhg_2",
      appointment_date: new Date(Date.now() + 4 * 24 * 3600 * 1000).toISOString().split("T")[0],
      provider_name: "Dr. Derek Shepherd",
      status: "in_verification",
      created_at: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(), // 5 days ago
      updated_at: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString()
    },
    // 8. Pending Review (recent, no alert)
    {
      id: "apt_mhg_3",
      client_id: "client_mhg",
      patient_id: "pat_mhg_3",
      appointment_date: new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString().split("T")[0],
      provider_name: "Dr. Cristina Yang",
      status: "pending_review",
      created_at: new Date(Date.now() - 12 * 3600 * 1000).toISOString(), // 12 hours ago
      updated_at: new Date(Date.now() - 12 * 3600 * 1000).toISOString()
    },
    // 9. Approved
    {
      id: "apt_mhg_4",
      client_id: "client_mhg",
      patient_id: "pat_mhg_4",
      appointment_date: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString().split("T")[0],
      provider_name: "Dr. Alex Karev",
      status: "approved",
      created_at: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
      updated_at: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString()
    }
  ];

  const insurance_details = [
    {
      id: "ins_apc_1",
      patient_id: "pat_apc_1",
      appointment_id: "apt_apc_1",
      client_id: "client_apc",
      carrier_name: "Blue Cross Blue Shield",
      policy_number: encrypt("BCBS994827101"),
      group_number: "TX-40291",
      subscriber_name: "John Doe",
      subscriber_dob: "1985-05-12",
      relationship: "Self",
      created_at: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString()
    },
    {
      id: "ins_apc_2",
      patient_id: "pat_apc_2",
      appointment_id: "apt_apc_2",
      client_id: "client_apc",
      carrier_name: "Aetna",
      policy_number: encrypt("AET-8839210-C"),
      group_number: "AE-GRP-90",
      subscriber_name: "Alice Johnson",
      subscriber_dob: "1990-11-23",
      relationship: "Self",
      created_at: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString()
    },
    {
      id: "ins_apc_3",
      patient_id: "pat_apc_3",
      appointment_id: "apt_apc_3",
      client_id: "client_apc",
      carrier_name: "UnitedHealthcare",
      policy_number: encrypt("UHC-773820921"),
      group_number: "UH-90412",
      subscriber_name: "Robert Miller",
      subscriber_dob: "1962-07-04",
      relationship: "Self",
      created_at: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString()
    },
    {
      id: "ins_apc_4",
      patient_id: "pat_apc_4",
      appointment_id: "apt_apc_4",
      client_id: "client_apc",
      carrier_name: "Cigna",
      policy_number: encrypt("CIG-10029304"),
      group_number: "CI-GRP-11",
      subscriber_name: "Emily Davis",
      subscriber_dob: "1995-02-18",
      relationship: "Self",
      created_at: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString()
    },
    {
      id: "ins_apc_5",
      patient_id: "pat_apc_5",
      appointment_id: "apt_apc_5",
      client_id: "client_apc",
      carrier_name: "Blue Cross Blue Shield",
      policy_number: encrypt("BCBS11029302"),
      group_number: "TX-40291",
      subscriber_name: "David Wilson",
      subscriber_dob: "1978-09-30",
      relationship: "Self",
      created_at: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString()
    },
    
    // MHG
    {
      id: "ins_mhg_1",
      patient_id: "pat_mhg_1",
      appointment_id: "apt_mhg_1",
      client_id: "client_mhg",
      carrier_name: "Cigna",
      policy_number: encrypt("CIG-9048371"),
      group_number: "CI-GRP-22",
      subscriber_name: "Michael Brown",
      subscriber_dob: "1970-03-15",
      relationship: "Self",
      created_at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString()
    },
    {
      id: "ins_mhg_2",
      patient_id: "pat_mhg_2",
      appointment_id: "apt_mhg_2",
      client_id: "client_mhg",
      carrier_name: "Aetna",
      policy_number: encrypt("AET-1102931"),
      group_number: "AE-GRP-90",
      subscriber_name: "Sophia Martinez",
      subscriber_dob: "1988-12-05",
      relationship: "Self",
      created_at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString()
    },
    {
      id: "ins_mhg_3",
      patient_id: "pat_mhg_3",
      appointment_id: "apt_mhg_3",
      client_id: "client_mhg",
      carrier_name: "UnitedHealthcare",
      policy_number: encrypt("UHC-22948301"),
      group_number: "UH-90412",
      subscriber_name: "William Anderson",
      subscriber_dob: "1955-06-25",
      relationship: "Self",
      created_at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString()
    },
    {
      id: "ins_mhg_4",
      patient_id: "pat_mhg_4",
      appointment_id: "apt_mhg_4",
      client_id: "client_mhg",
      carrier_name: "Blue Cross Blue Shield",
      policy_number: encrypt("BCBS-3829483"),
      group_number: "TX-10023",
      subscriber_name: "Mark Taylor",
      subscriber_dob: "1972-04-14",
      relationship: "Father",
      created_at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString()
    }
  ];

  const verification_calls = [
    {
      id: "call_1",
      appointment_id: "apt_apc_3",
      verified_by: "user_ver",
      call_outcome: "approved",
      checklist: { activeStatus: true, coPayInfo: true, deductibleMet: true, priorAuthRequired: false },
      notes: "Called BCBS representative. Benefits verified. Policy is active and covers primary care visit with $20 copay.",
      created_at: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString()
    },
    {
      id: "call_2",
      appointment_id: "apt_apc_5",
      verified_by: "user_ver",
      call_outcome: "not_approved",
      checklist: { activeStatus: false, coPayInfo: false, deductibleMet: false, priorAuthRequired: false },
      notes: "Spoke to Aetna. Policy terminated effective 2026-06-30 due to non-payment.",
      created_at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString()
    },
    {
      id: "call_3",
      appointment_id: "apt_mhg_4",
      verified_by: "user_ver",
      call_outcome: "approved",
      checklist: { activeStatus: true, coPayInfo: true, deductibleMet: true, priorAuthRequired: true },
      notes: "Verified coverage with UHC. Prior authorization is required for specialized scan, but primary consultation is approved with $30 copay.",
      created_at: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString()
    }
  ];

  const audit_log = [
    {
      id: "audit_init",
      user_id: "user_super",
      user_email: "super_admin@veloai.com",
      client_id: null,
      action: "SYSTEM_INITIALIZED",
      record_id: "system",
      details: "InsureTrack B2B application has been seeded and initialized.",
      created_at: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString()
    }
  ];

  const db = {
    clients,
    users,
    import_batches,
    patients,
    appointments,
    insurance_details,
    verification_calls,
    audit_log
  };

  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
  console.log("Database seeded successfully!");
}

ensureDatabase();

// --- FIREBASE CLOUD FIRESTORE MIGRATION LAYER ---
let firestoreDb: any = null;
let useFirestore = false;

const firebaseConfigPath = path.join(process.cwd(), "firebase-applet-config.json");
if (fs.existsSync(firebaseConfigPath)) {
  try {
    const config = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf8"));
    const firebaseApp = initializeApp(config);
    firestoreDb = initializeFirestore(firebaseApp, {
      experimentalForceLongPolling: true,
    }, config.firestoreDatabaseId || "(default)");
    useFirestore = true;
    console.log("[FIREBASE] Initialized Firestore successfully with custom database ID:", config.firestoreDatabaseId);
  } catch (err) {
    console.error("[FIREBASE] Failed to initialize Firestore:", err);
  }
}

let dbCache: any = null;

// Write-through helper
async function syncToFirestore(collectionName: string, id: string, data: any) {
  if (!useFirestore || !firestoreDb) return;
  try {
    const sanitized = JSON.parse(JSON.stringify(data)); // strip undefined elements
    const docRef = doc(firestoreDb, collectionName, id);
    await setDoc(docRef, sanitized);
  } catch (err) {
    console.error(`[FIREBASE] Error write-through syncing document ${collectionName}/${id}:`, err);
  }
}

async function deleteFromFirestore(collectionName: string, id: string) {
  if (!useFirestore || !firestoreDb) return;
  try {
    const docRef = doc(firestoreDb, collectionName, id);
    await deleteDoc(docRef);
    console.log(`[FIREBASE] Successfully deleted document ${collectionName}/${id} from Cloud Storage`);
  } catch (err) {
    console.error(`[FIREBASE] Error deleting document ${collectionName}/${id}:`, err);
  }
}

async function fetchFirestoreCollection(collectionName: string): Promise<any[]> {
  if (!useFirestore || !firestoreDb) return [];
  try {
    const colRef = collection(firestoreDb, collectionName);
    const snap = await getDocs(colRef);
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (err) {
    console.error(`[FIREBASE] Error fetching collection '${collectionName}':`, err);
    return [];
  }
}

async function initializeAndSyncDb() {
  const localDb = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  
  if (useFirestore && firestoreDb) {
    try {
      console.log("[FIREBASE] Verifying Cloud database status...");
      const clientsRef = collection(firestoreDb, "clients");
      const clientsSnap = await getDocs(clientsRef);
      
      if (clientsSnap.empty) {
        console.log("[FIREBASE] Cloud database is empty. Performing automatic database.json to Firestore migration...");
        const collections = ["clients", "users", "import_batches", "patients", "appointments", "insurance_details", "verification_calls", "audit_log", "migrations"];
        
        for (const colName of collections) {
          const items = localDb[colName] || [];
          console.log(`[FIREBASE] Migrating ${items.length} records into '${colName}'...`);
          for (const item of items) {
            await syncToFirestore(colName, item.id, item);
          }
        }
        console.log("[FIREBASE] Automatic Firestore migration seeding completed successfully!");
      } else {
        console.log("[FIREBASE] Firestore contains existing active data. Syncing cloud dataset into local memory cache...");
      }
      
      // Load source of truth from Cloud Firestore
      const [clients, users, import_batches, patients, appointments, insurance_details, verification_calls, audit_log] = await Promise.all([
        fetchFirestoreCollection("clients"),
        fetchFirestoreCollection("users"),
        fetchFirestoreCollection("import_batches"),
        fetchFirestoreCollection("patients"),
        fetchFirestoreCollection("appointments"),
        fetchFirestoreCollection("insurance_details"),
        fetchFirestoreCollection("verification_calls"),
        fetchFirestoreCollection("audit_log")
      ]);
      
      dbCache = {
        clients,
        users,
        import_batches,
        patients,
        appointments,
        insurance_details,
        verification_calls,
        audit_log
      };
      
      // Save localized backup
      fs.writeFileSync(DB_FILE, JSON.stringify(dbCache, null, 2), "utf8");
      console.log("[FIREBASE] Memory cache is 100% synchronized with Firebase Cloud Storage. Ready!");
    } catch (err) {
      console.error("[FIREBASE] Migration synchronization failed. Falling back to local database.json:", err);
      dbCache = localDb;
    }
  } else {
    console.log("[FIREBASE] Firebase disabled. Relying on local database.json.");
    dbCache = localDb;
  }
}

function runUserAccessMigration() {
  const db = loadDb();
  if (!db.migrations) db.migrations = {};
  if (!db.migrations.user_access_model_v1) {
    let migratedCount = 0;
    db.users = db.users || [];
    for (const user of db.users) {
      if (!Array.isArray(user.assigned_client_ids)) {
        user.assigned_client_ids = [];
      }
      if (user.role === "team1_reviewer" || user.role === "team2_verifier") {
        user.is_global = true;
        writeAuditLog(
          "system",
          "system@veloai.com",
          null,
          "MIGRATED_WITH_TEMP_GLOBAL_ACCESS",
          user.id,
          "User migrated with temporary global access. Please review and narrow assigned clients."
        );
        migratedCount++;
      } else {
        user.is_global = false;
      }
    }
    db.migrations.user_access_model_v1 = true;
    saveDb(db);
    console.log(`Ran user access migration on ${migratedCount} users.`);
  }
}

// Fire-and-forget sync trigger on server startup
initializeAndSyncDb()
  .then(() => runUserAccessMigration())
  .catch(err => console.error("Database initialization error:", err));

// Load / Save Helper
function loadDb() {
  if (!dbCache) {
    ensureDatabase();
    dbCache = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  }
  return dbCache;
}

function saveDb(db: any) {
  dbCache = db;
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
  
  // Asynchronously propagate all local mutations to Cloud Firestore
  if (useFirestore && firestoreDb) {
    setTimeout(() => {
      const collections = ["clients", "users", "import_batches", "patients", "appointments", "insurance_details", "verification_calls", "audit_log", "migrations"];
      for (const colName of collections) {
        const items = db[colName] || [];
        for (const item of items) {
          syncToFirestore(colName, item.id, item).catch(err => console.error(err));
        }
      }
    }, 0);
  }
}

// RLS Filter Engine
function canAccessClient(user: any, client_id: string): boolean {
  if (!user) return false;
  if (user.role === "ops_admin" || user.role === "super_admin") return true;
  if (user.is_global) return true;
  if (user.role === "client_viewer") return user.client_id === client_id;
  return Array.isArray(user.assigned_client_ids) && user.assigned_client_ids.includes(client_id);
}

function applyRls(db: any, user: any, tableName: string, rows: any[]): any[] {
  if (!user) return [];
  return rows.filter((row: any) =>
    canAccessClient(user, tableName === "clients" ? row.id : row.client_id)
  );
}

// Audit logger helper
function writeAuditLog(userId: string, email: string, clientId: string | null, action: string, recordId: string, details: string) {
  const db = loadDb();
  const logEntry = {
    id: "audit_" + Math.random().toString(36).substring(2, 11),
    user_id: userId,
    user_email: email,
    client_id: clientId,
    action,
    record_id: recordId,
    details,
    created_at: new Date().toISOString()
  };
  db.audit_log.unshift(logEntry); // new logs first
  saveDb(db);
}

// JSON body parser
app.use(express.json({ limit: '10mb' }));

// Middleware to mock authentication via headers
app.use((req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next(); // let per-route guards decide if auth is required
  }

  const token = authHeader.substring(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as {
      sub: string; email: string; role: string; client_id: string | null;
    };
    const db = loadDb();
    const user = db.users.find((u: any) => u.id === payload.sub);
    if (!user) return res.status(401).json({ error: "User not found" });
    (req as any).user = user;
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
  next();
});

const otpStore = new Map<string, { otp: string; expiresAt: number }>();

// --- Lightweight in-memory rate limiting -----------------------------------
// Per-email attempt caps for the two auth endpoints. Fine for a single-
// instance demo/dev deployment; swap for a real rate-limit library backed
// by Redis (or similar) before running more than one instance.
const loginAttempts = new Map<string, { count: number; windowStart: number }>();
const verifyAttempts = new Map<string, { count: number; windowStart: number }>();
const RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_LOGIN_REQUESTS = 5;
const MAX_VERIFY_ATTEMPTS = 5;

function checkRateLimit(
  store: Map<string, { count: number; windowStart: number }>,
  key: string,
  max: number
): boolean {
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    store.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= max) return false;
  entry.count++;
  return true;
}
// -----------------------------------------------------------------------------

// Authentication APIs
app.post("/api/auth/login", (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  const normalizedEmail = email.toLowerCase();
  if (!checkRateLimit(loginAttempts, normalizedEmail, MAX_LOGIN_REQUESTS)) {
    return res.status(429).json({ error: "Too many login requests. Please try again in a few minutes." });
  }

  const db = loadDb();
  const user = db.users.find((u: any) => u.email.toLowerCase() === normalizedEmail);

  if (!user) {
    return res.status(404).json({
      error: "User not found",
      message: "This email isn't registered. Ask your Ops Admin to invite you.",
    });
  }

  const otp = crypto.randomInt(100000, 999999).toString();
  otpStore.set(normalizedEmail, { otp, expiresAt: Date.now() + 5 * 60 * 1000 });

  console.log(`[AUTH] OTP generated for ${email} (OTP: ${otp})`);

  // DEMO MODE: the real OTP is returned in the response so client demos can
  // proceed without a wired-up email provider. Remove this line (and require
  // the real inbox) before onboarding any account that isn't a controlled
  // demo/test account.
  const responsePayload: any = { message: "OTP sent to your email", email, devOtp: otp };

  res.json(responsePayload);
});

app.post("/api/auth/verify-otp", (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) {
    return res.status(400).json({ error: "Email and OTP are required" });
  }

  const normalizedEmail = email.toLowerCase();
  if (!checkRateLimit(verifyAttempts, normalizedEmail, MAX_VERIFY_ATTEMPTS)) {
    return res.status(429).json({ error: "Too many attempts. Please request a new code and try again later." });
  }

  const entry = otpStore.get(normalizedEmail);

  // The universal "123456" bypass has been removed. Every login now requires
  // the actual code issued by /api/auth/login for that email.
  const isValidOtp = !!entry && entry.otp === otp && Date.now() <= entry.expiresAt;

  if (!isValidOtp) {
    return res.status(401).json({ error: "Invalid or expired code" });
  }

  otpStore.delete(normalizedEmail);
  verifyAttempts.delete(normalizedEmail);

  const db = loadDb();
  const user = db.users.find((u: any) => u.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    return res.status(401).json({ error: "User not found" });
  }

  writeAuditLog(user.id, user.email, user.client_id, "USER_LOGIN_SUCCESS", user.id, `User signed in using email/OTP.`);

  const JWT_SECRET = process.env.JWT_SECRET!;
  const token = jwt.sign(
    { sub: user.id, email: user.email, role: user.role, client_id: user.client_id },
    JWT_SECRET,
    { expiresIn: "12h" }
  );

  res.json({
    user,
    token
  });
});

app.get("/api/auth/me", (req, res) => {
  const user = (req as any).user;
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  res.json({ user });
});

// Row Level Security Validation test endpoint
// "Build and TEST this RLS policy before building any UI screen."
app.get("/api/test-rls", (req, res) => {
  const user = (req as any).user;
  if (!user || user.role !== "super_admin") {
    return res.status(403).json({ error: "Access Denied: Only a Super Admin can run this test suite." });
  }

  const db = loadDb();
  const results: any[] = [];
  
  // Test case 1: Super Admin querying patients (should see all 9 patients)
  const superAdmin = db.users.find((u: any) => u.role === "super_admin");
  const adminPatients = applyRls(db, superAdmin, "patients", db.patients);
  results.push({
    test: "Super Admin bypasses filters",
    expected: db.patients.length,
    actual: adminPatients.length,
    success: adminPatients.length === db.patients.length
  });

  // Test case 2: client_viewer (for client_apc) querying patients (should only see patients belonging to client_apc)
  const apcViewer = db.users.find((u: any) => u.email === "apc_viewer@veloai.com");
  const apcPatients = applyRls(db, apcViewer, "patients", db.patients);
  const expectedApcCount = db.patients.filter((p: any) => p.client_id === "client_apc").length;
  results.push({
    test: "Client Viewer limits by client_id",
    expected: expectedApcCount,
    actual: apcPatients.length,
    success: apcPatients.length === expectedApcCount && apcPatients.every((p: any) => p.client_id === "client_apc")
  });

  // Test case 3: client_viewer tries to access details of another client (should be empty or filtered out)
  const nonApcPatients = apcPatients.filter((p: any) => p.client_id !== "client_apc");
  results.push({
    test: "Client Viewer cannot access other client records",
    expected: 0,
    actual: nonApcPatients.length,
    success: nonApcPatients.length === 0
  });

  const allSuccess = results.every(r => r.success);
  res.json({
    message: allSuccess ? "RLS verification tests PASSED successfully!" : "RLS verification tests FAILED!",
    passed: allSuccess,
    results
  });
});

// Clients API
app.get("/api/clients", (req, res) => {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const db = loadDb();
  const filtered = applyRls(db, user, "clients", db.clients);
  res.json(filtered);
});

// Dashboard statistics
app.get("/api/dashboard/stats", (req, res) => {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const db = loadDb();

  // Apply RLS to appointments
  const appointments = applyRls(db, user, "appointments", db.appointments);
  const clients = applyRls(db, user, "clients", db.clients);

  // Status counts
  const stats = {
    total: appointments.length,
    pending_review: appointments.filter((a: any) => a.status === "pending_review").length,
    in_verification: appointments.filter((a: any) => a.status === "in_verification").length,
    approved: appointments.filter((a: any) => a.status === "approved").length,
    not_approved: appointments.filter((a: any) => a.status === "not_approved").length,
  };

  // Aging alerts:
  // - pending_review > 24h
  // - in_verification > 3 days (72h)
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 3600 * 1000);
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 3600 * 1000);

  const pendingAlerts = appointments.filter((a: any) => {
    return a.status === "pending_review" && new Date(a.created_at) < oneDayAgo;
  });

  const verificationAlerts = appointments.filter((a: any) => {
    return a.status === "in_verification" && new Date(a.created_at) < threeDaysAgo;
  });

  // Client summaries
  const clientBreakdown = clients.map((c: any) => {
    const clientApts = appointments.filter((a: any) => a.client_id === c.id);
    return {
      client_id: c.id,
      name: c.name,
      code: c.code,
      total: clientApts.length,
      pending_review: clientApts.filter((a: any) => a.status === "pending_review").length,
      in_verification: clientApts.filter((a: any) => a.status === "in_verification").length,
      approved: clientApts.filter((a: any) => a.status === "approved").length,
      not_approved: clientApts.filter((a: any) => a.status === "not_approved").length,
      aging_pending: clientApts.filter((a: any) => a.status === "pending_review" && new Date(a.created_at) < oneDayAgo).length,
      aging_verification: clientApts.filter((a: any) => a.status === "in_verification" && new Date(a.created_at) < threeDaysAgo).length,
    };
  });

  res.json({
    stats,
    agingAlerts: {
      pending_review_24h_count: pendingAlerts.length,
      in_verification_3d_count: verificationAlerts.length,
      alerts: [
        ...pendingAlerts.map((a: any) => {
          const patient = db.patients.find((p: any) => p.id === a.patient_id);
          const client = db.clients.find((c: any) => c.id === a.client_id);
          const hrs = Math.round((now.getTime() - new Date(a.created_at).getTime()) / (3600 * 1000));
          return {
            id: a.id,
            type: "pending_review_24h",
            patientName: patient ? `${patient.first_name} ${patient.last_name}` : "Unknown Patient",
            clientName: client ? client.name : "Unknown Client",
            created_at: a.created_at,
            hoursOld: hrs,
            appointment_date: a.appointment_date,
            provider_name: a.provider_name
          };
        }),
        ...verificationAlerts.map((a: any) => {
          const patient = db.patients.find((p: any) => p.id === a.patient_id);
          const client = db.clients.find((c: any) => c.id === a.client_id);
          const days = Math.floor((now.getTime() - new Date(a.created_at).getTime()) / (24 * 3600 * 1000));
          return {
            id: a.id,
            type: "in_verification_3d",
            patientName: patient ? `${patient.first_name} ${patient.last_name}` : "Unknown Patient",
            clientName: client ? client.name : "Unknown Client",
            created_at: a.created_at,
            daysOld: days,
            appointment_date: a.appointment_date,
            provider_name: a.provider_name
          };
        })
      ]
    },
    clientBreakdown
  });
});

// Import batches API
app.get("/api/import-batches", (req, res) => {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const db = loadDb();
  const filtered = applyRls(db, user, "import_batches", db.import_batches);
  res.json(filtered);
});

app.post("/api/import-batches/analyze-mapping", async (req, res) => {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { client_id, headers, sampleRows } = req.body;
  if (!client_id || !headers || !sampleRows) {
    return res.status(400).json({ error: "client_id, headers, and sampleRows are required" });
  }

  const db = loadDb();
  
  if (!canAccessClient(user, client_id)) {
    return res.status(403).json({ error: "Access Denied: Not assigned to this client." });
  }

  // 1. Check for previously confirmed mapping
  const headersJoined = headers.join(",");
  const pastBatch = db.import_batches.find(
    (b: any) => b.client_id === client_id && 
                b.headers && 
                b.headers.join(",") === headersJoined && 
                b.field_mapping && 
                Object.keys(b.field_mapping).length > 0
  );

  if (pastBatch) {
    return res.json({ mapping: pastBatch.field_mapping, source: "cache" });
  }

  // 2. No past mapping, call AI
  try {
    // Never send raw patient data to the AI. Only column headers (which are
    // schema metadata, not PHI) and non-identifying shape descriptors are sent.
    const redactedSampleRows = describeSampleRows(sampleRows);

    const prompt = `You are a data mapping assistant. I have a CSV file with the following columns:
    
    ${JSON.stringify(headers)}

    The actual cell values are withheld for privacy. Instead, here are shape descriptors
    for some sample rows, in the same column order as the headers above. Use them only to
    infer data format (for example <date> suggests a date field, <digits:N> a numeric id):
    ${JSON.stringify(redactedSampleRows)}

    Please map each column to one of these exact target fields:
    first_name, last_name, dob, gender, appointment_date, provider_name, carrier_name, policy_number, group_number, subscriber_name, subscriber_dob, relationship.

    Return a JSON object where keys are the source column names, and values are the target fields. 
    If a column does not confidently match any target field, map it to null.
    Do not add any explanations, just return the JSON object.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });

    const text = response.text || "{}";
    const mapping = JSON.parse(text);

    res.json({ mapping, source: "ai" });
  } catch (err) {
    console.error("AI mapping failed", err);
    res.status(500).json({ error: "Failed to analyze mapping" });
  }
});

app.post("/api/import-batches/commit", (req, res) => {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { client_id, filename, rows, headers, field_mapping, rowDecisions } = req.body;
  if (!client_id || !filename || !rows || !Array.isArray(rows)) {
    return res.status(400).json({ error: "client_id, filename, and rows array are required." });
  }

  const db = loadDb();
  
  if (!canAccessClient(user, client_id)) {
    return res.status(403).json({ error: "Access Denied: Not assigned to this client." });
  }

  const decisions = rowDecisions || {};
  const rowsToCommit = rows.filter((_, index) => decisions[index] !== "skip");

  const batchId = "batch_" + Math.random().toString(36).substring(2, 11);
  const newBatch = {
    id: batchId,
    client_id,
    uploaded_by: user.id,
    filename,
    record_count: rowsToCommit.length,
    status: "completed" as const,
    created_at: new Date().toISOString(),
    headers: headers || [],
    field_mapping: field_mapping || {}
  };

  db.import_batches.unshift(newBatch);

  // Commit each record
  rowsToCommit.forEach((row: any) => {
    const patientId = "pat_" + Math.random().toString(36).substring(2, 11);
    const appointmentId = "apt_" + Math.random().toString(36).substring(2, 11);
    const insId = "ins_" + Math.random().toString(36).substring(2, 11);

    // Save Patient
    const newPatient = {
      id: patientId,
      client_id,
      first_name: row.first_name || "Unknown",
      last_name: row.last_name || "Patient",
      dob: row.dob || "1990-01-01",
      gender: row.gender || "Other",
      created_at: new Date().toISOString()
    };
    db.patients.push(newPatient);

    // Save Appointment
    const newAppointment = {
      id: appointmentId,
      client_id,
      patient_id: patientId,
      appointment_date: row.appointment_date || new Date().toISOString().split("T")[0],
      provider_name: row.provider_name || "Unknown Provider",
      status: "pending_review" as const, // initially moves through pending_review
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    db.appointments.push(newAppointment);

    // Save Insurance details (encrypt policy_number)
    const newInsurance = {
      id: insId,
      patient_id: patientId,
      appointment_id: appointmentId,
      client_id,
      carrier_name: row.carrier_name || "Unknown Insurance",
      policy_number: encrypt(row.policy_number || "999999"),
      group_number: row.group_number || "",
      subscriber_name: row.subscriber_name || `${newPatient.first_name} ${newPatient.last_name}`,
      subscriber_dob: row.subscriber_dob || newPatient.dob,
      relationship: row.relationship || "Self",
      created_at: new Date().toISOString()
    };
    db.insurance_details.push(newInsurance);
  });

  saveDb(db);

  writeAuditLog(
    user.id,
    user.email,
    client_id,
    "IMPORT_BATCH_COMMITTED",
    batchId,
    `Committed import batch ${filename} with ${rowsToCommit.length} insurance tracking rows.`
  );

  const forcedCreations = Object.values(decisions).filter(d => d === "create").length;
  if (forcedCreations > 0) {
    writeAuditLog(
      user.id,
      user.email,
      client_id,
      "DUPLICATE_OVERRIDE",
      batchId,
      `User confirmed creation of ${forcedCreations} rows despite fuzzy duplicate warnings in batch ${filename}.`
    );
  }

  res.json({ success: true, batch: newBatch });
});

// On-Demand Intake Extraction
app.post("/api/on-demand/extract", async (req, res) => {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { client_id, text } = req.body;
  if (!client_id || !text) {
    return res.status(400).json({ error: "client_id and text are required" });
  }

  if (!canAccessClient(user, client_id)) {
    return res.status(403).json({ error: "Access Denied: Not assigned to this client." });
  }

  try {
    const prompt = `You are a medical intake extraction assistant. Extract the following information from the text below:
    - patient_first_name
    - patient_last_name
    - patient_dob (format YYYY-MM-DD if possible)
    - appointment_date (format YYYY-MM-DD or whatever is mentioned)
    - provider_name
    - carrier_name

    Return a JSON object with exactly these keys. Any field not found in the text should be null, not guessed.

    Text:
    ${text}
    `;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });

    const result = JSON.parse(response.text || "{}");
    res.json(result);
  } catch (err) {
    console.error("AI extraction failed", err);
    res.status(500).json({ error: "Failed to extract fields" });
  }
});

// On-Demand Intake Commit Draft
app.post("/api/on-demand/commit", (req, res) => {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { client_id, data } = req.body;
  if (!client_id || !data) {
    return res.status(400).json({ error: "client_id and data are required" });
  }

  if (!data.patient_first_name || !data.patient_last_name || !data.patient_dob) {
    return res.status(400).json({
      error: "Patient first name, last name, and date of birth are required before creating a record. Please fill in any fields the extraction missed."
    });
  }

  if (!canAccessClient(user, client_id)) {
    return res.status(403).json({ error: "Access Denied: Not assigned to this client." });
  }

  const db = loadDb();

  const patientId = "pat_" + Math.random().toString(36).substring(2, 11);
  const appointmentId = "apt_" + Math.random().toString(36).substring(2, 11);
  const insId = "ins_" + Math.random().toString(36).substring(2, 11);

  // Save Patient
  const newPatient = {
    id: patientId,
    client_id,
    first_name: data.patient_first_name || "Unknown",
    last_name: data.patient_last_name || "Patient",
    dob: data.patient_dob || "1990-01-01",
    gender: data.patient_gender || "Other", // Can add gender if we want, defaulting for now
    created_at: new Date().toISOString()
  };
  db.patients.push(newPatient);

  // Save Appointment
  const newAppointment = {
    id: appointmentId,
    client_id,
    patient_id: patientId,
    appointment_date: data.appointment_date || new Date().toISOString().split("T")[0],
    provider_name: data.provider_name || "Unknown Provider",
    status: "pending_review" as const,
    source: "on_demand_email",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  db.appointments.push(newAppointment);

  // Save Insurance details
  const newInsurance = {
    id: insId,
    patient_id: patientId,
    appointment_id: appointmentId,
    client_id,
    carrier_name: data.carrier_name || "Unknown Insurance",
    policy_number: encrypt("PENDING"),
    group_number: "",
    subscriber_name: `${newPatient.first_name} ${newPatient.last_name}`,
    subscriber_dob: newPatient.dob,
    relationship: "Self",
    created_at: new Date().toISOString()
  };
  db.insurance_details.push(newInsurance);

  saveDb(db);

  writeAuditLog(
    user.id,
    user.email,
    client_id,
    "ON_DEMAND_DRAFT_CREATED",
    appointmentId,
    `Created draft record for ${newPatient.first_name} ${newPatient.last_name} via On-Demand email paste.`
  );

  res.json({ success: true, patient_id: patientId, appointment_id: appointmentId });
});

function soundex(s: string): string {
  if (!s) return "";
  let a = s.toLowerCase().split(''),
      f = a.shift(),
      r = '',
      codes: any = { a: '', e: '', i: '', o: '', u: '', b: 1, f: 1, p: 1, v: 1, c: 2, g: 2, j: 2, k: 2, q: 2, s: 2, x: 2, z: 2, d: 3, t: 3, l: 4, m: 5, n: 5, r: 6 };
  f = f ? f.toUpperCase() : '';
  r = f + a.map(v => codes[v] || codes[v] === 0 ? codes[v] : '').join('').replace(/(.)\1+/g, '$1').replace(/0/g, '');
  return (r + '0000').slice(0, 4);
}

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let matrix = [];
  let i, j;
  for (i = 0; i <= b.length; i++) { matrix[i] = [i]; }
  for (j = 0; j <= a.length; j++) { matrix[0][j] = j; }
  for (i = 1; i <= b.length; i++) {
    for (j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) == a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
      }
    }
  }
  return matrix[b.length][a.length];
}

app.post("/api/import-batches/check-duplicates", (req, res) => {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { client_id, rows } = req.body;
  if (!client_id || !rows || !Array.isArray(rows)) {
    return res.status(400).json({ error: "client_id and rows array are required." });
  }

  const MAX_DUPLICATE_CHECK_ROWS = 500;
  if (rows.length > MAX_DUPLICATE_CHECK_ROWS) {
    return res.status(400).json({
      error: `Too many rows for duplicate checking in a single request (max ${MAX_DUPLICATE_CHECK_ROWS}). Please split this import into smaller batches.`
    });
  }

  if (!canAccessClient(user, client_id)) {
    return res.status(403).json({ error: "Access Denied: Not assigned to this client." });
  }

  const db = loadDb();
  const existingPatients = db.patients.filter((p: any) => p.client_id === client_id);

  const duplicates = rows.map((row: any, index: number) => {
    if (!row.first_name || !row.last_name || !row.dob) return null;
    
    // Find a fuzzy match
    const match = existingPatients.find((p: any) => {
      // Normalize DOB to YYYY-MM-DD
      const normalizeDate = (d: string) => {
        try {
          const date = new Date(d);
          if (isNaN(date.getTime())) return d;
          return date.toISOString().split("T")[0];
        } catch {
          return d;
        }
      };

      // DOB must be exact match for this heuristic
      if (normalizeDate(p.dob) !== normalizeDate(row.dob)) return false;
      
      const fn1 = p.first_name.toLowerCase();
      const fn2 = row.first_name.toLowerCase();
      const ln1 = p.last_name.toLowerCase();
      const ln2 = row.last_name.toLowerCase();

      const fnLev = levenshtein(fn1, fn2);
      const lnLev = levenshtein(ln1, ln2);
      const fnSdx = soundex(fn1) === soundex(fn2);
      const lnSdx = soundex(ln1) === soundex(ln2);

      // Match if (First name is close OR soundex matches) AND (Last name is close OR soundex matches)
      const firstMatch = fnLev <= 2 || fnSdx;
      const lastMatch = lnLev <= 2 || lnSdx;
      
      return firstMatch && lastMatch;
    });

    if (match) {
      return {
        rowIndex: index,
        existingPatient: match
      };
    }
    return null;
  }).filter(Boolean);

  res.json({ duplicates });
});

// Appointments & Patients details combined (Queue list)
// Simple in-memory cache for call scripts
const callScriptCache = new Map<string, string>();

app.post("/api/ai/call-script", async (req, res) => {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { client_id, carrier_name, provider_name } = req.body;
  if (!client_id || !carrier_name) {
    return res.status(400).json({ error: "client_id and carrier_name are required" });
  }

  if (!canAccessClient(user, client_id)) {
    return res.status(403).json({ error: "Access Denied: Not assigned to this client." });
  }

  const cacheKey = carrier_name.toLowerCase().trim();
  if (callScriptCache.has(cacheKey)) {
    return res.json({ script: callScriptCache.get(cacheKey), source: "cache" });
  }

  try {
    const prompt = `You are a medical billing expert. Generate a short (4-6 item) practical call checklist for an insurance verification call.
    Carrier: ${carrier_name}
    Provider: ${provider_name || "Unknown"}
    
    The checklist should include items to confirm like "plan is active as of today", "ask about copay amount", "confirm prior authorization requirements", etc.
    Return only the list items, separated by newlines, as plain text without markdown or numbering.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const script = response.text || "";
    callScriptCache.set(cacheKey, script);

    res.json({ script, source: "ai" });
  } catch (err) {
    console.error("AI script generation failed", err);
    res.status(500).json({ error: "Failed to generate script" });
  }
});

app.get("/api/appointments", (req, res) => {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const db = loadDb();
  
  // Apply RLS to appointments
  const filteredAppointments = applyRls(db, user, "appointments", db.appointments);

  // Map other attributes (patient details, insurance details)
  const result = filteredAppointments.map((apt: any) => {
    const patient = db.patients.find((p: any) => p.id === apt.patient_id);
    const insurance = db.insurance_details.find((i: any) => i.appointment_id === apt.id);
    const calls = db.verification_calls.filter((c: any) => c.appointment_id === apt.id);
    
    // Policy number is masked by default
    let maskedPolicy = "••••••••";
    if (insurance) {
      const decrypted = decrypt(insurance.policy_number);
      maskedPolicy = decrypted.length > 4 
        ? "••••" + decrypted.slice(-4) 
        : decrypted;
    }

    return {
      ...apt,
      patient: patient ? {
        id: patient.id,
        first_name: patient.first_name,
        last_name: patient.last_name,
        dob: patient.dob,
        gender: patient.gender
      } : null,
      insurance: insurance ? {
        id: insurance.id,
        carrier_name: insurance.carrier_name,
        policy_number_masked: maskedPolicy,
        group_number: insurance.group_number,
        subscriber_name: insurance.subscriber_name,
        subscriber_dob: insurance.subscriber_dob,
        relationship: insurance.relationship
      } : null,
      calls_count: calls.length
    };
  });

  res.json(result);
});

// Get detailed appointment by ID (Workspace View)
// Writing an audit log row for viewing patient record is MANDATORY
app.get("/api/appointments/:id", (req, res) => {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.params;
  const db = loadDb();

  const apt = db.appointments.find((a: any) => a.id === id);
  if (!apt) {
    return res.status(404).json({ error: "Appointment not found" });
  }

  if (!canAccessClient(user, apt.client_id)) {
    return res.status(403).json({ error: "Access Denied: Not assigned to this client." });
  }

  const patient = db.patients.find((p: any) => p.id === apt.patient_id);
  const insurance = db.insurance_details.find((i: any) => i.appointment_id === apt.id);
  const calls = db.verification_calls.filter((c: any) => c.appointment_id === apt.id);

  let decryptedPolicy = "";
  let maskedPolicy = "••••••••";
  if (insurance) {
    decryptedPolicy = decrypt(insurance.policy_number);
    maskedPolicy = decryptedPolicy.length > 4 
      ? "••••" + decryptedPolicy.slice(-4) 
      : decryptedPolicy;
  }

  // Audit view logs - mandatory for view
  writeAuditLog(
    user.id,
    user.email,
    apt.client_id,
    "VIEW_PATIENT_RECORD",
    apt.patient_id,
    `Viewed detailed record for patient: ${patient ? `${patient.first_name} ${patient.last_name}` : "Unknown"}`
  );

  res.json({
    appointment: apt,
    patient,
    insurance: insurance ? {
      ...insurance,
      policy_number: undefined,
      policy_number_masked: maskedPolicy,
    } : null,
    calls
  });
});

// Decrypt Policy number explicitly (optional, creates precise audit log)
app.post("/api/appointments/:id/decrypt-policy", (req, res) => {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.params;
  const db = loadDb();

  const apt = db.appointments.find((a: any) => a.id === id);
  if (!apt) return res.status(404).json({ error: "Appointment not found" });

  if (!canAccessClient(user, apt.client_id)) {
    return res.status(403).json({ error: "Access Denied: Not assigned to this client." });
  }

  if (user.role === "client_viewer") {
    return res.status(403).json({ error: "Access Denied: Client viewers cannot decrypt policy numbers." });
  }

  const insurance = db.insurance_details.find((i: any) => i.appointment_id === apt.id);
  if (!insurance) return res.status(404).json({ error: "Insurance info not found" });

  const decrypted = decrypt(insurance.policy_number);
  const patient = db.patients.find((p: any) => p.id === apt.patient_id);

  writeAuditLog(
    user.id,
    user.email,
    apt.client_id,
    "DECRYPT_POLICY_NUMBER",
    insurance.id,
    `Decrypted policy number for patient ${patient ? `${patient.first_name} ${patient.last_name}` : "Unknown"}`
  );

  res.json({ decrypted });
});

// Promote Appointment Stage (from pending_review to in_verification)
app.post("/api/appointments/:id/promote", (req, res) => {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.params;
  const db = loadDb();

  const aptIndex = db.appointments.findIndex((a: any) => a.id === id);
  if (aptIndex === -1) return res.status(404).json({ error: "Appointment not found" });

  const currentAppointment = db.appointments[aptIndex];
  if (currentAppointment.status !== "pending_review") {
    return res.status(400).json({
      error: `Cannot promote appointment from status "${currentAppointment.status}". Only appointments in "pending_review" can be promoted to "in_verification".`
    });
  }

  const apt = db.appointments[aptIndex];

  if (!canAccessClient(user, apt.client_id)) {
    return res.status(403).json({ error: "Access Denied: Not assigned to this client." });
  }

  // Update status
  const oldStatus = apt.status;
  apt.status = "in_verification";
  apt.updated_at = new Date().toISOString();

  saveDb(db);

  const patient = db.patients.find((p: any) => p.id === apt.patient_id);
  writeAuditLog(
    user.id,
    user.email,
    apt.client_id,
    "APPOINTMENT_STAGE_PROMOTED",
    apt.id,
    `Promoted appointment status from ${oldStatus} to in_verification for patient ${patient ? `${patient.first_name} ${patient.last_name}` : "Unknown"}`
  );

  res.json({ success: true, appointment: apt });
});

// FEATURE A: Get Denial Risk Assessment for an appointment based on historical carrier verification calls
app.get("/api/appointments/:id/denial-risk", async (req, res) => {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.params;
  const db = loadDb();

  const apt = db.appointments.find((a: any) => a.id === id);
  if (!apt) {
    return res.status(404).json({ error: "Appointment not found" });
  }

  if (!canAccessClient(user, apt.client_id)) {
    return res.status(403).json({ error: "Access Denied: Not assigned to this client." });
  }

  const insurance = db.insurance_details.find((i: any) => i.appointment_id === apt.id);
  if (!insurance || !insurance.carrier_name) {
    return res.json({ insufficientData: true, message: "Insurance carrier information is missing for this appointment." });
  }

  const carrierName = insurance.carrier_name;

  // Find all appointments for THIS CLIENT ONLY with the same carrier_name (never cross-client)
  const clientAppointments = db.appointments.filter((a: any) => a.client_id === apt.client_id);
  const clientAppointmentIds = new Set(clientAppointments.map((a: any) => a.id));

  const clientInsurances = db.insurance_details.filter((i: any) => clientAppointmentIds.has(i.appointment_id) && i.carrier_name === carrierName);
  const carrierApptIds = new Set(clientInsurances.map((i: any) => i.appointment_id));

  // Find all verification calls for those appointments
  const historicalCalls = db.verification_calls.filter((c: any) => carrierApptIds.has(c.appointment_id));

  const MIN_CALLS = 5;
  if (historicalCalls.length < MIN_CALLS) {
    return res.json({
      insufficientData: true,
      carrierName,
      totalCalls: historicalCalls.length,
      minimumRequired: MIN_CALLS,
      message: `Insufficient historical verification data for carrier '${carrierName}' under client (found ${historicalCalls.length} prior calls, minimum ${MIN_CALLS} required).`
    });
  }

  // Aggregate outcome counts
  let approvedCount = 0;
  let notApprovedCount = 0;
  let otherCount = 0;
  const denialNotes: string[] = [];

  historicalCalls.forEach((c: any) => {
    if (c.call_outcome === "approved") {
      approvedCount++;
    } else if (c.call_outcome === "not_approved") {
      notApprovedCount++;
      if (c.notes) {
        // Strip direct identifiers (names, dates, phone/email, member and policy
        // ids) before any note text is sent to the AI.
        denialNotes.push(redactPhiText(c.notes));
      }
    } else {
      otherCount++;
    }
  });

  try {
    const prompt = `You are an expert medical billing compliance and claims denial analyst.
Analyze the historical verification outcomes for insurance carrier "${carrierName}" for this healthcare client.
Total Historical Calls: ${historicalCalls.length}
- Approved: ${approvedCount}
- Not Approved / Denied: ${notApprovedCount}
- Other / Callback: ${otherCount}

Excerpts from past denial/not_approved call notes (aggregated reasons):
Do not quote, closely paraphrase, or reproduce any specific sentence from the notes below. Describe only recurring categories of reasons in your own general language, without referencing any single call.
${denialNotes.slice(0, 10).join("\n- ")}

Assess whether this carrier shows a historically elevated denial pattern.
Return a JSON object with:
- "isElevatedRisk": boolean
- "riskLevel": string ("Low", "Moderate", "Elevated")
- "explanation": string (A clear, plain-language explanation of WHY the risk flag is raised, referencing historical denial rates or common patterns. Never just a bare score.)
- "commonDenialReasons": array of strings (common reasons or missing documentation noted in past denials)
`;

    const aiRes = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });

    const analysis = JSON.parse(aiRes.text || "{}");
    res.json({
      insufficientData: false,
      carrierName,
      totalCalls: historicalCalls.length,
      approvedCount,
      notApprovedCount,
      ...analysis
    });
  } catch (err) {
    console.error("AI denial risk analysis failed:", err);
    const denialRate = notApprovedCount / historicalCalls.length;
    res.json({
      insufficientData: false,
      carrierName,
      totalCalls: historicalCalls.length,
      approvedCount,
      notApprovedCount,
      isElevatedRisk: denialRate > 0.3,
      riskLevel: denialRate > 0.3 ? "Elevated" : "Low",
      explanation: `Based on ${historicalCalls.length} historical verification calls for ${carrierName}, ${notApprovedCount} resulted in non-approval (${Math.round(denialRate * 100)}% denial rate).`,
      commonDenialReasons: ["Prior authorization required", "Missing benefit details"]
    });
  }
});

// Submit verification call outcome & update appointment status
app.post("/api/appointments/:id/verification-call", (req, res) => {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.params;
  const { call_outcome, checklist, notes } = req.body;

  if (!call_outcome) {
    return res.status(400).json({ error: "call_outcome is required." });
  }

  const db = loadDb();
  const aptIndex = db.appointments.findIndex((a: any) => a.id === id);
  if (aptIndex === -1) return res.status(404).json({ error: "Appointment not found" });

  const apt = db.appointments[aptIndex];

  if (!canAccessClient(user, apt.client_id)) {
    return res.status(403).json({ error: "Access Denied: Not assigned to this client." });
  }

  // Only team2_verifier or admin can perform verification calls
  if (user.role !== "team2_verifier" && user.role !== "ops_admin" && user.role !== "super_admin") {
    return res.status(403).json({ error: "Access Denied: Only verifiers or admins can log verification calls." });
  }

  // Create call log
  const callId = "call_" + Math.random().toString(36).substring(2, 11);
  const newCall = {
    id: callId,
    appointment_id: id,
    verified_by: user.id,
    call_outcome,
    checklist: checklist || {},
    notes: notes || "",
    created_at: new Date().toISOString()
  };

  db.verification_calls.push(newCall);

  // Update appointment status based on outcome
  const oldStatus = apt.status;
  if (call_outcome === "approved") {
    apt.status = "approved";
  } else if (call_outcome === "not_approved") {
    apt.status = "not_approved";
  } else {
    // For no_answer or callback_needed, keep it in "in_verification" or return to it
    apt.status = "in_verification";
  }
  apt.updated_at = new Date().toISOString();

  saveDb(db);

  const patient = db.patients.find((p: any) => p.id === apt.patient_id);
  writeAuditLog(
    user.id,
    user.email,
    apt.client_id,
    "VERIFICATION_CALL_SUBMITTED",
    id,
    `Logged verification call with outcome "${call_outcome}". Updated appointment status from ${oldStatus} to ${apt.status} for patient ${patient ? `${patient.first_name} ${patient.last_name}` : "Unknown"}`
  );

  res.json({ success: true, appointment: apt, call: newCall });
});

// Admin API: Users and roles management (for ops_admin and super_admin)
app.get("/api/admin/users", (req, res) => {
  const user = (req as any).user;
  if (!user || (user.role !== "ops_admin" && user.role !== "super_admin")) {
    return res.status(403).json({ error: "Access Denied: Only administrators have access." });
  }

  const db = loadDb();
  // Filter by client if ops_admin is bound (though by rule ops_admin bypasses client filters, let's keep it complete)
  const filteredUsers = applyRls(db, user, "users", db.users);
  res.json(filteredUsers);
});

app.post("/api/admin/users", (req, res) => {
  const user = (req as any).user;
  if (!user || (user.role !== "ops_admin" && user.role !== "super_admin")) {
    return res.status(403).json({ error: "Access Denied." });
  }

  const { email, role, client_id, name, is_global, assigned_client_ids } = req.body;
  if (!email || !role || !name) {
    return res.status(400).json({ error: "Email, role, and name are required." });
  }

  // Only a Super Admin may create another Super Admin account.
  if (role === "super_admin" && user.role !== "super_admin") {
    return res.status(403).json({ error: "Access Denied: Only a Super Admin can grant the Super Admin role." });
  }

  const db = loadDb();
  
  // Check if user already exists
  if (db.users.some((u: any) => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(400).json({ error: "User with this email already exists." });
  }

  const newUser = {
    id: "user_" + Math.random().toString(36).substring(2, 11),
    email: email.toLowerCase(),
    role,
    client_id: role === "client_viewer" ? client_id : null,
    name,
    is_global: !!is_global,
    assigned_client_ids: Array.isArray(assigned_client_ids) ? assigned_client_ids : [],
    created_at: new Date().toISOString()
  };

  db.users.push(newUser);
  saveDb(db);

  writeAuditLog(
    user.id,
    user.email,
    user.client_id,
    "ADMIN_CREATE_USER",
    newUser.id,
    `Created new user ${newUser.name} with role ${role}`
  );

  if (role === "team1_reviewer" || role === "team2_verifier") {
    writeAuditLog(
      user.id,
      user.email,
      user.client_id,
      "ADMIN_UPDATE_USER_ACCESS",
      newUser.id,
      `Access granted - is_global: false -> ${newUser.is_global}, assigned_client_ids: [] -> [${newUser.assigned_client_ids.join(",")}]`
    );
  }

  res.json({ success: true, user: newUser });
});

app.put("/api/admin/users/:id", (req, res) => {
  const user = (req as any).user;
  if (!user || (user.role !== "ops_admin" && user.role !== "super_admin")) {
    return res.status(403).json({ error: "Access Denied." });
  }

  const { id } = req.params;
  const { role, client_id, name, is_global, assigned_client_ids } = req.body;

  const db = loadDb();
  const userIndex = db.users.findIndex((u: any) => u.id === id);
  if (userIndex === -1) return res.status(404).json({ error: "User not found" });

  const targetUser = db.users[userIndex];
  
  // A user may not change their own role — prevents self-escalation.
  if (role && role !== targetUser.role && id === user.id) {
    return res.status(403).json({ error: "Access Denied: You cannot change your own role." });
  }

  // Only a Super Admin may grant the Super Admin role to anyone.
  if (role === "super_admin" && user.role !== "super_admin") {
    return res.status(403).json({ error: "Access Denied: Only a Super Admin can grant the Super Admin role." });
  }

  // Record changes
  const changes = [];
  if (name && name !== targetUser.name) {
    changes.push(`name to ${name}`);
    targetUser.name = name;
  }
  if (role && role !== targetUser.role) {
    changes.push(`role to ${role}`);
    targetUser.role = role;
  }
  if (client_id !== undefined && client_id !== targetUser.client_id) {
    changes.push(`client_id to ${client_id}`);
    targetUser.client_id = client_id;
  }

  let accessChanged = false;
  const oldIsGlobal = targetUser.is_global;
  const oldAssigned = targetUser.assigned_client_ids || [];

  if (is_global !== undefined && is_global !== targetUser.is_global) {
    targetUser.is_global = is_global;
    accessChanged = true;
  }
  if (assigned_client_ids !== undefined && JSON.stringify(assigned_client_ids) !== JSON.stringify(targetUser.assigned_client_ids)) {
    targetUser.assigned_client_ids = assigned_client_ids;
    accessChanged = true;
  }

  saveDb(db);

  writeAuditLog(
    user.id,
    user.email,
    user.client_id,
    "ADMIN_UPDATE_USER",
    id,
    `Updated user ${targetUser.email}: ${changes.join(", ")}`
  );

  if (accessChanged) {
    writeAuditLog(
      user.id,
      user.email,
      user.client_id,
      "ADMIN_UPDATE_USER_ACCESS",
      id,
      `Access updated - is_global: ${oldIsGlobal} -> ${targetUser.is_global}, assigned_client_ids: [${oldAssigned.join(",")}] -> [${(targetUser.assigned_client_ids || []).join(",")}]`
    );
  }

  res.json({ success: true, user: targetUser });
});

app.delete("/api/admin/users/:id", (req, res) => {
  const user = (req as any).user;
  if (!user || (user.role !== "ops_admin" && user.role !== "super_admin")) {
    return res.status(403).json({ error: "Access Denied." });
  }

  const { id } = req.params;
  
  if (id === user.id) {
    return res.status(400).json({ error: "Cannot delete your own user account." });
  }

  const db = loadDb();
  const targetUser = db.users.find((u: any) => u.id === id);
  if (!targetUser) return res.status(404).json({ error: "User not found" });

  db.users = db.users.filter((u: any) => u.id !== id);
  saveDb(db);
  deleteFromFirestore("users", id).catch(err => console.error(err));

  writeAuditLog(
    user.id,
    user.email,
    user.client_id,
    "ADMIN_DELETE_USER",
    id,
    `Deleted user account: ${targetUser.email}`
  );

  res.json({ success: true });
});

// Super Admin API: Audit Logs (only super_admin can see this)
app.get("/api/admin/audit-logs", (req, res) => {
  const user = (req as any).user;
  if (!user || user.role !== "super_admin") {
    return res.status(403).json({ error: "Access Denied: Only Super Administrators can view audit logs." });
  }

  const db = loadDb();
  // Filter by RLS just in case, though super_admin sees all
  const filteredLogs = applyRls(db, user, "audit_log", db.audit_log);
  res.json(filteredLogs);
});

// Clear Logs (optional super-admin action)
app.post("/api/admin/audit-logs/clear", (req, res) => {
  return res.status(403).json({ error: "Audit logs are append-only and cannot be cleared." });
});

// Export Patients Action - writes audit logs
app.post("/api/appointments/export", (req, res) => {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { ids } = req.body;
  if (!ids || !Array.isArray(ids)) {
    return res.status(400).json({ error: "Array of appointment IDs is required." });
  }

  const db = loadDb();
  const appointments = db.appointments.filter((a: any) => ids.includes(a.id));

  const isViolating = appointments.some((a: any) => !canAccessClient(user, a.client_id));
  if (isViolating) {
    return res.status(403).json({ error: "Access Denied: Attempting to export patient records belonging to other clients." });
  }

  // Build the exported record set server-side, so the audit log below always
  // reflects exactly what leaves the system.
  const records = appointments.map((apt: any) => {
    const patient = db.patients.find((p: any) => p.id === apt.patient_id);
    const insurance = db.insurance_details.find((i: any) => i.appointment_id === apt.id);
    let maskedPolicy = "••••••••";
    if (insurance) {
      const decrypted = decrypt(insurance.policy_number);
      maskedPolicy = decrypted.length > 4 ? "••••" + decrypted.slice(-4) : decrypted;
    }
    return {
      ...apt,
      patient: patient ? {
        id: patient.id,
        first_name: patient.first_name,
        last_name: patient.last_name,
        dob: patient.dob,
        gender: patient.gender
      } : null,
      insurance: insurance ? {
        id: insurance.id,
        carrier_name: insurance.carrier_name,
        policy_number_masked: maskedPolicy,
        group_number: insurance.group_number,
        subscriber_name: insurance.subscriber_name,
        subscriber_dob: insurance.subscriber_dob,
        relationship: insurance.relationship
      } : null
    };
  });

  writeAuditLog(
    user.id,
    user.email,
    user.role === "client_viewer" ? user.client_id : null,
    "EXPORT_PATIENT_RECORDS",
    "multiple",
    `Exported ${appointments.length} patient appointments/insurance details.`
  );

  res.json({ success: true, count: appointments.length, records });
});

// FEATURE B: Get Billing & Claims Anomalies for a Client (Ops Admin / Super Admin only)
app.get("/api/clients/:id/billing-anomalies", (req, res) => {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  if (user.role !== "ops_admin" && user.role !== "super_admin") {
    return res.status(403).json({ error: "Access Denied: Only Ops Admins or Super Admins can access billing anomaly reviews." });
  }

  const { id: clientId } = req.params;
  const db = loadDb();

  const client = db.clients.find((c: any) => c.id === clientId);
  if (!client) {
    return res.status(404).json({ error: "Client not found" });
  }

  if (!canAccessClient(user, clientId)) {
    return res.status(403).json({ error: "Access Denied: Not assigned to this client." });
  }

  if (!db.billing_anomalies) {
    db.billing_anomalies = [];
  }

  const appointments = db.appointments.filter((a: any) => a.client_id === clientId);
  const patients = db.patients.filter((p: any) => p.client_id === clientId);
  const apptIds = new Set(appointments.map((a: any) => a.id));
  const insurances = db.insurance_details.filter((i: any) => apptIds.has(i.appointment_id));

  const currentAnomalies: any[] = [];

  // 1. Detect duplicate appointments (same patient, same date, same carrier)
  const seenMap = new Map<string, any[]>();
  appointments.forEach((apt: any) => {
    const ins = insurances.find((i: any) => i.appointment_id === apt.id);
    const carrier = ins ? ins.carrier_name : "Unknown";
    const key = `${apt.patient_id}_${apt.appointment_date}_${carrier}`;
    if (!seenMap.has(key)) {
      seenMap.set(key, []);
    }
    seenMap.get(key)!.push({ appointment: apt, carrier });
  });

  seenMap.forEach((group) => {
    if (group.length > 1) {
      const firstApt = group[0].appointment;
      const patient = patients.find((p: any) => p.id === firstApt.patient_id);
      const carrier = group[0].carrier;
      // Deterministic stable ID based on patient_id + appointment_date + carrier
      const stableId = "anomaly_dup_" + crypto.createHash("md5").update(`${clientId}_${firstApt.patient_id}_${firstApt.appointment_date}_${carrier}`).digest("hex").substring(0, 8);

      let existing = db.billing_anomalies.find((a: any) => a.id === stableId);
      if (!existing) {
        existing = {
          id: stableId,
          client_id: clientId,
          type: "duplicate_pattern",
          severity: "Moderate",
          title: "Duplicate Appointment Date Pattern Detected",
          description: `Patient ${patient ? `${patient.first_name} ${patient.last_name}` : firstApt.patient_id} has ${group.length} appointments scheduled on the exact same date (${firstApt.appointment_date}) with carrier ${carrier}. This unusual pattern worth reviewing helps prevent duplicate claims submissions.`,
          appointmentIds: group.map((g: any) => g.appointment.id),
          status: "Pending Review",
          created_at: new Date().toISOString()
        };
        db.billing_anomalies.push(existing);
      }
      currentAnomalies.push(existing);
    }
  });

  // 2. Detect provider high denial ratio or volume spikes (minimum 5 total appointments for that provider before flagging)
  const providerMap = new Map<string, { total: number; denied: number; carrierSet: Set<string> }>();
  appointments.forEach((apt: any) => {
    const prov = apt.provider_name || "Unknown Provider";
    if (!providerMap.has(prov)) {
      providerMap.set(prov, { total: 0, denied: 0, carrierSet: new Set() });
    }
    const stat = providerMap.get(prov)!;
    stat.total++;
    if (apt.status === "not_approved") {
      stat.denied++;
    }
    const ins = insurances.find((i: any) => i.appointment_id === apt.id);
    if (ins) stat.carrierSet.add(ins.carrier_name);
  });

  providerMap.forEach((stat, provider) => {
    // Standard minimum sample size threshold of 5 total appointments
    if (stat.total >= 5 && stat.denied >= 2 && (stat.denied / stat.total) >= 0.5) {
      const stableId = "anomaly_prov_" + crypto.createHash("md5").update(`${clientId}_${provider}`).digest("hex").substring(0, 8);

      let existing = db.billing_anomalies.find((a: any) => a.id === stableId);
      if (!existing) {
        existing = {
          id: stableId,
          client_id: clientId,
          type: "provider_denial_cluster",
          severity: "Elevated",
          title: `Elevated Non-Approval Cluster for ${provider}`,
          description: `Provider ${provider} has ${stat.denied} non-approved outcomes out of ${stat.total} total appointments (${Math.round((stat.denied / stat.total) * 100)}% denial rate across sample size of ${stat.total} appointments). This unusual pattern worth reviewing indicates potential authorization or documentation gaps.`,
          providerName: provider,
          status: "Pending Review",
          created_at: new Date().toISOString()
        };
        db.billing_anomalies.push(existing);
      }
      currentAnomalies.push(existing);
    }
  });

  saveDb(db);

  res.json({
    clientId,
    clientName: client.name,
    totalAppointments: appointments.length,
    anomalies: currentAnomalies
  });
});

// FEATURE B: Review Billing Anomaly
app.post("/api/clients/:id/billing-anomalies/review", (req, res) => {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  if (user.role !== "ops_admin" && user.role !== "super_admin") {
    return res.status(403).json({ error: "Access Denied: Only Ops Admins or Super Admins can review billing anomalies." });
  }

  const { id: clientId } = req.params;
  const { anomalyId, reviewStatus, notes } = req.body;

  if (!anomalyId || !reviewStatus) {
    return res.status(400).json({ error: "anomalyId and reviewStatus are required." });
  }

  const db = loadDb();
  const client = db.clients.find((c: any) => c.id === clientId);
  if (!client) return res.status(404).json({ error: "Client not found" });

  if (!canAccessClient(user, clientId)) {
    return res.status(403).json({ error: "Access Denied: Not assigned to this client." });
  }

  if (!db.billing_anomalies) {
    db.billing_anomalies = [];
  }

  let anomaly = db.billing_anomalies.find((a: any) => a.id === anomalyId);
  if (anomaly) {
    anomaly.status = reviewStatus;
    anomaly.review_notes = notes || "";
    anomaly.reviewed_by = user.email;
    anomaly.reviewed_at = new Date().toISOString();
  } else {
    anomaly = {
      id: anomalyId,
      client_id: clientId,
      status: reviewStatus,
      review_notes: notes || "",
      reviewed_by: user.email,
      reviewed_at: new Date().toISOString()
    };
    db.billing_anomalies.push(anomaly);
  }

  writeAuditLog(
    user.id,
    user.email,
    clientId,
    "REVIEW_BILLING_ANOMALY",
    anomalyId,
    `Reviewed billing anomaly ${anomalyId} for client ${client.name} with status: "${reviewStatus}". Notes: ${notes || "None"}`
  );

  saveDb(db);

  res.json({ success: true, status: reviewStatus });
});

// Vite & Static file serve setup
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`InsureTrack Server running on http://localhost:${PORT}`);
  });
}

startServer();
