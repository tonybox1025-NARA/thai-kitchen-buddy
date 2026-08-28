import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-catalog-sync-key" };
const normalize = (value: string) => String(value || "").normalize("NFKC").toLocaleLowerCase("th")
  .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "").replace(/[\s\-–—_/().]+/g, "").trim();

const errorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const value = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    return [value.message, value.details, value.hint, value.code].filter(Boolean).join(" | ") || JSON.stringify(error);
  }
  return String(error);
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const expectedKey = Deno.env.get("POS_CATALOG_SYNC_SECRET");
    if (!expectedKey || req.headers.get("X-Catalog-Sync-Key") !== expectedKey) throw new Error("Unauthorized catalog sync");
    const { execute = false, catalog } = await req.json();
    if (!catalog || !Array.isArray(catalog.menus)) throw new Error("Invalid catalog payload");
    // Prefer Supabase's current non-JWT secret key. The legacy service-role JWT
    // can be rejected by PostgREST with PGRST303 when platform clocks differ.
    const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    const adminKey = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!adminKey) throw new Error("Missing POS database admin key");
    const db = createClient(Deno.env.get("SUPABASE_URL")!, adminKey, { auth: { persistSession: false } });
    const [menusResult, categoriesResult, groupsResult, optionsResult] = await Promise.all([
      db.from("menus").select("id,name_th,name_en,name_my,price,image_url,available,category_id,sort"),
      db.from("categories").select("id,name_th,name_en,name_my,sort"),
      db.from("addon_groups").select("id,name,kitchen_name"),
      db.from("addon_options").select("id,addon_group_id,name,price,sort_order"),
    ]);
    for (const result of [menusResult, categoriesResult, groupsResult, optionsResult]) if (result.error) throw result.error;
    const posMenus = menusResult.data ?? [];
    const menuById = new Map(posMenus.map((menu) => [menu.id, menu]));
    const menuByName = new Map(posMenus.map((menu) => [normalize(menu.name_th), menu]));
    const posCategories = categoriesResult.data ?? [];
    const categoryByName = new Map(posCategories.map((category) => [normalize(category.name_th), category]));
    const sourceCategoryByName = new Map((catalog.categories ?? []).map((category: any) => [normalize(category.name_th), category]));
    const categoryNames = [...new Set(catalog.menus.map((menu: any) => menu.category || "ทั่วไป"))] as string[];
    const menuPlan = catalog.menus.map((menu: any) => {
      const target = (menu.pos_menu_id && menuById.get(menu.pos_menu_id)) || menuByName.get(normalize(menu.name_th)) || null;
      const changed = !target || target.name_en !== (menu.name_en || "") || target.name_my !== (menu.name_my || "")
        || Number(target.price) !== Number(menu.selling_price) || target.image_url !== (menu.image_url || null)
        || target.available !== (menu.is_active !== false && menu.available_pos !== false);
      return { source: menu, target, action: !target ? "create" : changed ? "update" : "same" };
    });
    const summary = {
      menus: { total: menuPlan.length, create: menuPlan.filter((item: any) => item.action === "create").length, update: menuPlan.filter((item: any) => item.action === "update").length, same: menuPlan.filter((item: any) => item.action === "same").length },
      categories: { total: categoryNames.length, create: categoryNames.filter((name) => !categoryByName.has(normalize(name))).length },
      addons: { groups: (catalog.addonGroups ?? []).length, options: (catalog.addonOptions ?? []).length, links: (catalog.menuAddons ?? []).length },
    };
    if (!execute) return Response.json({ mode: "preview", summary }, { headers: corsHeaders });

    const categoryIdByName = new Map<string, string>();
    const categoryRows: any[] = [];
    for (const [index, name] of categoryNames.entries()) {
      const target = categoryByName.get(normalize(name));
      const source: any = sourceCategoryByName.get(normalize(name));
      const id = target?.id ?? crypto.randomUUID();
      categoryRows.push({ id, name_th: name, name_en: source?.name_en || name, name_my: target?.name_my || "", sort: source?.sort_order ?? index });
      categoryIdByName.set(normalize(name), id);
    }
    if (categoryRows.length > 0) {
      const { error } = await db.from("categories").upsert(categoryRows, { onConflict: "id" });
      if (error) throw error;
    }

    const menuMappings: Array<{ managerId: string; posId: string }> = [];
    const menuRows: any[] = [];
    for (const [index, item] of menuPlan.entries()) {
      const menu = item.source;
      const id = item.target?.id ?? crypto.randomUUID();
      menuRows.push({ id, category_id: categoryIdByName.get(normalize(menu.category || "ทั่วไป")) ?? null, name_th: menu.name_th, name_en: menu.name_en || "", name_my: menu.name_my || menu.kitchen_name_my || "", price: Number(menu.selling_price), image_url: menu.image_url || null, available: menu.is_active !== false && menu.available_pos !== false, sort: menu.sort_order ?? index });
      menuMappings.push({ managerId: menu.id, posId: id });
    }
    if (menuRows.length > 0) {
      const { error } = await db.from("menus").upsert(menuRows, { onConflict: "id" });
      if (error) throw error;
    }

    const groupByName = new Map((groupsResult.data ?? []).map((group) => [normalize(group.name), group]));
    const posGroupIdByManagerId = new Map<string, string>();
    const groupRows: any[] = [];
    for (const group of catalog.addonGroups ?? []) {
      const target = groupByName.get(normalize(group.name_th));
      const id = target?.id ?? crypto.randomUUID();
      groupRows.push({ id, name: group.name_th, kitchen_name: group.kitchen_name_my || group.name_my || group.name_th });
      posGroupIdByManagerId.set(group.id, id);
    }
    if (groupRows.length > 0) {
      const { error } = await db.from("addon_groups").upsert(groupRows, { onConflict: "id" });
      if (error) throw error;
    }

    const optionRows: any[] = [];
    for (const group of catalog.addonGroups ?? []) {
      const groupId = posGroupIdByManagerId.get(group.id)!;
      const existing = (optionsResult.data ?? []).filter((option) => option.addon_group_id === groupId);
      const byName = new Map(existing.map((option) => [normalize(option.name), option]));
      for (const [index, option] of (catalog.addonOptions ?? []).filter((row: any) => row.group_id === group.id).entries()) {
        const target = byName.get(normalize(option.name_th));
        const id = target?.id ?? crypto.randomUUID();
        optionRows.push({ id, addon_group_id: groupId, name: option.name_th, price: Number(option.price), sort_order: option.sort_order ?? index });
      }
    }
    if (optionRows.length > 0) {
      const { error } = await db.from("addon_options").upsert(optionRows, { onConflict: "id" });
      if (error) throw error;
    }

    const posMenuIdByManagerId = new Map(menuMappings.map((mapping) => [mapping.managerId, mapping.posId]));
    const synchronizedMenuIds = [...posMenuIdByManagerId.values()];
    if (synchronizedMenuIds.length > 0) {
      const { error: deleteError } = await db.from("menu_addons").delete().in("menu_id", synchronizedMenuIds);
      if (deleteError) throw deleteError;
    }
    const linkRows = (catalog.menuAddons ?? []).map((link: any) => ({
      menu_id: posMenuIdByManagerId.get(link.menu_id),
      group_id: posGroupIdByManagerId.get(link.group_id),
    })).filter((link: any) => Boolean(link.menu_id && link.group_id));
    if (linkRows.length > 0) {
      const { error } = await db.from("menu_addons").insert(linkRows);
      if (error) throw error;
    }
    return Response.json({ mode: "published", summary, menuMappings }, { headers: corsHeaders });
  } catch (error) {
    const message = errorMessage(error);
    console.error("sync-manager-catalog failed:", message);
    return Response.json({ error: message }, { status: 400, headers: corsHeaders });
  }
});
