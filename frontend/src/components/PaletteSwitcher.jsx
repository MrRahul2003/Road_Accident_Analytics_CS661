import React from "react";
import { useStore } from "../data/store.jsx";
import { PALETTES } from "../theme.js";

export default function PaletteSwitcher() {
  const { paletteKey, setPaletteKey } = useStore();
  const active = PALETTES[paletteKey];

  return (
    <div className="mt-auto border-t border-[#1F2935] pt-4">
      <div className="mb-2 px-1 text-[10px] uppercase tracking-wider text-[#5A6675]">
        Colour scheme
      </div>

      <div className="flex flex-col gap-1">
        {Object.entries(PALETTES).map(([key, p]) => {
          const isActive = key === paletteKey;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setPaletteKey(key)}
              aria-pressed={isActive}
              className={
                "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors cursor-pointer " +
                (isActive
                  ? "bg-[#15202D] text-[#E6EDF3]"
                  : "text-[#8B98A8] hover:bg-[#131C26] hover:text-[#E6EDF3]")
              }
            >
              <span className="flex-1 text-left">{p.label}</span>
              <span className="flex gap-[3px]">
                {Object.values(p.severity).map((c, i) => (
                  <span key={i} className="h-[9px] w-[9px] rounded-[2px]" style={{ background: c }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-2 px-1 text-[10px] leading-snug text-[#5A6675]">
        {active.description}
      </p>
    </div>
  );
}
