import { supabase } from "@/integrations/supabase/client";
import type { ActiveStaff } from "@/lib/auth";

export type PosAccessProfile = ActiveStaff & { position?: string | null };
export type PosAccessStatus = {
  configured: boolean;
  version: number;
  profiles: PosAccessProfile[];
};

const DEVICE_KEY = "lonmoh.pos.sharedAccess.deviceId";
const VERSION_KEY = "lonmoh.pos.sharedAccess.version";

export function sharedAccessDeviceId() {
  let value = localStorage.getItem(DEVICE_KEY);
  if (!value) {
    value = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, value);
  }
  return value;
}

export function storedSharedAccessVersion() {
  const raw = localStorage.getItem(VERSION_KEY);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function rememberSharedAccessVersion(version: number) {
  localStorage.setItem(VERSION_KEY, String(version));
}

export function clearSharedAccessVersion() {
  localStorage.removeItem(VERSION_KEY);
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("shared-pin-auth", { body });
  if (error) {
    const response = (error as { context?: Response }).context;
    const payload = response
      ? await response
          .clone()
          .json()
          .catch(() => null)
      : null;
    throw new Error(payload?.error || error.message || "Shared access is unavailable");
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export function loadPosAccessStatus() {
  return invoke<PosAccessStatus>({ action: "status" });
}

export async function signInWithSharedPin(profileId: string, pin: string) {
  const result = await invoke<{
    token_hash: string;
    type: "magiclink";
    version: number;
    profile: PosAccessProfile;
  }>({
    action: "login",
    profile_id: profileId,
    pin,
    device_id: sharedAccessDeviceId(),
  });
  const { error } = await supabase.auth.verifyOtp({
    token_hash: result.token_hash,
    type: result.type,
  });
  if (error) throw error;
  rememberSharedAccessVersion(result.version);
  return result.profile;
}
