export type PrintTarget = "counter" | "kitchen";
export type PrintJobKind = "receipt" | "kitchen_ticket";

export type Department = "hot_kitchen" | "bar" | "dessert" | "cold_kitchen" | string;

export type ReceiptItem = {
  name: string;
  qty: number;
  unitPrice: number;
  note?: string;
};

export type ReceiptData = {
  restaurant: string;
  logoUrl?: string;
  address?: string;
  taxId?: string;
  table?: string;
  billNo: string;
  cashier?: string;
  printedAt: string;
  items: ReceiptItem[];
  subtotal: number;
  discount?: number;
  serviceCharge?: number;
  roundingAdjustment?: number;
  vatMode: "inclusive" | "exclusive";
  vatRate: number;
  vatAmount: number;
  total: number;
  payments: { method: string; amount: number }[];
  change?: number;
  loyaltyClaimUrl?: string;
  loyaltyClaimCode?: string;
  loyaltyEarnPoints?: number;
};

export type KitchenItem = {
  name: string;
  qty: number;
  note?: string;
  /** Optional localized names — Phase 1 placeholders. */
  name_th?: string;
  name_en?: string;
  name_my?: string;
  /** Optional modifiers/options (e.g. "Extra spicy", "No peanuts"). */
  modifiers?: string[];
  /** Optional department routing. */
  department?: Department;
};

export type KitchenTicketData = {
  table?: string;
  orderNo: string;
  printedAt: string;
  station?: string;
  /** Department label printed large at top (e.g. "HOT KITCHEN"). */
  department?: string;
  /** Ticket index within a split print run (1-based). */
  ticketIndex?: number;
  /** Total number of tickets in this split run. */
  ticketTotal?: number;
  items: KitchenItem[];
};

export type PrintJob =
  | { kind: "receipt"; target: PrintTarget; data: ReceiptData }
  | { kind: "kitchen_ticket"; target: PrintTarget; data: KitchenTicketData };

export interface PrintDriver {
  name: string;
  print(job: PrintJob): Promise<void>;
}
