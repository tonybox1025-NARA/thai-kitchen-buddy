export type SetItem = { id?: string; th: string; en: string; cost: number };

export type SetConfig = {
  set_id: string;
  main: SetItem;
  sides: SetItem[];
  drink?: SetItem;              // SET C only
  rice: "rice" | "porridge";
  rice_cost?: number;
};

export type SetDef = {
  id: string;
  menu_id?: string;
  price: number;
  name_th: string;
  name_en: string;
  mains: SetItem[];
  sides: SetItem[];
  sideMin?: number;
  sideMax?: number;
  hasDrink: boolean;
  drinks?: SetItem[];
  riceCosts?: Partial<Record<"rice" | "porridge", number>>;
};

export type SetItemRow = {
  set_menu_id: string;
  child_menu_id: string;
  quantity: number;
  group_key: string;
  group_name: string;
  min_select: number;
  max_select: number;
  sort_order: number;
  child: { id: string; name_th: string; name_en: string; cost?: number | null };
};

const cleanSetChildName = (value: string) => value.replace(/^\s*SET\s+/i, "").trim();

/** Build the POS selector directly from Manager-published SET rows. */
export function buildSetDef(
  parent: { id: string; name_th: string; name_en: string; price: number },
  rows: SetItemRow[],
): SetDef | null {
  if (rows.length === 0) return null;
  const group = (key: string) => rows.filter((row) => row.group_key.toLowerCase() === key);
  const toItem = (row: SetItemRow): SetItem => ({
    id: row.child.id,
    th: cleanSetChildName(row.child.name_th),
    en: cleanSetChildName(row.child.name_en || row.child.name_th),
    cost: Number(row.child.cost ?? 0) * Math.max(1, Number(row.quantity) || 1),
  });
  const mainRows = group("main");
  const sideRows = group("side");
  const drinkRows = group("drink");
  const riceRows = group("rice");
  if (mainRows.length === 0 || sideRows.length === 0) return null;
  const setCode = /set\s*([a-z0-9]+)/i.exec(`${parent.name_en} ${parent.name_th}`)?.[1]?.toUpperCase() ?? parent.id;
  const riceCosts: SetDef["riceCosts"] = {};
  for (const row of riceRows) {
    const name = `${row.child.name_th} ${row.child.name_en}`.toLowerCase();
    if (name.includes("ข้าวสวย") || name.includes("steamed")) riceCosts.rice = toItem(row).cost;
    if (name.includes("ข้าวต้ม") || name.includes("porridge")) riceCosts.porridge = toItem(row).cost;
  }
  return {
    id: setCode,
    menu_id: parent.id,
    price: Number(parent.price),
    name_th: parent.name_th,
    name_en: parent.name_en,
    mains: mainRows.map(toItem),
    sides: sideRows.map(toItem),
    sideMin: Number(sideRows[0]?.min_select ?? 1),
    sideMax: Number(sideRows[0]?.max_select ?? 2),
    hasDrink: drinkRows.length > 0,
    drinks: drinkRows.map(toItem),
    riceCosts,
  };
}

// cost = the SET (small-portion) child-menu food cost, in THB (from Manager catalog).
const GROUP_A_MAINS: SetItem[] = [
  { th: "ไข่เจียว", en: "Omelet", cost: 26.35 },
  { th: "กุนเชียงทอด", en: "Fried Chinese Sausage", cost: 24.37 },
];
const GROUP_B_MAINS: SetItem[] = [
  { th: "สามชั้นทอด", en: "Fried Pork Belly", cost: 26.66 },
  { th: "ปีกไก่ทอดน้ำปลา", en: "Crispy Fried Chicken with Fish Sauce", cost: 29.87 },
];
const GROUP_C_MAINS: SetItem[] = [
  { th: "หมูกรอบคั่วพริกเกลือ", en: "Crispy Pork with Chili Garlic and Salt", cost: 20.66 },
  { th: "ไก่ผัดเม็ดมะม่วง", en: "Stir Fried Chicken With Cashew Nuts", cost: 26.37 },
];
const GROUP_A_SIDES: SetItem[] = [
  { th: "ไชโป๊ผัดไข่", en: "Stir-fried Preserved Radish with Egg", cost: 15.07 },
  { th: "ผัดผักบุ้ง", en: "Stir-Fried Morning Glory", cost: 10.22 },
  { th: "กะหล่ำปลีผัดน้ำปลา", en: "Stir-Fried Cabbage with Fish Sauce", cost: 5.24 },
];
const GROUP_B_SIDES: SetItem[] = [
  { th: "ผักกาดดอง", en: "Pickled Mustard Greens", cost: 16.05 },
  { th: "ผัดวุ้นเส้นใส่ไข่", en: "Stir-Fried Glass Noodles with Egg", cost: 11.06 },
];
const GROUP_C_SIDES: SetItem[] = [
  { th: "ยำไข่เค็ม", en: "Salted Egg Spicy Salad", cost: 14.27 },
  { th: "ผัดผักรวม", en: "Stir-Fried Mixed Vegetables", cost: 13.82 },
];

