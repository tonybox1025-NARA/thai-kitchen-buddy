import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const settings = read("src/routes/_app/settings.tsx");
const menuApi = read("src/routes/api/public/qr-menu.$tableCode.ts");
const orderApi = read("src/routes/api/public/qr-order.ts");
const sync = read("supabase/functions/sync-manager-catalog/index.ts");

const requireText = (source, text, label) => {
  if (!source.includes(text)) throw new Error(`Missing ${label}: ${text}`);
};

requireText(settings, "Staff POS sale", "separate POS availability control");
requireText(settings, "Customer QR menu", "separate customer QR control");
requireText(settings, "available_qr: payload.available_qr", "linked-menu QR persistence");
requireText(menuApi, '.eq("available_qr", true)', "QR menu visibility filter");
requireText(orderApi, "!m.available_qr", "server-side QR order visibility check");
requireText(sync, "item.target?.available_qr", "catalog publish visibility preservation");

console.log("Menu channel visibility regression checks passed.");
