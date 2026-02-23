"use client";

const TAGLINE = "Stream Your Brand";

type AdteLogoProps = {
  size?: "sm" | "md" | "lg";
  showWordmark?: boolean;
  showTagline?: boolean;
  className?: string;
};

const sizes = { sm: 32, md: 48, lg: 80 } as const;

export default function AdteLogo({
  size = "md",
  showWordmark = true,
  showTagline = false,
  className = "",
}: AdteLogoProps) {
  const px = sizes[size];
  const w = Math.round(px * 2.2);
  const h = Math.round(px * 1.6);

  return (
    <div
      className={`flex flex-col items-center gap-2 ${className}`}
      aria-label="Adte"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.svg"
        alt="Adte"
        width={w}
        height={h}
        className="h-auto w-auto max-w-[180px] object-contain"
        loading="eager"
      />
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
  return (
    <div
      className={`flex items-center gap-4 ${className}`}
      aria-label="Adte"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.svg"
        alt="Adte"
        width={56}
        height={40}
        className="h-12 w-auto object-contain"
        loading="eager"
      />
      <div className="flex flex-col justify-center gap-0">
        <span className="text-xl font-bold tracking-tight text-white leading-tight">
          Adte&apos;s Management App
        </span>
        {showTagline && (
          <span className="text-[0.7rem] font-normal tracking-wide text-white/50 leading-tight">
            {TAGLINE}
          </span>
        )}
      </div>
    </div>
  );
}
