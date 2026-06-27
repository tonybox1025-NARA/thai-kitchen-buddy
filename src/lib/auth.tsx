import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";

export type StaffRole = "admin" | "manager" | "staff";
export type ActiveStaff = { id: string; name: string; role: StaffRole };

type AuthCtx = {
  loading: boolean;
  session: Session | null;
  staff: ActiveStaff | null;
  setStaff: (s: ActiveStaff | null) => void;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  verifyPin: (pin: string) => Promise<ActiveStaff | null>;
  requireManagerPin: (pin: string) => Promise<boolean>;
};

const Ctx = createContext<AuthCtx | null>(null);

const STAFF_KEY = "pos.activeStaff";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [staff, setStaffState] = useState<ActiveStaff | null>(null);

  useEffect(() => {
    let mounted = true;
    let settled = false;

    const finishLoading = (nextSession: Session | null) => {
      if (!mounted) return;
      settled = true;
      setSession(nextSession);
      setLoading(false);
    };

    const fallback = window.setTimeout(() => {
      if (!settled) {
        console.warn("Auth session check timed out; continuing without a session.");
        finishLoading(null);
      }
    }, 1800);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      finishLoading(s);
    });

    const initSession = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        finishLoading(data.session ?? null);
      } catch (error) {
        console.error("Failed to initialize auth session", error);
        finishLoading(null);
      }
    };

    void initSession();

    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(STAFF_KEY) : null;
      if (raw) setStaffState(JSON.parse(raw));
    } catch {}

    return () => {
      mounted = false;
      window.clearTimeout(fallback);
      subscription.unsubscribe();
    };
  }, []);

  const setStaff = (s: ActiveStaff | null) => {
    setStaffState(s);
    if (s) localStorage.setItem(STAFF_KEY, JSON.stringify(s));
    else localStorage.removeItem(STAFF_KEY);
  };

  const signIn: AuthCtx["signIn"] = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message };
  };

  const signUp: AuthCtx["signUp"] = async (email, password) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    return { error: error?.message };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setStaff(null);
  };

  const verifyPin: AuthCtx["verifyPin"] = async (pin) => {
    const { data, error } = await supabase.rpc("verify_staff_pin", { _pin: pin });
    if (error || !data || (Array.isArray(data) && data.length === 0)) return null;
    const row = Array.isArray(data) ? data[0] : data;
    return { id: row.id, name: row.name, role: row.role as StaffRole };
  };

  const requireManagerPin: AuthCtx["requireManagerPin"] = async (pin) => {
    const s = await verifyPin(pin);
    return !!s && (s.role === "manager" || s.role === "admin");
  };

  return (
    <Ctx.Provider value={{ loading, session, staff, setStaff, signIn, signUp, signOut, verifyPin, requireManagerPin }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}
