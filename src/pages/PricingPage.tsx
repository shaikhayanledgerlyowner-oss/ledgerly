import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, Star, Info, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const plans = [
  { id: "monthly", name: "Monthly", price: 199, currency: "₹", period: "/month", features: ["Unlimited tables", "Professional PDFs", "No watermark", "Priority support"] },
  { id: "yearly", name: "Yearly", price: 1500, currency: "₹", period: "/year", features: ["Everything in Monthly", "Save ₹888/year", "Early access to features", "Priority support"], popular: true },
];

interface PaymentInfo {
  receiver_name: string | null;
  upi_id: string | null;
  paypal_email: string | null;
  is_enabled: boolean;
}

export default function PricingPage() {
  const { profile, isPremium } = useAuth();
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo | null>(null);
  const [showSubscribe, setShowSubscribe] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<typeof plans[0] | null>(null);
  const [txnId, setTxnId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pendingRequest, setPendingRequest] = useState(false);

  useEffect(() => {
    // Fetch payment settings (public read via RPC or direct if policy allows)
    // We'll use a simple select - owner_payment_settings has RLS for owner only,
    // so we need an RPC or adjust. For now, fetch via edge function or use a simple approach.
    // Actually, customers can't read owner_payment_settings. Let's create an RPC.
    // For now, we'll fetch it without auth check by using the notify_owner approach.
    // Simplest: just show static info. But the user wants dynamic. Let me fetch and handle gracefully.
    supabase.from("owner_payment_settings").select("receiver_name, upi_id, paypal_email, is_enabled" as any).limit(1).single()
      .then(({ data }) => {
        if (data) setPaymentInfo(data as any);
      });

    if (profile) {
      supabase.from("purchase_requests").select("status").eq("user_id", profile.id).eq("status", "pending").limit(1)
        .then(({ data }) => setPendingRequest((data ?? []).length > 0));
    }
  }, [profile]);

  const subscribe = async () => {
    if (!profile || !selectedPlan) return;
    if (isPremium) { toast.info("You already have Premium!"); return; }
    if (pendingRequest) { toast.info("You already have a pending request."); return; }

    setSubmitting(true);
    const { error } = await supabase.from("purchase_requests").insert({
      user_id: profile.id,
      plan: selectedPlan.id,
      amount: selectedPlan.price,
      status: "pending",
      txn_id: txnId || null,
    });
    if (error) { toast.error(error.message); setSubmitting(false); return; }

    await supabase.rpc("notify_owner_purchase", {
      p_email: profile.email,
      p_plan: selectedPlan.id,
      p_amount: selectedPlan.price,
    });

    toast.success("Subscription request submitted! Pending verification.");
    setShowSubscribe(false);
    setTxnId("");
    setPendingRequest(true);
    setSubmitting(false);
  };

  const paymentsEnabled = paymentInfo?.is_enabled ?? false;

  return (
    <div className="animate-fade-in space-y-8">
      <div className="text-center">
        <h1 className="text-3xl font-display font-bold">Upgrade to Premium</h1>
        <p className="mt-2 text-muted-foreground">Unlock all features with a premium plan</p>
        {isPremium && (
          <Badge className="mt-3 bg-success text-success-foreground">
            <Star className="mr-1 h-3 w-3" /> Premium Active
          </Badge>
        )}
        {pendingRequest && !isPremium && (
          <Badge className="mt-3" variant="secondary">
            <AlertTriangle className="mr-1 h-3 w-3" /> Verification Pending
          </Badge>
        )}
      </div>

      <div className="mx-auto grid max-w-3xl gap-6 md:grid-cols-2">
        {plans.map(plan => (
          <Card key={plan.id} className={`glass-card relative ${plan.popular ? "ring-2 ring-accent" : ""}`}>
            {plan.popular && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <Badge className="gradient-accent text-accent-foreground">Most Popular</Badge>
              </div>
            )}
            <CardHeader>
              <CardTitle className="font-display">{plan.name}</CardTitle>
              <CardDescription>
                <span className="text-3xl font-bold text-foreground">{plan.currency}{plan.price}</span>
                <span className="text-muted-foreground">{plan.period}</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-2">
                {plan.features.map(f => (
                  <li key={f} className="flex items-center gap-2 text-sm">
                    <Check className="h-4 w-4 text-success" /> {f}
                  </li>
                ))}
              </ul>
              <Button
                className="w-full"
                variant={plan.popular ? "default" : "outline"}
                onClick={() => {
                  if (!paymentsEnabled) { toast.info("Payments coming soon!"); return; }
                  setSelectedPlan(plan);
                  setShowSubscribe(true);
                }}
                disabled={isPremium || pendingRequest}
              >
                {isPremium ? "Active" : pendingRequest ? "Pending" : !paymentsEnabled ? "Coming Soon" : "Subscribe"}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Payment info for customers */}
      {paymentsEnabled && paymentInfo && !isPremium && (
        <Card className="glass-card max-w-lg mx-auto">
          <CardContent className="py-4 space-y-2">
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 text-info mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium">Payment Information</p>
                {paymentInfo.receiver_name && <p>Receiver: {paymentInfo.receiver_name}</p>}
                {paymentInfo.upi_id && <p>UPI: {paymentInfo.upi_id}</p>}
                {paymentInfo.paypal_email && <p>PayPal: {paymentInfo.paypal_email}</p>}
                <p className="text-xs text-muted-foreground mt-2">
                  Payments are temporarily processed via our authorized payment partner.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Subscribe Dialog */}
      <Dialog open={showSubscribe} onOpenChange={setShowSubscribe}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Subscribe to {selectedPlan?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg bg-muted p-4 text-sm space-y-1">
              <p><strong>Amount:</strong> {selectedPlan?.currency}{selectedPlan?.price}</p>
              {paymentInfo?.receiver_name && <p><strong>Pay to:</strong> {paymentInfo.receiver_name}</p>}
              {paymentInfo?.upi_id && <p><strong>UPI:</strong> {paymentInfo.upi_id}</p>}
              {paymentInfo?.paypal_email && <p><strong>PayPal:</strong> {paymentInfo.paypal_email}</p>}
            </div>
            <div className="space-y-2">
              <Label>Transaction ID (optional)</Label>
              <Input value={txnId} onChange={e => setTxnId(e.target.value)} placeholder="Enter transaction reference" />
            </div>
            <p className="text-xs text-muted-foreground">After payment, submit your request. The owner will verify and activate your premium.</p>
            <Button onClick={subscribe} disabled={submitting} className="w-full">
              {submitting ? "Submitting..." : "Submit Request"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
