import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/api/public/qr-menu/$tableCode")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

        if (!supabaseUrl || !supabasePublishableKey) {
          return new Response("Backend is not configured", { status: 500 });
        }

        const supabase = createClient<Database>(supabaseUrl, supabasePublishableKey, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        });

        // params is not populated in TanStack Start server handlers for dynamic routes;
        // extract the table code from the request URL instead.
        const code = decodeURIComponent(new URL(request.url).pathname.split("/").pop() ?? "");
        const { data: table } = await supabase
          .from("restaurant_tables")
          .select("id,code,capacity,status")
          .eq("code", code)
          .maybeSingle();
        if (!table) return new Response("Table not found", { status: 404 });

        const [{ data: cats }, { data: menus }, { data: settings }] = await Promise.all([
          supabase.from("categories").select("id,name_th,name_en,sort").order("sort"),
          supabase
            .from("menus")
            .select("id,category_id,name_th,name_en,price,available,sort,image_url")
            .eq("available", true)
            .order("sort"),
          supabase.from("settings").select("restaurant_name").eq("id", 1).maybeSingle(),
        ]);

        return Response.json({
          table,
          categories: cats ?? [],
          menus: menus ?? [],
          restaurant_name: settings?.restaurant_name ?? "Restaurant",
        });
      },
    },
  },
});
