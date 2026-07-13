import { interpolateViridis, interpolatePlasma, interpolateRdBu, interpolatePuOr } from "d3-scale-chromatic";
import { scaleSequential, scaleDiverging } from "d3-scale";

export const OKABE_ITO = {
  black: "#000000",
  orange: "#E69F00",
  skyblue: "#56B4E9",
  green: "#009E73",
  yellow: "#F0E442",
  blue: "#0072B2",
  vermillion: "#D55E00",
  purple: "#CC79A7",
};

export const TRIADIC_HUES = {
  magenta: "#B04F9A",
  teal: "#4F9AB0",
  olive: "#9AB04F",
  magentaTint: "#D49EC7",
  tealTint: "#9EC7D4",
  oliveTint: "#C7D49E",
  magentaShade: "#7B376C",
  grey: "#6B7280",
};

export const PALETTES = {
  standard: {
    label: "Standard",
    cvdSafe: false,
    sequential: interpolatePlasma,
    sequentialLabel: "Plasma",
    diverging: (t) => interpolateRdBu(1 - t),
    divergingLabel: "Red–White–Blue",
    severity: {
      "Slight Injury": TRIADIC_HUES.teal,
      "Serious Injury": TRIADIC_HUES.olive,
      "Fatal injury": TRIADIC_HUES.magenta,
    },
    categorical: [
      TRIADIC_HUES.magenta, TRIADIC_HUES.teal, TRIADIC_HUES.olive, TRIADIC_HUES.magentaTint,
      TRIADIC_HUES.tealTint, TRIADIC_HUES.oliveTint, TRIADIC_HUES.magentaShade, TRIADIC_HUES.grey,
    ],
  },
  colorblind: {
    label: "Colour-blind safe",
    // description: "Okabe–Ito palette, distinguishable under deuteranopia, protanopia and tritanopia.",
    cvdSafe: true,
    sequential: interpolateViridis,
    sequentialLabel: "Viridis",
    diverging: (t) => interpolatePuOr(1 - t),
    divergingLabel: "Orange–White–Purple",
    severity: {
      "Slight Injury": OKABE_ITO.skyblue,
      "Serious Injury": OKABE_ITO.orange,
      "Fatal injury": OKABE_ITO.vermillion,
    },
    categorical: [
      OKABE_ITO.blue, OKABE_ITO.orange, OKABE_ITO.green, OKABE_ITO.purple,
      OKABE_ITO.vermillion, OKABE_ITO.skyblue, OKABE_ITO.yellow, "#999999",
    ],
  },
};

export const SEVERITY_ORDER = ["Slight Injury", "Serious Injury", "Fatal injury"];

export function sequentialScale(paletteKey, domainMax = 1) {
  const p = PALETTES[paletteKey] || PALETTES.standard;
  return scaleSequential(p.sequential).domain([0, domainMax]);
}

export function divergingScale(paletteKey, domain) {
  const p = PALETTES[paletteKey] || PALETTES.standard;
  return scaleDiverging(p.diverging).domain(domain);
}

export function meanDivergingColor(diverging, values) {
  const mean = values.length ? values.reduce((a, v) => a + v, 0) / values.length : 0;
  if (!mean) return { color: () => "#6B7280", domain: [0, 0, 0], mean: 0 };
  const ratios = values.map((v) => v / mean);
  const half = Math.max(Math.max(1, ...ratios) - 1, 1 - Math.min(1, ...ratios), 0.5);
  const lo = Math.max(0, 1 - half) * mean;
  const hi = (1 + half) * mean;
  return { color: diverging([lo, mean, hi]), domain: [lo, mean, hi], mean };
}

export function textColorFor(fill) {
  const m = fill.match(/rgba?\(([^)]+)\)/);
  let r, g, b;
  if (m) {
    [r, g, b] = m[1].split(",").map(Number);
  } else {
    const hex = fill.replace("#", "");
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  }
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return luminance > 0.42 ? "#0A0E14" : "#EDEEF1";
}

export const UI = {
  bg: "#0A0E14",
  panel: "#121821",
  panelAlt: "#0F151D",
  border: "#1F2935",
  borderBright: "#2C3A4A",
  text: "#E6EDF3",
  textDim: "#8B98A8",
  textFaint: "#5A6675",
  accent: "#E69F00",
};
