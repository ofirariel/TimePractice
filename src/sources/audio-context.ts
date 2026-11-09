let shared: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  shared ??= new AudioContext({ latencyHint: 'interactive' });
  return shared;
}

/** Must be called from a tap/click handler: browsers only allow sound to start after a user gesture. */
export async function unlockAudio(): Promise<AudioContext> {
  const ctx = getAudioContext();
  if (ctx.state !== 'running') await ctx.resume();
  return ctx;
}

/** Seconds between a sound being scheduled at `currentTime` and it leaving the speakers. */
export function outputDelay(ctx: AudioContext): number {
  return (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
}
