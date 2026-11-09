/** Player states from the IFrame Player API. */
export const PlayerState = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

/** The subset of the official YT.Player API that TimePractice uses. */
export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getPlaybackRate(): number;
  getVideoData?(): { title?: string; video_id?: string };
  destroy(): void;
}

interface YTNamespace {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      width?: string | number;
      height?: string | number;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (e: { target: YTPlayer }) => void;
        onStateChange?: (e: { data: number; target: YTPlayer }) => void;
        onError?: (e: { data: number; target: YTPlayer }) => void;
      };
    },
  ) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace & { loaded?: number };
    onYouTubeIframeAPIReady?: () => void;
  }
}

const API_URL = 'https://www.youtube.com/iframe_api';
let api: Promise<YTNamespace> | null = null;

/** Loads YouTube's official player script once (it is never bundled with the app). */
export function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player && window.YT.loaded) return Promise.resolve(window.YT);
  api ??= new Promise<YTNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT!);
    };
    const script = document.createElement('script');
    script.src = API_URL;
    script.async = true;
    script.onerror = () => {
      api = null;
      script.remove();
      reject(new Error('network'));
    };
    document.head.appendChild(script);
  });
  return api;
}

export interface PlayerEvents {
  onReady: (player: YTPlayer) => void;
  onStateChange: (state: number) => void;
  onError: (code: number) => void;
}

/** Replaces `element` with an embedded player for `videoId`. */
export async function createPlayer(element: HTMLElement, videoId: string, events: PlayerEvents): Promise<YTPlayer> {
  const YT = await loadYouTubeApi();
  return new YT.Player(element, {
    videoId,
    width: '100%',
    height: '100%',
    playerVars: {
      playsinline: 1,
      rel: 0,
      origin: window.location.origin,
    },
    events: {
      onReady: (e) => events.onReady(e.target),
      onStateChange: (e) => events.onStateChange(e.data),
      onError: (e) => events.onError(e.data),
    },
  });
}

/** Plain-language explanation of an IFrame API error code. */
export function describePlayerError(code: number): string {
  switch (code) {
    case 2:
      return "That link doesn't point to a YouTube video. Check it and try again.";
    case 5:
      return "This video can't be played in the browser's player. Try another video.";
    case 100:
      return 'This video has been removed or is private.';
    case 101:
    case 150:
      return "YouTube won't play this video here. Usually that's because its owner only allows it on YouTube itself. Try another upload of the same track.";
    case 153:
      return "YouTube refused to play the video here. Reload the page and try again.";
    default:
      return `YouTube couldn't play this video (error ${code}). Try another video.`;
  }
}
