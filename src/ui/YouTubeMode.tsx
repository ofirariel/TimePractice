import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Position } from '../core/grid';
import { makeSeed } from '../core/rng';
import { nudgeOffset, offsetFromTaps, type TapResult } from '../core/tap-align';
import { parseVideoId } from '../core/youtube-url';
import { getAudioContext, unlockAudio } from '../sources/audio-context';
import type { SessionSummary } from '../sources/session';
import { createPlayer, describePlayerError, type YTPlayer } from '../sources/youtube-player';
import { wallNow, YouTubeEngine, type VideoStatus } from '../sources/youtube-session';
import { loadSettings, saveSettings, toScheduleOptions, type Settings } from '../state/settings';
import {
  CALIBRATION,
  loadYouTubeSettings,
  recentVideos,
  saveYouTubeSettings,
  type VideoGrid,
  type YouTubeSettings,
} from '../state/youtube-settings';
import { useWakeLock } from './App';
import { PlayPanel } from './PlayPanel';
import { SessionTimeline } from './SessionTimeline';
import { SilenceSettings } from './SilenceSettings';
import { YouTubeAlign } from './YouTubeAlign';
import './youtube.css';

const MAX_TAPS = 12;

function defaultGrid(settings: Settings): VideoGrid {
  return {
    bpm: settings.bpm,
    beatsPerBar: settings.beatsPerBar,
    beatUnit: settings.beatUnit,
    offset: 0,
    aligned: false,
    title: '',
    savedAt: Date.now(),
  };
}

function statusMessage(status: VideoStatus, practicing: boolean, started: boolean): string | null {
  switch (status) {
    case 'waiting':
      return "The video isn't moving (an ad, or slow internet?). Silences are on hold until it plays again.";
    case 'buffering':
      return practicing ? 'The video is loading. Silences are on hold.' : null;
    case 'speed':
      return "Set the video's speed back to Normal: silences and the click only work at normal speed.";
    case 'paused':
      return practicing ? 'Paused. Silences carry on when the video plays again.' : null;
    case 'ended':
      return 'End of the video.';
    case 'idle':
      return practicing && !started ? 'Press ▶ on the video to begin.' : null;
    default:
      return null;
  }
}

