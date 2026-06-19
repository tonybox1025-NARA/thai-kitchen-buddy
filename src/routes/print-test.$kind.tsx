import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { receiptToHtml } from "@/components/print/ReceiptPreview72";
import { kitchenToHtml } from "@/components/print/KitchenTicketPreview72";
import {
  sampleReceipt,
  sampleKitchen,
  sampleDepartmentOrder,
  splitOrderByDepartment,
} from "@/lib/print/sampleData";

type Kind = "receipt" | "kitchen-ticket" | "department-split";

export const Route = createFileRoute("/print-test/$kind")({
  component: PrintTestPage,
  validateSearch: (s: Record<string, unknown>) => ({
    mode: typeof s.mode === "string" ? s.mode : undefined,
    auto: s.auto === "1" || s.auto === true,
  }),
});

function buildHtml(kind: Kind): { title: string; html: string } {
  if (kind === "receipt") {
    return { title: "Test Counter Receipt", html: receiptToHtml(sampleReceipt) };
  }
  if (kind === "kitchen-ticket") {
    return { title: "Test Kitchen Ticket", html: kitchenToHtml(sampleKitchen) };
  }
  const tickets = splitOrderByDepartment(sampleDepartmentOrder);
  const html = tickets
    .map((t, i) => {
      const br = i < tickets.length - 1 ? `<div class="page-break"></div>` : "";
      return kitchenToHtml(t) + br;
    })
    .join("");
  return { title: "Test Department Split Tickets", html };
}

function PrintTestPage() {
  const { kind } = Route.useParams() as { kind: Kind };
  const { auto } = Route.useSearch();
  const nav = useNavigate();
  const router = useRouter();

  const valid: Kind[] = ["receipt", "kitchen-ticket", "department-split"];
  const safeKind = (valid.includes(kind) ? kind : "receipt") as Kind;
  const { title, html } = buildHtml(safeKind);

  useEffect(() => {
    document.title = title;
    if (auto) {
      const id = setTimeout(() => window.print(), 250);
      return () => clearTimeout(id);
    }
  }, [title, auto]);

  const goBack = () => {
    if (window.history.length > 1) router.history.back();
    else nav({ to: "/settings" });
  };

  return (
    <div className="print-test-root">
      <style>{`
        html, body { margin: 0; padding: 0; background: #f3f4f6; }
        .print-test-root { min-height: 100vh; padding: 16px; display: flex;
          flex-direction: column; align-items: center; gap: 12px;
          font-family: ui-sans-serif, system-ui, sans-serif; color: #111; }
        .pt-controls { display: flex; gap: 8px; }
        .pt-btn { padding: 10px 16px; border-radius: 6px; border: 1px solid #d1d5db;
          background: #fff; font-size: 14px; cursor: pointer; }
        .pt-btn.primary { background: #0d9488; color: #fff; border-color: #0d9488; }
        .pt-paper { background: #fff; width: 72mm; padding: 0;
          box-shadow: 0 1px 6px rgba(0,0,0,.15); color: #000;
          font-family: ui-monospace, Menlo, Consolas, monospace; }
        .pt-banner { text-align: center; font-weight: 800; font-size: 13px;
          padding: 4px 0; border: 1px dashed #000; margin: 4px 3mm;
          letter-spacing: 1px; }
        .page-break { page-break-after: always; break-after: page; }

        @page { size: 72mm auto; margin: 0; }
        @media print {
          html, body { background: #fff; }
          .print-test-root { padding: 0; gap: 0; background: #fff; }
          .pt-controls { display: none !important; }
          .pt-paper { box-shadow: none; width: 72mm; }
        }
      `}</style>

      <div className="pt-controls">
        <button className="pt-btn" onClick={goBack}>← Back to Settings</button>
        <button className="pt-btn primary" onClick={() => window.print()}>
          🖨 Print
        </button>
      </div>

      <div className="pt-paper">
        <div className="pt-banner">*** TEST PRINT ***</div>
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}
