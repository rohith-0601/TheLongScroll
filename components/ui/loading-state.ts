'use client';
/** "The loading screen has been dismissed" — shared between the Loader and the opening hint. */
import { useSyncExternalStore } from 'react';

let done = false;
const subs = new Set<() => void>();

export function setLoaderDone(): void {
  if (done) return;
  done = true;
  for (const f of subs) f();
}

const subscribe = (cb: () => void): (() => void) => {
  subs.add(cb);
  return () => subs.delete(cb);
};

export function useLoaderDone(): boolean {
  return useSyncExternalStore(subscribe, () => done, () => false);
}
