"use client";

import { useEffect, useRef } from "react";

export function GlassFocus() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const host = canvas.parentElement;
    if (!host) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void import("./focus-scene")
      .then(({ createFocusScene }) => {
        if (disposed || !canvas || !host) return;
        const activeCanvas = canvas;
        const activeHost = host;
        let scene: ReturnType<typeof createFocusScene>;
        try {
          scene = createFocusScene(activeCanvas);
        } catch {
          return;
        }
        activeHost.dataset.glassReady = "true";
        let frame = 0;
        let visible = true;
        let currentX = 0;
        let currentY = 0;
        let targetX = 0;
        let targetY = 0;
        const reduceMotion = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        );
        function stop() {
          cancelAnimationFrame(frame);
          frame = 0;
          activeCanvas.dataset.animationActive = "false";
        }
        function draw() {
          frame = 0;
          if (disposed || !visible || document.hidden) {
            stop();
            return;
          }
          currentX += (targetX - currentX) * 0.13;
          currentY += (targetY - currentY) * 0.13;
          scene.render(currentX, currentY);
          if (
            Math.abs(targetX - currentX) + Math.abs(targetY - currentY) >
              0.002 &&
            !reduceMotion.matches
          ) {
            activeCanvas.dataset.animationActive = "true";
            frame = requestAnimationFrame(draw);
          } else stop();
        }
        function schedule() {
          if (!frame && visible && !document.hidden && !disposed)
            frame = requestAnimationFrame(draw);
        }
        function move(event: PointerEvent) {
          if (reduceMotion.matches || event.pointerType === "touch") return;
          const rect = activeHost.getBoundingClientRect();
          targetX = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
          targetY = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
          schedule();
        }
        function reset() {
          targetX = 0;
          targetY = 0;
          schedule();
        }
        function visibility() {
          if (document.hidden) stop();
          else schedule();
        }
        function motionChange() {
          stop();
          currentX = 0;
          currentY = 0;
          targetX = 0;
          targetY = 0;
          scene.render();
        }
        const resize = new ResizeObserver(() => {
          scene.resize(activeHost.clientWidth, activeHost.clientHeight);
        });
        resize.observe(activeHost);
        const intersection = new IntersectionObserver(([entry]) => {
          visible = entry?.isIntersecting ?? false;
          if (visible) schedule();
          else stop();
        });
        intersection.observe(activeHost);
        const drag = (event: Event) => {
          const detail = (event as CustomEvent<{ x: number; y: number }>)
            .detail;
          scene.drag(detail.x, detail.y);
        };
        activeHost.addEventListener("focus-rail-drag", drag);
        activeHost.addEventListener("pointermove", move);
        activeHost.addEventListener("pointerleave", reset);
        document.addEventListener("visibilitychange", visibility);
        reduceMotion.addEventListener("change", motionChange);
        const contextLost = (event: Event) => {
          event.preventDefault();
          stop();
          delete activeHost.dataset.glassReady;
        };
        activeCanvas.addEventListener("webglcontextlost", contextLost);
        scene.resize(activeHost.clientWidth, activeHost.clientHeight);
        cleanup = () => {
          stop();
          resize.disconnect();
          intersection.disconnect();
          activeHost.removeEventListener("focus-rail-drag", drag);
          activeHost.removeEventListener("pointermove", move);
          activeHost.removeEventListener("pointerleave", reset);
          document.removeEventListener("visibilitychange", visibility);
          reduceMotion.removeEventListener("change", motionChange);
          activeCanvas.removeEventListener("webglcontextlost", contextLost);
          delete activeHost.dataset.glassReady;
          scene.dispose();
        };
      })
      .catch(() => {
        /* The accessible DOM control is the WebGL fallback. */
      });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);
  return (
    // biome-ignore lint/a11y/noAriaHiddenOnFocusable: This canvas is decorative; the adjacent DOM controls provide the interaction.
    <canvas
      ref={canvasRef}
      className="gh-glass-canvas"
      aria-hidden="true"
      data-animation-active="false"
    />
  );
}
