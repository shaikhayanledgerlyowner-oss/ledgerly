import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Lock, Delete, Mail, ArrowLeft, UserPlus } from "lucide-react";

const SESSION_KEY = "ledgerly_unlocked_uid";

// SHA-256 hash — no salt (consistent)
export async function hashPin(pin: string): Promise<string> {
  const buf = new TextEncoder().encode(pin);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function clearPinSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

type Screen = "pin" | "signup" | "forgot" | "forgot_sent";

interface PinLockProps {
  children: React.ReactNode;
}

export default function PinLock({ children }: PinLockProps) {
  const { user, profile, loading, signOut } = useAuth();

  const [screen, setScreen] = useState<Screen>("pin");
  const [pinInput, setPinInput] = useState("");
  const [shake, setShake] = useState(false);
  const [checking, setChecking] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const [hasPinSet, setHasPinSet] = useState(false);

  // Signup state
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupPin, setSignupPin] = useState("");
  const [signupPinConfirm, setSignupPinConfirm] = useState("");
  const [signupLoading, setSignupLoading] = useState(false);

  // Forgot PIN state
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);

  useEffect(() => {
    if (loading) return;

    if (!user || !profile?.id) {
      // Not logged in — show PIN screen (which has signup option)
      setChecking(false);
      setUnlocked(false);
      return;
    }

    const init = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("pin_hash")
        .eq("id", profile.id)
        .single();

      const pinSet = !!(data as any)?.pin_hash;
      setHasPinSet(pinSet);

      if (!pinSet) {
        // Logged in but no PIN set yet → let through to set PIN in settings
        setUnlocked(true);
      } else {
        // Check session
        const sessionOk = sessionStorage.getItem(SESSION_KEY) === profile.id;
        setUnlocked(sessionOk);
      }
      setChecking(false);
    };

    init();
  }, [user, profile?.id, loading]);

  // Digit pressed
  const pressDigit = (d: string) => {
    if (pinInput.length >= 4) return;
    const next = pinInput + d;
    setPinInput(next);
    if (next.length === 4) setTimeout(() => verifyPin(next), 100);
  };

  const pressDelete = () => setPinInput((p) => p.slice(0, -1));

  const verifyPin = async (pin: string) => {
    if (!profile?.id) {
      // Not logged in — try to find user by PIN (email+pin login)
      // This case shouldn't happen in normal flow
      setShake(true); setPinInput("");
      setTimeout(() => setShake(false), 600);
      return;
    }

    const { data } = await supabase
      .from("profiles")
      .select("pin_hash")
      .eq("id", profile.id)
      .single();

    const stored = (data as any)?.pin_hash;
    const entered = await hashPin(pin);

    if (stored === entered) {
      sessionStorage.setItem(SESSION_KEY, profile.id);
      setUnlocked(true);
    } else {
      setShake(true); setPinInput("");
      setTimeout(() => setShake(false), 600);
      toast.error("Galat PIN!");
    }
  };

  // Signup with email + password + PIN
  const handleSignup = async () => {
    if (!signupEmail.trim()) { toast.error("Email daalo"); return; }
    if (signupPassword.length < 6) { toast.error("Password kam se kam 6 characters ka hona chahiye"); return; }
    if (signupPin.length !== 4) { toast.error("PIN 4 digits ka hona chahiye"); return; }
    if (signupPin !== signupPinConfirm) { toast.error("PIN match nahi hua!"); return; }

    setSignupLoading(true);
    try {
      // Create account
      const { data, error } = await supabase.auth.signUp({
        email: signupEmail.trim(),
        password: signupPassword,
      });

      if (error) { toast.error(error.message); return; }
      if (!data.user) { toast.error("Account create nahi hua"); return; }

      // Save PIN hash
      const hash = await hashPin(signupPin);
      await supabase.from("profiles").update({ pin_hash: hash } as any).eq("id", data.user.id);

      toast.success("Account ban gaya! Ab PIN se login karo ✅");
      setScreen("pin");
      setSignupEmail(""); setSignupPassword(""); setSignupPin(""); setSignupPinConfirm("");
    } finally {
      setSignupLoading(false);
    }
  };

  // Forgot PIN — send reset email
  const handleForgotPin = async () => {
    if (!forgotEmail.trim()) { toast.error("Email daalo"); return; }
    setForgotLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail.trim(), {
        redirectTo: `${window.location.origin}/reset-pin`,
      });
      if (error) { toast.error(error.message); return; }
      setScreen("forgot_sent");
    } finally {
      setForgotLoading(false);
    }
  };

  if (loading || checking) return (
    <div className="fixed inset-0 flex items-center justify-center bg-background">
      <div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
    </div>
  );

  // Show children if unlocked
  if (unlocked) return <>{children}</>;

  const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, "del"] as const;

  // ─── FORGOT PIN SENT ───
  if (screen === "forgot_sent") return (
    <div className="fixed inset-0 flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-xs flex flex-col items-center gap-6 text-center">
        <div className="h-16 w-16 rounded-2xl bg-green-100 flex items-center justify-center">
          <Mail className="h-8 w-8 text-green-600" />
        </div>
        <div>
          <h2 className="text-xl font-bold">Email bheja gaya!</h2>
          <p className="text-sm text-muted-foreground mt-2">
            <strong>{forgotEmail}</strong> pe password reset link bheja gaya hai.<br />
            Reset karne ke baad Settings mein nayi PIN set karo.
          </p>
        </div>
        <Button variant="outline" className="w-full gap-2" onClick={() => { setScreen("pin"); setForgotEmail(""); }}>
          <ArrowLeft className="h-4 w-4" /> Wapas PIN pe
        </Button>
      </div>
    </div>
  );

  // ─── FORGOT PIN ───
  if (screen === "forgot") return (
    <div className="fixed inset-0 flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-xs flex flex-col gap-5">
        <button onClick={() => setScreen("pin")} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Wapas
        </button>
        <div>
          <h2 className="text-xl font-bold">PIN bhool gaye?</h2>
          <p className="text-sm text-muted-foreground mt-1">Email pe reset link milega</p>
        </div>
        <div className="space-y-2">
          <Input
            type="email"
            placeholder="aapka@email.com"
            value={forgotEmail}
            onChange={(e) => setForgotEmail(e.target.value)}
          />
        </div>
        <Button className="w-full gap-2" onClick={handleForgotPin} disabled={forgotLoading}>
          {forgotLoading ? "Bhej raha hai..." : <><Mail className="h-4 w-4" /> Reset Link Bhejo</>}
        </Button>
      </div>
    </div>
  );

  // ─── SIGNUP ───
  if (screen === "signup") return (
    <div className="fixed inset-0 flex items-center justify-center bg-background p-6 overflow-y-auto">
      <div className="w-full max-w-xs flex flex-col gap-4 py-8">
        <button onClick={() => setScreen("pin")} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Wapas
        </button>
        <div>
          <h2 className="text-xl font-bold">Naya Account Banao</h2>
          <p className="text-sm text-muted-foreground mt-1">Ek baar banao — phir sirf PIN se login</p>
        </div>
        <div className="space-y-3">
          <Input type="email" placeholder="Email" value={signupEmail} onChange={(e) => setSignupEmail(e.target.value)} />
          <Input type="password" placeholder="Password (min 6 characters)" value={signupPassword} onChange={(e) => setSignupPassword(e.target.value)} />
          <Input
            type="password"
            placeholder="4-digit PIN (yaad rakhna!)"
            maxLength={4}
            value={signupPin}
            onChange={(e) => setSignupPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          />
          <Input
            type="password"
            placeholder="PIN dobara daalo"
            maxLength={4}
            value={signupPinConfirm}
            onChange={(e) => setSignupPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 4))}
          />
        </div>
        <Button className="w-full gap-2" onClick={handleSignup} disabled={signupLoading}>
          {signupLoading ? "Ban raha hai..." : <><UserPlus className="h-4 w-4" /> Account Banao</>}
        </Button>
        <p className="text-xs text-muted-foreground text-center">
          Pehle se account hai?{" "}
          <button className="text-primary underline" onClick={() => setScreen("pin")}>PIN se login karo</button>
        </p>
      </div>
    </div>
  );

  // ─── PIN SCREEN (default) ───
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-6 w-full max-w-xs px-6">
        <div className="flex flex-col items-center gap-3">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Lock className="h-8 w-8 text-primary" />
          </div>
          <div className="text-center">
            <h2 className="text-xl font-bold">Ledgerly</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {user ? "PIN daalo andar jaane ke liye" : "Apna PIN daalo"}
            </p>
          </div>
        </div>

        {/* PIN dots */}
        <div className={`flex gap-4 ${shake ? "animate-shake" : ""}`}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={`h-4 w-4 rounded-full border-2 transition-all duration-150 ${
              i < pinInput.length ? "bg-primary border-primary scale-110" : "border-muted-foreground/40"
            }`} />
          ))}
        </div>

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-3 w-full">
          {digits.map((d, idx) => {
            if (d === null) return <div key={idx} />;
            if (d === "del") return (
              <button key={idx} onClick={pressDelete}
                className="h-14 w-full rounded-2xl flex items-center justify-center text-muted-foreground hover:bg-muted active:scale-95 transition-all">
                <Delete className="h-5 w-5" />
              </button>
            );
            return (
              <button key={idx} onClick={() => pressDigit(String(d))}
                className="h-14 w-full rounded-2xl bg-muted hover:bg-muted/70 active:scale-95 active:bg-primary/20 transition-all text-xl font-semibold">
                {d}
              </button>
            );
          })}
        </div>

        {/* Bottom options */}
        <div className="flex flex-col items-center gap-2 w-full">
          <button
            className="text-sm text-muted-foreground hover:text-foreground underline"
            onClick={() => { setScreen("forgot"); setForgotEmail(user?.email || ""); }}
          >
            PIN bhool gaye?
          </button>
          <button
            className="flex items-center gap-1 text-sm text-primary hover:underline"
            onClick={() => setScreen("signup")}
          >
            <UserPlus className="h-4 w-4" /> Naya Account Banao
          </button>
          {user && (
            <button className="text-xs text-muted-foreground hover:text-foreground mt-1" onClick={signOut}>
              Alag account se login karo
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
