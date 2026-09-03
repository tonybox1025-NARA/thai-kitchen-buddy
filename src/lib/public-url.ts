// Base URL for CUSTOMER-facing links printed on QR slips (table self-order menu,
// loyalty claim). `window.location.origin` is wrong in the places these QR codes
// are usually generated from:
//   - Lovable preview  → lovable.dev / *.gptengineer.run
//   - the native SUNMI app → capacitor://localhost
//   - local dev → localhost
// In all of those the printed QR must still point at the deployed public site,
// so fall back to PROD_BASE unless we're already on a real public web origin.
const PROD_BASE = "https://thai-kitchen-buddy.lovable.app";

const NON_PUBLIC = /lovable\.dev|gptengineer|localhost|127\.0\.0\.1|^capacitor:|^file:/i;

export function publicBaseUrl(): string {
  if (typeof window === "undefined") return PROD_BASE;
  const origin = window.location.origin;
  if (origin.startsWith("http") && !NON_PUBLIC.test(origin)) return origin;
  return PROD_BASE;
}
