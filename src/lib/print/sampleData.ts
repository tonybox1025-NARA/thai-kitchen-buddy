import type { ReceiptData, KitchenTicketData, KitchenItem, Department } from "./types";

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

/** Sample multi-department order — Phase 1, sample data only. */
export type SampleOrder = {
  table: string;
  orderNo: string;
  printedAt: string;
  items: KitchenItem[];
};

export const sampleDepartmentOrder: SampleOrder = {
  table: "T05",
  orderNo: "O-0143",
  printedAt: new Date().toISOString(),
  items: [
    {
      name: "Pad Thai Goong",
      name_en: "Pad Thai Goong",
      name_th: "ผัดไทยกุ้ง",
      name_my: "ပက်ထိုင်း ပုဇွန်",
      qty: 2,
      department: "hot_kitchen",
      modifiers: ["Extra spicy", "No peanuts"],
    },
    {
      name: "Tom Yum Kung",
      name_en: "Tom Yum Kung",
      name_th: "ต้มยำกุ้ง",
      name_my: "တုံယန်ပုဇွန်",
      qty: 1,
      department: "hot_kitchen",
      modifiers: ["Less coconut milk"],
    },
    {
      name: "Thai Iced Tea",
      name_en: "Thai Iced Tea",
      name_th: "ชาเย็น",
      name_my: "ထိုင်းရေခဲလက်ဖက်ရည်",
      qty: 3,
      department: "bar",
      modifiers: ["Less sweet"],
    },
    {
      name: "Beer",
      name_en: "Beer (Singha)",
      name_th: "เบียร์สิงห์",
      name_my: "ဘီယာ",
      qty: 2,
      department: "bar",
    },
    {
      name: "Mango Sticky Rice",
      name_en: "Mango Sticky Rice",
      name_th: "ข้าวเหนียวมะม่วง",
      name_my: "သရက်သီးကောက်ညှင်း",
      qty: 1,
      department: "dessert",
      modifiers: ["Extra coconut sauce"],
    },
  ],
};

const DEPT_LABEL: Record<string, string> = {
  hot_kitchen: "HOT KITCHEN",
  cold_kitchen: "COLD KITCHEN",
  bar: "BAR",
  dessert: "DESSERT",
};

export const departmentLabel = (d: Department): string =>
  DEPT_LABEL[d] ?? d.toString().replace(/_/g, " ").toUpperCase();

/** Split a sample order into one KitchenTicketData per department. */
export function splitOrderByDepartment(order: SampleOrder): KitchenTicketData[] {
  const groups = new Map<string, KitchenItem[]>();
  for (const it of order.items) {
    const d = it.department ?? "kitchen";
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d)!.push(it);
  }
  const depts = Array.from(groups.keys());
  const total = depts.length;
  return depts.map((d, i) => ({
    table: order.table,
    orderNo: order.orderNo,
    printedAt: order.printedAt,
    department: departmentLabel(d),
    station: departmentLabel(d),
    ticketIndex: i + 1,
    ticketTotal: total,
    items: groups.get(d)!,
  }));
}
