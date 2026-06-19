import type { PrintDriver, PrintJob } from "./types";

export type DriverId = "browser" | "queue" | "android" | "network";

const PRINT_AREA_ID = "__print_area__";

function ensurePrintHost(): HTMLElement {
  let host = document.getElementById(PRINT_AREA_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = PRINT_AREA_ID;
    document.body.appendChild(host);
  }
  return host;
}

/** Renders given HTML into a hidden print container, calls window.print(), then cleans up. */
export function browserPrintHtml(html: string): Promise<void> {
  return new Promise((resolve) => {
    const host = ensurePrintHost();
    host.innerHTML = html;
    document.body.classList.add("printing");
    const cleanup = () => {
      document.body.classList.remove("printing");
      host.innerHTML = "";
      window.removeEventListener("afterprint", cleanup);
      resolve();
    };
    window.addEventListener("afterprint", cleanup);
    setTimeout(() => {
      window.print();
      // Safari fallback
      setTimeout(cleanup, 1500);
    }, 50);
  });
}

/**
 * Print arbitrary HTML in a DEDICATED off-screen iframe document.
 * This avoids the SUNMI/Android Chrome bug where window.print() captures
 * the entire current page DOM even with @media print visibility hacks.
 *
 * `bodyHtml` should be the inner body content (may include its own <style> tags).
 * A complete HTML document is constructed and loaded via srcdoc.
 */
export function printInDedicatedDocument(
  bodyHtml: string,
  opts: { title?: string; testBanner?: boolean } = {},
): Promise<void> {
  return new Promise((resolve) => {
    const title = opts.title ?? "Print";
    const banner = opts.testBanner
      ? `<div class="test-banner">*** TEST PRINT ***</div>`
      : "";
    const doc = `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  @page { size: 72mm auto; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000;
    font-family: ui-monospace, "Menlo", "Consolas", monospace; }
  body { width: 72mm; }
  .test-banner {
    text-align: center; font-weight: 800; font-size: 13px;
    padding: 4px 0; border: 1px dashed #000; margin: 4px 3mm;
    letter-spacing: 1px;
  }
  .page-break { page-break-after: always; break-after: page; }
  @media print {
    html, body { width: 72mm; }
  }
</style>
</head><body>${banner}${bodyHtml}</body></html>`;

    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText =
      "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
    iframe.srcdoc = doc;

    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      try { iframe.remove(); } catch {}
      resolve();
    };

    iframe.onload = () => {
      const w = iframe.contentWindow;
      if (!w) { cleanup(); return; }
      try {
        w.addEventListener("afterprint", () => setTimeout(cleanup, 100));
      } catch {}
      // Give the doc a tick to lay out, then print from the dedicated document.
      setTimeout(() => {
        try {
          w.focus();
          w.print();
        } catch {
          cleanup();
          return;
        }
        // Fallback cleanup in case afterprint never fires (some Android builds).
        setTimeout(cleanup, 8000);
      }, 100);
    };

    document.body.appendChild(iframe);
  });
}

export class BrowserPrintDriver implements PrintDriver {
  name = "browser";
  constructor(private renderHtml: (job: PrintJob) => string) {}
  async print(job: PrintJob): Promise<void> {
    await browserPrintHtml(this.renderHtml(job));
  }
}

/** Stub — wraps the existing print_jobs queue. Not implemented in Phase 1. */
export class QueuePrintDriver implements PrintDriver {
  name = "queue";
  async print(_job: PrintJob): Promise<void> {
    throw new Error("QueuePrintDriver not implemented in Phase 1");
  }
}

/** Stub — Android print bridge. Phase 2+. */
export class AndroidBridgePrintDriver implements PrintDriver {
  name = "android";
  async print(_job: PrintJob): Promise<void> {
    throw new Error("AndroidBridgePrintDriver not implemented yet");
  }
}

/** Stub — Direct ESC/POS over TCP. Phase 2+. */
export class NetworkEscPosPrintDriver implements PrintDriver {
  name = "network";
  async print(_job: PrintJob): Promise<void> {
    throw new Error("NetworkEscPosPrintDriver not implemented yet");
  }
}

let activeDriverId: DriverId = "browser";
export const getActiveDriverId = (): DriverId => activeDriverId;
export const setActiveDriverId = (id: DriverId) => {
  activeDriverId = id;
};

export function makeDriver(id: DriverId, renderHtml: (job: PrintJob) => string): PrintDriver {
  switch (id) {
    case "browser":
      return new BrowserPrintDriver(renderHtml);
    case "queue":
      return new QueuePrintDriver();
    case "android":
      return new AndroidBridgePrintDriver();
    case "network":
      return new NetworkEscPosPrintDriver();
  }
}
