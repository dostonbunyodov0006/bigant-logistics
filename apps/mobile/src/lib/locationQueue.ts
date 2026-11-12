import { File, Paths } from 'expo-file-system';
import { api, ApiError } from './api';

/**
 * Positions taken without internet are kept on the phone and sent when it is
 * back, each with the moment it was taken (owner, 04.11.2026): the office
 * then knows where the lorry was — and when it crossed into Tashkent — even
 * for the stretch with no signal.
 */
export type QueuedPoint = { lat: number; lng: number; recorded_at: string };

/** At most this many kept: two days of fixes every five minutes, several times over. */
export const MAX_QUEUED = 2000;
const FILE_NAME = 'location-queue.json';

let pending = 0;
const listeners = new Set<(n: number) => void>();
const setPending = (n: number) => {
  if (n === pending) return;
  pending = n;
  listeners.forEach((l) => l(n));
};

/** How many positions are waiting for the internet; the app shows a line while there are. */
export const locationBacklog = {
  get: () => pending,
  subscribe(fn: (n: number) => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

async function queueFile() {
  return new File(Paths.document, FILE_NAME);
}

async function read(): Promise<QueuedPoint[]> {
  try {
    const f = await queueFile();
    if (!f.exists) return [];
    const v: unknown = JSON.parse(f.textSync());
    return Array.isArray(v) ? (v as QueuedPoint[]) : [];
  } catch {
    return [];
  }
}

async function write(points: QueuedPoint[]): Promise<void> {
  try {
    const f = await queueFile();
    if (points.length === 0) {
      if (f.exists) f.delete();
      return;
    }
    if (!f.exists) f.create();
    f.write(JSON.stringify(points.slice(-MAX_QUEUED)));
  } catch {
    // Storage full or gone: the live fixes still go when they can.
  }
}

// One at a time: the open app and the background service share the file.
let chain: Promise<unknown> = Promise.resolve();

/**
 * Send positions, with any kept from before. One position and nothing kept
 * goes as a plain fix; otherwise all go together with their times. When it
 * cannot reach the server, everything not yet taken is kept for the next try.
 */
type Answer = { on_shift?: boolean; gps_required?: { from: string; until: string } | null };

/**
 * Refused as invalid (owner, 06.11.2026): a list the server will not take is
 * split in two and each half tried on its own, so one bad point no longer
 * drops the whole backlog — hours of road. A single point refused on its own
 * is the bad one and is dropped. At most this many sends per call; what is
 * left waits for the next.
 */
export const MAX_SENDS = 24;
const refused = (err: unknown) => err instanceof ApiError && (err.status === 400 || err.status === 413 || err.status === 422);

export function deliver(points: QueuedPoint[]): Promise<Answer | undefined> {
  const run = chain.then(async () => {
    const queued = await read();
    const all = [...queued, ...points].slice(-MAX_QUEUED);
    if (all.length === 0) return undefined;
    // Oldest first; a half that goes is taken off, a refused one is split in place.
    const todo: QueuedPoint[][] = [all];
    let answer: Answer | undefined;
    const keep = async () => {
      const left = todo.flat();
      if (queued.length || left.length) await write(left);
      setPending(left.length);
    };
    try {
      for (let sends = 0; todo.length && sends < MAX_SENDS; sends++) {
        const part = todo[0];
        try {
          // Only a lone fresh fix goes as a plain position: a kept one needs its own time.
          answer =
            all.length === 1
              ? await api.post<Answer | undefined>('/drivers/me/location', { lat: part[0].lat, lng: part[0].lng })
              : await api.post<Answer | undefined>('/drivers/me/location/batch', { points: part, sent_at: new Date().toISOString() });
          todo.shift();
        } catch (err) {
          if (!refused(err)) throw err;
          todo.shift();
          if (part.length > 1) {
            const mid = Math.ceil(part.length / 2);
            todo.unshift(part.slice(0, mid), part.slice(mid));
          }
        }
      }
    } catch (err) {
      await keep();
      throw err;
    }
    await keep();
    return answer;
  });
  chain = run.catch(() => undefined);
  return run;
}

/**
 * Counts what the file holds (owner, 07.11.2026): after a cold start nothing
 * has been sent yet, so the count would read 0 with positions still kept.
 */
export function syncBacklog(): Promise<number> {
  const run = chain.then(async () => {
    const n = (await read()).length;
    setPending(n);
    return n;
  });
  chain = run.catch(() => undefined);
  return run;
}

/**
 * Signed out (audit, 07.11.2026): the kept positions are dropped, so the next
 * account on this phone never sends this driver's road as its own. Waits for
 * a send already running, so that one cannot write the file back afterwards.
 */
export function clearQueue(): Promise<void> {
  const run = chain.then(async () => {
    await write([]);
    setPending(0);
  });
  chain = run.catch(() => undefined);
  return run;
}
