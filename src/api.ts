const API_BASE = "";

// Helper to get auth header
function getHeaders(): Record<string, string> {
  const token = localStorage.getItem("insuretrack_token");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

export const api = {
  // Auth API
  async login(email: string) {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || err.error || "Login failed");
    }
    return res.json();
  },

  async verifyOtp(email: string, otp: string) {
    const res = await fetch(`${API_BASE}/api/auth/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, otp }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Verification failed");
    }
    const data = await res.json();
    localStorage.setItem("insuretrack_token", data.token);
    localStorage.setItem("insuretrack_user", JSON.stringify(data.user));
    return data;
  },

  logout() {
    localStorage.removeItem("insuretrack_token");
    localStorage.removeItem("insuretrack_user");
  },

  getCurrentUser() {
    const userStr = localStorage.getItem("insuretrack_user");
    if (!userStr) return null;
    try {
      return JSON.parse(userStr);
    } catch {
      return null;
    }
  },

  // Clients API
  async getClients() {
    const res = await fetch(`${API_BASE}/api/clients`, { headers: getHeaders() });
    if (!res.ok) throw new Error("Failed to load clients");
    return res.json();
  },

  // Dashboard API
  async getStats() {
    const res = await fetch(`${API_BASE}/api/dashboard/stats`, { headers: getHeaders() });
    if (!res.ok) throw new Error("Failed to load dashboard statistics");
    return res.json();
  },

  // Import Batch API
  async getImportBatches() {
    const res = await fetch(`${API_BASE}/api/import-batches`, { headers: getHeaders() });
    if (!res.ok) throw new Error("Failed to load import batches");
    return res.json();
  },

  async analyzeMapping(client_id: string, headers: string[], sampleRows: string[][]) {
    const res = await fetch(`${API_BASE}/api/import-batches/analyze-mapping`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ client_id, headers, sampleRows }),
    });
    if (!res.ok) throw new Error("Failed to analyze mapping");
    return res.json();
  },

  async checkDuplicates(client_id: string, rows: any[]) {
    const res = await fetch(`${API_BASE}/api/import-batches/check-duplicates`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ client_id, rows }),
    });
    if (!res.ok) throw new Error("Failed to check for duplicates");
    return res.json();
  },

  async commitImportBatch(client_id: string, filename: string, rows: any[], headers?: string[], field_mapping?: Record<string, string>, rowDecisions?: Record<number, string>) {
    const res = await fetch(`${API_BASE}/api/import-batches/commit`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ client_id, filename, rows, headers, field_mapping, rowDecisions }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Import commit failed");
    }
    return res.json();
  },

  async extractOnDemandRecord(client_id: string, text: string) {
    const res = await fetch(`${API_BASE}/api/on-demand/extract`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ client_id, text }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to extract record");
    }
    return res.json();
  },

  async commitOnDemandRecord(client_id: string, data: any) {
    const res = await fetch(`${API_BASE}/api/on-demand/commit`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ client_id, data }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to commit record");
    }
    return res.json();
  },

  async getCallScript(client_id: string, carrier_name: string, provider_name?: string) {
    const res = await fetch(`${API_BASE}/api/ai/call-script`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ client_id, carrier_name, provider_name }),
    });
    if (!res.ok) throw new Error("Failed to generate call script");
    return res.json();
  },

  // Appointments / Queue API
  async getAppointments() {
    const res = await fetch(`${API_BASE}/api/appointments`, { headers: getHeaders() });
    if (!res.ok) throw new Error("Failed to load appointments queue");
    return res.json();
  },

  async getAppointmentDetail(id: string) {
    const res = await fetch(`${API_BASE}/api/appointments/${id}`, { headers: getHeaders() });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to load patient details");
    }
    return res.json();
  },

  async decryptPolicy(id: string) {
    const res = await fetch(`${API_BASE}/api/appointments/${id}/decrypt-policy`, {
      method: "POST",
      headers: getHeaders(),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Decryption failed");
    }
    const data = await res.json();
    return data.decrypted;
  },

  async promoteAppointment(id: string) {
    const res = await fetch(`${API_BASE}/api/appointments/${id}/promote`, {
      method: "POST",
      headers: getHeaders(),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to promote appointment status");
    }
    return res.json();
  },

  async submitVerificationCall(id: string, call_outcome: string, checklist: any, notes: string) {
    const res = await fetch(`${API_BASE}/api/appointments/${id}/verification-call`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ call_outcome, checklist, notes }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to save verification call");
    }
    return res.json();
  },

  // Export Patients Action
  async exportPatients(ids: string[]) {
    const res = await fetch(`${API_BASE}/api/appointments/export`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) throw new Error("Failed to log export action");
    return res.json();
  },

  // RLS Test Run
  async runRlsTest() {
    const res = await fetch(`${API_BASE}/api/test-rls`, { headers: getHeaders() });
    if (!res.ok) throw new Error("Failed to run RLS verification test suite");
    return res.json();
  },

  // Admin: User & Role Management APIs
  async getUsers() {
    const res = await fetch(`${API_BASE}/api/admin/users`, { headers: getHeaders() });
    if (!res.ok) throw new Error("Failed to fetch users catalog");
    return res.json();
  },

  async createUser(data: { email: string; role: string; client_id: string | null; name: string; is_global?: boolean; assigned_client_ids?: string[] }) {
    const res = await fetch(`${API_BASE}/api/admin/users`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to create user");
    }
    return res.json();
  },

  async updateUser(id: string, data: { role?: string; client_id?: string | null; name?: string; is_global?: boolean; assigned_client_ids?: string[] }) {
    const res = await fetch(`${API_BASE}/api/admin/users/${id}`, {
      method: "PUT",
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to update user");
    }
    return res.json();
  },

  async deleteUser(id: string) {
    const res = await fetch(`${API_BASE}/api/admin/users/${id}`, {
      method: "DELETE",
      headers: getHeaders(),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to delete user");
    }
    return res.json();
  },

  // Super Admin: Audit Logs API
  async getAuditLogs() {
    const res = await fetch(`${API_BASE}/api/admin/audit-logs`, { headers: getHeaders() });
    if (!res.ok) throw new Error("Failed to fetch system audit logs");
    return res.json();
  },

  async clearAuditLogs() {
    const res = await fetch(`${API_BASE}/api/admin/audit-logs/clear`, {
      method: "POST",
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error("Failed to clear system audit logs");
    return res.json();
  },
};
