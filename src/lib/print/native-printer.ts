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

  /** Force the on-screen keyboard to show (SUNMI/rugged devices suppress it). */
  showKeyboard(): Promise<void>;
  /** Hide the on-screen keyboard. */
  hideKeyboard(): Promise<void>;
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
 * SUNMI / rugged POS devices register a phantom hardware keyboard, so Chromium
 * WebView won't raise the on-screen keyboard when a text field is focused (the
 * field shows a focus ring but no keyboard). Force it: on focusin of a real,
 * editable text field ask the native side to show the keyboard; hide on focusout.
 * No-op outside the APK. Returns a cleanup function.
 */
export function installKeyboardFix(): () => void {
  if (!isNativeApp() || typeof document === "undefined") return () => {};

  const isTextField = (target: EventTarget | null): boolean => {
    const el = target as HTMLElement | null;
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === "TEXTAREA") return !(el as HTMLTextAreaElement).readOnly;
    if (tag !== "INPUT") return false;
    const input = el as HTMLInputElement;
    if (input.readOnly || input.disabled || input.inputMode === "none") return false;
    const type = (input.type || "text").toLowerCase();
    // Numeric entry uses the in-app keypad (a <button>), not a system-keyboard input.
    const nonText = ["button", "submit", "reset", "checkbox", "radio", "file", "range", "color", "image", "hidden"];
    return !nonText.includes(type);
  };

  // On this device a plain touch-focus does NOT raise the keyboard (Chromium sees
  // a phantom hardware keyboard and suppresses it), but a PROGRAMMATIC focus does
  // — which is why pressing the login button (form validation focuses the field)
  // pops the keyboard. So on a touch-focus, immediately re-focus the field in code
  // to take that working path, then also force the keyboard natively. A guard
  // stops the programmatic re-focus from looping.
  let reFocusing = false;
  const onFocusIn = (e: FocusEvent) => {
    const el = e.target as HTMLElement | null;
    if (!el || !isTextField(el)) return;
    if (reFocusing) {
      reFocusing = false;
      void PosPrinter.showKeyboard().catch(() => {});
      window.setTimeout(() => void PosPrinter.showKeyboard().catch(() => {}), 150);
      return;
    }
    reFocusing = true;
    el.blur();
    el.focus();
  };
  const onFocusOut = (e: FocusEvent) => {
    if (reFocusing) return; // mid re-focus — don't hide
    if (isTextField(e.target)) void PosPrinter.hideKeyboard().catch(() => {});
  };
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  return () => {
    document.removeEventListener("focusin", onFocusIn);
    document.removeEventListener("focusout", onFocusOut);
  };
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
