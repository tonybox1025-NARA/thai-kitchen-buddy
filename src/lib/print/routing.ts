type CategoryRoute = {
  name_th?: string | null;
  name_en?: string | null;
};

const FRONT_CATEGORY_NAMES = new Set([
  "alcohol",
  "alcoholic drinks",
  "cooked rice / porridge",
  "cooked rice/porridge",
  "drink / ice cream",
  "drink/ice cream",
  "drinks",
  "drinks / ice cream",
  "drinks/ice cream",
  "snack",
  "snacks",
  "ข้าวสวย/ข้าวต้ม",
  "ของทานเล่น",
  "เครื่องดื่ม / ไอศกรีม",
  "เครื่องดื่ม/ไอศกรีม",
  "แอลกอฮอล์",
]);

const normalize = (value?: string | null) => value?.trim().toLowerCase() ?? "";

/** These categories are always prepared at the front counter. */
export function isFrontCounterCategory(category?: CategoryRoute | null) {
  return Boolean(category) && (
    FRONT_CATEGORY_NAMES.has(normalize(category?.name_en))
    || FRONT_CATEGORY_NAMES.has(normalize(category?.name_th))
  );
}
