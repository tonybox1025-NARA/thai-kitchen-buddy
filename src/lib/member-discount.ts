export type MemberDiscountRow = {
  member_discount_amount?: number | string | null;
  loyalty_discount_amount?: number | string | null;
};

function money(value: MemberDiscountRow[keyof MemberDiscountRow]) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

/**
 * The POS has two storage columns for customer membership benefits:
 * manually applied member discounts and loyalty-points redemptions. Every
 * report and export must present their combined baht reduction as MB Discount.
 */
export function totalMemberDiscount(rows: readonly MemberDiscountRow[]) {
  return rows.reduce(
    (total, row) =>
      total + money(row.member_discount_amount) + money(row.loyalty_discount_amount),
    0,
  );
}
