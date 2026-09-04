import { useState } from "react";
import { Routes, Route, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard, Table2, FileText, BarChart2,
  Settings, Wallet, Crown, LogOut, Menu, X, BookOpen,
} from "lucide-react";

import DashboardHome from "./DashboardHome";
import AnalyticsPage from "./AnalyticsPage";
import DocumentEditorPage from "./DocumentEditorPage";
import EasyCountPage from "./EasyCountPage";
import InvoicesPage from "./InvoicesPage";
import PricingPage from "./PricingPage";
import SettingsPage from "./SettingsPage";
import TablesPage from "./TablesPage";
import WalletPage from "./Walletpage";
import NotFound from "./NotFound";

const NAV = [
  { to: "/dashboard",           label: "Dashboard",  icon: LayoutDashboard, end: true },
  { to: "/dashboard/tables",    label: "Tables",     icon: Table2 },
  { to: "/dashboard/invoices",  label: "Documents",  icon: FileText },
  { to: "/dashboard/easycount", label: "EasyCount",  icon: BookOpen },
  { to: "/dashboard/analytics", label: "Analytics",  icon: BarChart2 },
  { to: "/dashboard/wallet",    label: "Wallet",     icon: Wallet },
  { to: "/dashboard/pricing",   label: "Pricing",    icon: Crown },
  { to: "/dashboard/settings",  label: "Settings",   icon: Settings },
];

export default function DashboardLayout() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const displayName = profile?.display_name || profile?.email?.split("@")[0] || "User";

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-4 border-b border-sidebar-border">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-primary">
          <BookOpen className="h-4 w-4 text-white" />
        </div>
        <span className="font-display font-bold text-lg text-sidebar-foreground">Ledgerly</span>
      </div>

      {/* Nav links */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-primary"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* User + Sign out */}
      <div className="border-t border-sidebar-border px-3 py-3 space-y-1">
        <p className="px-2 text-xs text-sidebar-foreground/50 truncate">{profile?.email}</p>
        <p className="px-2 text-sm font-medium text-sidebar-foreground truncate">{displayName}</p>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 mt-1"
          onClick={handleSignOut}
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-56 shrink-0 flex-col sidebar-gradient border-r border-sidebar-border">
        <SidebarContent />
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 sidebar-gradient border-r border-sidebar-border z-50">
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {/* Top bar (mobile) */}
        <header className="flex md:hidden items-center gap-3 px-4 py-3 border-b border-border bg-card">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="font-display font-bold text-base">Ledgerly</span>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/"           element={<DashboardHome />} />
            <Route path="/analytics"  element={<AnalyticsPage />} />
            <Route path="/documents"  element={<DocumentEditorPage />} />
            <Route path="/easycount"  element={<EasyCountPage />} />
            <Route path="/invoices"   element={<InvoicesPage />} />
            <Route path="/pricing"    element={<PricingPage />} />
            <Route path="/settings"   element={<SettingsPage />} />
            <Route path="/tables"     element={<TablesPage />} />
            <Route path="/wallet"     element={<WalletPage />} />
            <Route path="*"           element={<NotFound />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
