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

        // Build addon groups per menu item
        const menuIds = (menus ?? []).map((m: { id: string }) => m.id);
        const addonsByMenuId: Record<string, unknown[]> = {};
        if (menuIds.length > 0) {
          const { data: menuAddons } = await db
            .from("menu_addons")
            .select("menu_id, addon_groups(id, name, kitchen_name, addon_options(id, name, price))")
            .in("menu_id", menuIds);
          for (const row of (menuAddons ?? []) as { menu_id: string; addon_groups: unknown }[]) {
            if (!addonsByMenuId[row.menu_id]) addonsByMenuId[row.menu_id] = [];
            if (row.addon_groups) addonsByMenuId[row.menu_id].push(row.addon_groups);
          }
        }

        return Response.json(
          {
            table,
            categories: cats ?? [],
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