// SET C drinks: no SET child-menu cost exists yet, so these are rough estimates
// (replace with real values once "SET <drink>" child menus are added in Manager).
export const SET_C_DRINKS: SetItem[] = [
  { th: "ชาไทยเย็น", en: "Thai Iced Tea", cost: 9 },
  { th: "โอเลี้ยง", en: "Thai Iced Coffee", cost: 9 },
  { th: "โซดามะนาว", en: "Lemon Soda", cost: 7 },
  { th: "น้ำเก๊กฮวย", en: "Chrysanthemum Tea", cost: 8 },
  { th: "น้ำส้ม", en: "Orange Juice", cost: 8 },
  { th: "น้ำเปล่าเย็น", en: "Cold Water", cost: 3 },
];

export const SETS: SetDef[] = [
  {
    id: "A", price: 99, name_th: "เซ็ต A", name_en: "SET A",
    mains: GROUP_A_MAINS,
    sides: GROUP_A_SIDES,
    sideMin: 2, sideMax: 2,
    hasDrink: false,
  },
  {
    id: "B", price: 139, name_th: "เซ็ต B", name_en: "SET B",
    mains: [...GROUP_A_MAINS, ...GROUP_B_MAINS],
    sides: [...GROUP_A_SIDES, ...GROUP_B_SIDES],
    sideMin: 2, sideMax: 2,
    hasDrink: false,
  },
  {
    id: "C", price: 199, name_th: "เซ็ต C", name_en: "SET C",
    mains: [...GROUP_A_MAINS, ...GROUP_B_MAINS, ...GROUP_C_MAINS],
    sides: [...GROUP_A_SIDES, ...GROUP_B_SIDES, ...GROUP_C_SIDES],
    sideMin: 2, sideMax: 2,
    hasDrink: true,
    drinks: SET_C_DRINKS,
  },
];

// SET (small-portion) cost of the rice choice, in THB.
const SET_RICE_COST: Record<"rice" | "porridge", number> = { rice: 3.85, porridge: 2.88 };

/**
 * Food cost of one chosen set = main + 2 sides + rice (+ drink for SET C),
 * using each component's small-portion (SET child menu) cost.
 * Returns THB rounded to 2 decimals.
 */
export function setConfigCost(cfg: SetConfig): number {
  const sum =
    (cfg.main?.cost ?? 0) +
    (cfg.sides?.[0]?.cost ?? 0) +
    (cfg.sides?.[1]?.cost ?? 0) +
    (cfg.rice_cost ?? SET_RICE_COST[cfg.rice] ?? 0) +
    (cfg.drink?.cost ?? 0);
  return Math.round(sum * 100) / 100;
}

// Look up a component's cost by its Thai name — used when only labels are
// available (e.g. a QR self-order set_config sent from the customer's device,
// which carries { th } labels but no cost).
const SET_COST_BY_TH: Map<string, number> = new Map(
  [
    ...GROUP_A_MAINS, ...GROUP_B_MAINS, ...GROUP_C_MAINS,
    ...GROUP_A_SIDES, ...GROUP_B_SIDES, ...GROUP_C_SIDES,
    ...SET_C_DRINKS,
  ].map((item) => [item.th, item.cost]),
);

/**
 * Food cost of a set described only by Thai labels (no per-item cost),
 * looking each component up by name. Same total as setConfigCost.
 */
export function setCostFromLabels(sc: {
  main?: { th?: string | null; cost?: number | null } | null;
  sides?: ({ th?: string | null; cost?: number | null } | null)[] | null;
  drink?: { th?: string | null; cost?: number | null } | null;
  rice?: string | null;
  rice_cost?: number | null;
}): number {
  let sum = 0;
  if (sc?.main?.th) sum += Number(sc.main.cost ?? SET_COST_BY_TH.get(sc.main.th) ?? 0);
  for (const side of sc?.sides ?? []) if (side?.th) sum += Number(side.cost ?? SET_COST_BY_TH.get(side.th) ?? 0);
  if (sc?.drink?.th) sum += Number(sc.drink.cost ?? SET_COST_BY_TH.get(sc.drink.th) ?? 0);
  if (sc?.rice === "rice" || sc?.rice === "porridge") sum += Number(sc.rice_cost ?? SET_RICE_COST[sc.rice] ?? 0);
  return Math.round(sum * 100) / 100;
}
