import crypto from "crypto";

// ---------------------------------------------------------------------------
// Security-critical helpers, kept in one place so they can be tested directly.
// server.ts imports these; tests/security.test.ts exercises them.
// ---------------------------------------------------------------------------

// Redacts common direct identifiers from free-text notes before they are sent
// to any third-party service.
export function redactPhiText(input: string | null | undefined): string {
  if (!input) return "";
  let out = String(input);

  out = out.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[redacted-email]");
  out = out.replace(/\b(?:\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "[redacted-phone]");
  out = out.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[redacted-ssn]");
  out = out.replace(/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g, "[redacted-date]");
  out = out.replace(/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g, "[redacted-date]");
  out = out.replace(/\b(?=[A-Za-z0-9-]{6,})(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]+\b/g, "[redacted-id]");
  out = out.replace(/\b\d{6,}\b/g, "[redacted-id]");
  out = out.replace(/\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g, "[redacted-name]");
  out = out.replace(/\b[A-Z][a-z]{2,}\b/g, "[redacted]");

  return out;
}

// Converts a raw CSV cell into a non-identifying shape descriptor.
export function describeCellShape(value: any): string {
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
export function describeSampleRows(rows: any[][]): string[][] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => (Array.isArray(row) ? row.map(describeCellShape) : []));
}

// Computes the tamper-evident digest for one audit entry.
export function computeAuditHash(entry: {
  id: string;
  user_id: string;
  user_email: string;
  client_id: string | null;
  action: string;
  record_id: string;
  details: string;
  created_at: string;
  prev_hash: string;
}): string {
  const canonical = [
    entry.id,
    entry.user_id,
    entry.user_email,
    entry.client_id === null || entry.client_id === undefined ? "" : entry.client_id,
    entry.action,
    entry.record_id,
    entry.details,
    entry.created_at,
    entry.prev_hash,
  ].join("|");
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

// Decides whether a user may access records belonging to a given client.
// This is the core of the platform's tenant isolation.
export function canAccessClient(user: any, client_id: string): boolean {
  if (!user) return false;
  if (user.role === "ops_admin" || user.role === "super_admin") return true;
  if (user.is_global) return true;
  if (user.role === "client_viewer") return user.client_id === client_id;
  return Array.isArray(user.assigned_client_ids) && user.assigned_client_ids.includes(client_id);
}
