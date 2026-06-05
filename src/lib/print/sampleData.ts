import type { ReceiptData, KitchenTicketData } from "./types";

export const sampleReceipt: ReceiptData = {
  restaurant: "Thai Kitchen Buddy",
  address: "123 Sukhumvit Rd, Bangkok",
  taxId: "0105561000000",
  table: "T05",
  billNo: "B-20260605-0042",
  cashier: "Somchai",
  printedAt: new Date().toISOString(),
  items: [
    { name: "Pad Thai Goong", qty: 2, unitPrice: 180 },
    { name: "Tom Yum Kung", qty: 1, unitPrice: 220 },
    { name: "Thai Iced Tea", qty: 3, unitPrice: 60 },
  ],
  subtotal: 760,
  discount: 0,
  serviceCharge: 0,
  vatMode: "inclusive",
  vatRate: 7,
  vatAmount: 49.72,
  total: 760,
  payments: [{ method: "cash", amount: 1000 }],
  change: 240,
};

export const sampleKitchen: KitchenTicketData = {
  table: "T05",
  orderNo: "O-0142",
  printedAt: new Date().toISOString(),
  station: "Kitchen",
  items: [
    { name: "Pad Thai Goong", qty: 2, note: "Extra spicy, no peanuts" },
    { name: "Tom Yum Kung", qty: 1, note: "Less coconut milk" },
    { name: "Thai Iced Tea", qty: 3 },
  ],
};
