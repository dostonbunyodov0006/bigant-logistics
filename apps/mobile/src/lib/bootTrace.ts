/**
 * The app's start, step by step, written down as it happens (owner,
 * 05.11.2026): twice the driver app sat on a white screen with its spinner,
 * and nothing it did reached the server, so nobody could tell where it stopped.
 *
 * Each step is written to a small file at once, with no waiting on anything —
 * so it survives a start that never finishes. On the next start the previous
 * one is read: if it never got to the end, the steps it did get through are
 * sent to the server, and the office sees exactly where it stopped. A start
 * still unfinished after 15 seconds is reported there and then too.
 *
 * Imports nothing of ours but the crash reporter, which itself imports nothing.
 */
import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { report } from './crashReport';

type Mark = [step: string, at: number];

const FILE_NAME = 'boot-trace.json';
const DONE = 'ready';
const WATCH_MS = 15_000;

let marks: Mark[] = [];
let finished = false;

function traceFile(): File | null {
  if (Platform.OS === 'web') return null;
  try {
    return new File(Paths.document, FILE_NAME);
  } catch {
    return null;
  }
}

function save(): void {
  try {
    const f = traceFile();
    if (!f) return;
    if (!f.exists) f.create();
    f.write(JSON.stringify(marks));
  } catch {
    // Nowhere to write: the start goes on regardless.
  }
}

/** "auth:storage +1840ms → auth:refresh +1902ms …" */
function describe(list: Mark[]): string {
  if (list.length === 0) return '(empty)';
  const t0 = list[0][1];
  return list.map(([step, at]) => `${step} +${at - t0}ms`).join(' → ');
}

/** Called once, first thing: reports a previous start that never finished, then starts a new trace. */
export function bootBegin(): void {
  try {
    const f = traceFile();
    if (f?.exists) {
      const previous = JSON.parse(f.textSync()) as Mark[];
      if (Array.isArray(previous) && previous.length > 0 && !previous.some(([s]) => s === DONE)) {
        report(new Error(`boot did not finish last time: ${describe(previous)}`));
      }
    }
  } catch {
    // An unreadable trace is no reason to stop.
  }
  marks = [];
  finished = false;
  bootMark('js-start');
  setTimeout(() => {
    if (!finished) report(new Error(`boot still not finished after ${WATCH_MS / 1000}s: ${describe(marks)}`));
  }, WATCH_MS);
}

/** One step of the start. Cheap; safe to call from anywhere. */
export function bootMark(step: string): void {
  if (finished) return;
  marks.push([step, Date.now()]);
  if (step === DONE) finished = true;
  save();
}
