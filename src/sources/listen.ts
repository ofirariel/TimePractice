import { detectBeatFromPcm, type BeatDetection } from '../core/beat-detect';
import { barSeconds, normalizeOffset } from '../core/tap-align';

/** How long a listen lasts. Long enough for a steady tempo, short enough to wait through. */
export const LISTEN_SECONDS = 12;

export type ListenMethod = 'tab' | 'mic';

/**
 * Mac Chrome shares the tab (that includes the YouTube player's sound).
 * Android has no reliable tab-audio share, so the microphone hears the speaker.
 */
export function listenMethod(userAgent: string, canCaptureTab: boolean): ListenMethod {
  if (/Android/i.test(userAgent) || !canCaptureTab) return 'mic';
  return 'tab';
}

export interface TabCaptureOptions extends DisplayMediaStreamOptions {
  /** Chrome: offer this tab first, which is the one playing the video. */
  preferCurrentTab?: boolean;
  selfBrowserSurface?: 'include' | 'exclude';
  systemAudio?: 'include' | 'exclude';
  surfaceSwitching?: 'include' | 'exclude';
  monitorTypeSurfaces?: 'include' | 'exclude';
}

/** Chrome needs a video track to share a tab, even though only the audio is used. */
export function tabCaptureOptions(): TabCaptureOptions {
  return {
    video: true,
    audio: true,
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    systemAudio: 'exclude',
    surfaceSwitching: 'exclude',
    monitorTypeSurfaces: 'exclude',
  };
}

/**
 * The microphone must hear the speaker, so echo cancellation and noise
 * suppression stay off — they would try to remove the track.
 */
export function micAudioConstraints(): MediaStreamConstraints {
  return {
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    video: false,
  };
}

export type ListenFailure = 'cancelled' | 'no-tab-audio' | 'no-mic' | 'unsupported' | 'failed';

export class ListenError extends Error {
  constructor(readonly failure: ListenFailure) {
    super(failure);
    this.name = 'ListenError';
  }
}

export function listenFailureMessage(method: ListenMethod, failure: ListenFailure): string {
  if (method === 'mic') {
    if (failure === 'cancelled') return 'The microphone was blocked. Allow it in the browser, then try again.';
    if (failure === 'no-mic') return 'No microphone was found on this phone.';
    if (failure === 'unsupported') return "This browser can't use the microphone here.";
    return "Couldn't hear through the microphone. Allow it, turn the volume up, and try again.";
  }
  if (failure === 'cancelled') return 'The share was cancelled. Choose this tab and turn on Share tab audio.';
  if (failure === 'no-tab-audio') return 'That share had no sound. Choose this tab and turn on Share tab audio.';
  if (failure === 'unsupported') return "This browser can't share tab audio. Try Chrome on a Mac.";
  return "Couldn't hear the tab. Choose this tab and turn on Share tab audio.";
}

export function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

export async function openListenStream(method: ListenMethod, signal?: AbortSignal): Promise<MediaStream> {
  const devices = navigator.mediaDevices;
  if (!devices || signal?.aborted) throw new ListenError(signal?.aborted ? 'cancelled' : 'unsupported');
  try {
    if (method === 'mic') {
      if (!devices.getUserMedia) throw new ListenError('unsupported');
      return await devices.getUserMedia(micAudioConstraints());
    }
    if (!devices.getDisplayMedia) throw new ListenError('unsupported');
    const stream = await devices.getDisplayMedia({ ...tabCaptureOptions(), signal } as DisplayMediaStreamOptions);
    if (stream.getAudioTracks().length === 0) {
      stopStream(stream);
      throw new ListenError('no-tab-audio');
    }
    return stream;
  } catch (error) {
    if (error instanceof ListenError) throw error;
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'NotAllowedError' || name === 'AbortError') throw new ListenError('cancelled');
    if (name === 'NotFoundError') throw new ListenError(method === 'mic' ? 'no-mic' : 'failed');
    throw new ListenError('failed');
  }
}

