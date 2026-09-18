import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import type { Database } from "@/integrations/supabase/types";
import { buildSetDef, type SetItemRow } from "@/lib/set-menu";

function createPublicServerClient() {
  const url =
    process.env.SUPABASE_URL ??
    process.env.VITE_SUPABASE_URL;
  // Prefer service role key (bypasses RLS for public read).
  // Falls back to publishable/anon key — requires anon SELECT policies on relevant tables.
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) return null;

  return createClient<Database>(url, key, {
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export const Route = createFileRoute("/api/public/qr-menu/$tableCode")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const supabase = createPublicServerClient();
        if (!supabase) {
          return new Response("QR menu is temporarily unavailable", { status: 503 });
        }

        // params is not populated in TanStack Start server handlers for dynamic routes;
        // extract the table code from the request URL instead.
        const code = decodeURIComponent(new URL(request.url).pathname.split("/").pop() ?? "");
        if (!code) return new Response("Table not found", { status: 404 });

        const { data: table, error: tableError } = await supabase
          .from("restaurant_tables")
          .select("id,code,capacity,status")
          .eq("code", code)
          .maybeSingle();
        if (tableError) return new Response("Failed to load table", { status: 500 });
        if (!table) return new Response("Table not found", { status: 404 });

        const db = supabase as any;
        const [{ data: cats, error: catsError }, { data: menus, error: menusError }, { data: settings, error: settingsError }] = await Promise.all([
          supabase.from("categories").select("id,name_th,name_en,sort").order("sort"),
          supabase
            .from("menus")
            .select("id,category_id,name_th,name_en,price,available,sort,image_url,is_set,manager_menu_id")
            .eq("available", true)
            .order("sort"),
          supabase.from("settings").select("restaurant_name").eq("id", 1).maybeSingle(),
        ]);
        if (catsError || menusError || settingsError) {
          return new Response("Failed to load menu", { status: 500 });
        }

        // Older POS builds created an unlinked duplicate when an operator edited
        // add-ons on a Manager-linked menu. Collapse only exact catalog twins,
        // preferring the Manager row, and carry the duplicate's add-ons onto it.
        const originalMenus = (menus ?? []) as any[];
        const duplicateToCanonical = new Map<string, string>();
        const menuKey = (menu: any) => [
          menu.category_id ?? "",
          String(menu.name_th ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase(),
          Number(menu.price ?? 0).toFixed(2),
        ].join("|");
        const menusByKey = new Map<string, any[]>();
        for (const menu of originalMenus) {
          const key = menuKey(menu);
          const group = menusByKey.get(key) ?? [];
          group.push(menu);
          menusByKey.set(key, group);
        }
        const visibleMenus = [...menusByKey.values()].map((group) => {
          const canonical = group.find((menu) => Boolean(menu.manager_menu_id)) ?? group[0];
          for (const menu of group) {
            if (menu.id !== canonical.id) duplicateToCanonical.set(menu.id, canonical.id);
          }
          return canonical;
        });

        // Build addon groups per menu item. menu_addons -> addon_groups is not a
        // declared PostgREST FK, so a nested select returns null — fetch in two
        // steps (same as the staff order screen).
        const menuIds = originalMenus.map((m: { id: string }) => m.id);
        const addonsByMenuId: Record<string, unknown[]> = {};
        const setDefsByMenuId: Record<string, unknown> = {};
        if (menuIds.length > 0) {
          const { data: links } = await db
            .from("menu_addons")
            .select("menu_id, group_id")
            .in("menu_id", menuIds);
          const linkRows = (links ?? []) as { menu_id: string; group_id: string }[];
          const groupIds = [...new Set(linkRows.map((r) => r.group_id))];
          const groupById = new Map<string, unknown>();
          if (groupIds.length > 0) {
            const { data: groups } = await db
              .from("addon_groups")
              .select("id, name, kitchen_name, max_select, addon_options(id, name, price)")
              .in("id", groupIds);
            for (const g of (groups ?? []) as { id: string }[]) groupById.set(g.id, g);
          }
          for (const link of linkRows) {
            const g = groupById.get(link.group_id);
            if (!g) continue;
            const canonicalId = duplicateToCanonical.get(link.menu_id) ?? link.menu_id;
            if (!addonsByMenuId[canonicalId]) addonsByMenuId[canonicalId] = [];
            const groups = addonsByMenuId[canonicalId] as { id?: string }[];
            if (!groups.some((group) => group.id === link.group_id)) groups.push(g);
          }
        }

        const setMenus = visibleMenus.filter((menu: any) => menu.is_set);
        if (setMenus.length > 0) {
          const { data: setLinks } = await db.from("menu_set_items")
            .select("set_menu_id,child_menu_id,quantity,group_key,group_name,min_select,max_select,sort_order")
            .in("set_menu_id", setMenus.map((menu: any) => menu.id))
            .order("sort_order");
          const childIds = [...new Set(((setLinks ?? []) as any[]).map((row) => row.child_menu_id))];
          const { data: children } = childIds.length > 0
            ? await db.from("menus").select("id,name_th,name_en,cost").in("id", childIds)
            : { data: [] };
          const childById = new Map(((children ?? []) as any[]).map((child) => [child.id, child]));
          for (const menu of setMenus as any[]) {
            const rows = ((setLinks ?? []) as any[]).filter((row) => row.set_menu_id === menu.id).flatMap((row) => {
              const child = childById.get(row.child_menu_id);
              return child ? [{ ...row, child }] : [];
            }) as SetItemRow[];
            const definition = buildSetDef(menu, rows);
            if (definition) setDefsByMenuId[menu.id] = definition;
          }
        }

        const usedCategoryIds = new Set(visibleMenus.map((menu) => menu.category_id).filter(Boolean));
        const visibleCategories = (cats ?? []).filter((category) => usedCategoryIds.has(category.id));

        return Response.json(
          {
            table,
            categories: visibleCategories,
            menus: visibleMenus,
            restaurant_name: settings?.restaurant_name ?? "Restaurant",
            addonsByMenuId,
            setDefsByMenuId,
          },
          {
            headers: {
              // Fresh 30s; serve stale up to 2min while revalidating in background
              "Cache-Control": "public, max-age=30, stale-while-revalidate=120",
            },
          },
        );
      },
    },
  },
});
