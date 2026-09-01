/**
 * Staff-facing table label. Shows the plain number only:
 *   "T01" → "1",  "T12" → "12",  "12" → "12".
 * Non-numeric codes (e.g. "TEST") are shown unchanged.
 * The stored `code` is NOT altered — QR routing (/menu/<code>) still uses the raw code.
 */
export function tableLabel(code: string | null | undefined): string {
  if (!code) return code ?? "";
  const m = code.match(/(\d+)\s*$/);
  return m ? String(parseInt(m[1], 10)) : code;
}
