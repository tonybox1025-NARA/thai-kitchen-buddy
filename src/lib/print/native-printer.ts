import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * Bridge to the native ESC/POS transport (android/app/src/main/java/com/lonmoh/pos/printer).
 *
 * Only the transport is native — the byte stream is composed in escpos.ts, so a
 * receipt printed from the APK is identical to one printed by the Node bridge.
 */
export interface PosPrinterPlugin {
  /** Raw TCP to a network printer (JetDirect, port 9100 by default). */
  printTcp(options: {
    host: string;
    port?: number;
    /** ESC/POS bytes, base64-encoded. */
    data: string;
    timeoutMs?: number;
  }): Promise<{ bytes: number; target: string }>;

  /** Connectivity check that prints nothing. Never rejects for an offline printer. */
  probeTcp(options: {
    host: string;
    port?: number;
    timeoutMs?: number;
  }): Promise<{ reachable: boolean; latencyMs?: number; error?: string }>;

  /** Built-in printer on a SUNMI POS terminal. */
  printSunmi(options: { data: string }): Promise<{ bytes: number; target: string }>;

  /** Whether a SUNMI printer service is bound on this device. */
  sunmiStatus(): Promise<{ available: boolean }>;

  /**
   * Printer cabled to this tablet over USB. Omit deviceId to auto-pick the first
   * printer-class device. Triggers Android's USB permission prompt on first use.
   */
  printUsb(options: { data: string; deviceId?: number }): Promise<{ bytes: number; target: string }>;

  /** Attached USB devices, printer-class first. */
  usbDevices(): Promise<{ devices: UsbDeviceInfo[] }>;
}

export type UsbDeviceInfo = {
  deviceId: number;
  vendorId: number;
  productId: number;
  name: string;
  product?: string | null;
  isPrinterClass: boolean;
};

export const PosPrinter = registerPlugin<PosPrinterPlugin>("PosPrinter");

/** True inside the Android APK; false in any browser, including the PWA. */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * Whether this device can print without the Node bridge.
 * Returns the transport that would be used, or null when there is none.
 */
export async function detectNativeTransport(
  host?: string | null,
): Promise<"sunmi" | "network" | null> {
  if (!isNativeApp()) return null;
  try {
    const { available } = await PosPrinter.sunmiStatus();
    if (available) return "sunmi";
  } catch {
    // No SUNMI service — fall through to the network check.
  }
  return host ? "network" : null;
}
