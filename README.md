# TimePractice

A free practice tool for keeping time. A metronome plays, then goes silent at random. You keep playing through the silence, and when the click comes back you hear straight away whether you're still with it.

**Use it here: <https://ofirariel.github.io/TimePractice/>** — it runs in the browser on a Mac (Chrome or Safari) or an Android phone (Chrome). Nothing to install, no account.

## How to use it

1. Set your **tempo** and **time signature**. Under **Beats**, tap each beat to make it an accent, normal, soft or silent click (by default the 1 is accented). Pick a click **Sound**: classic, woodblock, cowbell or soft beep. Beats, sound and volume can be changed while playing.
2. Under **Random silences**, choose whether to measure in **bars** or **seconds**, then set:
   - **Silence length** – how long the click goes quiet. *Fixed* always uses the same length; *Random range* picks a new length each time.
   - **Gap between silences** – how long you hear the click in between, fixed or a range.
   - **Warm-up** – nothing is muted at the start, so you can lock in first.
   - **Surprise** – after each gap, the chance per bar that the next silence starts. At 100% it starts right away; lower values make silences less predictable.
   - **Pattern seed** (optional) – type any word or number to get exactly the same pattern every time. Leave it empty for a new pattern each session.
3. Press **Start**. The big counter shows the bar and beat. Silences are not shown on screen – you only hear them.
4. Press **Stop**. The **Last session** panel shows where the silences fell. To practise the same pattern again, press **Repeat this pattern**.

Your settings are remembered in the browser.

**Tip:** use wired headphones or the built-in speakers. Bluetooth headphones add a delay, so the on-screen counter will look slightly ahead of what you hear (the silences themselves stay on the beat).

## Roadmap

1. Metronome with random silences (done)
2. Fixed silences ("mute bars 5–6 and 13–16"), muted light, reveal-the-schedule option
3. YouTube backing tracks
4. Audio files from your device, with automatic beat alignment
5. Install as an app, offline use, polish

## For developers

Built with [Vite](https://vite.dev), TypeScript and [Preact](https://preactjs.com); tests use [Vitest](https://vitest.dev). Requires Node 22+.

```bash
npm install
npm run dev      # local dev server at http://localhost:5173/TimePractice/
npm test         # unit tests
npm run build    # type-check and build into dist/
```

- `src/core/` – pure logic with no audio or UI: seeded random numbers, the random silence schedule, and bar/beat ↔ seconds maths. Fully unit-tested in `tests/`.
- `src/sources/` – Web Audio engine. A lookahead scheduler books clicks and mutes slightly ahead on the audio clock. Every source plays through one master gain (`mute-gate.ts`), and each mute is a 5 ms fade that finishes exactly on the beat.
- `src/ui/` – Preact screens. `src/state/settings.ts` – settings saved in `localStorage`.

Every push to `main` is tested, built and published to GitHub Pages by `.github/workflows/deploy.yml`.

## License

[MIT](LICENSE)
