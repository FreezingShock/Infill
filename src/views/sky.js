// On-theme sky: banded paper-toon gradient dome, flat sun and moon discs, stars at night,
// and cream puffy clouds with ink outlines (same look as the trees). Follows the camera.
import * as THREE from 'three';

const VERT = `varying vec3 vDir;
void main(){ vDir = normalize(position); vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0); gl_Position = p.xyww; gl_Position.z *= 0.99999; }`;
const FRAG = `precision highp float;
varying vec3 vDir;
uniform vec3 top; uniform vec3 mid; uniform vec3 low; uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 moonDir; uniform float night; uniform float sunUp;
float hash(vec3 p){ p = fract(p * 0.3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  // 6 flat bands from horizon to zenith, like cut paper
  float t = clamp(h * 1.6, 0.0, 1.0);
  float band = floor(pow(t, 0.7) * 6.0) / 5.0;
  vec3 col = mix(low, mid, smoothstep(0.0, 0.4, band));
  col = mix(col, top, smoothstep(0.35, 1.0, band));
  if (h < 0.0) col = low;
  // stars
  if (night > 0.02 && h > 0.02) {
    vec3 q = floor(d * 160.0);
    float s = step(0.9965, hash(q));
    col = mix(col, vec3(1.0, 0.96, 0.85), s * night * smoothstep(0.02, 0.2, h));
  }
  // sun: flat disc, a ring of soft bands around it
  float ds = acos(clamp(dot(d, normalize(sunDir)), -1.0, 1.0));
  float sunMask = sunUp * (1.0 - smoothstep(0.052, 0.056, ds));
  float halo1 = sunUp * (1.0 - smoothstep(0.11, 0.115, ds)) * 0.22;
  float halo2 = sunUp * (1.0 - smoothstep(0.2, 0.205, ds)) * 0.12;
  col = mix(col, sunCol, max(halo1, halo2));
  col = mix(col, vec3(1.0, 0.97, 0.86), sunMask);
  col = mix(col, vec3(0.17, 0.14, 0.12), sunUp * (smoothstep(0.052, 0.054, ds) - smoothstep(0.057, 0.059, ds)) * 0.55);
  // moon: disc with a bite taken out (crescent)
  vec3 mdir = normalize(moonDir);
  float dm = acos(clamp(dot(d, mdir), -1.0, 1.0));
  vec3 side = normalize(cross(mdir, vec3(0.0, 1.0, 0.0)) + 0.0001);
  float bite = acos(clamp(dot(d, normalize(mdir + side * 0.035)), -1.0, 1.0));
  float moon = (1.0 - smoothstep(0.04, 0.043, dm)) * (smoothstep(0.036, 0.039, bite)) * night * step(0.0, mdir.y);
  col = mix(col, vec3(0.96, 0.93, 0.8), moon);
  gl_FragColor = vec4(col, 1.0);
}`;

const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();

function makeCloud() {
  const g = new THREE.Group(), n = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const r = 55 + rnd() * 55, geo = new THREE.IcosahedronGeometry(r, 1).scale(1.4, 0.7, 1);
    const m = new THREE.Mesh(geo, CLOUD_MAT); m.position.set((i - n / 2) * 85 + rnd() * 20, (rnd() - 0.5) * 22, (rnd() - 0.5) * 40);
    const shell = new THREE.Mesh(geo, CLOUD_INK); shell.position.copy(m.position); shell.scale.setScalar(1.07);
    g.add(shell, m);
  }
  return g;
}
const CLOUD_MAT = new THREE.MeshBasicMaterial({ color: 0xfaf4e6, fog: false });
const CLOUD_INK = new THREE.MeshBasicMaterial({ color: 0x2b2420, side: THREE.BackSide, fog: false });

export function createSky(scene) {
  const U = {
    top: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, low: { value: new THREE.Color() },
    sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color() }, moonDir: { value: new THREE.Vector3(0, -1, 0) },
    night: { value: 0 }, sunUp: { value: 1 },
  };
  const dome = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), new THREE.ShaderMaterial({ uniforms: U, vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false }));
  dome.frustumCulled = false; dome.renderOrder = -100;
  const clouds = new THREE.Group(), list = [];
  for (let i = 0; i < 14; i++) {
    const c = makeCloud(), a = (i / 14) * Math.PI * 2 + rnd() * 0.3;
    c.userData = { a, r: 1100 + rnd() * 500, y: 260 + rnd() * 160, sp: 0.0006 + rnd() * 0.0006 };
    c.scale.setScalar(0.8 + rnd() * 0.7); list.push(c); clouds.add(c);
  }
  scene.add(dome, clouds);
  const dusk = new THREE.Color(0xf2b38a), nightC = new THREE.Color(0x3a4468), day = new THREE.Color(0xfaf4e6), tmp = new THREE.Color();
  return {
    update(L) {
      U.top.value.setRGB(...L.skyTop); U.low.value.setRGB(...L.skyBottom);
      U.mid.value.setRGB(...L.skyTop).lerp(U.low.value, 0.55);
      U.sunDir.value.set(...L.skyDir); U.moonDir.value.set(...L.moonDir);
      U.sunCol.value.setRGB(...L.sunCol); U.night.value = L.night; U.sunUp.value = L.skyDir[1] > -0.06 ? 1 : 0;
      tmp.copy(day).lerp(dusk, L.golden * 0.8).lerp(nightC, L.night);
      CLOUD_MAT.color.copy(tmp);
    },
    /** Keep the sky around the camera; clouds only show as horizon decor once the view is tilted. */
    follow(target, polar, dt) {
      dome.position.copy(target); clouds.position.set(target.x, 0, target.z);
      clouds.visible = polar > 0.55;
      for (const c of list) { c.userData.a += c.userData.sp * dt * 6; const { a, r, y } = c.userData; c.position.set(Math.cos(a) * r, y, Math.sin(a) * r); c.rotation.y = -a; }
    },
  };
}
