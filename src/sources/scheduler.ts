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

/** Calls `onTick` every `intervalMs`. Only wakes the scheduler; all timing comes from the audio clock. */
export function startTicker(onTick: () => void, intervalMs = TICK_MS): Ticker {
  try {
    const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = onTick;
    worker.postMessage(intervalMs);
    return { stop: () => worker.terminate() };
  } catch {
    const id = setInterval(onTick, intervalMs);
    return { stop: () => clearInterval(id) };
  }
}
