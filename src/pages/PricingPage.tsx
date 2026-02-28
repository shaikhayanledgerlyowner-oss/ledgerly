import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Star, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

declare global {
  interface Window {
    Razorpay?: any;
  }
}

const plans = [
  {
    id: "monthly",
    name: "Monthly",
    price: 199,
    currency: "₹",
    period: "/month",
    features: ["Unlimited tables", "Professional PDFs", "No watermark", "Priority support"],
  },
  {
    id: "yearly",
    name: "Yearly",
    price: 1500,
    currency: "₹",
    period: "/year",
    features: ["Everything in Monthly", "Save ₹888/year", "Early access to features", "Priority support"],
    popular: true,
  },
] as const;

type Plan = (typeof plans)[number];

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);

    const existing = document.querySelector(
      'script[src="https://checkout.razorpay.com/v1/checkout.js"]'
    ) as HTMLScriptElement | null;

    if (existing) {
      existing.addEventListener("load", () => resolve(true));
      existing.addEventListener("error", () => resolve(false));
      return;
    }

    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export default function PricingPage() {
  const { profile, isPremium } = useAuth();

  const [pendingRequest, setPendingRequest] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState<Plan["id"] | null>(null);

  const keyId = import.meta.env.VITE_RAZORPAY_KEY_ID as string | undefined;

  const isLoggedIn = useMemo(() => !!profile?.id, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) return;

    supabase
      .from("purchase_requests")
      .select("id,status")
      .eq("user_id", profile.id)
      .eq("status", "pending")
      .limit(1)
      .then(({ data }) => setPendingRequest((data ?? []).length > 0));
  }, [profile?.id]);

  const openCheckout = async (plan: Plan) => {
    if (!isLoggedIn) {
      toast.error("Please login first");
      return;
    }
    if (!keyId) {
      toast.error("VITE_RAZORPAY_KEY_ID missing in Vercel env");
      return;
    }
    if (isPremium) {
      toast.info("Premium already active");
      return;
    }
    if (pendingRequest) {
      toast.info("Your verification is pending");
      return;
    }

    setLoadingPlan(plan.id);

    try {
      const ok = await loadRazorpayScript();
      if (!ok || !window.Razorpay) {
        toast.error("Razorpay script load nahi hua");
        return;
      }

      const amountPaise = Math.round(plan.price * 100);

      // 1) Create order via Vercel API
      let orderId: string | null = null;
      try {
        const resp = await fetch("/api/create-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: amountPaise,
            currency: "INR",
            notes: {
              user_id: profile!.id,
              plan: plan.id,
              email: profile!.email || "",
            },
          }),
        });

        const data = await resp.json().catch(() => ({}));
        orderId = data?.orderId || data?.id || data?.order_id || null;

        if (!resp.ok || !orderId) {
          console.error("create-order failed:", data);
          toast.error("Order create failed (api/create-order). Vercel logs check karo.");
          return;
        }
      } catch (e) {
        console.error(e);
        toast.error("Order create error (api/create-order)");
        return;
      }

      // 2) Open Razorpay Checkout
      const options = {
        key: keyId,
        order_id: orderId,
        amount: amountPaise,
        currency: "INR",
        name: "Ledgerly",
        description: `Ledgerly ${plan.name} Plan`,
        prefill: {
          email: profile!.email || "",
        },
        notes: {
          user_id: profile!.id,
          plan: plan.id,
        },
        handler: async function (response: any) {
          try {
            const { error } = await supabase.from("purchase_requests").insert({
              user_id: profile!.id,
              plan: plan.id,
              amount: plan.price,
              status: "pending",
              txn_id: response?.razorpay_payment_id || null,
            } as any);

            if (error) {
              toast.error(error.message);
              return;
            }

            toast.success("Payment done ✅ Request sent for verification.");
            setPendingRequest(true);
          } catch (err) {
            console.error(err);
            toast.error("Payment saved nahi hua");
          }
        },
        modal: {
          ondismiss: function () {},
        },
        theme: {
          color: "#111827",
        },
      };

      const rzp = new window.Razorpay(options);
      rzp.on("payment.failed", function (resp: any) {
        console.error(resp);
        toast.error("Payment failed");
      });
      rzp.open();
    } finally {
      setLoadingPlan(null);
    }
  };

  return (
    <div className="animate-fade-in space-y-8">
      <div className="text-center">
        <h1 className="text-3xl font-display font-bold">Upgrade to Premium</h1>
        <p className="mt-2 text-muted-foreground">
          Unlock all features with a premium plan
        </p>

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
        {plans.map((plan) => (
          <Card
            key={plan.id}
            className={`glass-card relative ${plan.popular ? "ring-2 ring-accent" : ""}`}
          >
            {plan.popular && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <Badge className="gradient-accent text-accent-foreground">
                  Most Popular
                </Badge>
              </div>
            )}

            <CardHeader>
              <CardTitle className="font-display">{plan.name}</CardTitle>
              <CardDescription>
                <span className="text-3xl font-bold text-foreground">
                  {plan.currency}
                  {plan.price}
                </span>
                <span className="text-muted-foreground">{plan.period}</span>
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              <ul className="space-y-2">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm">
                    <Check className="h-4 w-4 text-success" /> {f}
                  </li>
                ))}
              </ul>

              <Button
                className="w-full"
                variant={plan.popular ? "default" : "outline"}
                onClick={() => openCheckout(plan)}
                disabled={isPremium || pendingRequest || loadingPlan !== null}
              >
                {isPremium
                  ? "Active"
                  : pendingRequest
                  ? "Pending"
                  : loadingPlan === plan.id
                  ? "Opening..."
                  : plan.id === "monthly"
                  ? "Pay ₹199"
                  : "Pay ₹1500"}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Payment ke baad verification pending rahega. Webhook se wallet_transactions me entry aayegi (captured pe).
      </p>
    </div>
  );
}
