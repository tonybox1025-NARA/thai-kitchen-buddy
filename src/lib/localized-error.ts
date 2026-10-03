export type ErrorLanguage = "th" | "en";

export type ErrorContext =
  | "generic"
  | "load"
  | "save"
  | "print"
  | "order"
  | "staffTabLoad"
  | "staffTabStart"
  | "staffTabSettle"
  | "sendKitchen"
  | "combine"
  | "moveTable"
  | "payment"
  | "cashDrawer"
  | "member"
  | "closeShift"
  | "update"
  | "refund";

const thaiFallback: Record<ErrorContext, string> = {
  generic: "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง",
  load: "โหลดข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง",
  save: "บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง",
  print: "พิมพ์ไม่สำเร็จ กรุณาตรวจสอบเครื่องพิมพ์แล้วลองอีกครั้ง",
  order: "ดำเนินการออเดอร์ไม่สำเร็จ กรุณาลองอีกครั้ง",
  staffTabLoad: "โหลดบัญชีพนักงานไม่สำเร็จ กรุณาลองอีกครั้ง",
  staffTabStart: "เปิดบัญชีพนักงานไม่สำเร็จ กรุณาลองอีกครั้ง",
  staffTabSettle: "ชำระบัญชีพนักงานไม่สำเร็จ กรุณาลองอีกครั้ง",
  sendKitchen: "ส่งออเดอร์เข้าครัวไม่สำเร็จ กรุณาแตะเพื่อลองอีกครั้ง",
  combine: "รวมโต๊ะไม่สำเร็จ กรุณาลองอีกครั้ง",
  moveTable: "ย้ายโต๊ะไม่สำเร็จ กรุณาลองอีกครั้ง",
  payment: "บันทึกการชำระเงินไม่สำเร็จ กรุณาลองอีกครั้ง",
  cashDrawer: "บันทึกการชำระเงินแล้ว แต่ลิ้นชักเงินไม่เปิด",
  member: "ดำเนินการข้อมูลสมาชิกไม่สำเร็จ กรุณาลองอีกครั้ง",
  closeShift: "ปิดกะไม่สำเร็จ กรุณาลองอีกครั้ง",
  update: "อัปเดตไม่สำเร็จ กรุณาลองอีกครั้ง",
  refund: "คืนเงินไม่สำเร็จ กรุณาลองอีกครั้ง",
};

const englishFallback: Record<ErrorContext, string> = {
  generic: "Something went wrong. Please try again.",
  load: "Could not load data. Please try again.",
  save: "Could not save. Please try again.",
  print: "Print failed. Check the printer and try again.",
  order: "Could not complete the order action. Please try again.",
  staffTabLoad: "Could not load staff tabs. Please try again.",
  staffTabStart: "Could not start the staff tab. Please try again.",
  staffTabSettle: "Could not settle the staff tab. Please try again.",
  sendKitchen: "Could not send the order to the kitchen. Tap to retry.",
  combine: "Could not combine tables. Please try again.",
  moveTable: "Could not move the table. Please try again.",
  payment: "Could not save the payment. Please try again.",
  cashDrawer: "Payment was saved, but the cash drawer did not open.",
  member: "Could not update member information. Please try again.",
  closeShift: "Could not close the shift. Please try again.",
  update: "Update failed. Please try again.",
  refund: "Refund failed. Please try again.",
};

function rawMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "");
  }
  return "";
}

/**
 * POS-facing errors must follow the device language. English keeps useful
 * server detail; Thai never leaks an untranslated database/bridge message.
 */
export function localizeError(
  error: unknown,
  lang: ErrorLanguage,
  context: ErrorContext = "generic",
): string {
  const message = rawMessage(error).trim();
  if (lang === "en") return message || englishFallback[context];

  if (/no open shift|open (the )?register/i.test(message)) {
    return "กรุณาเปิดกะที่หน้าแคชเชียร์ก่อน";
  }
  if (/offline|failed to fetch|network|timeout|timed out|abort/i.test(message)) {
    return "การเชื่อมต่อขัดข้อง กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง";
  }
  if (/duplicate payment|already closed|already paid/i.test(message)) {
    return "ระบบป้องกันการชำระเงินซ้ำ กรุณาตรวจสอบยอดบิล";
  }
  if (/permission denied|not authorized|unauthorized|row-level security/i.test(message)) {
    return "ไม่มีสิทธิ์ดำเนินการ กรุณาเรียกผู้จัดการ";
  }
  if (/printer|print|bridge|port 9100|unreachable/i.test(message)) {
    return thaiFallback.print;
  }
  if (/cash drawer/i.test(message)) return thaiFallback.cashDrawer;

  return thaiFallback[context];
}
