import fs from "node:fs";

const source = fs.readFileSync("src/routes/_app/live.tsx", "utf8");

const requireText = (text, label) => {
  if (!source.includes(text)) {
    throw new Error(`POS Live food-only top items is missing ${label}: ${text}`);
  }
};

requireText('select("menu_id,name_th,name_en,qty,voided_at")', "menu identity query");
requireText('select("id,category_id")', "menu category query");
requireText('select("id,name_th,name_en")', "category label query");
requireText("TOP_ITEM_NON_FOOD_CATEGORY_IDS", "stable non-food category exclusions");
requireText("TOP_ITEM_NON_FOOD_CATEGORY_TOKENS", "renamed-category fallback exclusions");
requireText("if (!isFoodTopItemCategory(category)) continue", "food-only aggregation guard");
requireText('"fdb7fca2-b2c2-44a9-82ac-74448575c9b6"', "rice and porridge exclusion");
requireText('"27d152e4-0841-473f-ba5b-c5cdff18b6c6"', "drinks exclusion");
requireText('"71257a4e-8929-4574-989c-8742ecb5b03d"', "beer exclusion");
requireText('"fe69f8a2-9fd7-415d-9035-e2b34ac4621e"', "dessert exclusion");

console.log("POS Live food-only top items regression guard passed.");
