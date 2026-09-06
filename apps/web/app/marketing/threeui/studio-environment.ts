// Adapted from ThreeUI glassToggleScene.ts, MIT, Copyright (c) 2026 Meng To.
// Source: https://github.com/MengTo/threeui
// Local adaptation: warm studio palette, current Three.js color management.
// Full license accompanies this file.
import * as THREE from "three";

type Softbox = {
  u: number;
  v: number;
  halfWidth: number;
  halfHeight: number;
  intensity: number;
  feather: number;
  warm: number;
};

const SOFTBOXES: readonly Softbox[] = [
  /* Broad key, high and camera-left. */
  { u: 0.3, v: 0.2, halfWidth: 0.155, halfHeight: 0.135, intensity: 19, feather: 0.86, warm: 0.04 },
  /* Narrow strip: the hard highlight that runs the length of the shoulder. */
  { u: 0.52, v: 0.115, halfWidth: 0.17, halfHeight: 0.04, intensity: 15, feather: 0.9, warm: 0 },
  /* Cool rim from behind camera-right. */
  { u: 0.86, v: 0.31, halfWidth: 0.085, halfHeight: 0.09, intensity: 10, feather: 0.92, warm: -0.06 },
  /* Backlight, directly behind the subject at u=0.25. At the silhouette the
     reflection vector points straight away from the camera, so this is the
     source that draws the clean border all the way round — and it lights the
     transmission through the body at the same time. A ring around the horizon
     instead reflects onto the equator and paints a bar across the middle. */
  { u: 0.25, v: 0.5, halfWidth: 0.1, halfHeight: 0.2, intensity: 6.5, feather: 0.8, warm: 0 },
  /* A small hard source high and camera-left: the crisp catchlight on the
     sphere, which a broad softbox alone can never give. */
  { u: 0.95, v: 0.21, halfWidth: 0.028, halfHeight: 0.032, intensity: 70, feather: 0.45, warm: 0.02 },
  /* Low bounce so the underside is not dead black. */
  { u: 0.5, v: 0.82, halfWidth: 0.5, halfHeight: 0.22, intensity: 0.5, feather: 1, warm: 0.02 },
];

function smoothFalloff(distance: number, extent: number, feather: number) {
  const inner = extent * (1 - feather);
  if (distance <= inner) return 1;
  if (distance >= extent) return 0;
  const t = (distance - inner) / (extent - inner);
  return 1 - t * t * (3 - 2 * t);
}

export function buildEnvironmentTexture() {
  const width = 512;
  const height = 256;
  const data = new Float32Array(width * height * 4);
  const skyTop = new THREE.Color(0xf5eee2);
  const skyBottom = new THREE.Color(0x78736b);
  const floor = new THREE.Color(0x171613);
  const box = new THREE.Color(0xfff5e8);

  for (let y = 0; y < height; y += 1) {
    /* three's equirect maps texture V=0 to straight *down*, so the rows have
       to be walked in reverse for `v` to mean what the softbox list says it
       means. Without this the whole studio is upside down and the subject is
       lit from the floor. */
    const v = 1 - y / (height - 1);
    /* Sky above, floor below, blended across a wide band — a hard horizon
       reflects as a seam cutting the capsule in half. */
    const ground = smoothFalloff(Math.max(0, 0.62 - v), 0.34, 1);
    const skyMix = Math.min(1, v / 0.56);
    const skyR = skyTop.r + (skyBottom.r - skyTop.r) * skyMix;
    const skyG = skyTop.g + (skyBottom.g - skyTop.g) * skyMix;
    const skyB = skyTop.b + (skyBottom.b - skyTop.b) * skyMix;
    const fade = 1 - Math.max(0, v - 0.62) * 1.1;
    const baseR = skyR + (floor.r * fade - skyR) * ground;
    const baseG = skyG + (floor.g * fade - skyG) * ground;
    const baseB = skyB + (floor.b * fade - skyB) * ground;

    for (let x = 0; x < width; x += 1) {
      const u = x / (width - 1);
      let r = baseR;
      let g = baseG;
      let b = baseB;

      for (const light of SOFTBOXES) {
        /* Azimuth wraps, so measure the short way round. */
        let du = Math.abs(u - light.u);
        if (du > 0.5) du = 1 - du;
        const dv = Math.abs(v - light.v);
        /* Elliptical, not separable: a product of two 1D falloffs reflects as a
           rectangle with visible corners. */
        const radial = Math.sqrt(
          (du / light.halfWidth) * (du / light.halfWidth)
          + (dv / light.halfHeight) * (dv / light.halfHeight),
        );
        if (radial >= 1) continue;
        const strength = smoothFalloff(radial, 1, light.feather) * light.intensity;
        r += box.r * strength * (1 + light.warm);
        g += box.g * strength;
        b += box.b * strength * (1 - light.warm);
      }

      const index = (y * width + x) * 4;
      data[index] = r;
      data[index + 1] = g;
      data[index + 2] = b;
      data[index + 3] = 1;
    }
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

