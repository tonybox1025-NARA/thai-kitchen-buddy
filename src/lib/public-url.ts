// Base URL for CUSTOMER-facing links printed on QR slips (table self-order menu,
// loyalty claim). These must ALWAYS reach the public deployed site — never the
// context the QR happens to be generated from:
//   - Lovable preview iframe  → *.lovableproject.com / preview *.lovable.app
//   - the native SUNMI app     → capacitor://localhost
//   - the Lovable editor       → lovable.dev
//   - local dev                → localhost
// window.location.origin is wrong in every one of those, so we pin the public
// URL. (If a custom domain is added later, change PUBLIC_SITE here.)
const PUBLIC_SITE = "https://thai-kitchen-buddy.lovable.app";

export function publicBaseUrl(): string {
  return PUBLIC_SITE;
}
