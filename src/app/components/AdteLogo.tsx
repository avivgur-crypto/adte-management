"use client";

type LogoMarkSize = "sm" | "md" | "lg";

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

/** סמל המותג — icon-512 על רקע כהה שקוף */
export function LogoMark({
  size = "md",
  className = "",
}: {
  size?: LogoMarkSize;
  className?: string;
}) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/[0.04] p-px ring-1 ring-white/[0.1] ${MARK_BOX[size]} ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/icon-512.png"
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
      <LogoMark size={size} />
    </div>
  );
}

/** כותרת דשבורד: לוגו + שם + כיתוב */
export function AdteLogoHeader({ className = "" }: { className?: string }) {
  return (
    <div
      className={`relative flex min-h-[88px] min-w-0 items-center gap-4 md:min-h-[96px] md:gap-5 ${className}`}
    >
      <LogoMark size="md" className="shrink-0" />
      <h1 className="absolute left-[130px] top-[40px] m-0 text-[30px] font-extrabold leading-tight tracking-tight text-white">
        Adtex
      </h1>
      <p className="absolute left-[130px] top-[70px] m-0 flex w-[130px] flex-wrap text-[13px] font-medium leading-[18px] text-zinc-500">
        Management App
      </p>
    </div>
  );
}
