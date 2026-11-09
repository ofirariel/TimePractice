/** How often the scheduler wakes up to book upcoming sounds. */
export const TICK_MS = 25;
/** How far ahead (seconds) sounds and mutes are booked on the audio clock. */
export const LOOKAHEAD_SECONDS = 0.12;

export interface Ticker {
  stop(): void;
}

// Timers inside a worker keep running steadily when the tab is in the background,
// unlike page timers, which browsers slow down to once a second.
const WORKER_SOURCE = `let id;onmessage=(e)=>{clearInterval(id);if(e.data>0)id=setInterval(()=>postMessage(0),e.data);};`;

/**
 * Calls `onTick` every `intervalMs`. Only wakes the scheduler; all timing comes from the audio clock.
 * A worker that never starts (its address was revoked too early, or the browser blocked it) used to
 * fail silently: the constructor succeeds, nothing is ever booked, and the click stays mute while a
 * YouTube video — which does not use this timer — keeps playing. A page timer takes over in that case.
 */
export function startTicker(onTick: () => void, intervalMs = TICK_MS): Ticker {
  let stopped = false;
  let workerAlive = false;
  let interval: ReturnType<typeof setInterval> | null = null;
  let worker: Worker | null = null;
  let blobUrl: string | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;

  const startInterval = () => {
    if (stopped || workerAlive || interval !== null) return;
    interval = setInterval(() => {
      if (!stopped) onTick();
    }, intervalMs);
  };

  const stop = () => {
    stopped = true;
    if (watchdog !== null) clearTimeout(watchdog);
    watchdog = null;
    if (interval !== null) clearInterval(interval);
    interval = null;
    worker?.terminate();
    worker = null;
    if (blobUrl !== null) URL.revokeObjectURL(blobUrl);
    blobUrl = null;
  };

  try {
    blobUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
    worker = new Worker(blobUrl);
    worker.onmessage = () => {
      if (stopped) return;
      if (!workerAlive) {
        workerAlive = true;
        if (interval !== null) {
          clearInterval(interval);
          interval = null;
        }
        // The script has loaded, so the address can be released without killing the worker.
        if (blobUrl !== null) URL.revokeObjectURL(blobUrl);
        blobUrl = null;
      }
      onTick();
    };
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      workerAlive = false;
      if (blobUrl !== null) URL.revokeObjectURL(blobUrl);
      blobUrl = null;
      startInterval();
    };
    worker.postMessage(intervalMs);
    // Give the worker a moment. If it never reports in, the page timer books the clicks.
    watchdog = setTimeout(() => {
      watchdog = null;
      if (!stopped && !workerAlive) startInterval();
    }, 150);
  } catch {
    if (blobUrl !== null) URL.revokeObjectURL(blobUrl);
    blobUrl = null;
    worker = null;
    startInterval();
  }

  return { stop };
}
