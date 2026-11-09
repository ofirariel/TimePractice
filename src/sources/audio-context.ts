let shared: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  // 'playback' shares the output path with the YouTube player. 'interactive' asks for a
  // low-latency device that, on some computers, stays silent while the video still plays.
  shared ??= new AudioContext({ latencyHint: 'playback' });
  return shared;
}

/**
 * Plays one silent sample. Some browsers ignore resume() until a buffer has actually been
 * started from the tap, so later clicks (booked after the tap returns) would never sound.
 */
function playSilence(ctx: AudioContext): void {
  const rate = ctx.sampleRate;
  if (!rate) return;
  const buffer = ctx.createBuffer(1, 1, rate);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start(0);
}

/** Must be called from a tap/click handler: browsers only allow sound to start after a user gesture. */
export function unlockAudio(): Promise<AudioContext> {
  const ctx = getAudioContext();
  try {
    playSilence(ctx);
  } catch {
    // resume() is the other signal browsers accept.
  }
  if (ctx.state === 'running') return Promise.resolve(ctx);
  return ctx.resume().then(() => ctx);
}

/** Asks a suspended or interrupted context to run again. Safe to call from the scheduler. */
export function resumeAudio(ctx: AudioContext): void {
  if (ctx.state === 'running') return;
  try {
    void Promise.resolve(ctx.resume()).catch(() => {});
  } catch {
    // The next tick tries again.
  }
}

/** While `active`, any tap resumes audio. Phones suspend it whenever something else plays. */
export function installAudioResume(): () => void {
  const resume = () => void unlockAudio().catch(() => {});
  const events = ['pointerdown', 'touchend'] as const;
  for (const event of events) document.addEventListener(event, resume, true);
  return () => {
    for (const event of events) document.removeEventListener(event, resume, true);
  };
}

/** Seconds between a sound being scheduled at `currentTime` and it leaving the speakers. */
export function outputDelay(ctx: AudioContext): number {
  const part = (value: number | undefined) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);
  return part(ctx.outputLatency) + part(ctx.baseLatency);
}
