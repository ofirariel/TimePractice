# TimePractice

A free practice tool for keeping time. A metronome plays, then goes silent at random. You keep playing through the silence, and when the click comes back you hear straight away whether you're still with it.

**Use it here: <https://ofirariel.github.io/TimePractice/>** — it runs in the browser on a Mac (Chrome or Safari) or an Android phone (Chrome). Nothing to install, no account.

## How to use it

1. Set your **tempo** and **time signature**. Under **Beats**, tap each beat to make it an accent, normal, soft or silent click (by default the 1 is accented). Pick a click **Sound**: classic, woodblock, cowbell or soft beep. Beats, sound and volume can be changed while playing.
2. Under **Silences**, pick a mode and whether to measure in **bars** or **seconds**:
   - **Fixed** (the default) – the same pattern over and over: *silent for N every M*. For example "silent for 2 every 4 bars" plays two bars, then two bars of silence, and repeats.
   - **Random** – silences of varying length at unpredictable places:
     - **Silence length** – how long the sound goes quiet. *Exact* always uses the same length; *Range* picks a new length each time.
     - **Gap between silences** – how long you hear the sound in between, exact or a range.
     - **Surprise** – after each gap, the chance per bar that the next silence starts. At 100% it starts right away; lower values make silences less predictable.
     - **Pattern seed** (optional) – type any word or number to get exactly the same pattern every time. Leave it empty for a new pattern each session.
   - **Off** – no silences.
   - In Fixed and Random, **Warm-up** keeps the start unmuted, so you can lock in first.
3. Press **Start**. The big counter shows the bar and beat. Silences are not shown on screen – you only hear them.
4. Press **Stop**. The **Last session** panel shows where the silences fell. To practise the same pattern again, press **Repeat this pattern**.

### Audio file

Choose **Audio file**, then pick an mp3, wav or m4a from your Mac or phone (or drop it onto the page). Tracks over 10 minutes are turned away. The app listens for the tempo and where bar 1 starts. Nothing about the file is saved: it stays in memory and is forgotten when you leave or load another one.

- If the tempo is half or double what you expected, tap **÷2 slower** or **×2 faster**.
- If the click's "1" is on the wrong beat, tap **1 beat earlier** or **1 beat later**.
- You can also type the tempo yourself. Turn on **Click with the track** to hear whether the grid sits on the music.
- Fixed, Random and Off silences all work, and they cut the track exactly on the beat.

Your settings are remembered in the browser.

**Tip:** use wired headphones or the built-in speakers. Bluetooth headphones add a delay, so the on-screen counter will look slightly ahead of what you hear (the silences themselves stay on the beat).

## Playing along with a YouTube track

1. At the top, choose **YouTube**. Paste a link from YouTube's *Share* button and press **Load**. The video appears small on the page.
2. Set the **time signature**, press play, then press **Detect tempo**.
   - On a Mac, Chrome asks to share this tab. Choose this tab and turn on **Share tab audio**. It listens for about 12 seconds.
   - On an Android phone, the microphone listens to the speaker. Turn the volume up and let the phone hear the track.
3. If the tempo comes out half or double, tap **÷2 slower** or **×2 faster**. If the "1" is on the wrong beat, tap **1 beat earlier / later**. You can still type the tempo, or tap **Tap on the 1** on every downbeat, if you'd rather line it up by hand.
4. To check, turn on **Play a click with the video**. If the click sounds slightly before or after the music, use **10 ms earlier / later**. If the click slowly drifts away over the song, the tempo is a little off: adjust it by 0.1.
5. Press **Start practice**. The video goes quiet on the beat, using the same silence settings as the metronome, lined up with the tempo just found. Press **Stop** to see where the silences fell.

The tempo and alignment are saved for each video, so next time just load it and press Start practice. Recently used videos appear under the link box.

- **Mute timing.** YouTube takes a moment to react, so mutes are sent a little early (60 ms to start with). If you still hear the start of the first silent beat, move the slider right. If the music cuts out before the beat, move it left. Mutes are on the beat by ear, not to the millisecond like the metronome.
- **Pausing, ads and buffering** put the silences on hold until the video plays again. Silences only work at normal playback speed.
- Some videos can't be played outside YouTube because their owner blocks it. The app says so. Try another upload of the same track.
- On Android, keep the screen on while practising. YouTube stops when the screen turns off.

## Roadmap

1. Metronome with random and fixed silences (done)
2. Custom silence regions ("mute bars 5–6 and 13–16"), muted light, reveal-the-schedule option
3. YouTube backing tracks (done)
4. Audio files from your device, with automatic beat alignment (done)
5. Install as an app, offline use, polish

## For developers

Built with [Vite](https://vite.dev), TypeScript and [Preact](https://preactjs.com); tests use [Vitest](https://vitest.dev). Requires Node 22+.

```bash
npm install
npm run dev      # local dev server at http://localhost:5173/TimePractice/
npm test         # unit tests
npm run build    # type-check and build into dist/
```

- `src/core/` – pure logic with no audio or UI: seeded random numbers, the random silence schedule, bar/beat ↔ seconds maths, YouTube link parsing, tap-along alignment, beat detection, and the smoothed video clock (`video-clock.ts`). Fully unit-tested in `tests/`.
- `src/sources/youtube-*.ts` – the official YouTube IFrame Player API (loaded from YouTube, not bundled) and the engine that mutes the player during silences and plays the optional click in time with the video.
- `src/sources/` – Web Audio engine. A lookahead scheduler books clicks and mutes slightly ahead on the audio clock. Every source plays through one master gain (`mute-gate.ts`), and each mute is a 5 ms fade that finishes exactly on the beat.
- `src/ui/` – Preact screens. `src/state/settings.ts` – settings saved in `localStorage`.

Every push to `main` is tested, built and published to GitHub Pages by `.github/workflows/deploy.yml`.

## License

[MIT](LICENSE)
