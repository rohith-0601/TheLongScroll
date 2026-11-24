/**
 * tsl/post.ts — the scene's post chain (from research/post.example.ts, verified on both backends).
 *
 * createPost: TSL post-processing chain for three r187 `WebGPURenderer`.
 * One code path for the WebGPU backend and the automatic WebGL2 fallback backend.
 *
 *   pass(scene)      HDR HalfFloat target, no MSAA, no depth attachment (additive particles never write depth)
 *     + bloom        BloomNode (5 mips); its resolution is pinned to CSS pixels, so the glow looks the same at DPR 1 and 2
 *     -> chromatic   radial R/B offset, 3 taps of the scene texture, no extra render pass
 *     -> * exposure
 *     -> renderOutput()  tone mapping (renderer.toneMapping) + sRGB encode (renderer.outputColorSpace)
 *     -> + background    display-referred color or radial gradient, so the tone mapper cannot crush #020309 to black
 *     -> vignette        display space
 *     -> grain + dither  display space, PCG hash, triangular noise, static when grainAnimated = 0
 *     -> canvas
 *
 * Usage:
 *   scene.background = null;                       // createPost draws the background (see `background`)
 *   const post = createPost(renderer, scene, camera, { ...tuning.post, grainAnimated: !reducedMotion });
 *   renderer.setAnimationLoop(() => { post.uniforms.bloomStrength.value = x; post.render(); });
 *   // Resize: renderer.setSize(w, h) and/or renderer.setPixelRatio(pr). The pipeline needs nothing else.
 *   post.dispose();
 *
 * Notes (verified in the spike, see tsl-post.md):
 *  - Call post.render(), never renderer.render(scene, camera) (that would tone map twice / skip the effects).
 *  - Keep renderer.toneMappingExposure = 1 and use uniforms.exposure (same maths, applied before the tone map).
 *  - Changing renderer.toneMapping or renderer.outputColorSpace later is detected by the pipeline and
 *    rebuilds the output material (one recompile). Changing any uniform .value never recompiles.
 */
