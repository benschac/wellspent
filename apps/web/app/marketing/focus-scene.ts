import * as THREE from "three";
import { buildEnvironmentTexture } from "./threeui/studio-environment";

/** Original focus control using ThreeUI's HDR glass studio environment. */
export function createFocusScene(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 30);
  camera.position.set(0, 0, 12);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const source = buildEnvironmentTexture();
  const environment = pmrem.fromEquirectangular(source);
  source.dispose();
  scene.environment = environment.texture;
  const rig = new THREE.Group();
  rig.position.set(-0.35, 0.35, 0);
  rig.scale.setScalar(0.86);
  rig.rotation.z = -0.06;
  scene.add(rig);

  function roundedRail(
    width: number,
    height: number,
    radius: number,
    depth: number,
  ) {
    const shape = new THREE.Shape();
    const x = -width / 2,
      y = -height / 2;
    shape.moveTo(x + radius, y);
    shape.lineTo(x + width - radius, y);
    shape.quadraticCurveTo(x + width, y, x + width, y + radius);
    shape.lineTo(x + width, y + height - radius);
    shape.quadraticCurveTo(
      x + width,
      y + height,
      x + width - radius,
      y + height,
    );
    shape.lineTo(x + radius, y + height);
    shape.quadraticCurveTo(x, y + height, x, y + height - radius);
    shape.lineTo(x, y + radius);
    shape.quadraticCurveTo(x, y, x + radius, y);
    return new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelSegments: 6,
      steps: 1,
      bevelSize: 0.065,
      bevelThickness: 0.08,
      curveSegments: 32,
    });
  }
  const metal = new THREE.MeshPhysicalMaterial({
    color: 0xa8a6a0,
    metalness: 1,
    roughness: 0.19,
    envMapIntensity: 2.1,
    clearcoat: 1,
  });
  const darkMetal = new THREE.MeshPhysicalMaterial({
    color: 0x30343a,
    metalness: 0.82,
    roughness: 0.19,
    envMapIntensity: 1.65,
    clearcoat: 1,
  });
  const faceMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x1f2731,
    metalness: 0.1,
    roughness: 0.17,
    transmission: 0.32,
    thickness: 0.45,
    ior: 1.48,
    attenuationColor: new THREE.Color(0x8294af),
    attenuationDistance: 2,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.45,
  });
  const rim = new THREE.Mesh(roundedRail(6.55, 2.62, 1.15, 0.19), metal);
  rig.add(rim);
  const inner = new THREE.Mesh(roundedRail(6.43, 2.49, 1.09, 0.19), darkMetal);
  inner.position.z = 0.12;
  rig.add(inner);
  const face = new THREE.Mesh(
    roundedRail(6.13, 2.22, 0.99, 0.12),
    faceMaterial,
  );
  face.position.z = 0.25;
  rig.add(face);
  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffe8bf });
  const trackMaterial = new THREE.MeshBasicMaterial({ color: 0x3f444b });
  const track = new THREE.Mesh(
    new THREE.TorusGeometry(0.79, 0.032, 8, 100),
    trackMaterial,
  );
  track.position.set(1.78, 0, 0.49);
  rig.add(track);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.79, 0.034, 8, 96, Math.PI * 1.5),
    ringMaterial,
  );
  ring.position.copy(track.position);
  ring.rotation.z = -Math.PI;
  rig.add(ring);

  const spineMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x59697a,
    metalness: 0.95,
    roughness: 0.22,
    envMapIntensity: 2,
  });
  const spine = new THREE.Mesh(
    new THREE.BoxGeometry(0.035, 22, 0.1),
    spineMaterial,
  );
  spine.position.set(3.45, 0, -0.08);
  scene.add(spine);
  const spineDark = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 22, 0.12),
    faceMaterial,
  );
  spineDark.position.set(3.56, 0, -0.18);
  scene.add(spineDark);
  function neckGeometry(dx: number, dy: number) {
    const shape = new THREE.Shape();
    const right = 1.85 + dx;
    const middle = 0.2 + dy;
    shape.moveTo(right, middle + 0.85);
    shape.bezierCurveTo(
      right + 0.85,
      middle - 0.05,
      3.45,
      middle - 0.12,
      3.45,
      middle + 2.15,
    );
    shape.lineTo(3.45, middle - 2.15);
    shape.bezierCurveTo(
      3.45,
      middle + 0.1,
      right + 0.75,
      middle - 0.25,
      right,
      middle - 0.85,
    );
    shape.closePath();
    return new THREE.ExtrudeGeometry(shape, {
      depth: 0.16,
      bevelEnabled: true,
      bevelSize: 0.035,
      bevelThickness: 0.05,
      bevelSegments: 4,
      curveSegments: 28,
    });
  }
  const neck = new THREE.Mesh(neckGeometry(0, 0), darkMetal);
  neck.position.z = -0.07;
  scene.add(neck);
  const ambient = new THREE.AmbientLight(0xcdd6e6, 1.7);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xffedcd, 2);
  key.position.set(-3, 4, 7);
  scene.add(key);
  const edge = new THREE.DirectionalLight(0x719fff, 3.5);
  edge.position.set(5, 0, 3);
  scene.add(edge);

  let disposed = false;
  let dragX = 0,
    dragY = 0;
  let width = 800,
    height = 740;
  function render(x = 0, y = 0) {
    if (disposed) return;
    rig.rotation.x = y * 0.025;
    rig.rotation.y = x * 0.025;
    renderer.render(scene, camera);
  }
  return {
    render,
    drag(x: number, y: number) {
      if (disposed) return;
      const dx = (x / width) * 10;
      const dy = (-y / width) * 10;
      if (dx === dragX && dy === dragY) return;
      dragX = dx;
      dragY = dy;
      rig.position.set(-0.35 + dx, 0.35 + dy, 0);
      neck.geometry.dispose();
      neck.geometry = neckGeometry(dx, dy);
      render();
    },
    resize(nextWidth: number, nextHeight: number) {
      if (disposed || nextWidth <= 0 || nextHeight <= 0) return;
      width = nextWidth;
      height = nextHeight;
      renderer.setSize(width, height, false);
      const halfHeight = (5 * height) / width;
      camera.top = halfHeight;
      camera.bottom = -halfHeight;
      camera.updateProjectionMatrix();
      render();
    },
    dispose() {
      disposed = true;
      const materials = new Set<THREE.Material>();
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        (Array.isArray(object.material)
          ? object.material
          : [object.material]
        ).forEach((material) => {
          materials.add(material);
        });
      });
      materials.forEach((material) => {
        material.dispose();
      });
      environment.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}
