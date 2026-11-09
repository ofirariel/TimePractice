import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { analyzeOnsets, detectBeat, downbeatOffset, type OnsetTrack } from '../core/beat-detect';
import { formatClock } from '../core/format';
import type { Position } from '../core/grid';
import { makeSeed } from '../core/rng';
import { nudgeOffset } from '../core/tap-align';
import { getAudioContext, installAudioResume, unlockAudio } from '../sources/audio-context';
import { CLICK_SOUNDS, nextBeatLevel, type BeatLevel, type ClickSound } from '../sources/click-sounds';
import { FileSession, MAX_FILE_SECONDS } from '../sources/file-session';
import { previewClick } from '../sources/metronome';
import type { SessionSummary } from '../sources/session';
import { LIMITS, loadSettings, saveSettings, toScheduleOptions, type Settings } from '../state/settings';
import { useWakeLock } from './App';
import { NumberField, Row } from './controls';
import { PlayPanel } from './PlayPanel';
import { SessionTimeline } from './SessionTimeline';
import { SilenceSettings } from './SilenceSettings';

interface Track {
  name: string;
  buffer: AudioBuffer;
  onsets: OnsetTrack;
}

interface TrackGrid {
  bpm: number;
  beatsPerBar: number;
  beatUnit: number;
  offset: number;
  /** Time of one detected beat, so the downbeat can be re-estimated. */
  beatTime: number;
  confidence: number;
  /** The downbeat was moved by hand, so a time-signature change won't undo it. */
  moved: boolean;
}

function clampBpm(bpm: number): number {
  return Math.min(LIMITS.bpm.max, Math.max(LIMITS.bpm.min, Math.round(bpm * 10) / 10));
}

function downmix(buffer: AudioBuffer): Float32Array {
  const length = buffer.length;
  const out = new Float32Array(length);
  const scale = 1 / buffer.numberOfChannels;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) out[i] += data[i] * scale;
  }
  return out;
}

