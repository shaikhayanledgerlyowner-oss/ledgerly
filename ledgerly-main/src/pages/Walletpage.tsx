import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Navigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { IndianRupee, TrendingUp, Users, Clock, CheckCircle, XCircle, Wallet } from "lucide-react";
import { formatCurrency } from "@/lib/currency";

interface Payment {
  id: string;
  user_id: string;
  plan: string;
  amount: number;
  status: string;
  txn_id: string | null;
  created_at: string;
  profiles: { email: string; display_name: string | null } | null;
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: string; icon: any; color: string }) {
  return (
    <Card className="glass-card">
      <CardContent className="flex items-center gap-4 pt-5 pb-4">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

const statusColor = (s: string) => {
  if (s === "approved") return "bg-green-100 text-green-700 border-green-200";
  if (s === "rejected") return "bg-red-100 text-red-700 border-red-200";
  return "bg-yellow-100 text-yellow-700 border-yellow-200";
};

const planLabel = (plan: string) => {
  if (plan === "yearly") return "Yearly · 365 days";
  if (plan === "monthly") return "Monthly · 30 days";
  return plan;
};

export default function WalletPage() {
  const { isOwner } = useAuth();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "approved" | "pending" | "rejected">("all");

  useEffect(() => {
    if (!isOwner) return;
    (async () => {
      setLoading(true);
      // Fetch only LIVE payments
      const { data: pData, error } = await supabase
        .from("purchase_requests")
        .select("*")
        .eq("is_live", true)
        .order("created_at", { ascending: false });

      if (error) console.error("[Wallet] fetch error:", error.message);
      const raw = (pData ?? []) as any[];

      // Fetch matching profiles separately
      const userIds = [...new Set(raw.map((p: any) => p.user_id))];
      let profileMap: Record<string, { email: string; display_name: string | null }> = {};
      if (userIds.length > 0) {
        const { data: pRows } = await supabase
          .from("profiles")
          .select("id, email, display_name")
          .in("id", userIds);
        (pRows ?? []).forEach((r: any) => { profileMap[r.id] = { email: r.email, display_name: r.display_name }; });
      }

      const merged = raw.map((p: any) => ({ ...p, profiles: profileMap[p.user_id] ?? null }));
      setPayments(merged);
      setLoading(false);
    })();
  }, [isOwner]);

  if (!isOwner) return <Navigate to="/dashboard" replace />;

  const approved = payments.filter(p => p.status === "approved");
  const pending  = payments.filter(p => p.status === "pending");
  const totalRevenue = approved.reduce((s, p) => s + (p.amount ?? 0), 0);
  const filtered = filter === "all" ? payments : payments.filter(p => p.status === filter);

  return (
    <div className="animate-fade-in space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Wallet className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-display font-bold">Wallet</h1>
          <p className="text-sm text-muted-foreground">All payments received from customers</p>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Revenue" value={formatCurrency(totalRevenue, "INR")} icon={IndianRupee} color="text-green-600" />
        <StatCard label="Total Payments" value={String(approved.length)} icon={CheckCircle} color="text-blue-600" />
        <StatCard label="Pending" value={String(pending.length)} icon={Clock} color="text-yellow-600" />
        <StatCard label="Total Customers" value={String(new Set(approved.map(p => p.user_id)).size)} icon={Users} color="text-purple-600" />
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 flex-wrap">
        {(["all", "approved", "pending", "rejected"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-full text-xs font-medium border transition-all capitalize ${
              filter === f
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:border-primary/50"
            }`}
          >
            {f} {f === "all" ? `(${payments.length})` : f === "approved" ? `(${approved.length})` : f === "pending" ? `(${pending.length})` : `(${payments.filter(p=>p.status==="rejected").length})`}
          </button>
        ))}
      </div>

      {/* Payments Table */}
      <Card className="glass-card overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Payment History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin w-6 h-6 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
              <Wallet className="h-8 w-8 opacity-30" />
              <p className="text-sm">No payments found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="px-4 py-3 text-left font-semibold text-muted-foreground text-xs">Customer</th>
                    <th className="px-4 py-3 text-left font-semibold text-muted-foreground text-xs">Plan</th>
                    <th className="px-4 py-3 text-right font-semibold text-muted-foreground text-xs">Amount</th>
                    <th className="px-4 py-3 text-left font-semibold text-muted-foreground text-xs">Status</th>
                    <th className="px-4 py-3 text-left font-semibold text-muted-foreground text-xs">TXN ID</th>
                    <th className="px-4 py-3 text-left font-semibold text-muted-foreground text-xs">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p, i) => (
                    <tr key={p.id} className={`border-b border-border/40 hover:bg-muted/20 transition-colors ${i % 2 === 0 ? "" : "bg-muted/10"}`}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-xs">{(p.profiles as any)?.display_name || "—"}</p>
                        <p className="text-[11px] text-muted-foreground">{(p.profiles as any)?.email || p.user_id.slice(0, 8) + "..."}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{planLabel(p.plan)}</td>
                      <td className="px-4 py-3 text-right font-bold text-green-600">{formatCurrency(p.amount, "INR")}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border capitalize ${statusColor(p.status)}`}>
                          {p.status === "approved" && <CheckCircle className="w-3 h-3" />}
                          {p.status === "pending"  && <Clock className="w-3 h-3" />}
                          {p.status === "rejected" && <XCircle className="w-3 h-3" />}
                          {p.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[11px] text-muted-foreground font-mono">
                        {p.txn_id ? (
                          <span title={p.txn_id}>{p.txn_id.slice(0, 16)}{p.txn_id.length > 16 ? "…" : ""}</span>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3 text-[11px] text-muted-foreground">
                        {new Date(p.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                        <br />
                        <span className="text-[10px]">{new Date(p.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {approved.length > 0 && (
                  <tfoot>
                    <tr className="bg-green-50 border-t-2 border-green-200">
                      <td className="px-4 py-3 font-bold text-green-700 text-xs" colSpan={2}>Total Revenue</td>
                      <td className="px-4 py-3 text-right font-bold text-green-700">{formatCurrency(totalRevenue, "INR")}</td>
                      <td colSpan={3} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
