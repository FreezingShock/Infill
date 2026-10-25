import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { $ } from '../engine/core.js';
// ---------- renderer, camera, controls ----------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 6000);
const VIEW_H = 420;
const controls = new MapControls(cam, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.maxPolarAngle = 1.2;
controls.minPolarAngle = 0.15;
controls.minZoom = 0.45;
controls.maxZoom = 14;
controls.zoomToCursor = true;
const CAM_OFF = new THREE.Vector3().setFromSphericalCoords(1600, 0.88, -0.42);
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight, a = w / h;
  renderer.setSize(w, h, false);
  cam.left = -VIEW_H * a / 2; cam.right = VIEW_H * a / 2; cam.top = VIEW_H / 2; cam.bottom = -VIEW_H / 2;
  cam.updateProjectionMatrix();
}

// ---------- toon look ----------
const grad = new THREE.DataTexture(new Uint8Array([130, 130, 130, 255, 185, 185, 185, 255, 228, 228, 228, 255, 255, 255, 255, 255]), 4, 1, THREE.RGBAFormat);
grad.minFilter = grad.magFilter = THREE.NearestFilter; grad.needsUpdate = true;
const toon = (o) => new THREE.MeshToonMaterial({ gradientMap: grad, ...o });
const INK = new THREE.LineBasicMaterial({ color: 0x2b2420 });
const hemi = new THREE.HemisphereLight(0xeaf3ff, 0x8a7a5a, 1.15);
const sun = new THREE.DirectionalLight(0xfff1d6, 2.1);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
const SUN_OFF = new THREE.Vector3(-260, 380, 200);
scene.add(hemi, sun, sun.target);
const MAT = {
  solid: toon({ vertexColors: true }),
  glass: toon({ vertexColors: true, emissive: 0x000000 }),
  ground: toon({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
  ghost: new THREE.MeshBasicMaterial({ color: 0x3e9fdc, transparent: true, opacity: 0.38, depthWrite: false }),
  ghostLine: new THREE.LineBasicMaterial({ color: 0x1f6fa8, transparent: true, opacity: 0.8 }),
};

export {
  CAM_OFF,
  INK,
  MAT,
  SUN_OFF,
  cam,
  canvas,
  controls,
  hemi,
  renderer,
  resize,
  scene,
  sun,
  toon,
};
