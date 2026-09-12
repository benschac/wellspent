"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { neckGeometry, roundedRail } from "./focus-geometry";
import { useFocusInteraction } from "./focus-interaction";
import { buildEnvironmentTexture } from "./threeui/studio-environment";

const metal = {
  color: 0xa8a6a0,
  metalness: 1,
  roughness: 0.19,
  envMapIntensity: 2.1,
  clearcoat: 1,
} satisfies THREE.MeshPhysicalMaterialParameters;
const darkMetal = {
  color: 0x30343a,
  metalness: 0.82,
  roughness: 0.19,
  envMapIntensity: 1.65,
  clearcoat: 1,
} satisfies THREE.MeshPhysicalMaterialParameters;
const faceMaterial = {
  color: 0x1f2731,
  metalness: 0.1,
  roughness: 0.17,
  transmission: 0.32,
  thickness: 0.45,
  ior: 1.48,
  attenuationColor: 0x8294af,
  attenuationDistance: 2,
  clearcoat: 1,
  clearcoatRoughness: 0.04,
  envMapIntensity: 1.45,
} satisfies THREE.MeshPhysicalMaterialParameters;

function StudioEnvironment() {
  const { gl, scene, invalidate } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const source = buildEnvironmentTexture();
    const environment = pmrem.fromEquirectangular(source);
    source.dispose();
    const previous = scene.environment;
    scene.environment = environment.texture;
    invalidate();
    return () => {
      scene.environment = previous;
      environment.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, invalidate]);
  return null;
}

function RailGeometry({
  dimensions,
}: {
  dimensions: [number, number, number, number];
}) {
  const [width, height, radius, depth] = dimensions;
  const geometry = useMemo(
    () => roundedRail(width, height, radius, depth),
    [width, height, radius, depth],
  );
  // Primitives are externally owned; Fiber does not dispose them.
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <primitive object={geometry} attach="geometry" />;
}

function FocusScene({
  host,
  onFailure,
}: {
  host: HTMLElement;
  onFailure: () => void;
}) {
  const rig = useRef<THREE.Group>(null);
  const neck = useRef<THREE.Mesh>(null);
  const initialNeck = useMemo(() => neckGeometry(0, 0), []);
  const currentNeck = useRef(initialNeck);
  useFocusInteraction({ host, rig, neck, currentNeck, onFailure });
  useEffect(() => {
    // Keep ownership independent of Fiber detaching the primitive on unmount.
    return () => currentNeck.current.dispose();
  }, []);

  return (
    <>
      <StudioEnvironment />
      <group
        ref={rig}
        position={[-0.35, 0.35, 0]}
        scale={0.86}
        rotation-z={-0.06}
      >
        <mesh>
          <RailGeometry dimensions={[6.55, 2.62, 1.15, 0.19]} />
          <meshPhysicalMaterial {...metal} />
        </mesh>
        <mesh position-z={0.12}>
          <RailGeometry dimensions={[6.43, 2.49, 1.09, 0.19]} />
          <meshPhysicalMaterial {...darkMetal} />
        </mesh>
        <mesh position-z={0.25}>
          <RailGeometry dimensions={[6.13, 2.22, 0.99, 0.12]} />
          <meshPhysicalMaterial {...faceMaterial} />
        </mesh>
        <mesh position={[1.78, 0, 0.49]}>
          <torusGeometry args={[0.79, 0.032, 8, 100]} />
          <meshBasicMaterial color={0x3f444b} />
        </mesh>
        <mesh position={[1.78, 0, 0.49]} rotation-z={-Math.PI}>
          <torusGeometry args={[0.79, 0.034, 8, 96, Math.PI * 1.5]} />
          <meshBasicMaterial color={0xffe8bf} />
        </mesh>
      </group>
      <mesh position={[3.45, 0, -0.08]}>
        <boxGeometry args={[0.035, 22, 0.1]} />
        <meshPhysicalMaterial
          color={0x59697a}
          metalness={0.95}
          roughness={0.22}
          envMapIntensity={2}
        />
      </mesh>
      <mesh position={[3.56, 0, -0.18]}>
        <boxGeometry args={[0.15, 22, 0.12]} />
        <meshPhysicalMaterial {...faceMaterial} />
      </mesh>
      <mesh ref={neck} position-z={-0.07}>
        <primitive object={initialNeck} attach="geometry" />
        <meshPhysicalMaterial {...darkMetal} />
      </mesh>
      <ambientLight color={0xcdd6e6} intensity={1.7} />
      <directionalLight color={0xffedcd} intensity={2} position={[-3, 4, 7]} />
      <directionalLight color={0x719fff} intensity={3.5} position={[5, 0, 3]} />
    </>
  );
}

export default function FocusCanvas({
  host,
  onFailure,
}: {
  host: HTMLElement;
  onFailure: () => void;
}) {
  return (
    <Canvas
      orthographic
      camera={{ position: [0, 0, 12], near: 0.1, far: 30, manual: true }}
      frameloop="demand"
      dpr={[1, 1.5]}
      resize={{ scroll: false }}
      style={{ pointerEvents: "none" }}
      gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
      onCreated={({ gl }) => {
        gl.outputColorSpace = THREE.SRGBColorSpace;
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.1;
        gl.setClearColor(0x000000, 0);
        gl.domElement.setAttribute("aria-hidden", "true");
        gl.domElement.dataset.animationActive = "false";
      }}
      fallback={null}
    >
      <FocusScene host={host} onFailure={onFailure} />
    </Canvas>
  );
}
