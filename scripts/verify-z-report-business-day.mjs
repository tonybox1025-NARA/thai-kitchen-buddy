import fs from "node:fs";

const source = fs.readFileSync("src/lib/print/raster.ts", "utf8");

const checks = [
  [source.includes('if (p.report_type === "Z")'), "Z report must have its own date hierarchy"],
  [source.includes('d.text("SALES DATE / วันที่ขาย", S.bold, "center")'), "Z report must label the sales date explicitly"],
  [source.includes("d.text(fmtBusinessDay(p.business_day), S.xl, \"center\")"), "Z business day must be the large dominant date"],
  [source.includes("CLOSED / ปิดกะ:"), "post-midnight timestamp must be labeled as the close time"],
  [source.includes("return match ? `${match[3]}/${match[2]}/${match[1]}` : day"), "business day must print in unambiguous DD/MM/YYYY form"],
];

for (const [ok, message] of checks) {
  if (!ok) throw new Error(message);
}

console.log("Z report business-day hierarchy verified");
