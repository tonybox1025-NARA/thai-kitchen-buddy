// The guest wallet token identifies a member by their device (no phone / no LINE
// required). It lives in localStorage; the same token is reused by the receipt
// claim page and the persistent /wallet page. When LINE Login is added later, we
// link this guest member to the LINE user id so points survive across devices.
const KEY = "lonmoh_guest_wallet_token";

export function walletToken(): string {
  if (typeof window === "undefined" || !window.localStorage) return "";
  const existing = localStorage.getItem(KEY);
  if (existing) return existing;
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  localStorage.setItem(KEY, token);
  return token;
}
