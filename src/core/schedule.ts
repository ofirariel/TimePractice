import { FixedSchedule, type FixedScheduleOptions } from './schedule-fixed';
import { RandomSchedule, type RandomScheduleOptions, type Silence } from './schedule-random';
import type { SilenceSource } from './silence-cursor';

export type ScheduleOptions = ({ mode: 'fixed' } & FixedScheduleOptions) | ({ mode: 'random' } & RandomScheduleOptions);

/** An endless stream of silences for either mode. */
export function createSchedule(opts: ScheduleOptions): SilenceSource {
  return opts.mode === 'fixed' ? new FixedSchedule(opts) : new RandomSchedule(opts);
}

/** All silences that start before `untilBeat`. */
export function generateSchedule(opts: ScheduleOptions, untilBeat: number): Silence[] {
  const schedule = createSchedule(opts);
  const out: Silence[] = [];
  for (;;) {
    const s = schedule.next();
    if (s.startBeat >= untilBeat) return out;
    out.push(s);
  }
}

/** The seed that reproduces a session, or null when the pattern isn't random. */
export function scheduleSeed(opts: ScheduleOptions | null): string | null {
  return opts?.mode === 'random' ? String(opts.seed) : null;
}
