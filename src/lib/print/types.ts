export type PrintTarget = "counter" | "kitchen";
export type PrintJobKind = "receipt" | "kitchen_ticket";

export type ReceiptItem = {
  name: string;
  qty: number;
  unitPrice: number;
  note?: string;
};

export type ReceiptData = {
  restaurant: string;
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
  vatMode: "inclusive" | "exclusive";
  vatRate: number;
  vatAmount: number;
  total: number;
  payments: { method: string; amount: number }[];
  change?: number;
};

export type KitchenItem = { name: string; qty: number; note?: string };

export type KitchenTicketData = {
  table?: string;
  orderNo: string;
  printedAt: string;
  station?: string;
  items: KitchenItem[];
};

export type PrintJob =
  | { kind: "receipt"; target: PrintTarget; data: ReceiptData }
  | { kind: "kitchen_ticket"; target: PrintTarget; data: KitchenTicketData };

export interface PrintDriver {
  name: string;
  print(job: PrintJob): Promise<void>;
}
