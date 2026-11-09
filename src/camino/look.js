// Camino street view: the same city models, sidewalks and trees, rendered like a real place.
// render.js builds MeshStandardMaterial instead of toon when Camino is on; this tunes the renderer and the shared materials.
import * as THREE from 'three';
import { INK, MAT, renderer, sun } from '../app/render.js';

renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
sun.shadow.radius = 3;
sun.shadow.bias = -0.00025;
// ink outlines become a faint architectural edge instead of a cartoon line
INK.color.set(0x1b1f22); INK.transparent = true; INK.opacity = 0.16; INK.depthWrite = false;
// facades a touch rough, windows glossy and darker so they read as glass
MAT.solid.roughness = 0.88;
MAT.glass.roughness = 0.18; MAT.glass.metalness = 0.35; MAT.glass.color.setRGB(0.55, 0.62, 0.68);
MAT.ground.roughness = 0.95;
for (const m of Object.values(MAT)) m.needsUpdate = true;
