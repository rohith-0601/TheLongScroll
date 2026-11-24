// Divergence-free curl noise in pure TSL (runs on WebGPU and on the WebGL2 backend; no wgslFn/glslFn).
// "Bitangent noise" (Atyuwen, 2020, MIT): two simplex-noise gradients from ONE simplex lattice walk;
// cross(grad a, grad b) is divergence-free because div(grad a x grad b) = 0.
import { Fn, float, vec3, vec4, uvec3, floor, step, min, max, clamp, dot, cross } from 'three/tsl';
import type { Node } from 'three/webgpu';

// PCG-style 3D hash; only the top 16 bits are well mixed (the gradient uses bits 17..19).
const pcg3d16 = Fn(([p]: [Node<'uvec3'>]) => {
  const v = p.mul(1664525).add(1013904223).toVar();
  v.x.addAssign(v.y.mul(v.z));
  v.y.addAssign(v.z.mul(v.x));
  v.z.addAssign(v.x.mul(v.y));
  v.x.addAssign(v.y.mul(v.z));
  v.y.addAssign(v.z.mul(v.x));
  return v.xy;
}, { p: 'uvec3', return: 'uvec2' });

// 8 gradients (+-1, +-1, +-1) from hash bits 19, 18, 17 (per component: @types/three only types scalar bit ops).
const gradient3d = Fn(([h]: [Node<'uint'>]) => {
  return vec3(
    float(h.bitAnd(0x80000)).mul(1 / 0x40000),
    float(h.bitAnd(0x40000)).mul(1 / 0x20000),
    float(h.bitAnd(0x20000)).mul(1 / 0x10000),
  ).sub(1.0);
}, { h: 'uint', return: 'vec3' });

/** One octave. Assumes |p| < 32768. RMS magnitude ~7.7; r^2 = 0.5 kernels leave ~2.7% of space at exactly 0. */
export const bitangentNoise3D = Fn(([p]: [Node<'vec3'>]) => {
  const i = floor(p.add(p.x.add(p.y).add(p.z).mul(1 / 3))).toVar();
  const x0 = p.sub(i).add(i.x.add(i.y).add(i.z).mul(1 / 6)).toVar();
  const g = step(x0.yzx, x0.xyz).toVar();
  const l = vec3(1.0).sub(g).toVar();
  const i1 = min(g, l.zxy).toVar();
  const i2 = max(g, l.zxy).toVar();
  const x1 = x0.sub(i1).add(1 / 6).toVar();
  const x2 = x0.sub(i2).add(1 / 3).toVar();
  const x3 = x0.sub(0.5).toVar();
  const ii = i.add(32768.5).toVar();
  const h0 = pcg3d16(uvec3(ii)).toVar();
  const h1 = pcg3d16(uvec3(ii.add(i1))).toVar();
  const h2 = pcg3d16(uvec3(ii.add(i2))).toVar();
  const h3 = pcg3d16(uvec3(ii.add(1.0))).toVar();
  const p00 = gradient3d(h0.x).toVar(), p01 = gradient3d(h0.y).toVar();
  const p10 = gradient3d(h1.x).toVar(), p11 = gradient3d(h1.y).toVar();
  const p20 = gradient3d(h2.x).toVar(), p21 = gradient3d(h2.y).toVar();
  const p30 = gradient3d(h3.x).toVar(), p31 = gradient3d(h3.y).toVar();
  const m = clamp(vec4(0.5).sub(vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3))), 0.0, 1.0).toVar();
  const mt = m.mul(m).toVar();
  const m4 = mt.mul(mt).toVar();
  const m3 = mt.mul(m).toVar();
  const t0 = vec4(dot(p00, x0), dot(p10, x1), dot(p20, x2), dot(p30, x3)).mul(m3).toVar();
  const grad0 = x0.mul(t0.x).add(x1.mul(t0.y)).add(x2.mul(t0.z)).add(x3.mul(t0.w)).mul(-8.0)
    .add(p00.mul(m4.x)).add(p10.mul(m4.y)).add(p20.mul(m4.z)).add(p30.mul(m4.w)).toVar();
  const t1 = vec4(dot(p01, x0), dot(p11, x1), dot(p21, x2), dot(p31, x3)).mul(m3).toVar();
  const grad1 = x0.mul(t1.x).add(x1.mul(t1.y)).add(x2.mul(t1.z)).add(x3.mul(t1.w)).mul(-8.0)
    .add(p01.mul(m4.x)).add(p11.mul(m4.y)).add(p21.mul(m4.z)).add(p31.mul(m4.w)).toVar();
  return cross(grad0, grad1).mul(3918.76);
}, { p: 'vec3', return: 'vec3' });

/** Two octaves (recommended): fills the single-octave zero "holes" (2.7% -> ~1% of space below 5% RMS). RMS ~8.6. */
export const curlNoise = Fn(([p]: [Node<'vec3'>]) => {
  return bitangentNoise3D(p).add(bitangentNoise3D(p.mul(2.03).add(vec3(17.1, -3.7, 9.3))).mul(0.5));
}, { p: 'vec3', return: 'vec3' });