import {
	AgXToneMapping,
	Color,
	RenderPipeline,
	SRGBColorSpace,
	Vector3,
	type Camera,
	type ColorRepresentation,
	type Node,
	type Scene,
	type ToneMapping,
	type UniformNode,
	type WebGPURenderer,
} from 'three/webgpu';
import {
	dot,
	float,
	hash,
	length,
	luminance,
	max,
	min,
	mix,
	pass,
	renderOutput,
	screenCoordinate,
	screenSize,
	smoothstep,
	uint,
	uniform,
	uv,
	vec2,
	vec3,
	vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { tuning } from '@/lib/tuning';

export type PostQuality = 0 | 1 | 2;

export interface PostOptions {
	/** Bloom strength (BloomNode default 1). */
	bloomStrength?: number;
	/** Bloom radius 0..1: shifts weight from the small mips toward the wide ones. */
	bloomRadius?: number;
	/** Luminance threshold on the linear HDR scene (before exposure). */
	bloomThreshold?: number;
	/** Chromatic aberration: UV offset of R and B at the image corners (0 = off). Quadratic falloff, 0 at the center. */
	chromatic?: number;
	/** Vignette darkening in the corners, 0..1, display space. */
	vignette?: number;
	/** Grain amplitude in display space (0.05 = subtle film grain). A 1/255 dither is always applied. */
	grain?: number;
	/** false = static grain pattern (prefers-reduced-motion). */
	grainAnimated?: boolean;
	/** Linear exposure multiplier applied before tone mapping. */
	exposure?: number;
	/** Tone mapping operator, written to renderer.toneMapping. Default AgXToneMapping. */
	toneMapping?: ToneMapping;
	/** Display-referred background color at the edges (what you would put in CSS). Default 0x020309. */
	background?: ColorRepresentation;
	/** Optional display-referred color at the screen center for a subtle radial gradient. Default = background. */
	backgroundCenter?: ColorRepresentation;
	quality?: PostQuality;
}

export interface PostUniforms {
	bloomStrength: UniformNode<'float', number>;
	bloomRadius: UniformNode<'float', number>;
	bloomThreshold: UniformNode<'float', number>;
	grain: UniformNode<'float', number>;
	/** 1 = animated grain (re-seeded at 24 Hz), 0 = static pattern. */
	grainAnimated: UniformNode<'float', number>;
	chromatic: UniformNode<'float', number>;
	vignette: UniformNode<'float', number>;
	exposure: UniformNode<'float', number>;
}

export interface PostFrame {
	time: number;
	/** Chapter bloom multiplier (data/chapters.ts scene.bloom, blended across transitions). */
	bloom: number;
	reducedMotion: boolean;
	/** 0..1 global intensity (dims the glow under the frontier). */
	fade: number;
}

export interface PostChain {
	pipeline: RenderPipeline;
	/** Per-frame: pulls live values from lib/tuning.ts (leva writes there in development). */
	update(f: PostFrame): void;
	uniforms: PostUniforms;
	/** Display-referred (sRGB, CSS-like) background: edge color and optional center color. */
	setBackground(edge: ColorRepresentation, center?: ColorRepresentation): void;
	setQuality(level: PostQuality): void;
	render(): void;
	dispose(): void;
}

/**
 * Per quality level:
 *  - maxSceneDpr: cap on the scene pass density in device pixels per CSS pixel. The particles are rendered at
 *    min(1, maxSceneDpr / DPR) of the canvas resolution while grain, vignette and the output stay native.
 *    It only bites on high-DPR screens; lower renderer.setPixelRatio() itself to go below 1.
 *  - bloomCssScale: bloom resolution relative to CSS pixels (0.5 = half of the CSS size, at any DPR).
 *  - chromatic: chromatic aberration on/off.
 */
const QUALITY: Record<PostQuality, { maxSceneDpr: number; bloomCssScale: number; chromatic: boolean }> = {
	// The scene pass always renders at the canvas's native resolution (crisp sprites); resolution is the last thing
	// adaptive quality lowers, through renderer.setPixelRatio(). Levels only trade bloom resolution and CA.
	0: { maxSceneDpr: Infinity, bloomCssScale: 0.35, chromatic: false },
	1: { maxSceneDpr: Infinity, bloomCssScale: 0.5, chromatic: false },
	2: { maxSceneDpr: Infinity, bloomCssScale: 0.5, chromatic: true },
};

/**
 * Scene-specific look adjustments on top of lib/tuning.ts `post` (tuned by eye on the real formations:
 * the default threshold lets the dim dust bloom into a coloured haze over the whole frame).
 */
// Look multipliers (folded into lib/tuning.ts defaults; kept at 1 for quick experiments).
const LOOK = { bloomStrength: 1, bloomRadius: 1, bloomThreshold: 1, grain: 1 };
/** Luminance cap of the bloom input: a million additive sprites make cores of HDR 100+, which would bloom into a
 *  frame-filling grey haze. Capping the high-pass keeps the glow local and the blacks deep. */
const BLOOM_INPUT_CAP = 2.5;

const _color = new Color();
/** Stores a color's sRGB-encoded components (0..1) in a Vector3, for use after renderOutput(). */
function toDisplay(target: Vector3, value: ColorRepresentation): Vector3 {
	_color.set(value); // three keeps colors in linear working space
	const srgb = _color.getRGB({ r: 0, g: 0, b: 0 }, SRGBColorSpace);
	return target.set(srgb.r, srgb.g, srgb.b);
}

export function createPost(
	renderer: WebGPURenderer,
	scene: Scene,
	camera: Camera,
	opts: PostOptions = {},
): PostChain {
	const toneMapping = opts.toneMapping ?? AgXToneMapping;
	renderer.toneMapping = toneMapping;
	renderer.toneMappingExposure = 1; // exposure lives in uniforms.exposure
	renderer.outputColorSpace = SRGBColorSpace;

	const uniforms: PostUniforms = {
		bloomStrength: uniform(opts.bloomStrength ?? 0.85),
		bloomRadius: uniform(opts.bloomRadius ?? 0.55),
		bloomThreshold: uniform(opts.bloomThreshold ?? 0.12),
		grain: uniform(opts.grain ?? 0.055),
		grainAnimated: uniform(opts.grainAnimated === false ? 0 : 1),
		chromatic: uniform(opts.chromatic ?? 0.0022),
		vignette: uniform(opts.vignette ?? 0.34),
		exposure: uniform(opts.exposure ?? 1),
	};
	// Internal uniforms.
	const grainFrame = uniform(0); // 24 Hz frame counter for the grain seed
	const grainCell = uniform(1); // grain cell size in device pixels (= DPR, so the grain is 1 CSS px at any DPR)
	const chromaticOn = uniform(1); // quality 0 turns chromatic aberration off without touching uniforms.chromatic
	const bgEdge = uniform(toDisplay(new Vector3(), opts.background ?? 0x020309));
	const bgCenter = uniform(toDisplay(new Vector3(), opts.backgroundCenter ?? opts.background ?? 0x020309));

	// 1. Scene pass. HDR: the target type is renderer.getOutputBufferType(), HalfFloatType by default.
	const scenePass = pass(scene, camera, { depthBuffer: false, samples: 0 });
	const sceneTex = scenePass.getTextureNode('output');

	// 2. Bloom on the HDR scene. Uniform nodes passed in are used as-is, so .value edits are live.
	const bloomNode = bloom(sceneTex, uniforms.bloomStrength, uniforms.bloomRadius, uniforms.bloomThreshold);
	// Soft-knee high pass with a luminance cap (replaces BloomNode's hard luminosityHighPass; set before setup()).
	bloomNode.highPassFn = (({ input, threshold }: { input: Node<'vec4'>; threshold: UniformNode<'float'> }) => {
		const v = luminance(input.rgb);
		const knee = smoothstep(threshold, threshold.mul(2.5).add(0.05), v);
		const capped = input.rgb.mul(min(float(1), float(BLOOM_INPUT_CAP).div(max(v, 1e-4))));
		return vec4(capped.mul(knee), 1);
	}) as unknown as typeof bloomNode.highPassFn;
	// In JS the method is getTextureNode(); @types/three 0.187 declares getTexture() instead, hence the cast.
	const bloomTex = (bloomNode as unknown as { getTextureNode(): Node<'vec4'> }).getTextureNode();

	// 3. Radial chromatic aberration on the sharp scene only (the bloom is too soft to show fringes).
	//    |offset| = chromatic * r^2 with r = 1 in the corners, so the center stays clean.
	const vUv = uv();
	const fromCenter = vUv.sub(0.5);
	const r2 = dot(fromCenter, fromCenter).mul(2); // 0 at the center, 1 in the corners
	const caOffset = fromCenter.mul(uniforms.chromatic.mul(chromaticOn).mul(r2).mul(Math.SQRT2));
	const sceneRGB = vec3(
		sceneTex.sample(vUv.add(caOffset)).r,
		sceneTex.sample(vUv).g,
		sceneTex.sample(vUv.sub(caOffset)).b,
	);

	// 4. HDR composite and exposure, then tone mapping + sRGB encoding at a point we choose.
	const hdr = sceneRGB.add(bloomTex.rgb).mul(uniforms.exposure);
	const display = renderOutput(vec4(hdr, 1)); // reads renderer.toneMapping / outputColorSpace through the pipeline context

	// 5. Background in display space (additive light over it), then vignette.
	const aspectDist = length(fromCenter.mul(vec2(screenSize.x.div(screenSize.y), 1)));
	const background = mix(bgCenter, bgEdge, smoothstep(0, 0.85, aspectDist));
	const vignette = float(1).sub(uniforms.vignette.mul(smoothstep(0.15, 1, r2)));
	const graded = display.rgb.add(background).mul(vignette);

	// 6. Grain + dither in display space: triangular noise from two PCG hashes of the pixel cell.
	const cell = screenCoordinate.div(grainCell).floor();
	const seed = cell.x
		.toUint()
		.mul(uint(1973))
		.add(cell.y.toUint().mul(uint(9277)))
		.add(grainFrame.mul(uniforms.grainAnimated).toUint().mul(uint(26699)));
	const noise = hash(seed).add(hash(seed.bitXor(uint(0x68e31da4)))).sub(1); // (-1, 1), triangular
	const luma = luminance(graded).clamp(0, 1);
	// Grain ∝ luminance (none on the near-black background, strongest in the midtones), one physical pixel per
	// cell, luminance-only (the same value on R, G, B). The ±0.5/255 dither alone keeps gradients unbanded.
	const response = smoothstep(0.02, 0.3, luma).mul(mix(float(0.5), float(1), luma.mul(float(1).sub(luma)).mul(4)));
	const amplitude = uniforms.grain.mul(response).add(0.5 / 255);
	const finalColor = vec4(graded.add(noise.mul(amplitude)), 1);

	const pipeline = new RenderPipeline(renderer);
	pipeline.outputColorTransform = false; // renderOutput() above already did it
	pipeline.outputNode = finalColor;

	let quality = QUALITY[opts.quality ?? 2];
	let lastPixelRatio = -1;

	const applyPixelRatio = (pixelRatio: number): void => {
		// BloomNode's blur kernels are measured in bloom-texture pixels. Dividing by DPR keeps the glow
		// size (and the cost) the same at DPR 1 and 2.
		bloomNode.setResolutionScale(quality.bloomCssScale / pixelRatio);
		scenePass.setResolutionScale(Math.min(1, quality.maxSceneDpr / pixelRatio));
		grainCell.value = 1; // physical pixels: fine grain at any DPR (never coarse CSS-pixel blocks)
		lastPixelRatio = pixelRatio;
	};

	const setQuality = (level: PostQuality): void => {
		quality = QUALITY[level];
		chromaticOn.value = quality.chromatic ? 1 : 0;
		applyPixelRatio(renderer.getPixelRatio());
	};

	setQuality(opts.quality ?? 2);

	return {
		pipeline,
		uniforms,
		setBackground(edge: ColorRepresentation, center: ColorRepresentation = edge): void {
			toDisplay(bgEdge.value, edge);
			toDisplay(bgCenter.value, center);
		},
		setQuality,
		update(f: PostFrame): void {
			const t = tuning.post;
			uniforms.bloomStrength.value = t.bloomStrength * LOOK.bloomStrength * f.bloom * (0.55 + 0.45 * f.fade);
			uniforms.bloomRadius.value = t.bloomRadius * LOOK.bloomRadius;
			uniforms.bloomThreshold.value = t.bloomThreshold * LOOK.bloomThreshold;
			uniforms.chromatic.value = t.chromatic;
			uniforms.vignette.value = t.vignette;
			uniforms.grain.value = t.grain * LOOK.grain;
			uniforms.exposure.value = t.exposure;
			uniforms.grainAnimated.value = f.reducedMotion ? 0 : 1;
		},
		render(): void {
			// R3F re-applies its colour management (flat → NoToneMapping) when the Canvas reconfigures; re-assert.
			if (renderer.toneMapping !== toneMapping) renderer.toneMapping = toneMapping;
			const pixelRatio = renderer.getPixelRatio();
			if (pixelRatio !== lastPixelRatio) applyPixelRatio(pixelRatio);
			grainFrame.value = Math.floor(performance.now() / (1000 / 24)) % 65536;
			pipeline.render();
		},
		dispose(): void {
			pipeline.dispose();
			bloomNode.dispose();
			scenePass.dispose();
		},
	};
}
