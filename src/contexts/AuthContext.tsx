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
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  loading: boolean;
  isOwner: boolean;
  isPremium: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
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

  // ✅ RLS-friendly: user can only touch row where id = auth.uid()
  const upsertProfileForUser = async (u: User) => {
    const email = u.email ?? "";
    const role: UserRole = email === OWNER_EMAIL ? "OWNER" : "CUSTOMER";

    const payload = {
      id: u.id, // MUST match auth.uid() for RLS
      email,
      role,
      is_premium: email === OWNER_EMAIL,
      display_name: pickDisplayName(u),
      avatar_url: pickAvatar(u),
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
    // First try fetch
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", u.id)
      .maybeSingle();

    if (error) {
      console.log("[Auth] loadProfile select error:", error);
      // try creating row anyway (Google login pe often missing)
      const created = await upsertProfileForUser(u);
      return created;
    }

    if (!data) {
      // profile missing -> create
      const created = await upsertProfileForUser(u);
      return created;
    }

    return data as any;
  };

  const setProfileFromRow = (row: any) => {
    if (!row) {
      setProfile(null);
      return;
    }
    setProfile({
      id: row.id,
      email: row.email,
      role: row.role as UserRole,
      is_premium: !!row.is_premium,
      display_name: row.display_name ?? null,
      avatar_url: row.avatar_url ?? null,
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

    // Ensure profile exists + load
    const row = await loadProfile(u);
    setProfileFromRow(row);

    setLoading(false);
  };

  useEffect(() => {
    // First load existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      hydrate(session);
    });

    // Listen future changes
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
  };

  const refreshProfile = async () => {
    if (!user) return;
    const row = await loadProfile(user);
    setProfileFromRow(row);
  };

  const isOwner = useMemo(() => {
    return profile?.role === "OWNER" || user?.email === OWNER_EMAIL;
  }, [profile?.role, user?.email]);

  const isPremium = useMemo(() => {
    return isOwner || (profile?.is_premium ?? false);
  }, [isOwner, profile?.is_premium]);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        loading,
        isOwner,
        isPremium,
        signOut,
        refreshProfile,
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