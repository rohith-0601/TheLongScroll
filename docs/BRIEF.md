# Original brief (verbatim, from the user)

Build "The Long Scroll": a single-page, award-level immersive website that takes the visitor through 13.8 billion years of breakthroughs in one scroll. The bar is the best real-time 3D sites on the web today, such as igloo.inc (Awwwards Site of the Year 2024), Lusion's Oryzo and Bruno Simon's portfolio. It should be good enough that people share it just to show others it exists.

CORE IDEA
One real-time WebGL scene of ~60,000 glowing particles (25,000 on phones). The same particles physically re-form into a new shape for each chapter as the user scrolls. There are no page changes, no images and no videos. Everything is drawn live in the browser.

THE 9 CHAPTERS (date label | headline | one line of copy | particle formation)
1. 13.8 billion years ago | "Everything started smaller than a point." | The universe begins. | Dense white-hot core with radial bursts streaking outward.
2. ~13.5 billion years ago | "Gravity learns to draw." | Gas collapses into stars, and stars into galaxies. | Three-armed spiral galaxy, tilted, with a warm bright core.
3. 4.54 billion years ago | "A rock at the right distance." | Earth forms where water can stay liquid. | Sphere with procedural continents (brighter points on land) and a thin atmosphere shell.
4. ~3.7 billion years ago | "Matter starts copying itself." | Life begins; its instructions end up written in DNA. | Rotating double helix with base-pair rungs.
5. c. 3200 BCE | "Thoughts outlive their thinkers." | In Sumer, marks pressed into clay become writing. | Clay tablet slab with rows of glowing wedge marks.
6. 1844 | "Words outrun horses." | Samuel Morse sends "What hath God wrought" from Washington to Baltimore. | The phrase spelled in real, accurate Morse dots and dashes along a flowing 3D ribbon.
7. 1969 | "Twelve people walk on another world." | Apollo 11 lands on July 20, 1969. | Cratered Moon sphere with bright crater rims.
8. 1969 to 1991 | "The machines start talking." | ARPANET's first message, "LO", crashes after two letters. In 1991, the first website goes live at CERN. | Network globe: glowing nodes joined by great-circle arcs, with pulses travelling along them.
9. Now | "The web learns depth." | Real-time 3D now runs in every browser. | A waving grid plane, the web as a canvas, that settles as the user reaches the final section.

MOTION AND TECHNIQUE
- Morph between formations in the vertex shader. Each formation is a precomputed position array (xyz plus a 4th value for per-point brightness or color mix). Swap the "from" and "to" buffers when the scroll crosses a chapter boundary.
- Give every particle its own random delay so shapes dissolve and re-form in waves rather than all at once. Add curl-noise turbulence that peaks mid-transition and fades to zero at rest.
- Smooth the scroll with inertia (eased, not 1:1) so everything feels heavy and expensive.
- The camera drifts slowly around each formation, with slight parallax that follows the mouse.
- Each chapter has its own two-color palette for the particles on a deep near-black space background. Use additive blending, soft round point sprites and subtle film grain plus a vignette overlay.
- Add a far-away static star field behind everything for depth.

SIGNATURE INTERACTIONS
- Cursor: particles near the pointer gently push away, like a hand moving through dust.
- Hold to collapse: press and hold anywhere (mouse or touch) and every particle gets pulled into the pointer, forming a tiny dense star. Release it and they burst outward, then spring back into the current formation.
- Year counter: a huge monospaced number pinned to the corner. It rolls continuously as you scroll, interpolated on a logarithmic scale, from "13,800,000,000 years ago" down through calendar years ("3200 BCE", "1844", "1969") to "Now". It always matches the scroll position exactly.
- Chapter rail: a thin vertical progress line on the right with one tick per chapter. Clicking a tick glides smoothly to that chapter. Arrow keys and Page Up/Down also move between chapters.

TYPOGRAPHY AND LAYOUT
- Headlines: a large, expressive display serif, used sparingly.
- Labels and the year counter: a precise monospace.
- Body: a clean, quiet sans.
- Text sits over the scene. Each chapter's text crossfades in as its formation completes and fades out as the next transition begins.
- Text must stay readable over moving particles. Use a soft local darkening behind text, never a solid box.
- Opening screen: the title "The Long Scroll", the subtitle "13.8 billion years. One scroll.", a short loader that counts up while formations are computed, and a hint: "Scroll to begin. Hold anywhere to collapse the universe."

FINAL SECTION: "THE FRONTIER"
After chapter 9, the scene stays alive in the background and the page scrolls into a normal section titled "The frontier". The intro line reads: "Twenty-two sites pushing real-time 3D on the web right now." Show them as an elegant grid of link cards (name, studio if known, domain). Every card opens in a new tab. Include ALL of these links:

