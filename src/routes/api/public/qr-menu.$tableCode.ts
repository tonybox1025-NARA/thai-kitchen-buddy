import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import type { Database } from "@/integrations/supabase/types";

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
            .select("id,category_id,name_th,name_en,price,available,sort,image_url")
            .eq("available", true)
            .order("sort"),
          supabase.from("settings").select("restaurant_name").eq("id", 1).maybeSingle(),
        ]);
        if (catsError || menusError || settingsError) {
          return new Response("Failed to load menu", { status: 500 });
        }

        // Build addon groups per menu item. menu_addons -> addon_groups is not a
        // declared PostgREST FK, so a nested select returns null — fetch in two
        // steps (same as the staff order screen).
        const menuIds = (menus ?? []).map((m: { id: string }) => m.id);
        const addonsByMenuId: Record<string, unknown[]> = {};
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
              .select("id, name, kitchen_name, addon_options(id, name, price)")
              .in("id", groupIds);
            for (const g of (groups ?? []) as { id: string }[]) groupById.set(g.id, g);
          }
          for (const link of linkRows) {
            const g = groupById.get(link.group_id);
            if (!g) continue;
            if (!addonsByMenuId[link.menu_id]) addonsByMenuId[link.menu_id] = [];
            addonsByMenuId[link.menu_id].push(g);
          }
        }

        const usedCategoryIds = new Set((menus ?? []).map((menu) => menu.category_id).filter(Boolean));
        const visibleCategories = (cats ?? []).filter((category) => usedCategoryIds.has(category.id));

        return Response.json(
          {
            table,
            categories: visibleCategories,
            menus: menus ?? [],
            restaurant_name: settings?.restaurant_name ?? "Restaurant",
            addonsByMenuId,
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