export interface RecordedListen {
  samples: Float32Array;
  sampleRate: number;
  /** Video time at the first sample, on the same clock the silences use. */
  videoStart: number | null;
  /** Video time when the last sample was recorded. */
  videoEnd: number | null;
}

/**
 * Records mono PCM from a stream. Samples before the video clock is running are
 * dropped, so the buffer lines up with the video.
 */
export function recordListen(args: {
  ctx: AudioContext;
  stream: MediaStream;
  seconds: number;
  videoTime: () => number | null;
  signal?: AbortSignal;
  onProgress?: (heardSeconds: number) => void;
}): Promise<RecordedListen> {
  const { ctx, stream, seconds, videoTime, signal, onProgress } = args;
  const source = ctx.createMediaStreamSource(stream);
  // One channel: the browser mixes a stereo tab or mic down for us.
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const silent = ctx.createGain();
  silent.gain.value = 0;
  source.connect(processor);
  processor.connect(silent);
  silent.connect(ctx.destination);

  const target = Math.floor(ctx.sampleRate * seconds);
  const chunks: Float32Array[] = [];
  let received = 0;
  let videoStart: number | null = null;
  let videoEnd: number | null = null;
  const startedAt = performance.now();

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = 0;
    const finish = (error?: ListenError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      processor.onaudioprocess = null;
      processor.disconnect();
      source.disconnect();
      silent.disconnect();
      signal?.removeEventListener('abort', onAbort);
      if (error) {
        reject(error);
        return;
      }
      const samples = new Float32Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        samples.set(chunk, offset);
        offset += chunk.length;
      }
      resolve({ samples, sampleRate: ctx.sampleRate, videoStart, videoEnd });
    };
    const onAbort = () => finish(new ListenError('cancelled'));
    if (signal?.aborted) {
      finish(new ListenError('cancelled'));
      return;
    }
    signal?.addEventListener('abort', onAbort);
    timer = window.setTimeout(() => finish(new ListenError('failed')), (seconds + 8) * 1000);
    processor.onaudioprocess = (event) => {
      if (signal?.aborted) return;
      event.outputBuffer.getChannelData(0).fill(0);
      const buffer = event.inputBuffer.getChannelData(0);
      const bufferSeconds = buffer.length / event.inputBuffer.sampleRate;
      if (videoStart === null) {
        const now = videoTime();
        if (now === null) {
          if (performance.now() - startedAt > 5000) finish(new ListenError('failed'));
          return;
        }
        videoStart = now - bufferSeconds;
      }
      const copy = new Float32Array(buffer.length);
      copy.set(buffer);
      chunks.push(copy);
      received += copy.length;
      videoEnd = videoTime() ?? videoEnd;
      onProgress?.(received / ctx.sampleRate);
      if (received >= target) finish();
    };
  });
}

/** The video kept playing for about as long as we were listening. */
export function listenWasSteady(recorded: RecordedListen, seconds: number): boolean {
  if (recorded.videoStart === null || recorded.videoEnd === null) return false;
  if (recorded.samples.length < recorded.sampleRate * seconds * 0.8) return false;
  const advanced = recorded.videoEnd - recorded.videoStart;
  return advanced > seconds * 0.7 && advanced < seconds + 1.5;
}

/**
 * Places the detected downbeat on the video clock.
 * `found.offset` is seconds from the start of the listen; `videoStart` is where
 * that listen began in the video.
 */
export function gridFromListen(found: BeatDetection, videoStart: number, beatsPerBar: number): { bpm: number; offset: number } | null {
  if (!(found.confidence > 0) || !(found.bpm > 0)) return null;
  return {
    bpm: found.bpm,
    offset: normalizeOffset(videoStart + found.offset, barSeconds(found.bpm, beatsPerBar)),
  };
}

/** Runs the shared detector on a short listen and lines the result up with the video. */
export function detectListen(recorded: RecordedListen, beatsPerBar: number): { bpm: number; offset: number } | null {
  if (recorded.videoStart === null) return null;
  const found = detectBeatFromPcm(recorded.samples, recorded.sampleRate, beatsPerBar);
  return gridFromListen(found, recorded.videoStart, beatsPerBar);
}