1. Igloo Inc (abeto): https://www.igloo.inc/
2. Messenger (abeto): https://messenger.abeto.co/
3. Oryzo AI (Lusion): https://oryzo.ai/
4. Bruno Simon's Portfolio: https://bruno-simon.com/
5. GQ & AP: The Extraordinary Lab (Immersive Garden): https://www.awwwards.com/sites/gq-ap-the-extraordinary-lab
6. Santioni Spirits: The Notturno Experience (Active Theory): https://www.awwwards.com/sites/santioni-spirits
7. Cartier Watches & Wonders 2026 (Immersive Garden): https://www.cartier.com/en-fr/watchesandwonders
8. Three.js Paris conference: https://threejs.paris
9. Lacoste Polo Factory (Merci Michel): https://www.awwwards.com/sites/lacoste-polo-factory
10. Lacoste Ace Breaker: https://members-play.lacoste.com/ace-breaker-rg/gb/en/
11. Explore Primland: https://explore.ownprimland.com/
12. IVRESS: https://brand.ivress.co.jp/
13. Hubtown (Unseen Studio): https://hubtown.co.in/
14. Shopify Editions Spring '26: https://www.shopify.com/editions/spring2026
15. Iventions: https://iventions.com/
16. EnduroSat Space Service: https://www.endurosat.com/space-service
17. Vectr (Utsubo): https://www.utsubo.com/blog/vectr-ai-startup-branding-case-study
18. Dragonfly (Studio Freight): https://dragonfly.xyz
19. Moto Finance (Properly Studio): https://www.awwwards.com/sites/moto-finance
20. Sleep Well Creative: https://sleep-well-creatives.com/
21. Hiroto Sato: https://www.awwwards.com/sites/hiroto-sato
22. Noomo: The Power of Storytelling: https://www.awwwards.com/noomoagency/

End with a one-line footer: "Every particle on this page is the same particle you started with."

PERFORMANCE AND ACCESSIBILITY
- Must hold a smooth 60fps on a mid-range laptop and stay fluid on a mid-range phone.
- Detect device capability: reduce particle count and pixel ratio on phones and weak GPUs, and lower quality automatically if the frame rate drops.
- prefers-reduced-motion: no turbulence, no idle motion and no camera drift, with slow crossfades between formations. All text remains fully usable.
- If WebGL is unavailable, show a styled static gradient with all chapter text still readable and scrollable.
- No horizontal scroll at any width. Works from 360px phones to 4K screens.
- All text is real HTML (selectable, screen-reader readable). Every link is keyboard-focusable with a visible focus style.
- Fast first load: no heavy libraries beyond Three.js (or raw WebGL), and no external images.

ACCURACY
Every date and fact above must stay historically accurate. The Morse code must be correct letter by letter. Do not invent statistics.

DELIVERABLE
A single self-contained HTML file (inline CSS and JS; Three.js from a pinned CDN version is allowed) that runs by opening it in a browser and deploys as-is to GitHub Pages, Vercel or Netlify.

ACCEPTANCE CHECKLIST
- All 9 formations morph smoothly in both scroll directions.
- The year counter matches every chapter exactly.
- Hold-to-collapse works with mouse and touch.
- All 22 links are present and open correctly.
- No console errors.
- Reduced-motion and no-WebGL fallbacks both work.
- Readable on a phone.

---

TECH STACK (most advanced available, latest stable versions)
- Next.js (App Router) + TypeScript in strict mode.
- Rendering: Three.js WebGPURenderer with TSL (Three Shading Language) for every shader. One shader codebase runs on WebGPU and falls back automatically to WebGL2 on older browsers.
- GPU compute particles: positions, velocities and all 9 formation targets live in GPU storage buffers and are updated by TSL compute shaders every frame, with no per-frame CPU work.
- Particle counts: 1,000,000 on desktop WebGPU, 250,000 on phones, and 100,000 on the WebGL2 fallback (morph done in the vertex shader there).
- Real physics, not tweens: each particle has velocity and is pulled toward its target by a spring force plus curl-noise turbulence. Chapter transitions, the cursor push and hold-to-collapse are all genuine simulation, so they react naturally when interrupted mid-motion.
- React Three Fiber (configured with the WebGPU renderer) + drei. If R3F's WebGPU setup proves unstable, use vanilla Three.js inside a single client component instead.
- Post-processing as TSL node passes: bloom, depth of field focused on the current formation, film grain, vignette, very subtle chromatic aberration.
- Theatre.js for keyframed cinematic camera paths per chapter. Edit them visually in development and bake them to JSON for production.
- Lenis smooth scroll + GSAP ScrollTrigger, mapping scroll to one 0–9 progress value.
- Tailwind CSS + Motion for the HTML overlay, next/font for typography, Zustand as the shared store between canvas and UI.
- Web Workers generate all formations off the main thread.
- Generative ambient sound with the Web Audio API: a low drone whose pitch and texture shift per chapter, a rising whoosh while holding to collapse, and a burst on release. Off by default, with one sound toggle.
- Adaptive quality: detect WebGPU support, GPU tier and live frame rate, then scale particle count, resolution and post effects automatically.
- Dev only: leva for live tuning, stats-gl for GPU timing. Both are stripped from production.

ARCHITECTURE
- app/page.tsx: page shell. The canvas is a client-only component (dynamic import, ssr: false), fixed behind the HTML content.
- tsl/: particles.compute.ts (simulation), particles.material.ts (sprites and color), post.ts (effect passes).
- lib/formations/: one generator per chapter (bigBang, galaxy, earth, dna, tablet, morse, moon, network, canvas), each returning the same particle count. Run them in a Web Worker.
- lib/quality.ts: capability detection and adaptive quality tiers.
- audio/engine.ts: the generative sound system.
- theatre/: camera keyframes as baked JSON.
- data/chapters.ts and data/frontier.ts: single source of truth for chapter content and the 22 links.
- components/ui/: Loader, YearCounter, ChapterRail, ChapterText, SoundToggle, Frontier, Footer.
- components/scene/: Particles, StarField, CameraRig, Effects.
