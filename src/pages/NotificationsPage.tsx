import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Bell, ShoppingCart, Info } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Notification {
  id: string;
  type: string;
  title: string | null;
  body: string | null;
  payload: any;
  is_read: boolean;
  created_at: string;
}

export default function NotificationsPage() {
  const { profile } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    if (!profile) return;
    supabase.from("notifications").select("*").eq("user_id", profile.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => setNotifications((data ?? []) as any));
  }, [profile]);

  const markRead = async (id: string) => {
    await supabase.from("notifications").update({ is_read: true }).eq("id", id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
  };

  const icon = (type: string) => {
    if (type === "purchase_request") return <ShoppingCart className="h-4 w-4 text-accent" />;
    return <Info className="h-4 w-4 text-info" />;
  };

  const getText = (n: Notification) => {
    if (n.title) return { title: n.title, desc: n.body || "" };
    if (n.type === "purchase_request") {
      const p = n.payload as any;
      return { title: "Purchase Request", desc: `${p?.email} — ${p?.plan} (₹${p?.amount})` };
    }
    return { title: "Notification", desc: JSON.stringify(n.payload) };
  };

  return (
    <div className="animate-fade-in space-y-6">
      <h1 className="text-2xl font-display font-bold flex items-center gap-2"><Bell className="h-6 w-6" /> Notifications</h1>
      <div className="space-y-3">
        {notifications.map(n => {
          const { title, desc } = getText(n);
          return (
            <Card key={n.id} className={`glass-card ${n.is_read ? "opacity-60" : ""}`}>
              <CardContent className="flex items-center justify-between py-4">
                <div className="flex items-center gap-3">
                  {icon(n.type)}
                  <div>
                    <p className="text-sm font-medium">{title}</p>
                    <p className="text-xs text-muted-foreground">{desc}</p>
                    <p className="text-xs text-muted-foreground">{new Date(n.created_at).toLocaleString()}</p>
                  </div>
                </div>
                {!n.is_read && (
                  <Button variant="outline" size="sm" onClick={() => markRead(n.id)}>Mark read</Button>
                )}
              </CardContent>
            </Card>
          );
        })}
        {notifications.length === 0 && <p className="text-muted-foreground text-sm">No notifications.</p>}
      </div>
    </div>
  );
}
