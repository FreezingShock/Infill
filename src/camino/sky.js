// Camino sky: a smooth physical-looking gradient (no paper bands, no ink clouds), a soft sun with glow,
// stars and a moon at night, and a black data sky in scan view.
// update(L) runs first inside applyLight, so it also tunes L (fog haze colour, light warmth) for the realistic look.
import * as THREE from 'three';

const VERT = `varying vec3 vDir;
void main(){ vDir = normalize(position); vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0); gl_Position = p.xyww; gl_Position.z *= 0.99999; }`;
const FRAG = `precision highp float;
varying vec3 vDir;
uniform vec3 zen; uniform vec3 hor; uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 moonDir; uniform float night; uniform float sunUp; uniform float scan;
float hash(vec3 p){ p = fract(p * 0.3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main(){
  vec3 d = normalize(vDir); float h = d.y;
  vec3 col = mix(hor, zen, pow(clamp(h, 0.0, 1.0), 0.55));
  if (h < 0.0) col = hor * 0.92;
  vec3 s = normalize(sunDir); float cs = max(dot(d, s), 0.0);
  col += sunCol * (pow(cs, 9.0) * 0.32 + pow(cs, 90.0) * 0.6) * sunUp;           // glow around the sun
  col += sunCol * 0.18 * pow(1.0 - abs(h), 6.0) * sunUp * (1.0 - night) * max(0.0, dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(s.x, 0.0, s.z)))); // warm horizon on the sun side
  col = mix(col, vec3(1.0, 0.97, 0.9) * 1.4, smoothstep(0.9993, 0.9997, cs) * sunUp); // disc
  if (night > 0.02 && h > 0.02) { vec3 q = floor(d * 220.0); float st = step(0.9972, hash(q)) * hash(q + 3.1); col += vec3(0.85, 0.9, 1.0) * st * night * smoothstep(0.02, 0.25, h); }
  vec3 m = normalize(moonDir); float dm = dot(d, m);
  col = mix(col, vec3(0.86, 0.88, 0.92), smoothstep(0.99955, 0.99975, dm) * night * step(0.0, m.y));
  col += vec3(0.25, 0.3, 0.4) * pow(max(dm, 0.0), 60.0) * night * 0.35;
  // scan: near black with a faint cyan horizon line
  vec3 sc = vec3(0.012, 0.016, 0.02) + vec3(0.02, 0.09, 0.1) * pow(1.0 - abs(h), 24.0);
  col = mix(col, sc, scan);
  gl_FragColor = vec4(col, 1.0);
}`;

const hex = (h) => [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
// real-world sky colours (zenith, horizon) for day, golden hour and night
const DAY = [hex(0x3d78c2), hex(0xc6d8e4)], GOLD = [hex(0x34437a), hex(0xf0a76e)], NIGHT = [hex(0x04060c), hex(0x141c2c)];
const SCAN_FOG = hex(0x05080a);

export const skyState = { scan: 0, L: null };

/** Realistic colours for an hour's light: [zenith, horizon]. Pure. */
export function caminoSkyColors(L) {
  let z = mix(DAY[0], GOLD[0], L.golden * 0.85), hz = mix(DAY[1], GOLD[1], L.golden * 0.85);
  z = mix(z, NIGHT[0], L.night); hz = mix(hz, NIGHT[1], L.night);
  return [z, hz];
}

export function createCaminoSky(scene) {
  const U = {
    zen: { value: new THREE.Color() }, hor: { value: new THREE.Color() },
    sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color() }, moonDir: { value: new THREE.Vector3(0, -1, 0) },
    night: { value: 0 }, sunUp: { value: 1 }, scan: { value: 0 },
  };
  const dome = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), new THREE.ShaderMaterial({ uniforms: U, vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false, toneMapped: false }));
  dome.frustumCulled = false; dome.renderOrder = -100; dome.userData.noScan = true;
  scene.add(dome);
  const api = {
    dome,
    update(L) {
      skyState.L = L;
      const [z, hz] = caminoSkyColors(L);
      U.zen.value.setRGB(...z); U.hor.value.setRGB(...hz);
      U.sunDir.value.set(...L.skyDir); U.moonDir.value.set(...L.moonDir);
      U.sunCol.value.setRGB(...mix(L.sunCol, [1, 0.62, 0.36], L.golden * 0.6)); U.night.value = L.night; U.sunUp.value = L.skyDir[1] > -0.06 ? 1 : 0;
      U.scan.value = skyState.scan;
      // the rest of applyLight reads these: a real haze colour for fog and the page, warmer low sun, cooler shade
      L.skyTop = skyState.scan ? SCAN_FOG : z; L.skyBottom = skyState.scan ? SCAN_FOG : hz;
      L.hemiGround = mix([0.36, 0.33, 0.28], [0.08, 0.09, 0.11], L.night);
      L.hemiSky = mix(mix([0.62, 0.74, 0.92], [0.55, 0.5, 0.62], L.golden * 0.6), [0.16, 0.2, 0.32], L.night);
      L.hemiI *= skyState.scan ? 0.6 : 0.78; L.sunI *= 1.12; L.sunCol = mix(L.sunCol, [1, 0.7, 0.45], L.golden * 0.35);
    },
    follow(target) { dome.position.copy(target); },
    /** Scan switched: repaint the dome and fog now instead of waiting for the clock to move. */
    refresh() { U.scan.value = skyState.scan; const L = skyState.L; if (!L || !scene.fog) return; scene.fog.color.setRGB(...(skyState.scan ? SCAN_FOG : caminoSkyColors(L)[1])); },
  };
  skyState.sky = api;
  return api;
}
