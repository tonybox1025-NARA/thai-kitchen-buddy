import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";
import {
  clearSharedAccessVersion,
  loadPosAccessStatus,
  rememberSharedAccessVersion,
  signInWithSharedPin,
  storedSharedAccessVersion,
  type PosAccessStatus,
} from "@/lib/shared-access";

export type StaffRole = "admin" | "manager" | "staff";
export type ActiveStaff = { id: string; name: string; role: StaffRole };

type AuthCtx = {
  loading: boolean;
  session: Session | null;
  staff: ActiveStaff | null;
  accessStatus: PosAccessStatus | null;
  setStaff: (s: ActiveStaff | null) => void;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  verifyPin: (pin: string) => Promise<ActiveStaff | null>;
  signInWithPin: (
    profileId: string,
    pin: string,
  ) => Promise<{ staff?: ActiveStaff; error?: string }>;
  refreshAccessStatus: () => Promise<PosAccessStatus | null>;
  requireManagerPin: (pin: string) => Promise<boolean>;
};

const Ctx = createContext<AuthCtx | null>(null);

const STAFF_KEY = "pos.activeStaff";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [staff, setStaffState] = useState<ActiveStaff | null>(null);
  const [accessStatus, setAccessStatus] = useState<PosAccessStatus | null>(null);

  useEffect(() => {
    let mounted = true;
    let validationSequence = 0;

    const validate = async (nextSession: Session | null) => {
      const sequence = ++validationSequence;
      if (!nextSession) {
        if (mounted && sequence === validationSequence) {
          setSession(null);
          setLoading(false);
        }
        return;
      }
      try {
        const status = await loadPosAccessStatus();
        if (mounted) setAccessStatus(status);
        const remembered = storedSharedAccessVersion();
        if (remembered === null) {
          rememberSharedAccessVersion(status.version);
        } else if (status.configured && remembered !== status.version) {
          clearSharedAccessVersion();
          localStorage.removeItem(STAFF_KEY);
          setStaffState(null);
          await supabase.auth.signOut({ scope: "local" });
          if (mounted && sequence === validationSequence) setSession(null);
          return;
        }
      } catch (error) {
        // Slow/offline startup must not erase a valid till session. Retry when
        // the app returns to the foreground or at the next periodic check.
        console.warn("Shared access version check failed", error);
      }
      if (mounted && sequence === validationSequence) setSession(nextSession);
      if (mounted) setLoading(false);
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, s) => {
      // Run outside Supabase's auth callback lock because validation invokes
      // an Edge Function and may perform a local sign-out on version mismatch.
      window.setTimeout(() => void validate(s), 0);
    });

    const initSession = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        await validate(data.session ?? null);
      } catch (error) {
        console.error("Failed to initialize auth session", error);
        if (mounted) setLoading(false);
      }
    };

    void initSession();

    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(STAFF_KEY) : null;
      if (raw) setStaffState(JSON.parse(raw));
    } catch {
      localStorage.removeItem(STAFF_KEY);
    }

    const revalidate = () => {
      void supabase.auth.getSession().then(({ data }) => validate(data.session));
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") revalidate();
    };
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", onVisibility);
    const interval = window.setInterval(revalidate, 5 * 60 * 1000);

    return () => {
      mounted = false;
      validationSequence += 1;
      subscription.unsubscribe();
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(interval);
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

  const refreshAccessStatus = async () => {
    try {
      const status = await loadPosAccessStatus();
      setAccessStatus(status);
      return status;
    } catch (error) {
      console.error("Failed to load shared access status", error);
      return null;
    }
  };

  const signInWithPin: AuthCtx["signInWithPin"] = async (profileId, pin) => {
    try {
      const selected = await signInWithSharedPin(profileId, pin);
      const next = { id: selected.id, name: selected.name, role: selected.role };
      setStaff(next);
      return { staff: next };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "PIN login failed" };
    }
  };

  return (
    <Ctx.Provider
      value={{
        loading,
        session,
        staff,
        accessStatus,
        setStaff,
        signIn,
        signUp,
        signOut,
        verifyPin,
        signInWithPin,
        refreshAccessStatus,
        requireManagerPin,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}
