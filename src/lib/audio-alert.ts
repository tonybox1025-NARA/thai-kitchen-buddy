// Web Audio API beep with global AudioContext unlocked on first user gesture.

let ctx: AudioContext | null = null;
let unlocked = false;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  return ctx;
}

export async function unlockAudio() {
  const c = getCtx();
  if (!c) return;
  try {
    if (c.state === "suspended") await c.resume();
    // Play a near-silent buffer to fully unlock on iOS/Safari
    const buf = c.createBuffer(1, 1, 22050);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    src.start(0);
    unlocked = true;
  } catch {
    // ignore
  }
}

export function isAudioUnlocked() {
  return unlocked;
}

/**
 * Plays a loud, repeating "ding-dong-ding" alert to grab attention over kitchen
 * noise. Defaults: fairly loud and repeated 3× (~1.7s). Actual loudness is still
 * capped by the device's media volume, so keep the SUNMI volume up too.
 */
export function playAlertBeep(opts?: { volume?: number; repeat?: number }) {
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") {
    // Try resume non-blocking; will work if user has interacted before.
    c.resume().catch(() => {});
  }
  const volume = Math.min(0.9, Math.max(0.05, opts?.volume ?? 0.7));
  const repeat = Math.min(6, Math.max(1, Math.round(opts?.repeat ?? 3)));
  // One chime: rising ding-dong-ding, ~0.56s.
  const chime: Array<[number, number]> = [
    [880, 0],
    [660, 0.18],
    [988, 0.36],
  ];
  const chimeLen = 0.56;
  const now = c.currentTime;
  for (let r = 0; r < repeat; r++) {
    const base = now + r * chimeLen;
    for (const [freq, delay] of chime) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "triangle"; // a touch harsher than sine → carries further
      osc.frequency.value = freq;
      const t = base + delay;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(volume, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      osc.connect(gain).connect(c.destination);
      osc.start(t);
      osc.stop(t + 0.22);
    }
  }
}

/** Install one-time listeners on window that unlock audio on first interaction. */
export function installAudioUnlockListeners() {
  if (typeof window === "undefined") return;
  if (unlocked) return;
  const handler = () => {
    unlockAudio();
    window.removeEventListener("pointerdown", handler);
    window.removeEventListener("keydown", handler);
    window.removeEventListener("touchstart", handler);
  };
  window.addEventListener("pointerdown", handler, { once: false });
  window.addEventListener("keydown", handler, { once: false });
  window.addEventListener("touchstart", handler, { once: false });
}
