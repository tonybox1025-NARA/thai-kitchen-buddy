import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "th" | "en";

type Dict = Record<string, { th: string; en: string }>;

const dict: Dict = {
  app_name: { th: "ระบบ POS ร้านอาหาร", en: "Restaurant POS" },
  // nav
  nav_pos: { th: "หน้าโต๊ะ", en: "Tables" },
  nav_dashboard: { th: "แดชบอร์ด", en: "Dashboard" },
  nav_reports: { th: "รายงาน", en: "Reports" },
  nav_settings: { th: "ตั้งค่า", en: "Settings" },
  logout: { th: "ออกจากระบบ", en: "Sign out" },
  switch_staff: { th: "เปลี่ยนพนักงาน", en: "Switch staff" },
  // login
  device_login: { th: "เข้าใช้งานเครื่อง", en: "Device sign in" },
  email: { th: "อีเมล", en: "Email" },
  password: { th: "รหัสผ่าน", en: "Password" },
  sign_in: { th: "เข้าสู่ระบบ", en: "Sign in" },
  sign_up: { th: "สมัครใช้งาน", en: "Create account" },
  no_account: { th: "ยังไม่มีบัญชี?", en: "No account yet?" },
  have_account: { th: "มีบัญชีอยู่แล้ว?", en: "Already have an account?" },
  // pin
  enter_pin: { th: "ใส่รหัส PIN พนักงาน", en: "Enter staff PIN" },
  manager_pin: { th: "ต้องการรหัสผู้จัดการ", en: "Manager PIN required" },
  wrong_pin: { th: "รหัส PIN ไม่ถูกต้อง", en: "Wrong PIN" },
  cancel: { th: "ยกเลิก", en: "Cancel" },
  confirm: { th: "ยืนยัน", en: "Confirm" },
  // tables
  table: { th: "โต๊ะ", en: "Table" },
  available: { th: "ว่าง", en: "Available" },
  occupied: { th: "มีลูกค้า", en: "Occupied" },
  bill_requested: { th: "ขอเช็คบิล", en: "Bill requested" },
  guests: { th: "ลูกค้า", en: "Guests" },
  open_table: { th: "เปิดโต๊ะ", en: "Open table" },
  num_guests: { th: "จำนวนลูกค้า", en: "Number of guests" },
  start: { th: "เริ่ม", en: "Start" },
  // order
  add_to_order: { th: "เพิ่มในออเดอร์", en: "Add to order" },
  order: { th: "ออเดอร์", en: "Order" },
  send_to_kitchen: { th: "ส่งครัว", en: "Send to kitchen" },
  request_bill: { th: "ขอเช็คบิล", en: "Request bill" },
  go_to_payment: { th: "ไปหน้าชำระเงิน", en: "Go to payment" },
  notes: { th: "หมายเหตุ", en: "Notes" },
  modifiers: { th: "ตัวเลือกพิเศษ", en: "Modifiers" },
  qty: { th: "จำนวน", en: "Qty" },
  void: { th: "ยกเลิกรายการ (VOID)", en: "Void item" },
  void_reason: { th: "เหตุผลในการยกเลิก", en: "Void reason" },
  void_only_pending: { th: "ยกเลิกได้เฉพาะรายการที่ยังไม่ส่งครัว", en: "Only items not yet sent to kitchen can be voided" },
  void_reason_changed_mind: { th: "ลูกค้าเปลี่ยนใจ", en: "Customer changed mind" },
  void_reason_wrong_order: { th: "สั่งผิด", en: "Wrong order" },
  void_reason_other: { th: "อื่นๆ", en: "Other" },
  sent: { th: "ส่งครัวแล้ว", en: "Sent" },
  pending: { th: "รอส่ง", en: "Pending" },
  voided: { th: "ยกเลิกแล้ว", en: "Voided" },
  empty_order: { th: "ยังไม่มีรายการ", en: "No items yet" },
  // payment
  payment: { th: "ชำระเงิน", en: "Payment" },
  subtotal: { th: "รวม", en: "Subtotal" },
  discount: { th: "ส่วนลด", en: "Discount" },
  member_discount: { th: "ส่วนลดสมาชิก", en: "Member discount" },
  vat: { th: "ภาษีมูลค่าเพิ่ม", en: "VAT" },
  total: { th: "ยอดสุทธิ", en: "Total" },
  amount: { th: "จำนวนเงิน", en: "Amount" },
  percent: { th: "เปอร์เซ็นต์", en: "Percent" },
  cash: { th: "เงินสด", en: "Cash" },
  qr_transfer: { th: "QR โอน", en: "QR Transfer" },
  card: { th: "บัตรเครดิต", en: "Credit card" },
  cash_received: { th: "รับเงิน", en: "Cash received" },
  change: { th: "เงินทอน", en: "Change" },
  pay: { th: "ชำระเงิน", en: "Pay" },
  paid: { th: "ชำระแล้ว", en: "Paid" },
  print_receipt: { th: "พิมพ์ใบเสร็จ", en: "Print receipt" },
  refund: { th: "คืนเงิน", en: "Refund" },
  refund_reason: { th: "เหตุผลในการคืนเงิน", en: "Refund reason" },
  // shifts
  shift: { th: "กะ", en: "Shift" },
  open_shift: { th: "เปิดกะ", en: "Open shift" },
  close_shift: { th: "ปิดกะ", en: "Close shift" },
  close_table: { th: "ปิดโต๊ะ", en: "Close table" },
  move_table: { th: "ย้ายโต๊ะ", en: "Move table" },
  opening_float: { th: "เงินทอนต้นกะ", en: "Opening float" },
  starting_cash: { th: "เงินสดตั้งต้น", en: "Starting cash" },
  starting_cash_help: { th: "ยอดนี้จะถูกใช้เป็นเงินทอนต้นกะอัตโนมัติเมื่อเปิดกะใหม่", en: "Applied automatically as opening float when a new shift starts." },
  x_report: { th: "รายงาน X (กลางกะ)", en: "X Report (mid-shift)" },
  z_report: { th: "รายงาน Z (ปิดวัน)", en: "Z Report (end of day)" },
  no_open_shift: { th: "ยังไม่มีกะที่เปิดอยู่", en: "No open shift" },
  business_day: { th: "วันทำการ", en: "Business day" },
  cash_count: { th: "นับเงินสด", en: "Cash count" },
  over_short: { th: "เกิน / ขาด", en: "Over / Short" },
  // reports text
  gross_sales: { th: "ยอดขายรวม", en: "Gross sales" },
  net_sales: { th: "ยอดขายสุทธิ", en: "Net sales" },
  by_method: { th: "แยกตามช่องทาง", en: "By payment method" },
  voids_total: { th: "รวมยกเลิก", en: "Voids total" },
  refunds_total: { th: "รวมคืนเงิน", en: "Refunds total" },
  // dashboard filters
  today: { th: "วันนี้", en: "Today" },
  yesterday: { th: "เมื่อวาน", en: "Yesterday" },
  this_week: { th: "สัปดาห์นี้", en: "This week" },
  this_month: { th: "เดือนนี้", en: "This month" },
  // settings
  menu_management: { th: "จัดการเมนู", en: "Menu" },
  printers: { th: "เครื่องพิมพ์", en: "Printers" },
  staff: { th: "พนักงาน", en: "Staff" },
  general: { th: "ทั่วไป", en: "General" },
  add: { th: "เพิ่ม", en: "Add" },
  save: { th: "บันทึก", en: "Save" },
  delete: { th: "ลบ", en: "Delete" },
  edit: { th: "แก้ไข", en: "Edit" },
  name_th: { th: "ชื่อภาษาไทย", en: "Thai name" },
  name_en: { th: "ชื่อภาษาอังกฤษ", en: "English name" },
  name_my: { th: "ชื่อภาษาพม่า", en: "Burmese name" },
  price: { th: "ราคา", en: "Price" },
  category: { th: "หมวดหมู่", en: "Category" },
  available_toggle: { th: "พร้อมขาย", en: "Available" },
  printer_counter_ip: { th: "IP เครื่องพิมพ์เคาน์เตอร์", en: "Counter printer IP" },
  printer_kitchen_ip: { th: "IP เครื่องพิมพ์ครัว", en: "Kitchen printer IP" },
  vat_mode: { th: "โหมดภาษี", en: "VAT mode" },
  vat_inclusive: { th: "รวมภาษีในราคา", en: "Tax-inclusive" },
  vat_exclusive: { th: "ภาษีแยกต่างหาก", en: "Tax-exclusive (7% line)" },
  vat_rate: { th: "อัตราภาษี (%)", en: "VAT rate (%)" },
  restaurant_name: { th: "ชื่อร้าน", en: "Restaurant name" },
  pin_label: { th: "รหัส PIN (4-6 หลัก)", en: "PIN (4-6 digits)" },
  role: { th: "ตำแหน่ง", en: "Role" },
  role_admin: { th: "เจ้าของ", en: "Admin" },
  role_manager: { th: "ผู้จัดการ", en: "Manager" },
  role_staff: { th: "พนักงาน", en: "Staff" },
  // discount / coupon
  apply_discount:     { th: "ใส่ส่วนลด",      en: "Apply Discount"  },
  change_discount:    { th: "เปลี่ยนส่วนลด",   en: "Change"          },
  remove_discount:    { th: "ยกเลิกส่วนลด",    en: "Remove discount" },
  disc_pct:           { th: "ลด %",            en: "% Off"           },
  disc_fixed:         { th: "ลดเป็นเงิน",      en: "Fixed ฿"         },
  disc_free_item:     { th: "แถมฟรี",           en: "Free Item"       },
  disc_select_item:   { th: "เลือกรายการที่แถมฟรี", en: "Select item to make free" },
  disc_saves:         { th: "ลดไป",             en: "Saves"           },
  disc_applied_by:    { th: "ใส่โดย",           en: "Applied by"      },
  disc_by_type:       { th: "แยกตามประเภทส่วนลด", en: "Discount breakdown" },
  disc_by_staff:      { th: "แยกตามพนักงาน",   en: "By staff"        },
  // special order types
  takeout: { th: "เทคอะเวย์", en: "Takeout" },
  staff_meal: { th: "อาหารพนักงาน", en: "Staff Meal" },
  new_order_btn: { th: "ใหม่", en: "New" },
  no_takeout_orders: { th: "ไม่มีออเดอร์เทคอะเวย์", en: "No open takeout orders" },
  no_staff_meal_orders: { th: "ไม่มีออเดอร์อาหารพนักงาน", en: "No open staff meal orders" },
  // dashboard stats
  bills:               { th: "จำนวนบิล",                  en: "Bills"                          },
  voids_cancellations: { th: "ยกเลิก / โมฆะ",             en: "Voids & Cancellations"          },
  cancelled_orders:    { th: "ออเดอร์ที่ยกเลิก",           en: "Cancelled orders"               },
  tips_collected:      { th: "ทิปที่ได้รับ (QR)",          en: "Tips collected (QR)"            },
  net_qr_sales:        { th: "ยอด QR สุทธิ",              en: "Net QR Sales"                   },
  tips_cash_payout:    { th: "ทิป — จ่ายเป็นเงินสด",      en: "Tips — cash payout"             },
  tips_payout_hint:    { th: "จ่ายให้พนักงานเป็นเงินสด",  en: "Pay this to staff in cash"      },
  // date range bar
  custom_range:        { th: "กำหนดเอง",                  en: "Custom range"                   },
  // detail-gross
  gross:               { th: "ยอดรวม",                    en: "Gross"                          },
  net:                 { th: "สุทธิ",                     en: "Net"                            },
  time:                { th: "เวลา",                      en: "Time"                           },
  sales_by_hour:       { th: "ยอดขายแยกตามชั่วโมง",       en: "Sales by hour"                  },
  sales_by_table:      { th: "ยอดขายแยกตามโต๊ะ",          en: "Sales by table / order"         },
  all_orders:          { th: "ออเดอร์ทั้งหมด",            en: "All orders"                     },
  no_bills_period:     { th: "ไม่มีบิลในช่วงเวลานี้",      en: "No paid bills for this period"  },
  bill_word:           { th: "บิล",                       en: "bill"                           },
  // detail-discounts
  all_discounts:       { th: "ส่วนลดทั้งหมด",             en: "All discounts"                  },
  no_discounts_period: { th: "ไม่มีส่วนลดในช่วงเวลานี้",   en: "No discounts applied in this period" },
  grand_total:         { th: "รวมทั้งหมด",                 en: "Grand total"                    },
  disc_member:         { th: "สมาชิก",                    en: "Member"                         },
  // detail-qr
  qr_transactions:     { th: "รายการ QR",                 en: "QR Transactions"                },
  qr_received:         { th: "รับ QR รวม",                en: "QR received"                    },
  all_qr_payments:     { th: "รายการ QR ทั้งหมด",          en: "All QR payments"                },
  no_qr_period:        { th: "ไม่มีรายการ QR ในช่วงเวลานี้", en: "No QR payments in this period" },
  tips:                { th: "ทิป",                       en: "Tips"                           },
  // detail-tips
  total_tips_payout:   { th: "ทิปรวมที่ต้องจ่าย",          en: "Total tips to pay out"          },
  tip_breakdown:       { th: "ทิปแยกตามออเดอร์",           en: "Tip breakdown by order"         },
  no_tips_period:      { th: "ไม่มีทิปในช่วงเวลานี้",       en: "No tips in this period"         },
  total_tips:          { th: "ทิปรวม",                    en: "Total tips"                     },
  qr_net:              { th: "QR สุทธิ",                  en: "QR net"                         },
  tipped_order_word:   { th: "ออเดอร์ที่มีทิป",            en: "tipped order"                   },
  pay_cash_staff:      { th: "จ่ายเป็นเงินสดให้พนักงาน",   en: "pay in cash to staff"           },
  // detail-voids
  voided_items:        { th: "รายการที่โมฆะ",              en: "Voided items"                   },
  no_cancelled:        { th: "ไม่มีออเดอร์ที่ยกเลิก",      en: "No cancelled orders"            },
  no_voided:           { th: "ไม่มีรายการที่โมฆะ",          en: "No voided items"                },
  cancelled_by:        { th: "ยกเลิกโดย",                 en: "Cancelled by"                   },
  reason_staff:        { th: "เหตุผล / พนักงาน",           en: "Reason / Staff"                 },
  item_col:            { th: "รายการ",                    en: "Item"                           },
  // misc
  loading: { th: "กำลังโหลด…", en: "Loading…" },
  qr_alert: { th: "ออเดอร์ QR ใหม่!", en: "New QR order!" },
  no_data: { th: "ไม่มีข้อมูล", en: "No data" },
  back: { th: "กลับ", en: "Back" },
  qr_codes: { th: "QR โต๊ะ", en: "Table QR" },
  qr_help: { th: "พิมพ์ QR วางบนโต๊ะ ลูกค้าสแกนแล้วสั่งจากมือถือ พนักงานยืนยันก่อนส่งครัว", en: "Print and place on tables. Customers scan to order from their phone; staff confirms before sending to kitchen." },
  print_all: { th: "พิมพ์ทั้งหมด", en: "Print all" },
  print: { th: "พิมพ์", en: "Print" },
};

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: keyof typeof dict) => string;
};

const I18nCtx = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("th");

  useEffect(() => {
    const stored = (typeof window !== "undefined" && localStorage.getItem("pos.lang")) as Lang | null;
    if (stored === "th" || stored === "en") setLangState(stored);
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    if (typeof window !== "undefined") localStorage.setItem("pos.lang", l);
  };

  const t = (key: keyof typeof dict) => dict[key]?.[lang] ?? String(key);

  return <I18nCtx.Provider value={{ lang, setLang, t }}>{children}</I18nCtx.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nCtx);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}

export function pickName(item: { name_th: string; name_en: string; name_my?: string }, lang: Lang) {
  return lang === "th" ? item.name_th : item.name_en;
}
