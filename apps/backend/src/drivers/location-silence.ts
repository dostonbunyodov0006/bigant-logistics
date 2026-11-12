/**
 * GPS and internet on for the whole shift (owner, 04.11.2026). The phone
 * sends its position every five minutes with the app closed and every five
 * seconds with it open; fixes taken without internet are kept on the phone
 * and arrive later with their own times. A shift with no fix for this long is
 * silent: GPS off, or the phone dead.
 */

const MIN = 60_000;

/** No fix for this long on shift is a silence: two background fixes missed (owner, 04.11.2026 — as soon as can be told). */
export const SILENCE_MIN = 11;

export type Gap = { from: Date; to: Date; minutes: number };

/**
 * The silences in a shift: stretches longer than SILENCE_MIN between its start,
 * each fix, and its end (or now, while it is open). `fixes` need not be sorted.
 */
export function silentGaps(fixes: readonly Date[], from: Date, to: Date, silenceMin = SILENCE_MIN): Gap[] {
  const inside = fixes
    .map((d) => d.getTime())
    .filter((t) => t >= from.getTime() && t <= to.getTime())
    .sort((a, b) => a - b);
  const marks = [from.getTime(), ...inside, to.getTime()];
  const gaps: Gap[] = [];
  for (let i = 1; i < marks.length; i++) {
    const ms = marks[i] - marks[i - 1];
    if (ms > silenceMin * MIN) gaps.push({ from: new Date(marks[i - 1]), to: new Date(marks[i]), minutes: Math.round(ms / MIN) });
  }
  return gaps;
}

/**
 * Whether to tell the driver his position stopped coming: on shift, not on a
 * break, nothing for SILENCE_MIN, and not already told about this silence.
 */
export function shouldWarnSilent(input: {
  now: Date;
  clockInAt: Date;
  lastFixAt: Date | null;
  onBreak: boolean;
  warnedAt: Date | null;
}): boolean {
  if (input.onBreak) return false;
  const since = input.lastFixAt && input.lastFixAt.getTime() > input.clockInAt.getTime() ? input.lastFixAt : input.clockInAt;
  if (input.now.getTime() - since.getTime() < SILENCE_MIN * MIN) return false;
  // Told once per silence: a fix after the warning starts the count again.
  return !input.warnedAt || input.warnedAt.getTime() < since.getTime();
}

/**
 * Where the lorry entered the city: the first fix inside after the last one
 * outside. Fixes kept on the phone without internet arrive late but carry the
 * moment they were taken, so the border is where it was crossed, not where
 * the internet came back. Null when the fixes never show the crossing.
 */
export function borderCrossing(
  fixes: readonly { lat: number; lng: number; recordedAt: Date }[],
  inCity: (f: { lat: number; lng: number }) => boolean,
): Date | null {
  const sorted = [...fixes].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
  let lastOutside = -1;
  for (let i = 0; i < sorted.length; i++) if (!inCity(sorted[i])) lastOutside = i;
  if (lastOutside < 0) return null;
  const back = sorted.slice(lastOutside + 1).find((f) => inCity(f));
  return back ? back.recordedAt : null;
}
