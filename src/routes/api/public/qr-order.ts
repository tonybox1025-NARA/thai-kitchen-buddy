import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import type { Database } from "@/integrations/supabase/types";
import { isFrontCounterCategory } from "@/lib/print/routing";
import { formatSetKitchenNotes, setCostFromLabels, type SetConfig } from "@/lib/set-menu";
import { z } from "zod";

function createPublicServerClient() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  // Service role bypasses RLS — required for server-side order writes.
  // Falls back to publishable key only if service role is absent (needs anon policies).
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

const Schema = z.object({
  table_code: z.string().min(1).max(20),
  guests: z.number().int().min(1).max(30).optional(),
  assisted_by_staff: z.boolean().optional().default(false),
  items: z
    .array(
      z.object({
        menu_id: z.string().uuid(),
        qty: z.number().int().min(1).max(50),
        notes: z.string().max(500).optional().nullable(),
        set_config: z.record(z.any()).optional().nullable(),
        addons: z
          .array(
            z.object({
              option_id: z.string().uuid(),
              qty: z.number().int().min(1).max(50).optional().default(1),
            }),
          )
          .optional()
          .default([]),
      }),
    )
    .min(1)
    .max(50),
});

export const Route = createFileRoute("/api/public/qr-order")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const supabase = createPublicServerClient();
        if (!supabase)
          return new Response("QR ordering is temporarily unavailable", { status: 503 });

        const tableCode = new URL(request.url).searchParams.get("table_code")?.trim();
        if (!tableCode || tableCode.length > 20)
          return new Response("Invalid table code", { status: 400 });

        const { data: table, error: tableError } = await supabase
          .from("restaurant_tables")
          .select("id")
          .eq("code", tableCode)
          .maybeSingle();
        if (tableError) return new Response(`DB error: ${tableError.message}`, { status: 500 });
        if (!table) return new Response("Table not found", { status: 404 });

        const { data: orders, error: orderError } = await supabase
          .from("orders")
          .select("id,opened_at")
          .eq("table_id", table.id)
          .eq("status", "open")
          .order("opened_at", { ascending: false })
          .limit(1);
        if (orderError) return new Response(`DB error: ${orderError.message}`, { status: 500 });
        const order = orders?.[0];
        if (!order) return Response.json({ order_id: null, items: [], total: 0, count: 0 });

        const { data: items, error: itemsError } = await supabase
          .from("order_items")
          .select(
            "id,name_th,name_en,qty,unit_price,notes,modifiers,round_number,sent_at,status,voided_at",
          )
          .eq("order_id", order.id)
          .neq("status", "voided")
          .is("voided_at", null)
          .order("sent_at", { ascending: true });
        if (itemsError) return new Response(`DB error: ${itemsError.message}`, { status: 500 });

        const safeItems = (items ?? []).map((item) => ({
          id: item.id,
          name_th: item.name_th,
          name_en: item.name_en,
          qty: Number(item.qty),
          unit_price: Number(item.unit_price),
          notes: item.notes,
          modifiers: Array.isArray(item.modifiers) ? item.modifiers : [],
          round_number: item.round_number,
          sent_at: item.sent_at,
        }));
        return Response.json({
          order_id: order.id,
          items: safeItems,
          total: safeItems.reduce((sum, item) => sum + item.qty * item.unit_price, 0),
          count: safeItems.reduce((sum, item) => sum + item.qty, 0),
        });
      },
      POST: async ({ request }) => {
        const supabase = createPublicServerClient();
        if (!supabase)
          return new Response("QR ordering is temporarily unavailable", { status: 503 });

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        const parsed = Schema.safeParse(body);
        if (!parsed.success)
          return Response.json({ error: parsed.error.flatten() }, { status: 400 });
        const { table_code, guests, items, assisted_by_staff } = parsed.data;

        const { data: table, error: tableErr } = await supabase
          .from("restaurant_tables")
          .select("id,status,guests,is_test")
          .eq("code", table_code)
          .maybeSingle();
        if (tableErr) return new Response(`DB error: ${tableErr.message}`, { status: 500 });
        if (!table) return new Response("Table not found", { status: 404 });
        if (table.status === "bill_requested") {
          return new Response(
            "The bill has already been requested. Please ask staff before adding items.",
            { status: 409 },
          );
        }

        // Validate menu items + fetch authoritative prices/names
        const menuIds = items.map((i) => i.menu_id);
        const { data: menus } = await supabase
          .from("menus")
          .select("id,category_id,name_th,name_en,name_my,price,cost,available")
          .in("id", menuIds);
        const menuMap = new Map((menus ?? []).map((m) => [m.id, m]));
        for (const it of items) {
          const m = menuMap.get(it.menu_id);
          if (!m || !m.available)
            return new Response(`Item unavailable: ${it.menu_id}`, { status: 400 });
        }

        // Validate addon options + fetch authoritative prices/names
        const allOptionIds = items.flatMap((i) => i.addons ?? []).map((a) => a.option_id);
        type AddonOptionRow = {
          id: string;
          name: string;
          price: number;
          addon_group_id: string;
          addon_groups: { name: string; kitchen_name: string | null } | null;
        };
        const optionMap = new Map<string, AddonOptionRow>();
        if (allOptionIds.length > 0) {
          const { data: options } = await (supabase as any)
            .from("addon_options")
            .select("id, name, price, addon_group_id, addon_groups(name, kitchen_name)")
            .in("id", allOptionIds);
          for (const opt of (options ?? []) as AddonOptionRow[]) {
            optionMap.set(opt.id, opt);
          }
        }

        // Enforce linked and required add-ons on the server as well as in the UI.
        const { data: addonLinks, error: addonLinksErr } = await (supabase as any)
          .from("menu_addons")
          .select("menu_id, group_id")
          .in("menu_id", [...new Set(menuIds)]);
        if (addonLinksErr)
          return new Response(`DB error: ${addonLinksErr.message}`, { status: 500 });
        const linksByMenu = new Map<string, { group_id: string; min_select: number }[]>();
        for (const link of addonLinks ?? []) {
          const links = linksByMenu.get(link.menu_id) ?? [];
          links.push({
            group_id: link.group_id,
            min_select:
              link.menu_id === "8299f129-5397-4ef7-a1d1-0f94760bd85a" &&
              link.group_id === "d547bf00-8241-451b-8ed9-9c01678f8ce8"
                ? 1
                : 0,
          });
          linksByMenu.set(link.menu_id, links);
        }
        for (const item of items) {
          const links = linksByMenu.get(item.menu_id) ?? [];
          const linkedGroupIds = new Set(links.map((link) => link.group_id));
          const selectedByGroup = new Map<string, number>();
          for (const addon of item.addons ?? []) {
            const option = optionMap.get(addon.option_id);
            if (!option || !linkedGroupIds.has(option.addon_group_id)) {
              return new Response("Invalid add-on selection", { status: 400 });
            }
            selectedByGroup.set(
              option.addon_group_id,
              (selectedByGroup.get(option.addon_group_id) ?? 0) + 1,
            );
          }
          if (links.some((link) => (selectedByGroup.get(link.group_id) ?? 0) < link.min_select)) {
            return new Response("Required add-on selection missing", { status: 400 });
          }
        }

        // Auto-open a shift if none is open (uses configured starting cash)
        let { data: shift } = await supabase
          .from("shifts")
          .select("id")
          .eq("status", "open")
          .maybeSingle();
        if (!shift) {
          const today = new Date().toISOString().slice(0, 10);
          const { data: cfg } = await supabase
            .from("settings")
            .select("starting_cash")
            .eq("id", 1)
            .maybeSingle();
          const opening = Number((cfg as { starting_cash?: number } | null)?.starting_cash ?? 0);
          const { data: newShift } = await supabase
            .from("shifts")
            .insert({ business_day: today, opening_float: opening })
            .select("id")
            .single();
          shift = newShift;
        }

        // Find or create an open order for this table (source=qr OR pos — reuse existing open table order)
        const { data: openOrders, error: openOrderErr } = await supabase
          .from("orders")
          .select("id")
          .eq("table_id", table.id)
          .eq("status", "open")
          .order("opened_at", { ascending: false })
          .limit(1);
        if (openOrderErr) return new Response(`DB error: ${openOrderErr.message}`, { status: 500 });
        let order = openOrders?.[0] ?? null;
        let orderType: "new" | "added" = "new";
        if (!order) {
          const { data: newOrder, error: orderErr } = await supabase
            .from("orders")
            .insert({
              table_id: table.id,
              guests: guests ?? Math.max(1, table.guests || 1),
              shift_id: shift?.id ?? null,
              source: "qr",
              is_test: (table as any).is_test ?? false,
            })
            .select("id")
            .single();
          if (orderErr || !newOrder)
            return new Response(orderErr?.message ?? "Failed to create order", { status: 500 });
          order = newOrder;
        } else {
          const { data: existingItems, error: existingItemsErr } = await supabase
            .from("order_items")
            .select("id")
            .eq("order_id", order.id)
            .neq("status", "voided")
            .limit(1);
          if (existingItemsErr) return new Response(existingItemsErr.message, { status: 500 });
          orderType = existingItems && existingItems.length > 0 ? "added" : "new";
        }

        // Insert items as already-sent — kitchen gets the ticket automatically, no staff confirmation needed
        const sentAt = new Date().toISOString();
        const { data: allocatedRound, error: roundError } = await (supabase as any).rpc(
          "allocate_order_round",
          { p_order_id: order.id },
        );
        if (roundError || !allocatedRound)
          return new Response(roundError?.message ?? "Round allocation failed", { status: 500 });
        const roundNumber = Number(allocatedRound);
        const categoryIds = [
          ...new Set((menus ?? []).map((m: any) => m.category_id).filter(Boolean)),
        ] as string[];
        const [{ data: categories }, { data: zones }] = await Promise.all([
          categoryIds.length
            ? supabase
                .from("categories")
                .select("id,name_th,name_en,kitchen_zone_id")
                .in("id", categoryIds)
            : Promise.resolve({ data: [] }),
          supabase
            .from("kitchen_zones")
            .select("id,name_th,name_en,sort,active,print_to_kitchen")
            .eq("active", true)
            .order("sort"),
        ]);
        const categoryMap = new Map(((categories ?? []) as any[]).map((c) => [c.id, c]));
        const zoneMap = new Map(((zones ?? []) as any[]).map((z) => [z.id, z]));

        const rowEntries = items.map((it) => {
          const m = menuMap.get(it.menu_id)!;
          const sc = it.set_config as
            | SetConfig
            | null
            | undefined;
          const baseNotes = sc
            ? formatSetKitchenNotes(sc)
            : (it.notes ?? null);

          // Build modifiers list from selected addon options (with quantity)
          const modifiers = (it.addons ?? []).map((a) => {
            const opt = optionMap.get(a.option_id);
            return {
              option_id: a.option_id,
              group_name: opt?.addon_groups?.kitchen_name ?? opt?.addon_groups?.name ?? "",
              option_name: opt?.name ?? "",
              price: opt?.price ?? 0,
              qty: a.qty ?? 1,
            };
          });

          // Authoritative total: base price + sum of (addon price × qty)
          const addonTotal = modifiers.reduce((s, mod) => s + mod.price * mod.qty, 0);
          const unit_price = Number(m.price) + addonTotal;
          const category = (m as any).category_id ? categoryMap.get((m as any).category_id) : null;
          const zone = category?.kitchen_zone_id ? zoneMap.get(category.kitchen_zone_id) : null;
          const routeToFront = isFrontCounterCategory(category);

          return {
            zoneId: routeToFront ? "__front__" : (zone?.id ?? "__main__"),
            zoneLabel: routeToFront ? "FRONT" : (zone?.name_en ?? "Main Kitchen"),
            printToKitchen: routeToFront ? false : (zone?.print_to_kitchen ?? true),
            row: {
              order_id: order!.id,
              menu_id: it.menu_id,
              name_th: m.name_th,
              name_en: m.name_en,
              name_my: m.name_my,
              qty: it.qty,
              unit_price,
              unit_cost: sc ? setCostFromLabels(sc) : Number((m as any).cost ?? 0),
              notes: baseNotes,
              modifiers: modifiers.length > 0 ? modifiers : null,
              status: "sent" as const,
              sent_at: sentAt,
              round_number: roundNumber,
              round_source: assisted_by_staff ? "pos" : "qr",
              set_config: it.set_config ?? null,
            },
          };
        });
        const rows = rowEntries.map((entry) => entry.row);
        const { error: itemsErr } = await (supabase as any).from("order_items").insert(rows);
        if (itemsErr) return new Response(itemsErr.message, { status: 500 });

        // Queue kitchen + counter print jobs (same format as sendToKitchen in order.$orderId.tsx)
        const lines = rowEntries.map((entry) => ({
          zoneId: entry.zoneId,
          zoneLabel: entry.zoneLabel,
          printToKitchen: entry.printToKitchen,
          name_th: entry.row.name_th,
          name_en: entry.row.name_en,
          name_my: entry.row.name_my,
          qty: entry.row.qty,
          notes: entry.row.notes,
          modifiers: entry.row.modifiers as { option_name: string; price: number }[] | null,
        }));
        const stripZone = ({
          zoneId: _zoneId,
          zoneLabel: _zoneLabel,
          printToKitchen: _printToKitchen,
          ...line
        }: (typeof lines)[number]) => line;
        type TicketLine = ReturnType<typeof stripZone>;
        const ticketPayload = {
          kind: "order_ticket",
          table: table_code,
          source: assisted_by_staff ? "pos" : "qr",
          order_type: orderType,
          sent_at: sentAt,
          round_number: roundNumber,
        };
        const grouped = new Map<string, { zoneLabel: string; lines: TicketLine[] }>();
        for (const line of lines) {
          if (!line.printToKitchen) continue;
          const entry = grouped.get(line.zoneId) ?? {
            zoneLabel: line.zoneLabel,
            lines: [] as TicketLine[],
          };
          entry.lines.push(stripZone(line));
          grouped.set(line.zoneId, entry);
        }
        const foodLines = lines.filter((line) => line.printToKitchen).map(stripZone);
        const frontLines = lines.filter((line) => !line.printToKitchen).map(stripZone);
        // Keep the two counter papers separate: kitchen-food checklist first,
        // then the front-prepared drinks/rice/ice/dessert ticket.
        const counterJobs = [
          ...(foodLines.length
            ? [
                {
                  printer: "counter" as const,
                  payload: {
                    ...ticketPayload,
                    ticket_type: "kitchen_check",
                    route_version: 3,
                    lines: foodLines,
                    language: "my",
                    department: "KITCHEN CHECK",
                    station: "KITCHEN CHECK",
                    footer: "counter",
                  },
                },
              ]
            : []),
          ...(frontLines.length
            ? [
                {
                  printer: "counter" as const,
                  payload: {
                    ...ticketPayload,
                    ticket_type: "front",
                    route_version: 3,
                    lines: frontLines,
                    language: "th",
                    department: "COUNTER",
                    station: "COUNTER",
                    footer: "counter",
                  },
                },
              ]
            : []),
        ];
        const kitchenJobs = [...grouped.values()].map((group, index, all) => ({
          printer: "kitchen" as const,
          payload: {
            ...ticketPayload,
            ticket_type: "kitchen",
            route_version: 2,
            lines: group.lines,
            language: "my",
            department: group.zoneLabel,
            station: group.zoneLabel,
            footer: "kitchen",
            alert_beep: true,
            ticketIndex: index + 1,
            ticketTotal: all.length,
          },
        }));

        // Insert the complete print plan in one request. The native POS queue
        // serializes jobs per device and adds the printer cooldown. Waiting 750ms
        // between cloud inserts made every customer order feel slow and did not
        // add reliability when Realtime briefly disconnected.
        const printJobs = [...counterJobs, ...kitchenJobs];
        if (printJobs.length > 0) {
          const { error: printErr } = await (supabase as any)
            .from("print_jobs")
            .insert(printJobs);
          if (printErr) return new Response(`Print queue error: ${printErr.message}`, { status: 500 });
        }

        // Mark table occupied + raise QR alert flag (the POS realtime listener will react)
        await supabase
          .from("restaurant_tables")
          .update({
            status: "occupied",
            guests: guests ?? Math.max(table.guests || 1, 1),
            has_qr_alert: !assisted_by_staff,
          })
          .eq("id", table.id);

        // Insert a synthetic 'qr' source marker order if table previously had a pos order — emit notification
        // (POS already listens to source=qr inserts on `orders`; emit a no-op event for existing reused orders)
        if (order && !assisted_by_staff) {
          await supabase
            .from("orders")
            .update({ source: "qr" })
            .eq("id", order.id)
            .eq("source", "pos")
            .select();
        }

        return Response.json({
          ok: true,
          order_id: order.id,
          count: rows.length,
          round_number: roundNumber,
          print_routing: { kitchen: foodLines.length, front: frontLines.length },
        });
      },
    },
  },
});
