// Camino world palette: one colour grade for every lit surface in the 3D world.
// The models are built with pastel vertex colours. Rather than recolour each generator, every MeshStandardMaterial gets a
// small grade after its albedo (desaturate, darken, tint by the hour). Road markings (unlit basic) are only dimmed at night.
// Emissive (windows, lamps), the sky, scan view and info-view overlays are untouched.
import * as THREE from 'three';

const lerp = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));

export const GRADE = { uSat: { value: 0.62 }, uTint: { value: new THREE.Vector3(0.86, 0.85, 0.83) }, uMark: { value: 0.92 } };

/** Grade for an hour's light (the lightAt() result): { sat, tint, mark }. Pure and smooth in L.golden and L.night. */
export function gradeFor(L) {
  const day = [0.86, 0.85, 0.82], gold = [0.9, 0.82, 0.7], night = [0.66, 0.76, 0.98];
  let tint = mix3(day, gold, Math.min(1, L.golden * 0.9));
  tint = mix3(tint, night, L.night);
  return { sat: lerp(lerp(0.62, 0.7, L.golden), 0.5, L.night), tint, mark: lerp(0.92, 0.5, L.night) };
}

export function applyGrade(L, scan = false) {
  const g = gradeFor(L);
  GRADE.uSat.value = g.sat; GRADE.uTint.value.set(...g.tint); GRADE.uMark.value = scan ? 1 : g.mark;
}

const isMark = (m) => m.vertexColors && !m.transparent && m.polygonOffsetFactor === -3; // lane lines, crosswalks, stop bars

// Installed on the prototypes, so it covers materials created before and after this module loads (programs compile lazily).
THREE.MeshStandardMaterial.prototype.onBeforeCompile = function (shader) {
  shader.uniforms.uSat = GRADE.uSat; shader.uniforms.uTint = GRADE.uTint;
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float uSat; uniform vec3 uTint;')
    .replace('#include <color_fragment>', `#include <color_fragment>
  { float gl = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)); diffuseColor.rgb = mix(vec3(gl), diffuseColor.rgb, uSat) * uTint; }`);
};
THREE.MeshBasicMaterial.prototype.onBeforeCompile = function (shader) {
  if (!isMark(this)) return;
  shader.uniforms.uMark = GRADE.uMark;
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float uMark;')
    .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= uMark;');
};
