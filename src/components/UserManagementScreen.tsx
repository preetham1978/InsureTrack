import React, { useState, useEffect } from "react";
import { 
  Users, 
  UserPlus, 
  Trash2, 
  Edit2, 
  ShieldAlert, 
  CheckCircle2, 
  AlertCircle,
  X,
  UserCheck
} from "lucide-react";
import { api } from "../api";
import { User, Client, UserRole } from "../types";

interface UserManagementScreenProps {
  currentUser: User;
}

export default function UserManagementScreen({ currentUser }: UserManagementScreenProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Form states for Create / Edit modal
  const [modalOpen, setModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  
  // Input fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("client_viewer");
  const [clientId, setClientId] = useState<string>("");
  const [isGlobal, setIsGlobal] = useState<boolean>(false);
  const [assignedClientIds, setAssignedClientIds] = useState<string[]>([]);

  const loadUsersAndClients = async () => {
    setLoading(true);
    try {
      const usersData = await api.getUsers();
      setUsers(usersData);

      const clientsData = await api.getClients();
      setClients(clientsData);
      if (clientsData.length > 0) {
        setClientId(clientsData[0].id);
      }
    } catch (err: any) {
      setErrorMsg("Failed to load user directories. Access Denied.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsersAndClients();
  }, [currentUser]);

  const handleOpenCreateModal = () => {
    setIsEditMode(false);
    setSelectedUserId("");
    setName("");
    setEmail("");
    setRole("client_viewer");
    setIsGlobal(false);
    setAssignedClientIds([]);
    if (clients.length > 0) setClientId(clients[0].id);
    setModalOpen(true);
  };

  const handleOpenEditModal = (targetUser: User) => {
    setIsEditMode(true);
    setSelectedUserId(targetUser.id);
    setName(targetUser.name);
    setEmail(targetUser.email);
    setRole(targetUser.role);
    setIsGlobal(!!targetUser.is_global);
    setAssignedClientIds(targetUser.assigned_client_ids || []);
    setClientId(targetUser.client_id || (clients[0]?.id || ""));
    setModalOpen(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !name.trim()) return;

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      if (isEditMode) {
        const res = await api.updateUser(selectedUserId, {
          name: name.trim(),
          role,
          client_id: role === "client_viewer" ? clientId : null,
          is_global: isGlobal,
          assigned_client_ids: assignedClientIds
        });
        if (res.success) {
          setSuccessMsg(`User ${email} updated successfully!`);
        }
      } else {
        const res = await api.createUser({
          email: email.trim(),
          name: name.trim(),
          role,
          client_id: role === "client_viewer" ? clientId : null,
          is_global: isGlobal,
          assigned_client_ids: assignedClientIds
        });
        if (res.success) {
          setSuccessMsg(`User ${email} registered successfully!`);
        }
      }
      setModalOpen(false);
      await loadUsersAndClients();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to submit user updates.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async (id: string, userEmail: string) => {
    if (!confirm(`Are you absolutely sure you want to permanently delete user account "${userEmail}"?`)) {
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await api.deleteUser(id);
      if (res.success) {
        setSuccessMsg(`User account "${userEmail}" deleted successfully.`);
        await loadUsersAndClients();
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to delete user account.");
      setLoading(false);
    }
  };

  const roleLabels: Record<UserRole, string> = {
    team1_reviewer: "Team 1 Reviewer",
    team2_verifier: "Team 2 Verifier",
    ops_admin: "Operations Administrator",
    client_viewer: "Client Medical Center Viewer",
    super_admin: "Super Administrator"
  };

  return (
    <div className="space-y-6 text-slate-100">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Team & Identity Management</h2>
          <p className="text-xs text-slate-400">
            Create, audit, configure access controls, and modify tenant constraints for client users.
          </p>
        </div>
        
        <button
          onClick={handleOpenCreateModal}
          className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-xs font-bold shadow-lg shadow-emerald-950/20 cursor-pointer transition-colors flex items-center space-x-1.5 shrink-0 border-0"
        >
          <UserPlus className="w-4.5 h-4.5" />
          <span>Provision New User</span>
        </button>
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

      {/* Main Table Card */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-xl shadow-lg overflow-hidden backdrop-blur-sm">
        {loading && users.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-3"></div>
            <span>Fetching user catalogs...</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-950/60 border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                  <th className="p-4">Name</th>
                  <th className="p-4">Email Address</th>
                  <th className="p-4">Operational Role</th>
                  <th className="p-4">Client Tenant Affinity</th>
                  <th className="p-4">Provision Date</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {users.map((u) => {
                  const clientObj = clients.find(c => c.id === u.client_id);
                  const isSelf = u.id === currentUser.id;
                  
                  return (
                    <tr key={u.id} className="hover:bg-slate-800/20 transition-colors">
                      <td className="p-4 font-bold text-white">
                        <div className="flex items-center space-x-2">
                          <span className="bg-slate-950 p-1 rounded-full text-slate-400 border border-slate-800">
                            <Users className="w-3.5 h-3.5" />
                          </span>
                          <span>{u.name}</span>
                          {isSelf && (
                            <span className="text-[9px] font-extrabold bg-blue-950 text-blue-300 px-1.5 py-0.2 rounded border border-blue-900/40 uppercase">
                              Current User
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-4 font-medium text-slate-300 font-mono">{u.email}</td>
                      <td className="p-4">
                        <span className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded border ${
                          u.role === "super_admin" ? "bg-purple-950/30 text-purple-300 border-purple-900/40" :
                          u.role === "ops_admin" ? "bg-blue-950/30 text-blue-300 border-blue-900/40" :
                          u.role === "team1_reviewer" ? "bg-amber-950/30 text-amber-300 border-amber-900/40" :
                          u.role === "team2_verifier" ? "bg-sky-950/30 text-sky-300 border-sky-900/40" :
                          "bg-slate-950 text-slate-400 border-slate-800"
                        }`}>
                          {roleLabels[u.role] || u.role}
                        </span>
                      </td>
                      <td className="p-4 font-semibold">
                        {u.role === "client_viewer" ? (
                          <span className="text-slate-200">
                            {clientObj ? `${clientObj.name} (${clientObj.code})` : "Unassigned Clinic"}
                          </span>
                        ) : (
                          <span className="text-slate-500 italic font-normal">All Tenants (VeloAI Staff)</span>
                        )}
                      </td>
                      <td className="p-4 text-slate-400 font-mono">
                        {new Date(u.created_at).toLocaleDateString()}
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex justify-end items-center space-x-2">
                          <button
                            onClick={() => handleOpenEditModal(u)}
                            className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg cursor-pointer"
                            title="Edit User Role"
                            aria-label={`Edit ${u.name}`}
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          
                          {!isSelf && (
                            <button
                              onClick={() => handleDeleteUser(u.id, u.email)}
                              className="p-1.5 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 rounded-lg cursor-pointer"
                              title="Revoke Access"
                              aria-label={`Delete ${u.name}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
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
        )}
      </div>

      {/* CREATE / EDIT USER DIALOG MODAL */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-[#030712] rounded-xl border border-slate-800 max-w-md w-full shadow-2xl relative overflow-hidden font-sans text-slate-100">
            
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/40">
              <div className="flex items-center space-x-2">
                <UserCheck className="w-5 h-5 text-emerald-450" />
                <h3 className="font-bold text-sm text-white">
                  {isEditMode ? "Edit User Permissions" : "Provision New Identity"}
                </h3>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-white hover:bg-slate-800 p-1 rounded-lg cursor-pointer transition-colors"
                title="Close dialog"
                aria-label="Close dialog"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSaveUser} className="p-5 space-y-4 text-xs">
              
              <div>
                <label className="block font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  Full Representative Name
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Dr. Harold Finch"
                  className="w-full text-xs p-2.5 bg-slate-950 border border-slate-850 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-600"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  disabled={isEditMode}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@veloai.com"
                  className="w-full text-xs p-2.5 bg-slate-950 border border-slate-850 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-600 disabled:bg-slate-900 disabled:text-slate-500 disabled:border-slate-800"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  Operational Role
                </label>
                <select
                  value={role}
                  onChange={(e: any) => setRole(e.target.value)}
                  className="w-full bg-[#030712] border border-slate-850 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                >
                  <option value="team1_reviewer" className="bg-slate-900">Team 1 Reviewer (Intake Audit)</option>
                  <option value="team2_verifier" className="bg-slate-900">Team 2 Verifier (Insurance Caller)</option>
                  <option value="client_viewer" className="bg-slate-900">Client Medical Center Viewer (Tenant Bound)</option>
                  <option value="ops_admin" className="bg-slate-900">VeloAI Operations Admin</option>
                  <option value="super_admin" className="bg-slate-900">Super Administrator</option>
                </select>
              </div>

              {/* Client Tenant Affinity, visible only when role is client_viewer */}
              {role === "client_viewer" && (
                <div>
                  <label className="block font-semibold text-slate-400 uppercase tracking-wider mb-1">
                    Affiliated Client Tenant
                  </label>
                  <select
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    className="w-full bg-[#030712] border border-slate-850 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                  >
                    {clients.map(c => (
                      <option key={c.id} value={c.id} className="bg-slate-900">{c.name} ({c.code})</option>
                    ))}
                  </select>
                </div>
              )}

              {(currentUser.role === "ops_admin" || currentUser.role === "super_admin") && (
                <div className="pt-2 border-t border-slate-800 mt-4">
                  <div className="flex items-center mb-3">
                    <input
                      type="checkbox"
                      id="global_access"
                      checked={isGlobal}
                      onChange={(e) => setIsGlobal(e.target.checked)}
                      className="w-4 h-4 text-blue-600 bg-slate-900 border-slate-700 rounded focus:ring-blue-500 cursor-pointer"
                    />
                    <label htmlFor="global_access" className="ml-2 font-semibold text-slate-300 uppercase tracking-wider text-[10px]">
                      Global access (all clients)
                    </label>
                  </div>
                  
                  {!isGlobal && (
                    <div className="mt-2">
                      <label className="block font-semibold text-slate-400 uppercase tracking-wider mb-1">
                        Assigned Clients
                      </label>
                      <select
                        multiple
                        value={assignedClientIds}
                        onChange={(e) => {
                          const options = e.target.options;
                          const values = [];
                          for (let i = 0; i < options.length; i++) {
                            if (options[i].selected) values.push(options[i].value);
                          }
                          setAssignedClientIds(values);
                        }}
                        className="w-full bg-[#030712] border border-slate-850 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer min-h-[80px]"
                      >
                        {clients.map(c => (
                          <option key={c.id} value={c.id} className="bg-slate-900 p-1">{c.name} ({c.code})</option>
                        ))}
                      </select>
                      <p className="text-[9px] text-slate-500 mt-1">Hold Ctrl/Cmd to select multiple.</p>
                    </div>
                  )}
                </div>
              )}

              <div className="pt-2 flex justify-end space-x-2 border-t border-slate-800 mt-5">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="border border-slate-800 hover:bg-slate-800 text-slate-300 hover:text-white px-4 py-2 rounded-lg font-semibold cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg font-bold shadow-lg shadow-emerald-950/20 cursor-pointer transition-colors border-0"
                >
                  {loading ? "Saving..." : "Save Identity Permissions"}
                </button>
              </div>

            </form>

          </div>
        </div>
      )}
    </div>
  );
}
