/**
 * Main-thread client that generates all 9 formations in a pool of Web Workers.
 *
 * CONTRACT. Browser-only.
 *  - Spawns a pool of min(4, max(1, hardwareConcurrency − 1)) module workers created with
 *    `new Worker(new URL('./formation.worker.ts', import.meta.url), { type: 'module' })`.
 *  - Each job: { type: 'generate', jobId, name: FormationName, count } → the worker posts
 *    { type: 'progress', jobId, fraction } a few times and finally { type: 'done', jobId, buffer }
 *    with the Float32Array's ArrayBuffer transferred (zero-copy).
 *  - Results are copied into ONE packed Float32Array(9 * count * 4) in chapter order (the GPU uploads it
 *    as a single storage buffer); per-formation views are subarrays (no copies).
 *  - onProgress receives the overall fraction 0..1 (weighted by job progress), monotonic.
 *  - Abortable: terminates all workers and rejects with an AbortError.
 *  - Workers are terminated when done.
 */
import { CHAPTERS, type FormationName } from '../../data/chapters.ts';
import { FORMATION_COUNT, STRIDE } from './types.ts';
import type { GenerateMessage, WorkerReply } from './formation.worker.ts';

export interface FormationSet {
  /** Particles per formation. */
  count: number;
  /** All 9 formations back to back: formation k occupies [k * count * 4, (k + 1) * count * 4). */
  packed: Float32Array;
  /** View (no copy) of formation k, 0-based chapter index (0 = chapter 1 … 8 = chapter 9). */
  at(k: number): Float32Array;
}

export function makeFormationSet(count: number, packed: Float32Array): FormationSet {
  return {
    count,
    packed,
    at: (k: number) => packed.subarray(k * count * STRIDE, (k + 1) * count * STRIDE),
  };
}

export interface GenerateOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/** Relative generation cost per formation (measured roughly in Node); weights the progress bar. */
/** Chapter order (not imported from ./index.ts, which would pull every generator into the main bundle). */
const FORMATION_ORDER: readonly FormationName[] = CHAPTERS.map((c) => c.formation);

const COST: Readonly<Record<FormationName, number>> = {
  bigBang: 1,
  galaxy: 1.2,
  earth: 1.6,
  dna: 1,
  tablet: 1.4,
  morse: 1.1,
  moon: 1.8,
  network: 1.5,
  canvas: 0.8,
};

function abortError(): Error {
  const e = new Error('Formation generation aborted');
  e.name = 'AbortError';
  return e;
}

export function generateFormations(count: number, opts: GenerateOptions = {}): Promise<FormationSet> {
  const { onProgress, signal } = opts;
  return new Promise<FormationSet>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const packed = new Float32Array(FORMATION_COUNT * count * STRIDE);
    const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
    const poolSize = Math.min(4, Math.max(1, cores - 1), FORMATION_COUNT);

    // Largest jobs first so the pool finishes evenly.
    const queue = FORMATION_ORDER.map((name, index) => ({ name, index })).sort((a, b) => COST[b.name] - COST[a.name]);
    const totalCost = FORMATION_ORDER.reduce((s, n) => s + COST[n], 0);
    const jobFraction = new Float64Array(FORMATION_COUNT);
    let reported = 0;
    let done = 0;
    let settled = false;
    const workers: Worker[] = [];

    const report = (): void => {
      if (!onProgress) return;
      let sum = 0;
      for (let k = 0; k < FORMATION_COUNT; k++) sum += jobFraction[k]! * COST[FORMATION_ORDER[k]!];
      const f = Math.min(1, sum / totalCost);
      if (f > reported) {
        reported = f;
        onProgress(f);
      }
    };

    const cleanup = (): void => {
      for (const w of workers) w.terminate();
      workers.length = 0;
      signal?.removeEventListener('abort', onAbort);
    };
    const fail = (err: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };
    function onAbort(): void {
      fail(abortError());
    }
    signal?.addEventListener('abort', onAbort);

    const next = (worker: Worker): void => {
      const job = queue.shift();
      if (!job) return;
      const msg: GenerateMessage = { type: 'generate', jobId: job.index, name: job.name, count };
      worker.postMessage(msg);
    };

    const onMessage = (worker: Worker) => (event: MessageEvent<WorkerReply>): void => {
      if (settled) return;
      const reply = event.data;
      if (reply.type === 'progress') {
        jobFraction[reply.jobId] = Math.max(jobFraction[reply.jobId]!, Math.min(0.99, reply.fraction));
        report();
      } else if (reply.type === 'done') {
        const data = new Float32Array(reply.buffer);
        if (data.length !== count * STRIDE) {
          fail(new Error(`formation ${reply.jobId}: expected ${count * STRIDE} floats, got ${data.length}`));
          return;
        }
        packed.set(data, reply.jobId * count * STRIDE);
        jobFraction[reply.jobId] = 1;
        report();
        done++;
        if (done === FORMATION_COUNT) {
          settled = true;
          cleanup();
          resolve(makeFormationSet(count, packed));
        } else {
          next(worker);
        }
      } else {
        fail(new Error(`formation worker error (${FORMATION_ORDER[reply.jobId] ?? reply.jobId}): ${reply.message}`));
      }
    };

    try {
      for (let i = 0; i < poolSize; i++) {
        const worker = new Worker(new URL('./formation.worker.ts', import.meta.url), { type: 'module' });
        workers.push(worker);
        worker.onmessage = onMessage(worker);
        worker.onerror = (e: ErrorEvent) => {
          e.preventDefault();
          fail(new Error(`formation worker failed: ${e.message || 'unknown error'}`));
        };
        worker.onmessageerror = () => fail(new Error('formation worker message could not be deserialised'));
        next(worker);
      }
    } catch (err) {
      fail(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
