import { useFrame, useThree } from "@react-three/fiber";
import { type RefObject, useEffect, useRef } from "react";
import * as THREE from "three";
import { neckGeometry } from "./focus-geometry";

export function useFocusInteraction({
  host,
  rig,
  neck,
  currentNeck,
  onFailure,
}: {
  host: HTMLElement;
  rig: RefObject<THREE.Group | null>;
  neck: RefObject<THREE.Mesh | null>;
  currentNeck: RefObject<THREE.ExtrudeGeometry>;
  onFailure: () => void;
}) {
  const { camera, gl, size, invalidate, setFrameloop } = useThree();
  const motion = useRef({
    x: 0,
    y: 0,
    targetX: 0,
    targetY: 0,
    dragX: 0,
    dragY: 0,
    appliedX: 0,
    appliedY: 0,
    visible: true,
    reduced: false,
  });

  useEffect(() => {
    if (!(camera instanceof THREE.OrthographicCamera) || size.width <= 0)
      return;
    camera.left = -5;
    camera.right = 5;
    camera.top = (5 * size.height) / size.width;
    camera.bottom = -camera.top;
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, size.width, size.height, invalidate]);

  useEffect(() => {
    const state = motion.current;
    const canvas = gl.domElement;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    state.reduced = media.matches;
    // Pick up a drag already in progress when the lazy scene mounts.
    state.dragX =
      Number.parseFloat(host.style.getPropertyValue("--rail-x")) || 0;
    state.dragY =
      Number.parseFloat(host.style.getPropertyValue("--rail-y")) || 0;
    function schedule() {
      if (state.visible && !document.hidden) invalidate();
    }
    function visibility() {
      const active = state.visible && !document.hidden;
      setFrameloop(active ? "demand" : "never");
      if (active) invalidate();
      else canvas.dataset.animationActive = "false";
    }
    function move(event: PointerEvent) {
      if (state.reduced || event.pointerType === "touch") return;
      const rect = host.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      state.targetX = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
      state.targetY = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
      schedule();
    }
    function reset() {
      state.targetX = 0;
      state.targetY = 0;
      schedule();
    }
    function motionChange() {
      state.reduced = media.matches;
      state.x = 0;
      state.y = 0;
      reset();
    }
    function drag(event: Event) {
      const detail = (event as CustomEvent<{ x: number; y: number }>).detail;
      if (!detail || !Number.isFinite(detail.x) || !Number.isFinite(detail.y))
        return;
      state.dragX = detail.x;
      state.dragY = detail.y;
      schedule();
    }
    function contextLost(event: Event) {
      event.preventDefault();
      setFrameloop("never");
      canvas.dataset.animationActive = "false";
      delete host.dataset.glassReady;
      onFailure();
    }
    const intersection = new IntersectionObserver(([entry]) => {
      state.visible = entry?.isIntersecting ?? false;
      visibility();
    });
    intersection.observe(host);
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", reset);
    host.addEventListener("focus-rail-drag", drag);
    document.addEventListener("visibilitychange", visibility);
    media.addEventListener("change", motionChange);
    canvas.addEventListener("webglcontextlost", contextLost);
    visibility();
    return () => {
      intersection.disconnect();
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", reset);
      host.removeEventListener("focus-rail-drag", drag);
      document.removeEventListener("visibilitychange", visibility);
      media.removeEventListener("change", motionChange);
      canvas.removeEventListener("webglcontextlost", contextLost);
      canvas.dataset.animationActive = "false";
      delete host.dataset.glassReady;
    };
  }, [host, gl, invalidate, setFrameloop, onFailure]);

  useFrame(() => {
    const state = motion.current;
    const group = rig.current;
    const connector = neck.current;
    if (
      !group ||
      !connector ||
      !state.visible ||
      document.hidden ||
      size.width <= 0
    )
      return;
    state.x += (state.targetX - state.x) * 0.13;
    state.y += (state.targetY - state.y) * 0.13;
    group.rotation.x = state.y * 0.025;
    group.rotation.y = state.x * 0.025;
    const dx = (state.dragX / size.width) * 10;
    const dy = (-state.dragY / size.width) * 10;
    if (dx !== state.appliedX || dy !== state.appliedY) {
      group.position.set(-0.35 + dx, 0.35 + dy, 0);
      const geometry = neckGeometry(dx, dy);
      currentNeck.current.dispose();
      currentNeck.current = geometry;
      connector.geometry = geometry;
      state.appliedX = dx;
      state.appliedY = dy;
    }
    const settling =
      !state.reduced &&
      Math.abs(state.targetX - state.x) + Math.abs(state.targetY - state.y) >
        0.002;
    gl.domElement.dataset.animationActive = String(settling);
    host.dataset.glassReady = "true";
    if (settling) invalidate();
  });
}
