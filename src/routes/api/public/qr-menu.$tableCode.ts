import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/public/qr-menu/$tableCode")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const code = params.tableCode;
        const { data: table } = await supabaseAdmin
          .from("restaurant_tables")
          .select("id,code,capacity,status")
          .eq("code", code)
          .maybeSingle();
        if (!table) return new Response("Table not found", { status: 404 });

        const [{ data: cats }, { data: menus }, { data: settings }] = await Promise.all([
          supabaseAdmin.from("categories").select("id,name_th,name_en,sort").order("sort"),
          supabaseAdmin
            .from("menus")
            .select("id,category_id,name_th,name_en,price,available,sort,image_url")
            .eq("available", true)
            .order("sort"),
          supabaseAdmin.from("settings").select("restaurant_name").eq("id", 1).maybeSingle(),
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
