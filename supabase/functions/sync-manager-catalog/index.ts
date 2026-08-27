import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-catalog-sync-key" };
const normalize = (value: string) => String(value || "").normalize("NFKC").toLocaleLowerCase("th")
  .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "").replace(/[\s\-–—_/().]+/g, "").trim();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const expectedKey = Deno.env.get("POS_CATALOG_SYNC_SECRET");
    if (!expectedKey || req.headers.get("X-Catalog-Sync-Key") !== expectedKey) throw new Error("Unauthorized catalog sync");
    const { execute = false, catalog } = await req.json();
    if (!catalog || !Array.isArray(catalog.menus)) throw new Error("Invalid catalog payload");
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
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
    for (const [index, name] of categoryNames.entries()) {
      const target = categoryByName.get(normalize(name));
      const source: any = sourceCategoryByName.get(normalize(name));
      const id = target?.id ?? crypto.randomUUID();
      const payload = { id, name_th: name, name_en: source?.name_en || name, name_my: "", sort: source?.sort_order ?? index };
      const { error } = target ? await db.from("categories").update(payload).eq("id", id) : await db.from("categories").insert(payload);
      if (error) throw error;
      categoryIdByName.set(normalize(name), id);
    }
    const menuMappings: Array<{ managerId: string; posId: string }> = [];
    for (const [index, item] of menuPlan.entries()) {
      const menu = item.source;
      const id = item.target?.id ?? crypto.randomUUID();
      const payload = { id, category_id: categoryIdByName.get(normalize(menu.category || "ทั่วไป")) ?? null, name_th: menu.name_th, name_en: menu.name_en || "", name_my: menu.name_my || menu.kitchen_name_my || "", price: Number(menu.selling_price), image_url: menu.image_url || null, available: menu.is_active !== false && menu.available_pos !== false, sort: menu.sort_order ?? index };
      const { error } = item.target ? await db.from("menus").update(payload).eq("id", id) : await db.from("menus").insert(payload);
      if (error) throw error;
      menuMappings.push({ managerId: menu.id, posId: id });
    }
    const groupByName = new Map((groupsResult.data ?? []).map((group) => [normalize(group.name), group]));
    const posGroupIdByManagerId = new Map<string, string>();
    for (const group of catalog.addonGroups ?? []) {
      const target = groupByName.get(normalize(group.name_th));
      const id = target?.id ?? crypto.randomUUID();
      const payload = { id, name: group.name_th, kitchen_name: group.kitchen_name_my || group.name_my || group.name_th };
      const { error } = target ? await db.from("addon_groups").update(payload).eq("id", id) : await db.from("addon_groups").insert(payload);
      if (error) throw error;
      posGroupIdByManagerId.set(group.id, id);
    }
    for (const group of catalog.addonGroups ?? []) {
      const groupId = posGroupIdByManagerId.get(group.id)!;
      const existing = (optionsResult.data ?? []).filter((option) => option.addon_group_id === groupId);
      const byName = new Map(existing.map((option) => [normalize(option.name), option]));
      for (const [index, option] of (catalog.addonOptions ?? []).filter((row: any) => row.group_id === group.id).entries()) {
        const target = byName.get(normalize(option.name_th));
        const id = target?.id ?? crypto.randomUUID();
        const payload = { id, addon_group_id: groupId, name: option.name_th, price: Number(option.price), sort_order: option.sort_order ?? index };
        const { error } = target ? await db.from("addon_options").update(payload).eq("id", id) : await db.from("addon_options").insert(payload);
        if (error) throw error;
      }
    }
    const posMenuIdByManagerId = new Map(menuMappings.map((mapping) => [mapping.managerId, mapping.posId]));
    for (const [managerMenuId, posMenuId] of posMenuIdByManagerId) {
      const { error: deleteError } = await db.from("menu_addons").delete().eq("menu_id", posMenuId);
      if (deleteError) throw deleteError;
      const links = (catalog.menuAddons ?? []).filter((link: any) => link.menu_id === managerMenuId)
        .map((link: any) => ({ menu_id: posMenuId, group_id: posGroupIdByManagerId.get(link.group_id) })).filter((link: any) => Boolean(link.group_id));
      if (links.length > 0) { const { error } = await db.from("menu_addons").insert(links); if (error) throw error; }
    }
    return Response.json({ mode: "published", summary, menuMappings }, { headers: corsHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400, headers: corsHeaders });
  }
});
