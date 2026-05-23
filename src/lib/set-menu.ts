export type SetItem = { th: string; en: string };

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

const GROUP_A_MAINS: SetItem[] = [
  { th: "ไข่เจียว", en: "Omelet" },
  { th: "กุนเชียงทอด", en: "Fried Chinese Sausage" },
];
const GROUP_B_MAINS: SetItem[] = [
  { th: "สามชั้นทอด", en: "Fried Pork Belly" },
  { th: "ปีกไก่ทอดน้ำปลา", en: "Crispy Fried Chicken with Fish Sauce" },
];
const GROUP_C_MAINS: SetItem[] = [
  { th: "หมูกรอบคั่วพริกเกลือ", en: "Crispy Pork with Chili Garlic and Salt" },
  { th: "ไก่ผัดเม็ดมะม่วง", en: "Stir Fried Chicken With Cashew Nuts" },
];
const GROUP_A_SIDES: SetItem[] = [
  { th: "ไชโป๊ผัดไข่", en: "Stir-fried Preserved Radish with Egg" },
  { th: "ผัดผักบุ้ง", en: "Stir-Fried Morning Glory" },
  { th: "กะหล่ำปลีผัดน้ำปลา", en: "Stir-Fried Cabbage with Fish Sauce" },
];
const GROUP_B_SIDES: SetItem[] = [
  { th: "ผักกาดดอง", en: "Pickled Mustard Greens" },
  { th: "ผัดวุ้นเส้นใส่ไข่", en: "Stir-Fried Glass Noodles with Egg" },
];
const GROUP_C_SIDES: SetItem[] = [
  { th: "ยำไข่เค็ม", en: "Salted Egg Spicy Salad" },
  { th: "ผัดผักรวม", en: "Stir-Fried Mixed Vegetables" },
];

export const SET_C_DRINKS: SetItem[] = [
  { th: "ชาไทยเย็น", en: "Thai Iced Tea" },
  { th: "โอเลี้ยง", en: "Thai Iced Coffee" },
  { th: "โซดามะนาว", en: "Lemon Soda" },
  { th: "น้ำเก๊กฮวย", en: "Chrysanthemum Tea" },
  { th: "น้ำส้ม", en: "Orange Juice" },
  { th: "น้ำเปล่าเย็น", en: "Cold Water" },
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
