// Control bar (.deck): no two visible controls overlap and none leaves the screen (review of PR #133: on 360/390 px
// the shift pad sat on the starter and the "Prüfstand und Ton" button). Shared by the E2E modules.

/** Visible deck controls, each as a box; touch layouts also need ≥ 44 px targets. */
const CONTROLS = [
  ".ignkey", ".starter", ".readybtn", ".console__group--main > .btn",
  ".shiftpad__btn", ".shiftpad__gear", ".shiftpad__sel", ".parkbtn", ".brakepedal", ".pedal",
];

/** Returns failure texts (empty when the bar is clean). */
export async function deckOverlaps(page) {
  return page.evaluate((sels) => {
    const deck = document.querySelector(".deck");
    if (!deck) return ["keine Bedienleiste"];
    const vw = document.documentElement.clientWidth;
    const boxes = [];
    for (const sel of sels) {
      for (const e of deck.querySelectorAll(sel)) {
        if (!e.checkVisibility()) continue;
        const r = e.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        boxes.push({ k: `${sel}${e.dataset.shift ?? e.dataset.sel ?? ""}`, r, el: e });
      }
    }
    const out = [];
    // touch layouts: every tappable control at least 44 × 44 px (the gear label and the gas lever are no buttons)
    if (matchMedia("(pointer: coarse)").matches) {
      for (const b of boxes) {
        if (!b.el.matches("button, [role=switch], [role=radio]")) continue;
        if (b.r.width < 43.5 || b.r.height < 43.5) out.push(`${b.k} kleiner als 44 px (${Math.round(b.r.width)}×${Math.round(b.r.height)})`);
      }
    }
    for (const b of boxes) if (b.r.left < -0.5 || b.r.right > vw + 0.5) out.push(`${b.k} außerhalb (${Math.round(b.r.left)}…${Math.round(b.r.right)} px)`);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        // nested elements (e.g. the gear label inside the pad) are not an overlap
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w > 0.5 && h > 0.5) out.push(`${a.k} überdeckt ${b.k} (${Math.round(w)}×${Math.round(h)} px)`);
      }
    }
    return out;
  }, CONTROLS);
}
