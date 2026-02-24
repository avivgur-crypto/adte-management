"use client";

import { useState, useEffect } from "react";

const TAGLINE = "Stream Your Brand";

type AdteLogoProps = {
  size?: "sm" | "md" | "lg";
  showWordmark?: boolean;
  showTagline?: boolean;
  className?: string;
};

// Logo SVG viewBox is ~1093.5×996 → aspect ratio width/height ≈ 1.098
const LOGO_ASPECT = 1093.5 / 996;
const sizes = { sm: 32, md: 48, lg: 96 } as const;

export default function AdteLogo({
  size = "md",
  showWordmark = true,
  showTagline = false,
  className = "",
}: AdteLogoProps) {
  const [imgError, setImgError] = useState(false);
  const [logoSrc, setLogoSrc] = useState("/logo.svg");
  const h = sizes[size];
  const w = Math.round(h * LOGO_ASPECT);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setLogoSrc(`${window.location.origin}/logo.svg`);
    }
  }, []);

  return (
    <div
      className={`flex flex-col items-center gap-2 ${className}`}
      aria-label="Adte"
    >
      {!imgError ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoSrc}
          alt=""
          width={w}
          height={h}
          className="h-auto w-auto max-h-[120px] object-contain object-center"
          loading="eager"
          onError={() => setImgError(true)}
        />
      ) : (
        <span
          className="font-bold tracking-tight text-white"
          style={{
            fontSize:
              size === "sm" ? "1.25rem" : size === "md" ? "1.5rem" : "2.5rem",
          }}
        >
          Adte
        </span>
      )}
      {showWordmark && (
        <div className="flex flex-col items-center gap-0.5 text-center">
          <span
            className="font-bold tracking-tight text-white"
            style={{
              fontSize:
                size === "sm" ? "0.875rem" : size === "md" ? "1rem" : "1.5rem",
            }}
          >
            Adte
          </span>
          {showTagline && (
            <span className="text-[0.75rem] font-normal tracking-wide text-white/60">
              {TAGLINE}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function AdteLogoHeader({
  className = "",
}: { className?: string } = {}) {
  return (
    <div
      className={`flex items-center gap-5 ${className}`}
      aria-label="Adte"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.svg"
        alt="Adte"
        width={200}
        height={200}
        className="h-[200px] w-[200px] object-contain"
        loading="eager"
      />
      <div className="flex flex-col justify-center gap-0.5">
        <span className="text-2xl font-bold tracking-tight text-white leading-tight md:text-3xl">
          Adte&apos;s Management App
        </span>
      </div>
    </div>
  );
}
