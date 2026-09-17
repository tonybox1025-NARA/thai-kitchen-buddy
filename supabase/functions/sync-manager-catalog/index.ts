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

const uniqueByNormalizedName = <T>(rows: T[], getName: (row: T) => string) => {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = normalize(getName(row));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const expectedKey = Deno.env.get("POS_CATALOG_SYNC_SECRET");
    if (!expectedKey || req.headers.get("X-Catalog-Sync-Key") !== expectedKey) throw new Error("Unauthorized catalog sync");
    const { execute = false, catalog } = await req.json();
    if (!catalog || !Array.isArray(catalog.menus)) throw new Error("Invalid catalog payload");
    const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    const adminKey = secretKeys.default;
    if (!adminKey || !adminKey.startsWith("sb_secret_")) throw new Error("Missing POS sb_secret database key");
    const apiKeyOnlyFetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      // New secret keys belong in `apikey` only. Sending one as Bearer makes
      // the gateway parse it as a JWT and can surface PGRST303.
      headers.delete("Authorization");
      return fetch(input, { ...init, headers });
    };
    const db = createClient(Deno.env.get("SUPABASE_URL")!, adminKey, {
      auth: { persistSession: false },
      global: { fetch: apiKeyOnlyFetch },
    });
    const [menusResult, categoriesResult, groupsResult, optionsResult, menuIngredientsResult] = await Promise.all([
      db.from("menus").select("id,manager_menu_id,name_th,name_en,name_my,price,cost,image_url,available,category_id,sort,is_set,is_set_child"),
      db.from("categories").select("id,name_th,name_en,name_my,sort"),
      db.from("addon_groups").select("id,name,kitchen_name"),
      db.from("addon_options").select("id,addon_group_id,name,price,sort_order"),
      db.from("menu_ingredients").select("menu_id"),
    ]);
    for (const result of [menusResult, categoriesResult, groupsResult, optionsResult, menuIngredientsResult]) if (result.error) throw result.error;
    const posMenus = menusResult.data ?? [];
    const menuById = new Map(posMenus.map((menu) => [menu.id, menu]));
    const menuByManagerId = new Map(posMenus.filter((menu) => menu.manager_menu_id).map((menu) => [menu.manager_menu_id, menu]));
    const menuByName = new Map(posMenus.map((menu) => [normalize(menu.name_th), menu]));
    const posCategories = categoriesResult.data ?? [];
    const categoryByName = new Map(posCategories.map((category) => [normalize(category.name_th), category]));
    const sourceCategoryByName = new Map((catalog.categories ?? []).map((category: any) => [normalize(category.name_th), category]));
    const categoryNames = uniqueByNormalizedName(
      catalog.menus.map((menu: any) => menu.category || "ทั่วไป") as string[],
      (name) => name,
    );
    const claimedMenuIds = new Set<string>();
    const explicitTargets = new Map<string, any>();
    for (const menu of catalog.menus) {
      const target = menuByManagerId.get(menu.id) || (menu.pos_menu_id ? menuById.get(menu.pos_menu_id) : null);
      if (target && !claimedMenuIds.has(target.id)) {
        explicitTargets.set(menu.id, target);
        claimedMenuIds.add(target.id);
      }
    }
    const menuPlan = catalog.menus.map((menu: any) => {
      let target = explicitTargets.get(menu.id) || null;
      if (!target) {
        const nameTarget = menuByName.get(normalize(menu.name_th));
        if (nameTarget && !claimedMenuIds.has(nameTarget.id)) {
          target = nameTarget;
          claimedMenuIds.add(nameTarget.id);
        }
      }
      const sellable = menu.is_active !== false && menu.available_pos !== false && menu.is_set_child !== true;
      const changed = !target || target.name_th !== menu.name_th || target.name_en !== (menu.name_en || "") || target.name_my !== (menu.name_my || menu.kitchen_name_my || "")
        || Number(target.price) !== Number(menu.selling_price) || Math.abs(Number(target.cost ?? 0) - Number(menu.food_cost ?? 0)) >= 0.005
        || target.image_url !== (menu.image_url || null)
        || target.available !== sellable || target.sort !== (menu.sort_order ?? 0)
        || target.is_set !== (menu.is_set === true) || target.is_set_child !== (menu.is_set_child === true);
      // SET children are intentionally hidden from sale, but they still need a
      // POS row so the Manager's set composition can reference them.
      return { source: menu, target, action: !target && !sellable && menu.is_set_child !== true ? "skip" : !target ? "create" : changed ? "update" : "same" };
    });
    const costChanges = menuPlan
      .filter((item: any) => item.target && Math.abs(Number(item.target.cost ?? 0) - Number(item.source.food_cost ?? 0)) >= 0.005)
      .map((item: any) => ({
        name: item.source.name_th,
        before: Number(item.target.cost ?? 0),
        after: Number(item.source.food_cost ?? 0),
        available: item.source.is_active !== false && item.source.available_pos !== false && item.source.is_set_child !== true,
      }));
    const sellableCostChanges = costChanges.filter((item: any) => item.available);
    // Check the complete incoming catalog, not only rows that already have a
    // POS target. After a clean reset every menu is new, so a change-only check
    // would otherwise miss zero-cost recipes entirely. SET parents are excluded
    // because their cost is calculated from the customer's selected children.
    const zeroCostSellableMenus = menuPlan
      .filter((item: any) => item.source.is_active !== false
        && item.source.available_pos !== false
        && item.source.is_set_child !== true
        && item.source.is_set !== true
        && Number(item.source.food_cost ?? 0) === 0)
      .map((item: any) => item.source.name_th);
    const managerLinkedTargets = new Map(
      menuPlan.filter((item: any) => item.target).map((item: any) => [item.target.id, item.source.name_th]),
    );
    const legacyIngredientCounts = new Map<string, number>();
    for (const row of menuIngredientsResult.data ?? []) {
      if (!managerLinkedTargets.has(row.menu_id)) continue;
      legacyIngredientCounts.set(row.menu_id, (legacyIngredientCounts.get(row.menu_id) ?? 0) + 1);
    }
    const legacyIngredientMenus = [...legacyIngredientCounts.entries()].map(([menuId, rows]) => ({
      name: managerLinkedTargets.get(menuId) ?? menuId,
      rows,
    })).sort((a, b) => b.rows - a.rows || a.name.localeCompare(b.name, "th"));
    const summary = {
      menus: { total: menuPlan.length, create: menuPlan.filter((item: any) => item.action === "create").length, update: menuPlan.filter((item: any) => item.action === "update").length, same: menuPlan.filter((item: any) => item.action === "same").length, skipped: menuPlan.filter((item: any) => item.action === "skip").length },
      categories: { total: categoryNames.length, create: categoryNames.filter((name) => !categoryByName.has(normalize(name))).length },
      addons: { groups: (catalog.addonGroups ?? []).length, options: (catalog.addonOptions ?? []).length, links: (catalog.menuAddons ?? []).length },
      sets: {
        parents: new Set((catalog.setItems ?? []).map((item: any) => item.set_menu_id)).size,
        items: (catalog.setItems ?? []).length,
        unresolved: (catalog.setItems ?? []).filter((item: any) =>
          !catalog.menus.some((menu: any) => menu.id === item.set_menu_id)
          || !catalog.menus.some((menu: any) => menu.id === item.child_menu_id)
        ).length,
      },
      costs: {
        changed: costChanges.length,
        sellableChanged: sellableCostChanges.length,
        increased: sellableCostChanges.filter((item: any) => item.after > item.before).length,
        decreased: sellableCostChanges.filter((item: any) => item.after < item.before).length,
        zero: zeroCostSellableMenus.length,
        zeroMenus: zeroCostSellableMenus,
        topDifferences: sellableCostChanges
          .sort((a: any, b: any) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before))
          .slice(0, 10),
        legacyPosIngredients: {
          menus: legacyIngredientMenus.length,
          rows: legacyIngredientMenus.reduce((sum, item) => sum + item.rows, 0),
          affectedMenus: legacyIngredientMenus,
        },
      },
    };
    if (!execute) return Response.json({ mode: "preview", summary }, { headers: corsHeaders });
    if (summary.sets.unresolved > 0) {
      throw new Error(`Catalog publish blocked: ${summary.sets.unresolved} SET item link(s) cannot be resolved`);
    }
    if (summary.costs.zero > 0) {
      throw new Error(`Catalog publish blocked: ${summary.costs.zero} sellable menu(s) would change to zero food cost: ${summary.costs.zeroMenus.join(", ")}`);
    }

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
      if (error) throw new Error(`categories upsert: ${errorMessage(error)}`);
    }

    const menuMappings: Array<{ managerId: string; posId: string }> = [];
    const menuRows: any[] = [];
    for (const [index, item] of menuPlan.entries()) {
      if (item.action === "skip") continue;
      const menu = item.source;
      const id = item.target?.id ?? crypto.randomUUID();
      menuRows.push({
        id,
        manager_menu_id: menu.id,
        category_id: categoryIdByName.get(normalize(menu.category || "ทั่วไป")) ?? null,
        name_th: menu.name_th,
        name_en: menu.name_en || "",
        name_my: menu.name_my || menu.kitchen_name_my || "",
        price: Number(menu.selling_price),
        cost: Number(menu.food_cost ?? 0),
        image_url: menu.image_url || null,
        available: menu.is_active !== false && menu.available_pos !== false && menu.is_set_child !== true,
        is_set: menu.is_set === true,
        is_set_child: menu.is_set_child === true,
        sort: menu.sort_order ?? index,
      });
      menuMappings.push({ managerId: menu.id, posId: id });
    }
    if (menuRows.length > 0) {
      const { error } = await db.from("menus").upsert(menuRows, { onConflict: "id" });
      if (error) throw new Error(`menus upsert: ${errorMessage(error)}`);
    }

    const groupByName = new Map((groupsResult.data ?? []).map((group) => [normalize(group.name), group]));
    const posGroupIdByManagerId = new Map<string, string>();
    const groupRowsById = new Map<string, any>();
    for (const group of catalog.addonGroups ?? []) {
      const target = groupByName.get(normalize(group.name_th));
      const id = target?.id ?? crypto.randomUUID();
      groupRowsById.set(id, { id, name: group.name_th, kitchen_name: group.kitchen_name_my || group.name_my || group.name_th });
      posGroupIdByManagerId.set(group.id, id);
    }
    const groupRows = [...groupRowsById.values()];
    if (groupRows.length > 0) {
      const { error } = await db.from("addon_groups").upsert(groupRows, { onConflict: "id" });
      if (error) throw new Error(`addon groups upsert: ${errorMessage(error)}`);
    }

    const optionRowsById = new Map<string, any>();
    for (const group of catalog.addonGroups ?? []) {
      const groupId = posGroupIdByManagerId.get(group.id)!;
      const existing = (optionsResult.data ?? []).filter((option) => option.addon_group_id === groupId);
      const byName = new Map(existing.map((option) => [normalize(option.name), option]));
      for (const [index, option] of (catalog.addonOptions ?? []).filter((row: any) => row.group_id === group.id).entries()) {
        const target = byName.get(normalize(option.name_th));
        const id = target?.id ?? crypto.randomUUID();
        optionRowsById.set(id, { id, addon_group_id: groupId, name: option.name_th, price: Number(option.price), sort_order: option.sort_order ?? index });
      }
    }
    const optionRows = [...optionRowsById.values()];
    if (optionRows.length > 0) {
      const { error } = await db.from("addon_options").upsert(optionRows, { onConflict: "id" });
      if (error) throw new Error(`addon options upsert: ${errorMessage(error)}`);
    }

    const posMenuIdByManagerId = new Map(menuMappings.map((mapping) => [mapping.managerId, mapping.posId]));

    const setParentIds = [...new Set((catalog.setItems ?? [])
      .map((item: any) => posMenuIdByManagerId.get(item.set_menu_id))
      .filter(Boolean))] as string[];
    if (setParentIds.length > 0) {
      const { error } = await db.from("menu_set_items").delete().in("set_menu_id", setParentIds);
      if (error) throw new Error(`set items delete: ${errorMessage(error)}`);
    }
    const setRows = (catalog.setItems ?? []).flatMap((item: any) => {
      const setMenuId = posMenuIdByManagerId.get(item.set_menu_id);
      const childMenuId = posMenuIdByManagerId.get(item.child_menu_id);
      if (!setMenuId || !childMenuId) return [];
      return [{
        manager_set_item_id: item.id,
        set_menu_id: setMenuId,
        child_menu_id: childMenuId,
        quantity: Math.max(1, Number(item.quantity) || 1),
        group_key: item.group_key || "items",
        group_name: item.group_name || "Items",
        min_select: Math.max(0, Number(item.min_select) || 0),
        max_select: Math.max(1, Number(item.max_select) || 1),
        sort_order: Number(item.sort_order) || 0,
      }];
    });
    if (setRows.length > 0) {
      const { error } = await db.from("menu_set_items").insert(setRows);
      if (error) throw new Error(`set items insert: ${errorMessage(error)}`);
    }

    // An empty Manager add-on catalog means "not managed there yet", not
    // "erase every POS option". Preserve existing POS links until Manager has
    // at least one complete add-on definition to publish.
    const hasAddonCatalog = (catalog.addonGroups ?? []).length > 0
      || (catalog.addonOptions ?? []).length > 0
      || (catalog.menuAddons ?? []).length > 0;
    if (hasAddonCatalog) {
      const synchronizedMenuIds = [...posMenuIdByManagerId.values()];
      if (synchronizedMenuIds.length > 0) {
        const { error: deleteError } = await db.from("menu_addons").delete().in("menu_id", synchronizedMenuIds);
        if (deleteError) throw deleteError;
      }
      const linkRowsByKey = new Map<string, { menu_id: string; group_id: string }>();
      for (const link of catalog.menuAddons ?? []) {
        const menuId = posMenuIdByManagerId.get(link.menu_id);
        const groupId = posGroupIdByManagerId.get(link.group_id);
        if (menuId && groupId) linkRowsByKey.set(`${menuId}:${groupId}`, { menu_id: menuId, group_id: groupId });
      }
      const linkRows = [...linkRowsByKey.values()];
      if (linkRows.length > 0) {
        const { error } = await db.from("menu_addons").insert(linkRows);
        if (error) throw error;
      }
    }
    return Response.json({ mode: "published", summary, menuMappings }, { headers: corsHeaders });
  } catch (error) {
    const message = errorMessage(error);
    console.error("sync-manager-catalog failed:", message);
    return Response.json({ error: message }, { status: 400, headers: corsHeaders });
  }
});
