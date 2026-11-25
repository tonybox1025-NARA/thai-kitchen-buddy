import fs from "node:fs";

const raster = fs.readFileSync("src/lib/print/raster.ts", "utf8");
const posOrder = fs.readFileSync("src/routes/_app/order.$orderId.tsx", "utf8");
const qrOrder = fs.readFileSync("src/routes/api/public/qr-order.ts", "utf8");

const checks = [
  [raster.includes("set_config?:"), "ticket payload carries structured SET choices"],
  [raster.includes("set ? S.setTitle : S.item"), "SET parent name is larger than an ordinary menu item"],
  [raster.includes('d.textIndented(`└ ${child.label}`'), "SET choices use an indented branch label"],
  [raster.includes("S.setDish, 58"), "Thai SET dish names receive the strong indented style"],
  [raster.includes("S.setEnglish, 58"), "English SET dish names remain subordinate"],
  [raster.includes('d.textIndented("เพิ่ม / ADD-ON"'), "add-ons have a visible bilingual heading"],
  [raster.includes("addon: { size: SIZE.addon, bold: false }"), "add-on menu text and price remain regular weight"],
  [raster.includes("d.addon(`${on}${qs}`, ps)"), "add-ons use the large-plus layout with separate price"],
  [raster.includes("ctx.fillText(right, WIDTH - PAD_X"), "add-on price stays right-aligned"],
  [raster.includes("if (my && my !== th) d.text(my, S.myBold)"), "Myanmar main-menu line remains printed"],
  [posOrder.includes("set_config: sc"), "staff POS tickets carry SET choices"],
  [posOrder.includes("set_config: item.set_config ?? null"), "counter reprints carry SET choices"],
  [qrOrder.includes("set_config: entry.row.set_config"), "customer QR tickets carry SET choices"],
];

const failures = checks.filter(([ok]) => !ok).map(([, label]) => label);
if (failures.length) {
  console.error(`Kitchen ticket hierarchy regression failed: ${failures.join(", ")}`);
  process.exit(1);
}

console.log("Kitchen ticket hierarchy regression guard passed.");
