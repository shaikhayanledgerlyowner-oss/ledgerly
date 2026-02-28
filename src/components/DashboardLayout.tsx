import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  LayoutDashboard, Table2, FileText, CreditCard, Settings, Bell, LogOut,
  BookOpen, Shield, BarChart3, Menu, Wallet
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";

const navItems = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/dashboard/tables", icon: Table2, label: "Tables" },
  { to: "/dashboard/analytics", icon: BarChart3, label: "Analytics" },
  { to: "/dashboard/invoices", icon: FileText, label: "Documents" },
  { to: "/dashboard/pricing", icon: CreditCard, label: "Pricing" },
  { to: "/dashboard/settings", icon: Settings, label: "Settings" },
];

const ownerItems = [
  { to: "/dashboard/notifications", icon: Bell, label: "Notifications" },
  { to: "/dashboard/verification", icon: Shield, label: "Verification Queue" },
  { to: "/dashboard/wallet", icon: Wallet, label: "Wallet" },
];

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/dashboard/tables": "Tables",
  "/dashboard/analytics": "Analytics",
  "/dashboard/invoices": "Documents",
  "/dashboard/pricing": "Pricing",
  "/dashboard/notifications": "Notifications",
  "/dashboard/settings": "Settings",
  "/dashboard/verification": "Verification Queue",
  "/dashboard/wallet": "Wallet",
};

export default function DashboardLayout() {
  const { signOut, isOwner, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const pageTitle = pageTitles[location.pathname] || "Ledgerly";

  // ✅ GLOBAL REMINDER — settings page chhodne ke baad bhi kaam karta hai
  useEffect(() => {
    if (!profile) return;

    let reminderTime = "";
    let reminderMessage = "Your daily entry is pending.";
    let reminderEnabled = true;
    let lastFiredKey = "";

    // Load reminder from DB
    supabase
      .from("reminders")
      .select("reminder_time, enabled, message")
      .eq("user_id", profile.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          reminderTime = (data as any).reminder_time || "";
          reminderEnabled = (data as any).enabled ?? true;
          reminderMessage = (data as any).message || reminderMessage;
        }
      });

    const interval = setInterval(() => {
      if (!reminderEnabled || !reminderTime) return;
      if (Notification.permission !== "granted") return;

      const now = new Date();
      const currentTime =
        now.getHours().toString().padStart(2, "0") +
        ":" +
        now.getMinutes().toString().padStart(2, "0");

      const fireKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${currentTime}`;

      if (currentTime === reminderTime && fireKey !== lastFiredKey) {
        lastFiredKey = fireKey;
        new Notification("📒 Ledgerly Reminder", {
          body: reminderMessage,
          icon: "/icon-192x192.png",
        });
      }
    }, 30 * 1000); // ✅ Har 30 second mein check (accurate enough)

    return () => clearInterval(interval);
  }, [profile?.id]);

  useEffect(() => {
    if (!isOwner || !profile) return;
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", profile.id)
      .eq("is_read", false)
      .then(({ count }) => setUnreadCount(count ?? 0));
  }, [isOwner, profile, location.pathname]);

  const handleSignOut = async () => {
    await signOut();
    toast.success("Signed out");
    navigate("/auth");
  };

  const items = isOwner ? [...navItems, ...ownerItems] : navItems;
  const initials = profile?.display_name
    ? profile.display_name.slice(0, 2).toUpperCase()
    : profile?.email?.slice(0, 2).toUpperCase() ?? "U";

  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      {/* Top App Bar */}
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-card/80 backdrop-blur-xl px-4">
        <div className="flex items-center gap-3">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="shrink-0">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0 sidebar-gradient border-sidebar-border">
              <div className="flex items-center gap-3 p-4 border-b border-sidebar-border">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg gradient-accent">
                  <BookOpen className="h-5 w-5 text-accent-foreground" />
                </div>
                <span className="text-lg font-display font-bold text-sidebar-foreground">Ledgerly</span>
              </div>

              <nav className="flex-1 space-y-1 p-3">
                {items.map(item => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === "/dashboard"}
                    onClick={() => setOpen(false)}
                    className={({ isActive }) => cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-primary"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                    {item.label === "Notifications" && unreadCount > 0 && (
                      <Badge className="ml-auto h-5 min-w-5 px-1 text-[10px] bg-destructive text-destructive-foreground">
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </Badge>
                    )}
                  </NavLink>
                ))}
              </nav>

              <div className="mt-auto border-t border-sidebar-border p-3 space-y-1">
                {profile && (
                  <div className="px-3 py-2 mb-1">
                    <p className="text-xs text-sidebar-foreground/60 truncate">{profile.email}</p>
                    <p className="text-xs text-sidebar-primary font-medium">
                      {profile.role}{profile.is_premium ? " · Premium" : ""}
                    </p>
                  </div>
                )}
                <Button
                  variant="ghost"
                  className="w-full justify-start gap-3 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                  onClick={() => { handleSignOut(); setOpen(false); }}
                >
                  <LogOut className="h-4 w-4" />
                  Sign Out
                </Button>
              </div>
            </SheetContent>
          </Sheet>
          <div className="flex h-7 w-7 items-center justify-center rounded-md gradient-accent">
            <BookOpen className="h-4 w-4 text-accent-foreground" />
          </div>
        </div>

        <h1 className="text-base font-display font-semibold truncate">{pageTitle}</h1>

        <div className="flex items-center gap-2">
          {isOwner && (
            <Button
              variant="ghost"
              size="icon"
              className="relative"
              onClick={() => navigate("/dashboard/notifications")}
            >
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </Button>
          )}
          <Avatar className="h-8 w-8 cursor-pointer" onClick={() => navigate("/dashboard/settings")}>
            <AvatarImage src={(profile as any)?.avatar_url || undefined} />
            <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">{initials}</AvatarFallback>
          </Avatar>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="p-4 md:p-6 lg:p-8 w-full">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
