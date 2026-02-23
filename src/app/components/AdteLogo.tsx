"use client";

import Image from "next/image";
import { useState } from "react";

const TAGLINE = "Stream Your Brand";

type AdteLogoProps = {
  size?: "sm" | "md" | "lg";
  showWordmark?: boolean;
  showTagline?: boolean;
  className?: string;
};

const sizes = { sm: 32, md: 48, lg: 80 } as const;

/** SVG logomark fallback (brand gradient, two overlapping rectangles) */
function LogomarkSVG({ className, width, height }: { className?: string; width: number; height: number }) {
  return (
    <svg
      viewBox="0 0 88 48"
      width={width}
      height={height}
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient id="adte-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00ffff" />
          <stop offset="30%" stopColor="#566df7" />
          <stop offset="70%" stopColor="#8000ff" />
          <stop offset="100%" stopColor="#ff8000" />
        </linearGradient>
      </defs>
      <rect x="4" y="20" width="64" height="24" rx="3" fill="none" stroke="url(#adte-grad)" strokeWidth="2" />
      <rect x="28" y="4" width="24" height="36" rx="3" fill="none" stroke="url(#adte-grad)" strokeWidth="2" transform="rotate(-8 40 22)" />
    </svg>
  );
}

export default function AdteLogo({
  size = "md",
  showWordmark = true,
  showTagline = false,
  className = "",
}: AdteLogoProps) {
  const px = sizes[size];
  const [imgError, setImgError] = useState(false);
  const w = px * 2.2;
  const h = px * 1.6;

  return (
    <div
      className={`flex flex-col items-center gap-2 ${className}`}
      aria-label="Adte"
    >
      {imgError ? (
        <LogomarkSVG width={w} height={h} />
      ) : (
        <Image
          src="/logo.png"
          alt=""
          width={w}
          height={h}
          className="h-auto w-auto object-contain"
          priority
          unoptimized
          onError={() => setImgError(true)}
        />
      )}
      {showWordmark && (
        <div className="flex flex-col items-center gap-0.5">
          <span
            className="font-bold tracking-tight text-white"
            style={{ fontSize: size === "sm" ? "0.875rem" : size === "md" ? "1rem" : "1.25rem" }}
          >
            Adte
          </span>
          {showTagline && (
            <span className="text-[0.7rem] font-normal tracking-wide text-white/60">
              {TAGLINE}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function AdteLogoHeader({
  showTagline = true,
  className = "",
}: { showTagline?: boolean; className?: string } = {}) {
  const [imgError, setImgError] = useState(false);
  return (
    <div
      className={`flex items-center gap-3 ${className}`}
      aria-label="Adte"
    >
      {imgError ? (
        <LogomarkSVG width={36} height={26} />
      ) : (
        <Image
          src="/logo.png"
          alt=""
          width={36}
          height={26}
          className="h-8 w-auto object-contain"
          priority
          unoptimized
          onError={() => setImgError(true)}
        />
      )}
      <div className="flex flex-col justify-center gap-0">
        <span className="text-lg font-bold tracking-tight text-white leading-tight">
          Adte
        </span>
        {showTagline && (
          <span className="text-[0.65rem] font-normal tracking-wide text-white/50 leading-tight">
            {TAGLINE}
          </span>
        )}
      </div>
    </div>
  );
}
