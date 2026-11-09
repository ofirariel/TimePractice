import { describe, expect, it } from 'vitest';
import { drumTrack } from './drum-track';
import {
  LISTEN_SECONDS,
  detectListen,
  gridFromListen,
  listenFailureMessage,
  listenMethod,
  listenWasSteady,
  micAudioConstraints,
  tabCaptureOptions,
  type RecordedListen,
} from '../src/sources/listen';

function recorded(patch: Partial<RecordedListen> & { seconds?: number; rate?: number }): RecordedListen {
  const rate = patch.rate ?? 1000;
  const seconds = patch.seconds ?? LISTEN_SECONDS;
  return {
    samples: patch.samples ?? new Float32Array(Math.floor(rate * seconds)),
    sampleRate: rate,
    videoStart: patch.videoStart === undefined ? 10 : patch.videoStart,
    videoEnd: patch.videoEnd === undefined ? 10 + seconds : patch.videoEnd,
  };
}

describe('how a device listens', () => {
  it('uses the microphone on Android and tab audio on a Mac', () => {
    expect(listenMethod('Mozilla/5.0 (Linux; Android 14) Chrome/120.0.0.0 Mobile', true)).toBe('mic');
    expect(listenMethod('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0', true)).toBe('tab');
    expect(listenMethod('Mozilla/5.0 (Macintosh) Chrome/120.0.0.0', false)).toBe('mic');
  });

  it('asks Chrome to share this tab with its audio', () => {
    const options = tabCaptureOptions();
    expect(options.video).toBe(true);
    expect(options.audio).toBe(true);
    expect(options.preferCurrentTab).toBe(true);
    expect(options.selfBrowserSurface).toBe('include');
  });

  it('leaves echo cancellation off so the mic can hear the speaker', () => {
    const audio = micAudioConstraints().audio;
    expect(audio).toMatchObject({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });
  });

  it('explains a missing tab share and a blocked microphone', () => {
    expect(listenFailureMessage('tab', 'no-tab-audio')).toMatch(/Share tab audio/);
    expect(listenFailureMessage('mic', 'cancelled')).toMatch(/microphone/i);
    expect(listenFailureMessage('mic', 'cancelled')).not.toMatch(/tab/i);
  });
});

describe('lining a listen up with the video', () => {
  it('accepts a listen only when the video kept playing', () => {
    expect(listenWasSteady(recorded({}), LISTEN_SECONDS)).toBe(true);
    expect(listenWasSteady(recorded({ videoEnd: 12 }), LISTEN_SECONDS)).toBe(false);
    expect(listenWasSteady(recorded({ videoStart: null }), LISTEN_SECONDS)).toBe(false);
    expect(listenWasSteady(recorded({ samples: new Float32Array(100) }), LISTEN_SECONDS)).toBe(false);
  });

  it('places the detected downbeat on the video clock', () => {
    const onTheBar = gridFromListen({ bpm: 120, offset: 0.4, beatTime: 0.4, confidence: 0.5 }, 10, 4);
    expect(onTheBar?.bpm).toBe(120);
    expect(onTheBar?.offset).toBeCloseTo(0.4, 6);
    const wrapped = gridFromListen({ bpm: 120, offset: 0.8, beatTime: 0.8, confidence: 0.5 }, 9.5, 4);
    expect(wrapped?.offset).toBeCloseTo(0.3, 6);
    expect(gridFromListen({ bpm: 120, offset: 0, beatTime: 0, confidence: 0 }, 4, 4)).toBeNull();
  });

  it('detects tempo from a 12 second listen and shifts it by where the video was', () => {
    const samples = drumTrack(100, 0.37, 4, LISTEN_SECONDS);
    const videoStart = 25;
    const grid = detectListen({ samples, sampleRate: 22050, videoStart, videoEnd: videoStart + LISTEN_SECONDS }, 4);
    expect(grid).not.toBeNull();
    expect(Math.abs(grid!.bpm - 100)).toBeLessThanOrEqual(0.6);
    const bar = (60 / 100) * 4;
    const downbeat = videoStart + 0.37;
    const expected = downbeat % bar;
    const error = Math.min(Math.abs(grid!.offset - expected), bar - Math.abs(grid!.offset - expected));
    expect(error).toBeLessThan(0.05);
  });
});
