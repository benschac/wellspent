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
        if (disposed) return;
        let scene: ReturnType<typeof createFocusScene>;
        try {
          scene = createFocusScene(canvas);
        } catch {
          return;
        }
        host.dataset.glassReady = "true";
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
          canvas!.dataset.animationActive = "false";
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
            canvas!.dataset.animationActive = "true";
            frame = requestAnimationFrame(draw);
          } else stop();
        }
        function schedule() {
          if (!frame && visible && !document.hidden && !disposed)
            frame = requestAnimationFrame(draw);
        }
        function move(event: PointerEvent) {
          if (reduceMotion.matches || event.pointerType === "touch") return;
          const rect = host!.getBoundingClientRect();
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
          scene.resize(host!.clientWidth, host!.clientHeight);
        });
        resize.observe(host);
        const intersection = new IntersectionObserver(([entry]) => {
          visible = entry?.isIntersecting ?? false;
          if (visible) schedule();
          else stop();
        });
        intersection.observe(host);
        const drag = (event: Event) => {
          const detail = (event as CustomEvent<{ x: number; y: number }>)
            .detail;
          scene.drag(detail.x, detail.y);
        };
        host.addEventListener("focus-rail-drag", drag);
        host.addEventListener("pointermove", move);
        host.addEventListener("pointerleave", reset);
        document.addEventListener("visibilitychange", visibility);
        reduceMotion.addEventListener("change", motionChange);
        const contextLost = (event: Event) => {
          event.preventDefault();
          stop();
          delete host.dataset.glassReady;
        };
        canvas.addEventListener("webglcontextlost", contextLost);
        scene.resize(host.clientWidth, host.clientHeight);
        cleanup = () => {
          stop();
          resize.disconnect();
          intersection.disconnect();
          host.removeEventListener("focus-rail-drag", drag);
          host.removeEventListener("pointermove", move);
          host.removeEventListener("pointerleave", reset);
          document.removeEventListener("visibilitychange", visibility);
          reduceMotion.removeEventListener("change", motionChange);
          canvas.removeEventListener("webglcontextlost", contextLost);
          delete host.dataset.glassReady;
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
    <canvas
      ref={canvasRef}
      className="gh-glass-canvas"
      aria-hidden="true"
      data-animation-active="false"
    />
  );
}
