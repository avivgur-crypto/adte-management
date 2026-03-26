"use client";

export type FinancialDataSource = "billing" | "xdash";

export function DataSourceToggle({
  value,
  onChange,
  className = "",
}: {
  value: FinancialDataSource;
  onChange: (v: FinancialDataSource) => void;
  className?: string;
}) {
  return (
    <div
      className={`relative inline-flex rounded-full border border-white/10 bg-black/40 p-[3px] ${className}`}
    >
      <div
        className="absolute inset-y-[3px] w-[calc(50%-3px)] rounded-full bg-white/15 transition-transform duration-300 ease-in-out"
        style={{
          transform:
            value === "billing" ? "translateX(3px)" : "translateX(calc(100% + 3px))",
        }}
      />
      {(["billing", "xdash"] as const).map((src) => (
        <button
          key={src}
          type="button"
          onClick={() => onChange(src)}
          className={`relative z-10 rounded-full px-4 py-1 text-xs font-semibold transition-colors duration-200 ${
            value === src ? "text-white" : "text-white/40 hover:text-white/60"
          }`}
        >
          {src === "billing" ? "Billing" : "XDASH"}
        </button>
      ))}
    </div>
  );
}
