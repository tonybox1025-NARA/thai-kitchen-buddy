export function thb(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 2 }).format(v);
}

export function num(n: number | null | undefined, digits = 2): string {
  return Number(n ?? 0).toFixed(digits);
}
