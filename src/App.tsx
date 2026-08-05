import React, { useState, useEffect } from "react";
import { 
  Shield, 
  BarChart3, 
  ClipboardList, 
  Upload, 
  Users, 
  Activity, 
  LogOut,
  User as UserIcon,
  PhoneCall,
  ShieldCheck
} from "lucide-react";
import { api } from "./api";
import { User, UserRole } from "./types";

// Import Screens
import LoginScreen from "./components/LoginScreen";
import DashboardScreen from "./components/DashboardScreen";
import ImportCenterScreen from "./components/ImportCenterScreen";
import QueueScreen from "./components/QueueScreen";
import WorkspaceScreen from "./components/WorkspaceScreen";
import UserManagementScreen from "./components/UserManagementScreen";
import AuditLogsScreen from "./components/AuditLogsScreen";
import ComplianceScreen from "./components/ComplianceScreen";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<string>("dashboard");
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null);
  const [clientIdFilter, setClientIdFilter] = useState<string | undefined>(undefined);

  // Check if session exists in local storage
  useEffect(() => {
    const currentUser = api.getCurrentUser();
    if (currentUser) {
      setUser(currentUser);
    }
  }, []);

  const handleLoginSuccess = (loggedInUser: User) => {
    setUser(loggedInUser);
    setActiveTab("dashboard");
  };

  const handleLogout = () => {
    api.logout();
    setUser(null);
    setSelectedAppointmentId(null);
    setClientIdFilter(undefined);
  };

  const handleNavigateToQueue = (clientId?: string) => {
    setClientIdFilter(clientId);
    setActiveTab("queue");
  };

  const handleNavigateToWorkspace = (appointmentId: string) => {
    setSelectedAppointmentId(appointmentId);
    setActiveTab("workspace");
  };

  // Define Tab items based on roles
  const getTabs = () => {
    if (!user) return [];

    const tabs = [
      { id: "dashboard", label: "Dashboard", icon: BarChart3 },
      { id: "queue", label: "Intake Queue", icon: ClipboardList },
      { id: "compliance", label: "Compliance Center", icon: ShieldCheck }
    ];

    // team1_reviewer, ops_admin, super_admin have access to Import Center
    if (["team1_reviewer", "ops_admin", "super_admin"].includes(user.role)) {
      tabs.push({ id: "import", label: "Import Center", icon: Upload });
    }

    // ops_admin and super_admin have access to User Management
    if (["ops_admin", "super_admin"].includes(user.role)) {
      tabs.push({ id: "users", label: "User Management", icon: Users });
    }

    // Only super_admin has access to Audit Logs
    if (user.role === "super_admin") {
      tabs.push({ id: "audit", label: "Audit Trail", icon: Activity });
    }

    return tabs;
  };

  if (!user) {
    return <LoginScreen onLoginSuccess={handleLoginSuccess} />;
  }

  const tabs = getTabs();
  const roleDisplayLabels: Record<UserRole, string> = {
    team1_reviewer: "T1 Reviewer",
    team2_verifier: "T2 Verifier",
    ops_admin: "Ops Admin",
    client_viewer: "Client Viewer",
    super_admin: "Super Admin"
  };

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 flex flex-col font-sans">
      
      {/* Top Banner Header */}
      <header className="bg-[#020617]/80 backdrop-blur-md border-b border-slate-800 sticky top-0 z-40 shadow-xl shadow-black/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-14 items-center">
            
            {/* Logo and Name */}
            <div className="flex items-center space-x-2">
              <div className="bg-blue-600 p-1.5 rounded-lg text-white">
                <Shield className="w-5 h-5" />
              </div>
              <div>
                <span className="font-extrabold text-sm text-white tracking-tight block leading-none">InsureTrack</span>
                <span className="text-[9px] text-slate-400 font-medium">B2B Healthcare Intake by Medyaan</span>
              </div>
            </div>

            {/* Middle Nav - Tabs for Large Screen */}
            <nav className="hidden md:flex space-x-1">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => {
                      setActiveTab(tab.id);
                      setSelectedAppointmentId(null);
                    }}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-2 transition-all cursor-pointer border ${
                      isActive 
                        ? "bg-blue-600/10 text-blue-400 border-blue-500/35" 
                        : "text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-800/40"
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${isActive ? "text-blue-400" : "text-slate-500"}`} />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </nav>

            {/* Right Controls - User Identity Badge & Logout */}
            <div className="flex items-center space-x-3 text-xs">
              <div className="flex items-center space-x-2 bg-slate-900/80 rounded-full py-1 pl-1 pr-3 border border-slate-800">
                <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex justify-center items-center text-[10px] font-bold shadow-xs">
                  <UserIcon className="w-3.5 h-3.5" />
                </div>
                <div className="text-left hidden sm:block">
                  <span className="font-bold text-slate-200 leading-none block">{user.name}</span>
                  <span className="text-[9px] text-slate-400 font-semibold uppercase tracking-wider block">
                    {roleDisplayLabels[user.role]}
                  </span>
                </div>
                <span className="text-[10px] font-extrabold bg-blue-950/80 text-blue-400 px-2 py-0.5 rounded-full uppercase tracking-wider scale-90 sm:hidden border border-blue-900/30">
                  {roleDisplayLabels[user.role]}
                </span>
              </div>

              <button
                onClick={handleLogout}
                title="Log out session"
                className="p-2 text-slate-400 hover:text-rose-400 hover:bg-rose-950/20 rounded-full transition-colors cursor-pointer border border-transparent hover:border-slate-800"
              >
                <LogOut className="w-4.5 h-4.5" />
              </button>
            </div>

          </div>
        </div>
      </header>

      {/* Mobile Subnavigation Row */}
      <div className="md:hidden bg-[#030712] border-b border-slate-800 px-4 py-2 flex space-x-1 overflow-x-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                setSelectedAppointmentId(null);
              }}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center space-x-1.5 shrink-0 transition-all cursor-pointer border ${
                isActive 
                  ? "bg-blue-600/10 text-blue-400 border-blue-500/30" 
                  : "text-slate-400 border-transparent hover:bg-slate-800/40"
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {activeTab === "dashboard" && (
          <DashboardScreen 
            user={user} 
            onNavigateToQueue={handleNavigateToQueue} 
            onNavigateToWorkspace={handleNavigateToWorkspace}
          />
        )}

        {activeTab === "queue" && (
          <QueueScreen 
            user={user} 
            onNavigateToWorkspace={handleNavigateToWorkspace} 
            clientIdFilter={clientIdFilter}
          />
        )}

        {activeTab === "compliance" && <ComplianceScreen />}

        {activeTab === "import" && <ImportCenterScreen user={user} />}

        {activeTab === "users" && <UserManagementScreen currentUser={user} />}

        {activeTab === "audit" && <AuditLogsScreen />}

        {activeTab === "workspace" && selectedAppointmentId && (
          <WorkspaceScreen 
            user={user} 
            appointmentId={selectedAppointmentId} 
            onBack={() => {
              setActiveTab("queue");
              setSelectedAppointmentId(null);
            }}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="bg-[#020617] border-t border-slate-800/80 py-6 text-center text-[10px] text-slate-500 font-medium font-sans mt-auto">
        <div>InsureTrack Enterprise Healthcare Revenue Platform v1.1.0 • Medyaan LLC</div>
        <div className="mt-1 opacity-75">All operational logs are securely cataloged and RLS constraints active.</div>
      </footer>

    </div>
  );
}
