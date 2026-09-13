export type SetItem = { th: string; en: string; cost: number };

export type SetConfig = {
  set_id: "A" | "B" | "C";
  main: SetItem;
  sides: [SetItem, SetItem];   // exactly 2
  drink?: SetItem;              // SET C only
  rice: "rice" | "porridge";
};

export type SetDef = {
  id: "A" | "B" | "C";
  price: number;
  name_th: string;
  name_en: string;
  mains: SetItem[];
  sides: SetItem[];
  hasDrink: boolean;
};

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
    hasDrink: false,
  },
  {
    id: "B", price: 139, name_th: "เซ็ต B", name_en: "SET B",
    mains: [...GROUP_A_MAINS, ...GROUP_B_MAINS],
    sides: [...GROUP_A_SIDES, ...GROUP_B_SIDES],
    hasDrink: false,
  },
  {
    id: "C", price: 199, name_th: "เซ็ต C", name_en: "SET C",
    mains: [...GROUP_A_MAINS, ...GROUP_B_MAINS, ...GROUP_C_MAINS],
    sides: [...GROUP_A_SIDES, ...GROUP_B_SIDES, ...GROUP_C_SIDES],
    hasDrink: true,
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
    (SET_RICE_COST[cfg.rice] ?? 0) +
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
  main?: { th?: string | null } | null;
  sides?: ({ th?: string | null } | null)[] | null;
  drink?: { th?: string | null } | null;
  rice?: string | null;
}): number {
  let sum = 0;
  if (sc?.main?.th) sum += SET_COST_BY_TH.get(sc.main.th) ?? 0;
  for (const side of sc?.sides ?? []) if (side?.th) sum += SET_COST_BY_TH.get(side.th) ?? 0;
  if (sc?.drink?.th) sum += SET_COST_BY_TH.get(sc.drink.th) ?? 0;
  if (sc?.rice === "rice" || sc?.rice === "porridge") sum += SET_RICE_COST[sc.rice] ?? 0;
  return Math.round(sum * 100) / 100;
}
