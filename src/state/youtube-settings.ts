import { LIMITS } from './settings';

/** Everything needed to line the bar grid up with one video. */
export interface VideoGrid {
  bpm: number;
  beatsPerBar: number;
  beatUnit: number;
  /** Video time (seconds) of a downbeat, within the first bar. */
  offset: number;
  /** True once the user has tapped along or nudged, i.e. the offset means something. */
  aligned: boolean;
  title: string;
  savedAt: number;
}

export interface YouTubeSettings {
  lastVideoId: string;
  /** Mutes and unmutes are sent this many ms early to make up for the player's delay. */
  calibrationMs: number;
  clickOn: boolean;
  videos: Record<string, VideoGrid>;
}

export const CALIBRATION = { min: 0, max: 300, default: 60 } as const;
export const MAX_SAVED_VIDEOS = 100;

export const DEFAULT_YOUTUBE_SETTINGS: YouTubeSettings = {
  lastVideoId: '',
  calibrationMs: CALIBRATION.default,
  clickOn: false,
  videos: {},
};

const STORAGE_KEY = 'timepractice.youtube.v1';
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

function num(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function sanitizeGrid(raw: unknown): VideoGrid | null {
  const v = obj(raw);
  if (typeof v.bpm !== 'number' || !Number.isFinite(v.bpm)) return null;
  const bpm = Math.round(num(v.bpm, 100, LIMITS.bpm.min, LIMITS.bpm.max) * 10) / 10;
  const beatsPerBar = Math.round(num(v.beatsPerBar, 4, LIMITS.beatsPerBar.min, LIMITS.beatsPerBar.max));
  const bar = (60 * beatsPerBar) / bpm;
  return {
    bpm,
    beatsPerBar,
    beatUnit: (LIMITS.beatUnits as readonly number[]).includes(v.beatUnit as number) ? (v.beatUnit as number) : 4,
    offset: num(v.offset, 0, 0, bar),
    aligned: v.aligned === true,
    title: typeof v.title === 'string' ? v.title.slice(0, 200) : '',
    savedAt: num(v.savedAt, 0, 0, Number.MAX_SAFE_INTEGER),
  };
}

/** Keeps only the most recently used videos so storage can't grow forever. */
export function pruneVideos(videos: Record<string, VideoGrid>, max = MAX_SAVED_VIDEOS): Record<string, VideoGrid> {
  const entries = Object.entries(videos);
  if (entries.length <= max) return videos;
  entries.sort((a, b) => b[1].savedAt - a[1].savedAt);
  return Object.fromEntries(entries.slice(0, max));
}

export function sanitizeYouTubeSettings(raw: unknown): YouTubeSettings {
  const v = obj(raw);
  const videos: Record<string, VideoGrid> = {};
  for (const [id, grid] of Object.entries(obj(v.videos))) {
    const g = VIDEO_ID.test(id) ? sanitizeGrid(grid) : null;
    if (g) videos[id] = g;
  }
  return {
    lastVideoId: typeof v.lastVideoId === 'string' && VIDEO_ID.test(v.lastVideoId) ? v.lastVideoId : '',
    calibrationMs: Math.round(num(v.calibrationMs, CALIBRATION.default, CALIBRATION.min, CALIBRATION.max)),
    clickOn: v.clickOn === true,
    videos: pruneVideos(videos),
  };
}

export function loadYouTubeSettings(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): YouTubeSettings {
  try {
    const text = storage?.getItem(STORAGE_KEY);
    return sanitizeYouTubeSettings(text ? JSON.parse(text) : {});
  } catch {
    return sanitizeYouTubeSettings({});
  }
}

export function saveYouTubeSettings(settings: YouTubeSettings, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify({ ...settings, videos: pruneVideos(settings.videos) }));
  } catch {
    // Private browsing or full storage: settings just won't persist.
  }
}

/** Most recently used videos first. */
export function recentVideos(settings: YouTubeSettings, limit: number): { id: string; grid: VideoGrid }[] {
  return Object.entries(settings.videos)
    .sort((a, b) => b[1].savedAt - a[1].savedAt)
    .slice(0, limit)
    .map(([id, grid]) => ({ id, grid }));
}
