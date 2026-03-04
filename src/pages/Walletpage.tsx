import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Txn = {
  id: string;
  razorpay_payment_id: string | null;
  razorpay_order_id: string | null;
  amount: number; // paise
  currency: string | null;
  status: string | null;
  method: string | null;
  description: string | null;
  created_at: string;
};

function formatINR(paise: number) {
  const rupees = paise / 100;
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(rupees);
}

export default function WalletPage() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [txns, setTxns] = useState<Txn[]>([]);

  const load = async () => {
    if (!profile) return;

    setLoading(true);
    const { data, error } = await supabase
      .from("wallet_transactions")
      .select("id, razorpay_payment_id, razorpay_order_id, amount, currency, status, method, description, created_at")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false });

    if (error) toast.error(error.message);
    setTxns((data as any) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  const balancePaise = useMemo(() => {
    const ok = new Set(["captured", "authorized", "paid", "success"]);
    return txns.reduce(
      (sum, t) => sum + (ok.has((t.status || "").toLowerCase()) ? (t.amount || 0) : 0),
      0
    );
  }, [txns]);

  return (
    <div className="animate-fade-in space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold">Wallet</h1>
          <p className="text-sm text-muted-foreground">Razorpay payments and credits will appear here.</p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg">Current Balance</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <div className="text-3xl font-bold">{formatINR(balancePaise)}</div>
          <Badge variant="secondary">Auto-updated via webhook</Badge>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg">Transactions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : txns.length === 0 ? (
            <p className="text-sm text-muted-foreground">No transactions yet.</p>
          ) : (
            <div className="divide-y divide-border/60">
              {txns.map((t) => (
                <div key={t.id} className="py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{t.description || "Razorpay Payment"}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(t.created_at).toLocaleString()}
                      {t.method ? ` • ${t.method}` : ""}
                      {t.razorpay_payment_id ? ` • ${t.razorpay_payment_id}` : ""}
                    </p>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="font-semibold">{formatINR(t.amount || 0)}</p>
                    <Badge
                      variant={(t.status || "").toLowerCase() === "captured" ? "default" : "secondary"}
                    >
                      {t.status || "unknown"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
