import { setConsoleFunction } from 'three/webgpu';

/**
 * R3F 9.8.2 builds its root store with `new THREE.Clock()` and three r183+ deprecates Clock with a one-time
 * console warning (research/next-r3f.md §2.6). Filter exactly that message and forward everything else.
 * Imported first by Experience.tsx, before the <Canvas> mounts.
 */
const SILENCED = ['THREE.Clock: This module has been deprecated'];

setConsoleFunction((type, message, ...params) => {
  if (type === 'warn' && SILENCED.some((s) => message.startsWith(s))) return;
  console[type](message, ...params);
});
