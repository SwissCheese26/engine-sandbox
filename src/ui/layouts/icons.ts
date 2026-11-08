// Further ISO 2575 style lamp symbols for the cockpit (#26), simplified stroke drawings in currentColor.
// ABS, ESP and black ice come from environment-panel.ts (#23).
export { ICON as BASE_ICON } from "../environment-panel.ts";

const S = `fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"`;

export const ICON2 = {
  // fuel pump (ISO 7000-0245)
  fuel: `<svg viewBox="0 0 40 28" aria-hidden="true"><path ${S} d="M9 25V5h13v20M7 25h17M12 9h7v5h-7M22 10h4l3 3v9a2 2 0 0 0 4 0V11l-4-4"/></svg>`,
  /** Oil can with drop: oil pressure. */
  oil: `<svg viewBox="0 0 40 28" aria-hidden="true"><path ${S} d="M6 12h5l3 4h14l7-5M14 16v6h14v-6M11 12v-2h6v2"/><path d="M36 17c0 2-1.3 3.4-2.4 3.4S31.2 19 31.2 17c0-1.3 1.2-3 2.4-4.6 1.2 1.6 2.4 3.3 2.4 4.6z" fill="currentColor"/></svg>`,
  /** Battery: charge lamp. */
  battery: `<svg viewBox="0 0 40 28" aria-hidden="true"><rect x="7" y="8" width="26" height="15" rx="1.5" ${S}/><path ${S} d="M11 8V5.5h4V8M25 8V5.5h4V8M11.5 15.5h5M24 15.5h5M26.5 13v5"/></svg>`,
  /** Engine outline: MIL / check engine. */
  engine: `<svg viewBox="0 0 40 28" aria-hidden="true"><path ${S} d="M9 10h4V7h10v3h4l2 3h3v-3h3v11h-3v-3h-3v5H14l-3-3H7v3H4V12h3v4"/></svg>`,
  /** Thermometer in waves: coolant temperature. */
  coolant: `<svg viewBox="0 0 40 28" aria-hidden="true"><path ${S} d="M20 3v13M20 8h4M20 12h4"/><circle cx="20" cy="18.5" r="3" fill="currentColor"/><path ${S} d="M7 23c3-2 5 2 8 0M25 23c3-2 5 2 8 0"/></svg>`,
  /** Glow plug coil: diesel pre-glow. */
  glow: `<svg viewBox="0 0 40 28" aria-hidden="true"><path ${S} d="M6 10c0-4 4-5 6-3M34 10c0-4-4-5-6-3M10 13c2 0 2 4 4 4s2-4 4-4 2 4 4 4 2-4 4-4 2 4 4 4M6 21h28"/></svg>`,
  /** Speedometer with arrow: cruise control (#30). */
  cruise: `<svg viewBox="0 0 40 28" aria-hidden="true"><path ${S} d="M8 20a12 12 0 1 1 24 0M20 20l6-7"/></svg>`,
} as const;
