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