export function FileMode({ top }: { top?: ComponentChildren }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [track, setTrack] = useState<Track | null>(null);
  const [grid, setGrid] = useState<TrackGrid | null>(null);
  const [clickOn, setClickOn] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const session = useRef<FileSession | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => saveSettings(settings), [settings]);
  useWakeLock(playing);
  useEffect(() => (playing ? installAudioResume() : undefined), [playing]);
  useEffect(() => () => void session.current?.stop(), []);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const loop = () => {
      const current = session.current;
      if (current) {
        const next = current.position();
        setPosition((prev) => (prev?.beatIndex === next?.beatIndex ? prev : next));
        setElapsed(Math.floor(current.elapsed()));
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const stop = () => {
    let result: SessionSummary | undefined;
    try {
      result = session.current?.stop();
    } catch {
      // The button must still leave the playing state if the audio graph throws.
    }
    session.current = null;
    setPlaying(false);
    if (result) setSummary(result);
  };

  const loadFile = async (file: File) => {
    stop();
    setTrack(null);
    setGrid(null);
    setSummary(null);
    setPosition(null);
    setElapsed(0);
    setError(null);
    const looksAudio = file.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|mp4|ogg|flac|webm)$/i.test(file.name);
    if (!looksAudio) {
      setError('Choose an audio file, such as an mp3, wav or m4a.');
      return;
    }
    setBusy('Reading the file…');
    try {
      const ctx = await unlockAudio();
      const decoded = await ctx.decodeAudioData((await file.arrayBuffer()).slice(0));
      if (decoded.duration > MAX_FILE_SECONDS) {
        setError(`That track is ${formatClock(decoded.duration)} long. Please use one under 10 minutes.`);
        setBusy(null);
        return;
      }
      setBusy('Finding the beat…');
      await new Promise((resolve) => setTimeout(resolve, 30));
      const onsets = analyzeOnsets(downmix(decoded), decoded.sampleRate);
      const found = detectBeat(onsets, settings.beatsPerBar);
      setTrack({ name: file.name, buffer: decoded, onsets });
      setGrid({
        bpm: found.bpm,
        beatsPerBar: settings.beatsPerBar,
        beatUnit: settings.beatUnit,
        offset: found.offset,
        beatTime: found.beatTime,
        confidence: found.confidence,
        moved: false,
      });
    } catch {
      setError("Couldn't read that file. Try an mp3, wav or m4a.");
    } finally {
      setBusy(null);
      if (input.current) input.current.value = '';
    }
  };

  const updateGrid = (patch: Partial<TrackGrid>) => setGrid((g) => (g ? { ...g, ...patch } : g));

  const onBpm = (bpm: number) => {
    if (!grid) return;
    updateGrid({ bpm, offset: nudgeOffset(grid.offset, 0, bpm, grid.beatsPerBar) });
  };

  const onBeats = (beatsPerBar: number) => {
    if (!grid || !track) return;
    const offset = grid.moved ? nudgeOffset(grid.offset, 0, grid.bpm, beatsPerBar) : downbeatOffset(track.onsets, grid.bpm, grid.beatTime, beatsPerBar);
    updateGrid({ beatsPerBar, offset });
  };

  const scaleTempo = (factor: number) => {
    if (!grid) return;
    const bpm = clampBpm(grid.bpm * factor);
    updateGrid({ bpm, offset: nudgeOffset(grid.offset, 0, bpm, grid.beatsPerBar) });
  };

  const shiftBeat = (direction: number) => {
    if (!grid) return;
    updateGrid({ offset: nudgeOffset(grid.offset, (direction * 60) / grid.bpm, grid.bpm, grid.beatsPerBar), moved: true });
  };

  const update = (patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    if (patch.volume !== undefined) session.current?.setVolume(patch.volume);
  };
  const updateSilence = (patch: Partial<Settings['silence']>) => setSettings((s) => ({ ...s, silence: { ...s.silence, ...patch } }));

  const preview = (sound: ClickSound, level: BeatLevel) => {
    if (playing || level === 'off') return;
    const ctx = getAudioContext();
    void unlockAudio().catch(() => {});
    previewClick(ctx, sound, level, settings.volume);
  };

  const start = () => {
    if (!track || !grid) return;
    setError(null);
    try {
      const ctx = getAudioContext();
      void unlockAudio().catch((e) => {
        session.current?.stop();
        session.current = null;
        setPlaying(false);
        setError(`Couldn't play that file: ${e instanceof Error ? e.message : String(e)}`);
      });
      const seed = settings.silence.seed.trim() || makeSeed();
      const base = toScheduleOptions(settings, seed);
      const schedule = base && { ...base, bpm: grid.bpm, beatsPerBar: grid.beatsPerBar };
      session.current = new FileSession(
        ctx,
        track.buffer,
        { bpm: grid.bpm, beatsPerBar: grid.beatsPerBar, offset: grid.offset },
        schedule,
        settings.volume,
        clickOn ? { sound: settings.sound, beatLevels: settings.beatLevels } : null,
        (result) => {
          session.current = null;
          setPlaying(false);
          setSummary(result);
        },
      );
      setSummary(null);
      setPosition(null);
      setElapsed(0);
      setPlaying(true);
    } catch (e) {
      setError(`Couldn't play that file: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const levelName: Record<BeatLevel, string> = { accent: 'accent', normal: 'normal', soft: 'soft', off: 'silent' };

  return (
    <main class="app">
      <header class="app-header">
        <h1>TimePractice</h1>
        <p>Play along with a track from your device. It goes quiet on the beat — keep playing, and check you're still in time when it comes back.</p>
      </header>
      {top}

      <section
        class={`card${dragging ? ' over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!playing) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (playing) return;
          const file = e.dataTransfer?.files?.[0];
          if (file) void loadFile(file);
        }}
      >
        <h2>Audio file</h2>
        {track && grid ? (
          <>
            <p class="track-name" title={track.name}>
              {track.name}
            </p>
            <p class="muted small-note">
              {formatClock(track.buffer.duration)}
              {grid.confidence === 0 ? ' · No clear beat found — set the tempo yourself, then check with the click.' : ' · Beat found. Check it with the click, and fix it below if needed.'}
            </p>
            <button type="button" class="small-button" disabled={playing} onClick={() => input.current?.click()}>
              Choose a different track
            </button>
          </>
        ) : (
          <div class={`dropzone${dragging ? ' over' : ''}`}>
            <label class="file-button">
              Choose a track
              <input
                ref={input}
                type="file"
                accept="audio/*,.mp3,.wav,.m4a,.aac,.mp4,.ogg,.flac"
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0];
                  if (file) void loadFile(file);
                }}
              />
            </label>
            <p class="muted">or drop an audio file here</p>
            <p class="muted small-note">mp3, wav or m4a, up to 10 minutes. The file stays on this device and is forgotten when you leave or load another one.</p>
          </div>
        )}
        {busy && <p class="status-note">{busy}</p>}
        {error && <p class="error">{error}</p>}
        {/* The picker stays mounted so "choose a different track" can use it. */}
        {track && (
          <input
            ref={input}
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.aac,.mp4,.ogg,.flac"
            hidden
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              if (file) void loadFile(file);
            }}
          />
        )}
      </section>

      {track && grid && (
        <>
          <PlayPanel
            running={playing}
            position={position}
            elapsed={elapsed}
            bpm={grid.bpm}
            beatsPerBar={grid.beatsPerBar}
            beatUnit={grid.beatUnit}
            silenceMode={settings.silence.mode}
            alwaysShowPosition
            startLabel="Play"
            onToggle={playing ? stop : start}
          />
          {playing && <p class="locked-note">Stop to change the track, tempo or silences. Volume works any time.</p>}

          {summary && !playing && (
            <SessionTimeline summary={summary} seedInUse={settings.silence.seed.trim() === summary.seed} onReuseSeed={(seed) => updateSilence({ seed })} />
          )}

          <section class="card">
            <h2>The beat</h2>
            <fieldset disabled={playing}>
              <Row label="Tempo" hint="Detected from the track. Change it if the click drifts.">
                <NumberField label="Tempo" suffix="BPM" value={grid.bpm} min={LIMITS.bpm.min} max={LIMITS.bpm.max} step={0.1} onChange={onBpm} />
              </Row>
              <Row label="Half or double?">
                <div class="pair-buttons">
                  <button type="button" onClick={() => scaleTempo(0.5)} disabled={grid.bpm / 2 < LIMITS.bpm.min}>
                    ÷2 slower
                  </button>
                  <button type="button" onClick={() => scaleTempo(2)} disabled={grid.bpm * 2 > LIMITS.bpm.max}>
                    ×2 faster
                  </button>
                </div>
              </Row>
              <Row label="Time signature">
                <div class="time-sig">
                  <NumberField label="Beats per bar" value={grid.beatsPerBar} min={LIMITS.beatsPerBar.min} max={LIMITS.beatsPerBar.max} step={1} onChange={onBeats} />
                  <span class="slash">/</span>
                  <select aria-label="Beat value" value={grid.beatUnit} onChange={(e) => updateGrid({ beatUnit: Number(e.currentTarget.value) })}>
                    {LIMITS.beatUnits.map((u) => (
                      <option value={u}>{u}</option>
                    ))}
                  </select>
                </div>
              </Row>
              <Row label="Bar 1 on the wrong beat?">
                <div class="pair-buttons">
                  <button type="button" onClick={() => shiftBeat(-1)}>
                    ← 1 beat earlier
                  </button>
                  <button type="button" onClick={() => shiftBeat(1)}>
                    1 beat later →
                  </button>
                </div>
              </Row>
            </fieldset>
            <Row label="Click with the track" hint="A click on the detected beat, so you can hear whether it sits right.">
              <button type="button" class={`small-button${clickOn ? ' on' : ''}`} disabled={playing} onClick={() => setClickOn((v) => !v)}>
                {clickOn ? 'Click on' : 'Click off'}
              </button>
            </Row>
          </section>

          <section class="card">
            <h2>Click sound</h2>
            <Row label="Sound">
              <div class="sound-grid" role="radiogroup" aria-label="Click sound">
                {CLICK_SOUNDS.map((c) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={c.value === settings.sound}
                    class={c.value === settings.sound ? 'active' : ''}
                    disabled={playing}
                    onClick={() => {
                      update({ sound: c.value });
                      preview(c.value, 'accent');
                    }}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Beats" hint="Same as the metronome: tap a beat to change it.">
              <div class="beat-levels">
                {settings.beatLevels.slice(0, grid.beatsPerBar).map((level, i) => (
                  <button
                    type="button"
                    class={`beat-level ${level}`}
                    disabled={playing}
                    aria-label={`Beat ${i + 1}: ${levelName[level]}`}
                    onClick={() => {
                      const beatLevels = settings.beatLevels.slice();
                      beatLevels[i] = nextBeatLevel(beatLevels[i]);
                      update({ beatLevels });
                      preview(settings.sound, beatLevels[i]);
                    }}
                  >
                    <span class="beat-level-bar" aria-hidden="true" />
                    <span class="beat-level-num">{i + 1}</span>
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Volume">
              <input
                type="range"
                class="slider"
                aria-label="Volume"
                min={0}
                max={1}
                step={0.01}
                value={settings.volume}
                onInput={(e) => update({ volume: Number(e.currentTarget.value) })}
              />
            </Row>
          </section>

          <SilenceSettings silence={settings.silence} update={updateSilence} locked={playing} />
        </>
      )}

      <footer class="app-footer">
        <a href="https://github.com/ofirariel/TimePractice">Open source (MIT)</a>
      </footer>
    </main>
  );
}
