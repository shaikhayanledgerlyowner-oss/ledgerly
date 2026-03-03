import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Navigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Shield, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";

interface PurchaseRequest {
  id: string;
  user_id: string;
  plan: string;
  amount: number;
  status: string;
  txn_id: string | null;
  created_at: string;
  user_profiles: { email: string } | null;
}

export default function VerificationPage() {
  const { isOwner } = useAuth();
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);

  const loadRequests = async () => {
    const { data } = await supabase
      .from("purchase_requests")
      .select("*, user_profiles(email)")
      .order("created_at", { ascending: false });
    setRequests((data ?? []) as any);
  };

  useEffect(() => {
    if (isOwner) loadRequests();
  }, [isOwner]);

  if (!isOwner) return <Navigate to="/dashboard" replace />;

  const handleAction = async (
    id: string,
    userId: string,
    plan: string,
    action: "approved" | "rejected"
  ) => {
    // ✅ Purchase request update karo
    await supabase
      .from("purchase_requests")
      .update({ status: action })
      .eq("id", id);

    if (action === "approved") {
      // ✅ Premium expiry calculate karo
      const now = new Date();
      let premiumUntil: Date;

      if (plan === "yearly") {
        premiumUntil = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
      } else {
        // monthly (default)
        premiumUntil = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      }

      // ✅ Profile update karo — is_premium + premium_until + premium_type
      const { error } = await supabase
        .from("profiles")
        .update({
          is_premium: true,
          premium_type: plan,
          premium_until: premiumUntil.toISOString(),
          updated_at: now.toISOString(),
        } as any)
        .eq("id", userId);

      if (error) {
        toast.error("Profile update failed: " + error.message);
        return;
      }

      toast.success(
        `✅ User approved! Premium active until ${premiumUntil.toLocaleDateString()}`
      );
    } else {
      toast.success("Request rejected");
    }

    loadRequests();
  };

  const statusColor = (s: string) => {
    if (s === "approved") return "bg-success text-success-foreground";
    if (s === "rejected") return "bg-destructive text-destructive-foreground";
    return "bg-warning text-warning-foreground";
  };

  const getPlanLabel = (plan: string) => {
    if (plan === "yearly") return "Yearly (365 days)";
    return "Monthly (30 days)";
  };

  return (
    <div className="animate-fade-in space-y-6">
      <h1 className="text-2xl font-display font-bold flex items-center gap-2">
        <Shield className="h-6 w-6" /> Verification Queue
      </h1>
      <div className="space-y-3">
        {requests.map((r) => (
          <Card key={r.id} className="glass-card">
            <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-4">
              <div>
                <p className="font-medium">
                  {(r.user_profiles as any)?.email || r.user_id}
                </p>
                <p className="text-sm text-muted-foreground">
                  {getPlanLabel(r.plan)} · ₹{r.amount} ·{" "}
                  {new Date(r.created_at).toLocaleDateString()}
                  {r.txn_id && <> · TXN: {r.txn_id}</>}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge className={statusColor(r.status)}>{r.status}</Badge>
                {r.status === "pending" && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-success"
                      onClick={() =>
                        handleAction(r.id, r.user_id, r.plan, "approved")
                      }
                    >
                      <CheckCircle className="mr-1 h-4 w-4" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive"
                      onClick={() =>
                        handleAction(r.id, r.user_id, r.plan, "rejected")
                      }
                    >
                      <XCircle className="mr-1 h-4 w-4" /> Reject
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        {requests.length === 0 && (
          <p className="text-muted-foreground text-sm">No purchase requests.</p>
        )}
      </div>
    </div>
  );
}
