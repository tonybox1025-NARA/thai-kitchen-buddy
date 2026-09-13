type CategoryRoute = {
  name_th?: string | null;
  name_en?: string | null;
};

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
  "เครื่องดื่มไอศกรีม",
  "แอลกอฮอล์",
]);

/** These categories are always prepared at the front counter. */
export function isFrontCounterCategory(category?: CategoryRoute | null) {
  if (!category) return false;
  const names = [category.name_en, category.name_th].map(normalize);
  return names.some((name) => FRONT_CATEGORY_TOKENS.has(name));
}
