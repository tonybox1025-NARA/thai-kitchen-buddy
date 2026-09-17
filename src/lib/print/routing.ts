type CategoryRoute = {
  id?: string | null;
  name_th?: string | null;
  name_en?: string | null;
};

const FRONT_CATEGORY_IDS = new Set([
  "fdb7fca2-b2c2-44a9-82ac-74448575c9b6", // Cooked Rice / Porridge
  "b177544e-db6a-4ed2-86b4-78674e4e40e2", // Snacks
  "7a73b072-789e-49b4-a061-e42a92ae5b3a", // Drinks / Ice Cream
  "ec4b9304-7672-4d83-8e4a-d8fd6240345e", // Alcohol
]);

const normalize = (value?: string | null) =>
  value
    ?.normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\s\p{P}]/gu, "") ?? "";

const FRONT_CATEGORY_TOKENS = new Set([
  "alcohol",
  "alcoholicdrinks",
  "cookedriceporridge",
  "drinkicecream",
  "drinks",
  "snack",
  "snacks",
  "ข้าวสวยข้าวต้ม",
  "ของทานเล่น",
  "ของหวานไอศกรีม",
  "น้ำแข็ง",
  "เบียร์",
  "วิสกี้บรั่นดี",
  "เครื่องดื่มไอศกรีม",
  "เครื่องดื่ม",
  "promotionsannouncements",
  "โปรโมชั่นเครื่องดื่ม",
  "โปรโมชั่นประกาศจากทางล้นหม้อ",
  "แอลกอฮอล์",
]);

/** These categories are always prepared at the front counter. */
export function isFrontCounterCategory(category?: CategoryRoute | null) {
  if (!category) return false;

  if (category.id && FRONT_CATEGORY_IDS.has(category.id.toLowerCase())) {
    return true;
  }

  const names = [category.name_en, category.name_th].map(normalize);
  return names.some((name) => FRONT_CATEGORY_TOKENS.has(name));
}
