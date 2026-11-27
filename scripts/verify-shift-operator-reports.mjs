import fs from "node:fs";

const register = fs.readFileSync("src/routes/_app/register.tsx", "utf8");
const reports = fs.readFileSync("src/routes/_app/reports.tsx", "utf8");
const picker = fs.readFileSync("src/components/ShiftOperatorPicker.tsx", "utf8");
const close = fs.readFileSync("src/lib/shift-close.ts", "utf8");
const raster = fs.readFileSync("src/lib/print/raster.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/20261127120000_shift_operator_names.sql", "utf8");

const checks = [
  [picker.includes('["THA", "GIFT", "TANNIE", "JAY", "TONY"]'), "operator picker must expose exactly the approved five names"],
  [register.includes('openStep === "operator"') && reports.includes('openStep === "operator"'), "opening workflow must select the employee before cash counting"],
  [register.includes("closeOperatorDlg") && reports.includes("closeOperatorDlg"), "Z workflow must select the closing employee first"],
  [close.includes("p_operator_name: args.operatorName"), "shift RPC calls must persist the selected employee"],
  [migration.includes("opened_operator_name") && migration.includes("closed_operator_name"), "migration must retain both opening and closing employees"],
  [raster.includes('p.report_type === "OPEN" || p.report_type === "Z"') && raster.includes("operator_name"), "OPEN and Z thermal reports must print the employee"],
  [reports.includes("shift.closed_operator_name"), "historical Z reprints must retain the saved closing employee"],
];

const failed = checks.filter(([ok]) => !ok);
if (failed.length) {
  for (const [, message] of failed) console.error(`FAIL: ${message}`);
  process.exit(1);
}

console.log("Shift operator report guard passed.");
