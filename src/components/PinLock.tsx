import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Lock, Delete, LogOut } from "lucide-react";

// Unlocked flag — lives in sessionStorage (clears when ALL tabs close)
const SESSION_KEY = "ledgerly_pin_unlocked";

interface PinLockProps {
  children: React.ReactNode;
}

export default function PinLock({ children }: PinLockProps) {
  const { user, profile, signOut, loading } = useAuth();

  const [pinEnabled, setPinEnabled] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [input, setInput] = useState("");
  const [shake, setShake] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Wait for auth to load
    if (loading) return;

    // No user logged in → show children (AuthPage will handle redirect)
    if (!user || !profile?.id) {
      setChecking(false);
      setUnlocked(true);
      return;
    }

    const check = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("pin_hash")
        .eq("id", profile.id)
        .single();

      const hasPinSet = !!(data as any)?.pin_hash;
      setPinEnabled(hasPinSet);

      if (!hasPinSet) {
        // No PIN set — let through
        setUnlocked(true);
      } else {
        // PIN set — check if already unlocked this session
        const sessionOk = sessionStorage.getItem(SESSION_KEY) === profile.id;
        setUnlocked(sessionOk);
      }
      setChecking(false);
    };

    check();
  }, [user, profile?.id, loading]);

  const handleDigit = (d: string) => {
    if (input.length >= 4) return;
    const newInput = input + d;
    setInput(newInput);
    if (newInput.length === 4) verifyPin(newInput);
  };

  const handleDelete = () => setInput((p) => p.slice(0, -1));

  const verifyPin = async (pin: string) => {
    if (!profile?.id) return;

    const { data } = await supabase
      .from("profiles")
      .select("pin_hash")
      .eq("id", profile.id)
      .single();

    const storedHash = (data as any)?.pin_hash;
    const inputHash = await hashPin(pin);

    if (storedHash === inputHash) {
      sessionStorage.setItem(SESSION_KEY, profile.id);
      setUnlocked(true);
    } else {
      setShake(true);
      setInput("");
      setTimeout(() => setShake(false), 600);
      toast.error("Galat PIN!");
    }
  };

  // Still loading auth or checking PIN
  if (loading || checking) return null;

  // PIN not enabled or already unlocked
  if (!pinEnabled || unlocked) return <>{children}</>;

  const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, "del"] as const;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-8 w-full max-w-xs px-6">
        <div className="flex flex-col items-center gap-3">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Lock className="h-8 w-8 text-primary" />
          </div>
          <div className="text-center">
            <h2 className="text-xl font-bold">Ledgerly</h2>
            <p className="text-sm text-muted-foreground mt-1">PIN daalo andar jaane ke liye</p>
          </div>
        </div>

        {/* PIN dots */}
        <div className={`flex gap-4 ${shake ? "animate-shake" : ""}`}>
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`h-4 w-4 rounded-full border-2 transition-all duration-150 ${
                i < input.length
                  ? "bg-primary border-primary scale-110"
                  : "border-muted-foreground/40"
              }`}
            />
          ))}
        </div>

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-3 w-full">
          {digits.map((d, idx) => {
            if (d === null) return <div key={idx} />;
            if (d === "del") return (
              <button
                key={idx}
                onClick={handleDelete}
                className="h-16 w-full rounded-2xl flex items-center justify-center text-muted-foreground hover:bg-muted active:scale-95 transition-all"
              >
                <Delete className="h-5 w-5" />
              </button>
            );
            return (
              <button
                key={idx}
                onClick={() => handleDigit(String(d))}
                className="h-16 w-full rounded-2xl bg-muted hover:bg-muted/70 active:scale-95 active:bg-primary/20 transition-all text-xl font-semibold"
              >
                {d}
              </button>
            );
          })}
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="gap-2 text-muted-foreground"
          onClick={signOut}
        >
          <LogOut className="h-4 w-4" />
          Alag account se login karo
        </Button>
      </div>
    </div>
  );
}

// SHA-256 hash with salt
export async function hashPin(pin: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(pin + "ledgerly_salt_2024");
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function clearPinSession() {
  sessionStorage.removeItem(SESSION_KEY);
}
