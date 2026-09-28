/** Canonical Thai phone form used for member matching and search. */
export function normalizePhone(value: string | null | undefined) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0066") && digits.length >= 13) return `0${digits.slice(4)}`;
  if (digits.startsWith("66") && digits.length >= 11) return `0${digits.slice(2)}`;
  return digits;
}

export function isPhoneSearch(value: string | null | undefined, minDigits = 4) {
  return normalizePhone(value).length >= minDigits && /\d/.test(String(value ?? ""));
}
