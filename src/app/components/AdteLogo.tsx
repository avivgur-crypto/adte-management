"use client";

type LogoMarkSize = "sm" | "md" | "lg";
export type LogoMarkVariant = "header" | "login";

/**
 * קופסה בגודל קבוע — התמונה (512×512 אינטרינסית) חייבת להיכנס בפנים בלבד.
 * לא להשתמש ב-width/height גדולים על ה-img או ב-h-full/w-full בלי קופסה מוגדרת היטב.
 */
const MARK_BOX: Record<LogoMarkSize, string> = {
  sm: "h-10 w-10 max-h-10 max-w-10",
  /** כותרת: קופסה קבועה + תמונה max-* כדי שלא תתנפח */
  md: "h-[120px] w-[120px] max-h-[120px] max-w-[120px]",
  lg: "h-[80px] w-[80px] max-h-[80px] max-w-[80px]",
};

/** מימדים אינטרינסיים ל-img */
const MARK_IMG_DIMS: Record<LogoMarkSize, { w: number; h: number }> = {
  sm: { w: 64, h: 64 },
  md: { w: 100, h: 120 },
  lg: { w: 80, h: 80 },
};

const MARK_IMG_CLASS: Record<LogoMarkSize, string> = {
  sm: "",
  md: "h-[120px] w-[100px]",
  lg: "h-[80px] w-[80px]",
};

/** לוגו ורוד (PWA) — דף לוגין בלבד */
const LOGIN_SRC = "/icon-512.png";

/** לוגו מלא על רקע שכור — כותרת האפליקציה בלבד */
const HEADER_SRC = "/logo-header-inapp.png";

export function LogoMark({
  size = "md",
  variant = "header",
  className = "",
}: {
  size?: LogoMarkSize;
  variant?: LogoMarkVariant;
  className?: string;
}) {
  if (variant === "login") {
    return (
      <div
        className={`flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/[0.04] p-px ring-1 ring-white/[0.1] ${MARK_BOX[size]} ${className}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={LOGIN_SRC}
          alt=""
          width={MARK_IMG_DIMS[size].w}
          height={MARK_IMG_DIMS[size].h}
          className={`max-h-full max-w-full rounded-[10px] object-contain ${MARK_IMG_CLASS[size]}`}
          loading="eager"
          decoding="async"
        />
      </div>
    );
  }

  return (
    <div
      className={`flex shrink-0 items-center justify-start overflow-hidden ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={HEADER_SRC}
        alt=""
        width={200}
        height={96}
        className="h-[88px] w-auto max-h-[88px] max-w-[min(100%,260px)] object-contain object-left md:h-[96px] md:max-h-[96px]"
        loading="eager"
        decoding="async"
      />
    </div>
  );
}

type AdteLogoProps = {
  size?: LogoMarkSize;
  className?: string;
};

export default function AdteLogo({ size = "md", className = "" }: AdteLogoProps) {
  return (
    <div
      className={`flex min-h-0 w-full max-w-full flex-col items-center gap-2 overflow-hidden ${className}`}
      aria-label="Adtex"
    >
      <LogoMark variant="header" size={size} />
    </div>
  );
}

/** כותרת דשבורד: לוגו (כולל wordmark בתוך התמונה) + כיתוב */
export function AdteLogoHeader({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex min-h-[88px] min-w-0 flex-wrap items-center gap-3 md:min-h-[96px] md:gap-4 ${className}`}
    >
      <LogoMark variant="header" size="md" className="shrink-0" />
      <p className="m-0 max-w-[160px] text-[13px] font-medium leading-[18px] text-zinc-500">
        Management App
      </p>
    </div>
  );
}
