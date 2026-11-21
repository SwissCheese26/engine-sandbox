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
  /** Gear wheel with thermometer: gearbox oil temperature (#53). */
  gearbox: `<svg viewBox="0 0 40 28" aria-hidden="true"><circle cx="15" cy="14" r="6" ${S}/><path ${S} d="M15 4v3M15 21v3M5 14h3M22 14h3M8 7l2 2M20 19l2 2M8 21l2-2M20 9l2-2"/><path ${S} d="M31 4v13"/><circle cx="31" cy="20.5" r="3" fill="currentColor"/></svg>`,
  /** Brake circle between brackets with "!": brake air pressure too low (#83, ISO 2575 brake warning). */
  air: `<svg viewBox="0 0 40 28" aria-hidden="true"><circle cx="20" cy="14" r="8" ${S}/><path ${S} d="M9 6a12 12 0 0 0 0 16M31 6a12 12 0 0 1 0 16M20 9.5v5.5"/><circle cx="20" cy="18.5" r="1.3" fill="currentColor"/></svg>`,
  /** Drop over a wave: AdBlue (reductant) level (#83). */
  adblue: `<svg viewBox="0 0 40 28" aria-hidden="true"><path ${S} d="M20 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11zM6 24c3-2 5 2 8 0s5 2 8 0 5 2 8 0 3 1 4 0"/></svg>`,
  /** Speedometer with arrow: cruise control (#30). */
  cruise: `<svg viewBox="0 0 40 28" aria-hidden="true"><path ${S} d="M8 20a12 12 0 1 1 24 0M20 20l6-7"/></svg>`,
} as const;
