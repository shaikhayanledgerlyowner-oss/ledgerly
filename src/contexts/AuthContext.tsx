import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

const OWNER_EMAIL = "shaikhayan.ledgerlyowner@gmail.com";

export type UserRole = "OWNER" | "CUSTOMER";

interface UserProfile {
  id: string;
  email: string;
  role: UserRole;
  is_premium: boolean;
  display_name: string | null;
  avatar_url: string | null;
  premium_until: string | null;
  premium_type: string | null;
  trial_ends_at: string | null;
  created_at: string | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  loading: boolean;
  isOwner: boolean;
  isPremium: boolean;
  isTrialActive: boolean;
  isTrialExpired: boolean;
  trialDaysLeft: number;
  premiumDaysLeft: number;
  hasAccess: boolean;
  userCurrency: string;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  refreshCurrency: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function pickDisplayName(u: User) {
  const meta: any = u.user_metadata ?? {};
  return meta.full_name ?? meta.name ?? meta.display_name ?? null;
}

function pickAvatar(u: User) {
  const meta: any = u.user_metadata ?? {};
  return meta.avatar_url ?? meta.picture ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [userCurrency, setUserCurrency] = useState("INR");

  const upsertProfileForUser = async (u: User) => {
    const email = u.email ?? "";
    const role: UserRole = email === OWNER_EMAIL ? "OWNER" : "CUSTOMER";

    const payload = {
      id: u.id,
      email,
      role,
      is_premium: email === OWNER_EMAIL,
      display_name: pickDisplayName(u),
      avatar_url: pickAvatar(u),
      // ✅ New user ko 7 days trial
      trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    };

    const { data, error } = await supabase
      .from("profiles")
      .upsert(payload, { onConflict: "id" })
      .select("*")
      .single();

    if (error) {
      console.log("[Auth] upsertProfileForUser error:", error);
      return null;
    }
    return data as any;
  };

  const loadProfile = async (u: User) => {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", u.id)
      .maybeSingle();

    if (error) {
      console.log("[Auth] loadProfile select error:", error);
      const created = await upsertProfileForUser(u);
      return created;
    }

    if (!data) {
      const created = await upsertProfileForUser(u);
      return created;
    }

    return data as any;
  };

  const loadCurrency = async (userId: string) => {
    const { data } = await supabase
      .from("user_branding")
      .select("currency_code")
      .eq("user_id", userId)
      .maybeSingle();

    const code = (data as any)?.currency_code;
    if (code && typeof code === "string" && code.trim()) {
      setUserCurrency(code.trim().toUpperCase());
    } else {
      setUserCurrency("INR");
    }
  };

  const setProfileFromRow = (row: any) => {
    if (!row) {
      setProfile(null);
      return;
    }

    // ✅ Premium expiry check
    let effectivePremium = !!row.is_premium;
    if (effectivePremium && row.premium_until) {
      const expiry = new Date(row.premium_until);
      if (expiry < new Date()) {
        effectivePremium = false;
        // Expired — DB mein update karo
        supabase
          .from("profiles")
          .update({ is_premium: false })
          .eq("id", row.id)
          .then(() => {});
      }
    }

    setProfile({
      id: row.id,
      email: row.email,
      role: row.role as UserRole,
      is_premium: effectivePremium,
      display_name: row.display_name ?? null,
      avatar_url: row.avatar_url ?? null,
      premium_until: row.premium_until ?? null,
      premium_type: row.premium_type ?? null,
      trial_ends_at: row.trial_ends_at ?? null,
      created_at: row.created_at ?? null,
    });
  };

  const hydrate = async (s: Session | null) => {
    setSession(s);
    const u = s?.user ?? null;
    setUser(u);

    if (!u) {
      setProfile(null);
      setLoading(false);
      return;
    }

    const row = await loadProfile(u);
    setProfileFromRow(row);
    await loadCurrency(u.id);
    setLoading(false);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      hydrate(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      hydrate(s);
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setUserCurrency("INR");
  };

  const refreshProfile = async () => {
    if (!user) return;
    const row = await loadProfile(user);
    setProfileFromRow(row);
  };

  const refreshCurrency = async () => {
    if (!user) return;
    await loadCurrency(user.id);
  };

  const isOwner = useMemo(() => {
    return profile?.role === "OWNER" || user?.email === OWNER_EMAIL;
  }, [profile?.role, user?.email]);

  // ✅ Trial logic
  const trialDaysLeft = useMemo(() => {
    if (!profile?.trial_ends_at) return 0;
    const now = new Date();
    const end = new Date(profile.trial_ends_at);
    const diffMs = end.getTime() - now.getTime();
    if (diffMs <= 0) return 0;
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }, [profile?.trial_ends_at]);

  const isTrialActive = useMemo(() => {
    if (isOwner) return false;
    if (!profile?.trial_ends_at) return false;
    return new Date(profile.trial_ends_at) > new Date();
  }, [profile?.trial_ends_at, isOwner]);

  const isTrialExpired = useMemo(() => {
    if (isOwner) return false;
    if (!profile?.trial_ends_at) return true;
    return new Date(profile.trial_ends_at) <= new Date();
  }, [profile?.trial_ends_at, isOwner]);

  // ✅ Premium: owner ya valid premium_until wala
  const isPremium = useMemo(() => {
    if (isOwner) return true;
    if (!profile?.is_premium) return false;
    if (!profile?.premium_until) return false;
    return new Date(profile.premium_until) > new Date();
  }, [isOwner, profile?.is_premium, profile?.premium_until]);

  // Days left in premium plan
  const premiumDaysLeft = useMemo(() => {
    if (isOwner) return 999;
    if (!profile?.premium_until) return 0;
    const diff = new Date(profile.premium_until).getTime() - Date.now();
    return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
  }, [isOwner, profile?.premium_until]);

  // hasAccess = can use premium features (trial active OR premium active)
  const hasAccess = useMemo(() => {
    if (isOwner) return true;
    if (isPremium) return true;
    return isTrialActive;
  }, [isOwner, isPremium, isTrialActive]);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        loading,
        isOwner,
        isPremium,
        isTrialActive,
        isTrialExpired,
        trialDaysLeft,
        premiumDaysLeft,
        hasAccess,
        userCurrency,
        signOut,
        refreshProfile,
        refreshCurrency,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
