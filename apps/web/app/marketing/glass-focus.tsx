"use client";

import dynamic from "next/dynamic";
import {
  Component,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

const FocusCanvas = dynamic(() => import("./focus-scene"), { ssr: false });

class GlassBoundary extends Component<
  { children: ReactNode; onFailure: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFailure();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function GlassFocus() {
  const container = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const parent = container.current?.parentElement;
    if (parent) setHost(parent);
    return () => {
      if (parent) delete parent.dataset.glassReady;
    };
  }, []);
  const onFailure = useCallback(() => {
    if (host) delete host.dataset.glassReady;
    setFailed(true);
  }, [host]);
  return (
    <div ref={container} className="gh-glass-canvas" aria-hidden="true">
      {host && !failed && (
        <GlassBoundary onFailure={onFailure}>
          <FocusCanvas host={host} onFailure={onFailure} />
        </GlassBoundary>
      )}
    </div>
  );
}