export function YouTubeMode({ top }: { top?: ComponentChildren }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  // The click always starts off: switching it on is the tap that browsers require before sound can play.
  const [yt, setYt] = useState<YouTubeSettings>(() => ({ ...loadYouTubeSettings(), clickOn: false }));
  const [urlText, setUrlText] = useState(yt.lastVideoId ? `https://youtu.be/${yt.lastVideoId}` : '');
  const [videoId, setVideoId] = useState<string | null>(yt.lastVideoId || null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<VideoStatus>('idle');
  const [position, setPosition] = useState<Position | null>(null);
  const [practicing, setPracticing] = useState(false);
  const [started, setStarted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [taps, setTaps] = useState<number[]>([]);
  const [tapResult, setTapResult] = useState<TapResult | null>(null);
  const [tapHint, setTapHint] = useState<string | null>(null);

  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const engine = useRef<YouTubeEngine | null>(null);

  const grid: VideoGrid = (videoId && yt.videos[videoId]) || defaultGrid(settings);

  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => saveYouTubeSettings(yt), [yt]);
  useWakeLock(practicing);

  const updateGrid = (patch: Partial<VideoGrid>) => {
    if (!videoId) return;
    setYt((s) => {
      const current = s.videos[videoId] ?? defaultGrid(settings);
      return { ...s, videos: { ...s.videos, [videoId]: { ...current, ...patch, savedAt: Date.now() } } };
    });
  };

  // Create a player for each video. YouTube replaces the element it's given, so it gets its own child node.
  useEffect(() => {
    const container = host.current;
    if (!videoId || !container) return;
    let cancelled = false;
    setReady(false);
    setError(null);
    setTaps([]);
    setTapResult(null);
    setTapHint(null);
    const el = document.createElement('div');
    container.replaceChildren(el);
    createPlayer(el, videoId, {
      onReady: (p) => {
        if (cancelled) return;
        player.current = p;
        engine.current = new YouTubeEngine(p, { bpm: grid.bpm, beatsPerBar: grid.beatsPerBar, offset: grid.offset });
        const title = p.getVideoData?.().title;
        if (title) updateGrid({ title });
        setReady(true);
      },
      onStateChange: () => {},
      onError: (code) => {
        if (cancelled) return;
        setError(describePlayerError(code));
        stopPractice();
      },
    })
      .then((p) => {
        if (cancelled) p.destroy();
        else player.current = p;
      })
      .catch(() => !cancelled && setError("Couldn't reach YouTube. Check your internet connection and try again."));
    return () => {
      cancelled = true;
      engine.current?.destroy();
      engine.current = null;
      player.current?.destroy();
      player.current = null;
      setPracticing(false);
    };
  }, [videoId]);

  useEffect(() => {
    engine.current?.setGrid({ bpm: grid.bpm, beatsPerBar: grid.beatsPerBar, offset: grid.offset });
  }, [ready, grid.bpm, grid.beatsPerBar, grid.offset]);

  useEffect(() => {
    if (engine.current) engine.current.calibration = yt.calibrationMs / 1000;
  }, [ready, yt.calibrationMs]);

  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    e.setClickOverlay(
      yt.clickOn ? { ctx: getAudioContext(), sound: settings.sound, beatLevels: settings.beatLevels, volume: settings.volume } : null,
    );
  }, [ready, yt.clickOn, settings.sound, settings.beatLevels, settings.volume]);

  // Safari can suspend audio at any time; any tap on the page lets it resume.
  useEffect(() => {
    if (!yt.clickOn) return;
    const resume = () => void unlockAudio().catch(() => {});
    const events = ['pointerdown', 'touchend', 'keydown'] as const;
    for (const e of events) document.addEventListener(e, resume, true);
    return () => {
      for (const e of events) document.removeEventListener(e, resume, true);
    };
  }, [yt.clickOn]);

  // Refresh the counter and status every frame.
  useEffect(() => {
    if (!ready) return;
    let frame = 0;
    const loop = () => {
      const e = engine.current;
      if (e) {
        const p = e.position();
        const visible = p && p.bar >= 0 ? p : null;
        setPosition((prev) => (prev?.beatIndex === visible?.beatIndex ? prev : visible));
        setStatus(e.videoStatus());
        setStarted(e.practiceStarted());
        setElapsed(Math.floor(e.practiceSeconds()));
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [ready]);

  useEffect(() => {
    if (practicing && status === 'ended') stopPractice();
  }, [practicing, status]);

  const load = (input = urlText) => {
    const id = parseVideoId(input);
    if (!id) {
      setError("That doesn't look like a YouTube link. Copy the address from YouTube's Share button and paste it here.");
      return;
    }
    setUrlText(input.trim());
    setError(null);
    setSummary(null);
    setYt((s) => ({ ...s, lastVideoId: id }));
    if (id === videoId) return;
    setVideoId(id);
  };

  const onTempo = (patch: Partial<Pick<VideoGrid, 'bpm' | 'beatsPerBar' | 'beatUnit'>>) => {
    const next = { ...grid, ...patch };
    const r = offsetFromTaps(taps, next.bpm, next.beatsPerBar);
    setTapResult(r);
    updateGrid(r ? { ...patch, offset: r.offset, aligned: true } : { ...patch, offset: nudgeOffset(grid.offset, 0, next.bpm, next.beatsPerBar) });
  };

  const onTap = (timeStamp: number) => {
    const e = engine.current;
    if (!e || practicing) return;
    const now = wallNow();
    const at = Math.abs(timeStamp / 1000 - now) < 1 ? timeStamp / 1000 : now;
    const t = e.videoTime(at);
    if (t === null) {
      setTapHint('Start the video first, then tap on every "1".');
      return;
    }
    setTapHint(null);
    const next = [...taps, t].slice(-MAX_TAPS);
    setTaps(next);
    const r = offsetFromTaps(next, grid.bpm, grid.beatsPerBar);
    setTapResult(r);
    if (r) updateGrid({ offset: r.offset, aligned: true });
  };

  const onNudge = (seconds: number) => {
    setTaps([]);
    setTapResult(null);
    updateGrid({ offset: nudgeOffset(grid.offset, seconds, grid.bpm, grid.beatsPerBar), aligned: true });
  };

  const onClick = (on: boolean) => {
    if (on) void unlockAudio().catch(() => {});
    setYt((s) => ({ ...s, clickOn: on }));
  };

  const startPractice = () => {
    const e = engine.current;
    if (!e) return;
    void unlockAudio().catch(() => {});
    const seed = settings.silence.seed.trim() || makeSeed();
    const options = settings.silence.enabled
      ? { ...toScheduleOptions(settings, seed), bpm: grid.bpm, beatsPerBar: grid.beatsPerBar }
      : null;
    e.startPractice(options);
    setSummary(null);
    setElapsed(0);
    setPracticing(true);
  };

  function stopPractice() {
    const s = engine.current?.stopPractice() ?? null;
    setPracticing(false);
    if (s) setSummary(s);
  }

  const updateSilence = (patch: Partial<Settings['silence']>) => setSettings((s) => ({ ...s, silence: { ...s.silence, ...patch } }));
  const recent = recentVideos(yt, 6).filter((v) => v.id !== videoId);
  const message = ready ? statusMessage(status, practicing, started) : null;

  return (
    <main class="app">
      <header class="app-header">
        <h1>TimePractice</h1>
        <p>Play along with a YouTube track. It goes quiet at random. Keep playing, and check you're still in time when it comes back.</p>
      </header>
      {top}

      <section class="card">
        <h2>YouTube track</h2>
        <form
          class="url-row"
          onSubmit={(e) => {
            e.preventDefault();
            const input = e.currentTarget.elements.namedItem('url');
            load(input instanceof HTMLInputElement ? input.value : urlText);
          }}
        >
          <input
            type="url"
            name="url"
            class="text-input"
            inputMode="url"
            placeholder="Paste a YouTube link"
            aria-label="YouTube link"
            value={urlText}
            disabled={practicing}
            onInput={(e) => setUrlText(e.currentTarget.value)}
          />
          <button type="submit" class="load-button" disabled={practicing}>
            Load
          </button>
        </form>
        {error && <p class="error">{error}</p>}
        {videoId && <div class="yt-player" ref={host} />}
        {grid.title && videoId && !error && <p class="video-title">{grid.title}</p>}
        {recent.length > 0 && !practicing && (
          <div class="recent">
            <span class="muted">Recent:</span>
            {recent.map((v) => (
              <button type="button" class="chip" onClick={() => load(`https://youtu.be/${v.id}`)}>
                {v.grid.title || v.id}
              </button>
            ))}
          </div>
        )}
        {!videoId && (
          <p class="muted small-note">
            Pick a backing track recorded to a steady tempo. You'll enter its BPM, then tap along once to line up the bars. It's saved for next time.
          </p>
        )}
      </section>

      {videoId && ready && !error && (
        <>
          <PlayPanel
            running={practicing}
            position={position}
            elapsed={elapsed}
            bpm={grid.bpm}
            beatsPerBar={grid.beatsPerBar}
            beatUnit={grid.beatUnit}
            silencesOn={settings.silence.enabled}
            alwaysShowPosition
            startLabel="Start practice"
            stopLabel="Stop"
            status={practicing ? undefined : grid.aligned ? 'Lined up' : 'Not lined up yet'}
            onToggle={practicing ? stopPractice : startPractice}
          />
          {message && <p class="status-note">{message}</p>}
          {practicing && <p class="locked-note">Stop to change the tempo, alignment or silences. The click and mute timing work any time.</p>}

          {summary && !practicing && (
            <SessionTimeline summary={summary} seedInUse={settings.silence.seed.trim() === summary.seed} onReuseSeed={(seed) => updateSilence({ seed })} />
          )}

          <YouTubeAlign
            grid={grid}
            locked={practicing}
            taps={taps.length}
            tapResult={tapResult}
            tapHint={tapHint}
            clickOn={yt.clickOn}
            onTempo={onTempo}
            onTap={onTap}
            onResetTaps={() => {
              setTaps([]);
              setTapResult(null);
            }}
            onNudge={onNudge}
            onClick={onClick}
          />

          <section class="card">
            <h2>Mute timing</h2>
            <p class="muted small-note">
              YouTube takes a moment to react, so mutes are sent a little early. If you still hear the start of the first silent beat, move this right. If the
              music cuts out before the beat, move it left.
            </p>
            <div class="slider-with-value">
              <input
                type="range"
                class="slider"
                aria-label="Send mutes early by"
                min={CALIBRATION.min}
                max={CALIBRATION.max}
                step={5}
                value={yt.calibrationMs}
                onInput={(e) => setYt((s) => ({ ...s, calibrationMs: Number(e.currentTarget.value) }))}
              />
              <output>{yt.calibrationMs} ms</output>
            </div>
          </section>

          <SilenceSettings silence={settings.silence} update={updateSilence} locked={practicing} />
        </>
      )}

      <footer class="app-footer">
        <a href="https://github.com/ofirariel/TimePractice">Open source (MIT)</a>
      </footer>
    </main>
  );
}
