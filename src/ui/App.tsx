import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Position } from '../core/grid';
import { makeSeed } from '../core/rng';
import { getAudioContext, installAudioResume, unlockAudio } from '../sources/audio-context';
import type { BeatLevel, ClickSound } from '../sources/click-sounds';
import { previewClick } from '../sources/metronome';
import { PracticeSession, type SessionSummary } from '../sources/session';
import { loadSettings, saveSettings, toScheduleOptions, type Settings } from '../state/settings';
import { MetronomeSettings } from './MetronomeSettings';
import { PlayPanel } from './PlayPanel';
import { SessionTimeline } from './SessionTimeline';
import { SilenceSettings } from './SilenceSettings';

/** Keeps the phone screen on while practising, where the browser supports it. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = () => {
      if (document.visibilityState !== 'visible') return;
      navigator.wakeLock.request('screen').then(
        (l) => (cancelled ? void l.release() : (lock = l)),
        () => {},
      );
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release();
    };
  }, [active]);
}

export function App({ top }: { top?: ComponentChildren }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [running, setRunning] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const session = useRef<PracticeSession | null>(null);

  useEffect(() => saveSettings(settings), [settings]);
  useWakeLock(running);
  useEffect(() => (running ? installAudioResume() : undefined), [running]);

  useEffect(() => {
    if (!running) return;
    let frame = 0;
    const loop = () => {
      const s = session.current;
      if (s) {
        const p = s.position();
        setPosition((prev) => (prev?.beatIndex === p?.beatIndex ? prev : p));
        setElapsed(Math.floor(s.elapsedSeconds()));
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [running]);

  useEffect(() => () => void session.current?.stop(), []);

  const update = (patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    if (patch.volume !== undefined) session.current?.setVolume(patch.volume);
    if (patch.sound !== undefined) session.current?.setClickSound(patch.sound);
    if (patch.beatLevels !== undefined) session.current?.setBeatLevels(patch.beatLevels);
  };
  const preview = (sound: ClickSound, level: BeatLevel) => {
    if (running || level === 'off') return;
    const ctx = getAudioContext();
    // Start the buffer in this tap. Waiting on resume() runs the click after the gesture, which some browsers drop.
    void unlockAudio().catch(() => {});
    previewClick(ctx, sound, level, settings.volume);
  };
  const updateSilence = (patch: Partial<Settings['silence']>) => setSettings((s) => ({ ...s, silence: { ...s.silence, ...patch } }));

  const start = () => {
    setError(null);
    try {
      const ctx = getAudioContext();
      void unlockAudio().catch((e) => {
        session.current?.stop();
        session.current = null;
        setRunning(false);
        setError(`Couldn't start the sound: ${e instanceof Error ? e.message : String(e)}`);
      });
      const seed = settings.silence.seed.trim() || makeSeed();
      session.current = new PracticeSession(ctx, {
        bpm: settings.bpm,
        beatsPerBar: settings.beatsPerBar,
        beatLevels: settings.beatLevels,
        sound: settings.sound,
        volume: settings.volume,
        schedule: toScheduleOptions(settings, seed),
      });
      setSummary(null);
      setPosition(null);
      setElapsed(0);
      setRunning(true);
    } catch (e) {
      session.current = null;
      setRunning(false);
      setError(`Couldn't start the sound: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const stop = () => {
    const s = session.current;
    session.current = null;
    setRunning(false);
    if (s) setSummary(s.stop());
  };

  return (
    <main class="app">
      <header class="app-header">
        <h1>TimePractice</h1>
        <p>Keep playing through the silences. When the click comes back, are you still with it?</p>
      </header>
      {top}

      <PlayPanel
        running={running}
        position={position}
        elapsed={elapsed}
        bpm={settings.bpm}
        beatsPerBar={settings.beatsPerBar}
        beatUnit={settings.beatUnit}
        silenceMode={settings.silence.mode}
        onToggle={running ? stop : start}
      />
      {error && <p class="error">{error}</p>}
      {running && <p class="locked-note">Stop to change tempo, time signature or silences. Beats, sound and volume work any time.</p>}

      {summary && !running && (
        <SessionTimeline
          summary={summary}
          seedInUse={settings.silence.seed.trim() === summary.seed}
          onReuseSeed={(seed) => updateSilence({ seed })}
        />
      )}

      <MetronomeSettings settings={settings} update={update} onPreview={preview} locked={running} />
      <SilenceSettings silence={settings.silence} update={updateSilence} locked={running} />

      <footer class="app-footer">
        <a href="https://github.com/ofirariel/TimePractice">Open source (MIT)</a>
      </footer>
    </main>
  );
}
