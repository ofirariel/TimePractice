import { describe, expect, it } from 'vitest';
import {
  DEFAULT_YOUTUBE_SETTINGS,
  loadYouTubeSettings,
  pruneVideos,
  recentVideos,
  sanitizeYouTubeSettings,
  saveYouTubeSettings,
  type VideoGrid,
} from '../src/state/youtube-settings';
import { loadSource, saveSource } from '../src/state/source';

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

const grid = (savedAt: number, extra: Partial<VideoGrid> = {}): VideoGrid => ({
  bpm: 92.5, beatsPerBar: 4, beatUnit: 4, offset: 0.4, aligned: true, title: 'Track', savedAt, ...extra,
});

describe('youtube settings', () => {
  it('defaults when empty or broken', () => {
    expect(loadYouTubeSettings(memoryStorage())).toEqual(DEFAULT_YOUTUBE_SETTINGS);
    expect(loadYouTubeSettings({ getItem: () => '][' })).toEqual(DEFAULT_YOUTUBE_SETTINGS);
  });

  it('saves a grid per video and reads it back', () => {
    const storage = memoryStorage();
    const s = { ...DEFAULT_YOUTUBE_SETTINGS, lastVideoId: 'dQw4w9WgXcQ', calibrationMs: 85, videos: { dQw4w9WgXcQ: grid(1) } };
    saveYouTubeSettings(s, storage);
    expect(loadYouTubeSettings(storage)).toEqual(s);
  });

  it('drops invalid videos and clamps values', () => {
    const s = sanitizeYouTubeSettings({
      lastVideoId: 'not an id',
      calibrationMs: 5000,
      videos: {
        'bad id': grid(1),
        aaaaaaaaaaa: { bpm: 'fast' },
        bbbbbbbbbbb: { ...grid(2), bpm: 1000, beatsPerBar: 4, offset: 99, beatUnit: 3 },
      },
    });
    expect(s.lastVideoId).toBe('');
    expect(s.calibrationMs).toBe(300);
    expect(Object.keys(s.videos)).toEqual(['bbbbbbbbbbb']);
    expect(s.videos.bbbbbbbbbbb.bpm).toBe(400);
    expect(s.videos.bbbbbbbbbbb.offset).toBeCloseTo(0.6, 9); // one bar at 400 BPM
    expect(s.videos.bbbbbbbbbbb.beatUnit).toBe(4);
  });

  it('keeps only the most recently used videos', () => {
    const videos: Record<string, VideoGrid> = {};
    for (let i = 0; i < 10; i++) videos[`video${String(i).padStart(6, '0')}`] = grid(i);
    const kept = pruneVideos(videos, 3);
    expect(Object.keys(kept).sort()).toEqual(['video000007', 'video000008', 'video000009']);
    expect(recentVideos({ ...DEFAULT_YOUTUBE_SETTINGS, videos }, 2).map((v) => v.id)).toEqual(['video000009', 'video000008']);
  });

  it('remembers the chosen source', () => {
    const storage = memoryStorage();
    expect(loadSource(storage)).toBe('metronome');
    saveSource('youtube', storage);
    expect(loadSource(storage)).toBe('youtube');
  });
});
