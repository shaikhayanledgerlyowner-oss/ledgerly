import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Crown, Check, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

declare global {
  interface Window {
    Razorpay: any;
  }
}

const PLANS = [
  {
    id: "monthly",
    label: "Monthly",
    price: 199,
    days: 30,
    features: ["Unlimited invoices", "PDF exports", "Email reminders", "All currencies"],
  },
  {
    id: "yearly",
    label: "Yearly",
    price: 1500,
    days: 365,
    badge: "Best Value",
    features: ["Everything in Monthly", "Priority support", "2 months free"],
  },
];

export default function PricingPage() {
  const { user, profile, isPremium, isTrialActive, trialDaysLeft, refreshProfile } = useAuth();
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);

  // ✅ Razorpay auto-payment flow
  const handleRazorpay = async (plan: typeof PLANS[0]) => {
    if (!user) return;
    setLoadingPlan(plan.id);

    // Load Razorpay script
    if (!window.Razorpay) {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      document.body.appendChild(script);
      await new Promise((res) => (script.onload = res));
    }

    const options = {
      key: import.meta.env.VITE_RAZORPAY_KEY_ID,
      amount: plan.price * 100, // paise
      currency: "INR",
      name: "Ledgerly",
      description: `${plan.label} Plan`,
      prefill: { email: user.email },
      theme: { color: "#6366f1" },
      handler: async (response: any) => {
        // ✅ Payment successful — activate premium immediately
        const now = new Date();
        const premiumUntil = new Date(now.getTime() + plan.days * 24 * 60 * 60 * 1000);

        const { error } = await supabase
          .from("profiles")
          .update({
            is_premium: true,
            premium_type: plan.id,
            premium_until: premiumUntil.toISOString(),
            updated_at: now.toISOString(),
          } as any)
          .eq("id", user.id);

        if (error) {
          toast.error("Activation failed. Contact support with payment ID: " + response.razorpay_payment_id);
        } else {
          // Save payment record — only if live mode
          const isLive = (import.meta.env.VITE_RAZORPAY_KEY_ID || "").startsWith("rzp_live_");
          await supabase.from("purchase_requests").insert({
            user_id: user.id,
            plan: plan.id,
            amount: plan.price,
            status: "approved",
            txn_id: response.razorpay_payment_id,
            is_live: isLive,
          } as any);

          await refreshProfile();
          toast.success(`🎉 Premium activated! Valid for ${plan.days} days.`);
        }
        setLoadingPlan(null);
      },
      modal: {
        ondismiss: () => setLoadingPlan(null),
      },
    };

    const rzp = new window.Razorpay(options);
    rzp.open();
  };



  if (isPremium) {
    return (
      <div className="animate-fade-in text-center py-16 space-y-4">
        <Crown className="h-12 w-12 text-yellow-500 mx-auto" />
        <h2 className="text-2xl font-bold">You're Premium! 🎉</h2>
        <p className="text-muted-foreground">
          Plan: <strong>{profile?.premium_type}</strong> · Expires:{" "}
          <strong>
            {profile?.premium_until
              ? new Date(profile.premium_until).toLocaleDateString()
              : "—"}
          </strong>
        </p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6 max-w-3xl mx-auto">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-display font-bold flex items-center justify-center gap-2">
          <Crown className="h-7 w-7 text-yellow-500" /> Upgrade to Premium
        </h1>
        {isTrialActive && (
          <p className="text-muted-foreground">
            Trial active — <strong>{trialDaysLeft} days left</strong>
          </p>
        )}
        {!isTrialActive && (
          <div className="flex items-center justify-center gap-2 text-destructive text-sm">
            <AlertCircle className="h-4 w-4" />
            Your free trial has expired. Upgrade to continue.
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {PLANS.map((plan) => (
          <Card
            key={plan.id}
            className={`glass-card relative ${plan.badge ? "border-primary" : ""}`}
          >
            {plan.badge && (
              <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary">
                {plan.badge}
              </Badge>
            )}
            <CardHeader className="text-center">
              <CardTitle className="text-xl">{plan.label}</CardTitle>
              <p className="text-3xl font-bold">
                ₹{plan.price}
                <span className="text-sm font-normal text-muted-foreground">
                  /{plan.id === "yearly" ? "year" : "month"}
                </span>
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-2">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm">
                    <Check className="h-4 w-4 text-success" /> {f}
                  </li>
                ))}
              </ul>

              {/* Razorpay auto pay */}
              <Button
                className="w-full"
                onClick={() => handleRazorpay(plan)}
                disabled={!!loadingPlan}
              >
                {loadingPlan === plan.id ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                Pay ₹{plan.price} Online
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
