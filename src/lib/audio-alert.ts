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

/** Plays a short two-tone "ding-dong" alert. */
export function playAlertBeep() {
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") {
    // Try resume non-blocking; will work if user has interacted before.
    c.resume().catch(() => {});
  }
  const now = c.currentTime;
  const tones: Array<[number, number]> = [
    [880, 0],
    [660, 0.18],
    [880, 0.36],
  ];
  for (const [freq, delay] of tones) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + delay);
    gain.gain.exponentialRampToValueAtTime(0.35, now + delay + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.18);
    osc.connect(gain).connect(c.destination);
    osc.start(now + delay);
    osc.stop(now + delay + 0.2);
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
