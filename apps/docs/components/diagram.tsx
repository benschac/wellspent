"use client";
import Image from "next/image";
import { type ComponentProps, useState } from "react";
export function Diagram({
  src,
  alt = "",
}: Omit<ComponentProps<"img">, "src"> & { src?: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const imageSrc =
    typeof src === "string"
      ? src
      : typeof src === "object" &&
          src !== null &&
          "src" in src &&
          typeof src.src === "string"
        ? src.src
        : undefined;
  if (!imageSrc) return null;
  return (
    <span className="diagram">
      <span className="diagram-toolbar">
        <button
          type="button"
          aria-pressed={expanded}
          aria-label={`${expanded ? "Fit" : "Enlarge"} ${alt}`}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Fit width" : "Enlarge"}
        </button>
        <a href={imageSrc} target="_blank" rel="noreferrer">
          Open image ↗
        </a>
      </span>
      <span className={expanded ? "diagram-scroll expanded" : "diagram-scroll"}>
        <Image
          unoptimized
          src={imageSrc}
          alt={alt}
          width={1800}
          height={1100}
          style={{
            width: expanded ? "1800px" : "100%",
            height: "auto",
            maxWidth: "none",
          }}
        />
      </span>
      <span className="diagram-caption">{alt}</span>
    </span>
  );
}
