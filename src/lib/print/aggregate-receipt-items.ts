type ReceiptLine = Record<string, unknown> & {
  qty?: number;
  discount_amount?: number;
};

const ROW_ONLY_FIELDS = new Set([
  "id",
  "order_id",
  "bill_id",
  "created_at",
  "updated_at",
  "sent_at",
  "served_at",
  "round_number",
  "round_source",
  "status",
  "qty",
]);

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

function receiptLineKey(item: ReceiptLine) {
  const identity = Object.fromEntries(
    Object.entries(item).filter(([key]) => !ROW_ONLY_FIELDS.has(key)),
  );
  return JSON.stringify(stableValue(identity));
}

/**
 * Customer bills do not need the kitchen's ordering-round split. Merge only
 * truly identical lines while preserving the first-seen order. Notes,
 * modifiers, set choices, takeout state, unit price and item discounts remain
 * part of the identity, so materially different orders never collapse.
 */
export function aggregateReceiptItems(items: unknown): ReceiptLine[] {
  if (!Array.isArray(items)) return [];

  const grouped = new Map<string, ReceiptLine>();
  for (const rawItem of items) {
    if (!rawItem || typeof rawItem !== "object") continue;
    const item = rawItem as ReceiptLine;
    const key = receiptLineKey(item);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...item, qty: Number(item.qty) || 0 });
      continue;
    }
    existing.qty = (Number(existing.qty) || 0) + (Number(item.qty) || 0);
  }

  return [...grouped.values()];
}
