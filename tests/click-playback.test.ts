import { describe, expect, it } from 'vitest';
import { Metronome } from '../src/sources/metronome';
import { PracticeSession } from '../src/sources/session';

function gainNode() {
  return {
    gain: {
      value: 1,
      setValueAtTime() {},
      linearRampToValueAtTime() {},
      setTargetAtTime() {},
      cancelScheduledValues() {},
    },
    connect(dest: unknown) {
      return dest;
    },
    disconnect() {},
  };
}

describe('click playback', () => {
  it('writes the click and starts it on browsers without copyToChannel', () => {
    const data = new Float32Array(48000);
    const starts: number[] = [];
    const ctx = {
      sampleRate: 48000,
      currentTime: 5,
      createBuffer() {
        return { getChannelData: () => data };
      },
      createBufferSource() {
        return {
          buffer: null,
          connect() {},
          start(when: number) {
            starts.push(when);
          },
        };
      },
    };
    new Metronome(ctx as unknown as BaseAudioContext, {} as AudioNode, 'classic').click(5.2, 'accent');
    expect(starts).toEqual([5.2]);
    expect(data.some((sample) => sample !== 0)).toBe(true);
  });

  it('a rejected click does not escape and block the next one', () => {
    let started = 0;
    const ctx = {
      sampleRate: 48000,
      currentTime: 1,
      createBuffer() {
        return { copyToChannel() {}, getChannelData: () => new Float32Array(100) };
      },
      createBufferSource() {
        return {
          buffer: null,
          connect() {},
          start() {
            started++;
            throw new Error('not allowed');
          },
        };
      },
    };
    const metronome = new Metronome(ctx as unknown as BaseAudioContext, {} as AudioNode, 'classic');
    expect(() => metronome.click(1.1, 'normal')).not.toThrow();
    expect(() => metronome.click(1.2, 'normal')).not.toThrow();
    expect(started).toBe(2);
  });

  it('books the opening metronome click in Start, before the timer wakes', () => {
    const starts: number[] = [];
    const ctx = {
      state: 'running' as AudioContextState,
      sampleRate: 48000,
      currentTime: 10,
      destination: {},
      outputLatency: 0,
      baseLatency: 0,
      resume: () => Promise.resolve(),
      createGain: gainNode,
      createBuffer(_channels: number, length: number) {
        const data = new Float32Array(length);
        return {
          getChannelData: () => data,
          copyToChannel(src: Float32Array) {
            data.set(src.subarray(0, data.length));
          },
        };
      },
      createBufferSource() {
        return {
          buffer: null,
          connect() {},
          start(when: number) {
            starts.push(when);
          },
        };
      },
    };
    const session = new PracticeSession(ctx as unknown as AudioContext, {
      bpm: 100,
      beatsPerBar: 4,
      beatLevels: ['accent', 'normal', 'normal', 'normal'],
      sound: 'classic',
      volume: 0.8,
      schedule: null,
    });
    expect(starts).toEqual([10.2]);
    session.stop();
  });

  it('books nothing while the context is suspended, and asks it to resume', () => {
    let resumes = 0;
    const starts: number[] = [];
    const ctx = {
      state: 'suspended' as AudioContextState,
      sampleRate: 48000,
      currentTime: 10,
      destination: {},
      outputLatency: 0,
      baseLatency: 0,
      resume: () => {
        resumes++;
        return Promise.resolve();
      },
      createGain: gainNode,
      createBuffer() {
        return { copyToChannel() {}, getChannelData: () => new Float32Array(8) };
      },
      createBufferSource() {
        return {
          buffer: null,
          connect() {},
          start(when: number) {
            starts.push(when);
          },
        };
      },
    };
    const session = new PracticeSession(ctx as unknown as AudioContext, {
      bpm: 100,
      beatsPerBar: 4,
      beatLevels: ['accent', 'normal', 'normal', 'normal'],
      sound: 'classic',
      volume: 0.8,
      schedule: null,
    });
    expect(starts).toEqual([]);
    expect(resumes).toBeGreaterThan(0);
    session.stop();
  });
});
