/**
 * Module Web Worker: generates one formation per job and transfers the result back (zero-copy).
 * Created by lib/formations/client.ts with
 *   new Worker(new URL('./formation.worker.ts', import.meta.url), { type: 'module' })
 *
 * Protocol:
 *   in : { type: 'generate', jobId, name, count }
 *   out: { type: 'progress', jobId, fraction } (≈ every 5%)
 *        { type: 'done', jobId, buffer }      (ArrayBuffer of Float32Array(count * 4), transferred)
 *        { type: 'error', jobId, message }
 */
import type { FormationName } from '../../data/chapters.ts';
import { runFormation } from './index.ts';

export interface GenerateMessage {
  type: 'generate';
  jobId: number;
  name: FormationName;
  count: number;
}

export type WorkerReply =
  | { type: 'progress'; jobId: number; fraction: number }
  | { type: 'done'; jobId: number; buffer: ArrayBuffer }
  | { type: 'error'; jobId: number; message: string };

// Typed without the 'webworker' lib (which conflicts with 'dom' in one program).
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<GenerateMessage>) => void) | null;
  postMessage(message: WorkerReply, transfer?: Transferable[]): void;
};

scope.onmessage = (event) => {
  const msg = event.data;
  if (!msg || msg.type !== 'generate') return;
  try {
    let last = 0;
    const data = runFormation(msg.name, msg.count, (fraction) => {
      if (fraction - last >= 0.05 || fraction >= 1) {
        last = fraction;
        scope.postMessage({ type: 'progress', jobId: msg.jobId, fraction: Math.min(1, fraction) });
      }
    });
    const buffer = data.buffer as ArrayBuffer;
    scope.postMessage({ type: 'done', jobId: msg.jobId, buffer }, [buffer]);
  } catch (error) {
    scope.postMessage({
      type: 'error',
      jobId: msg.jobId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
