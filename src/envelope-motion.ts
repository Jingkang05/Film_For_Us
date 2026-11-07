import { envelopeMotion as timing } from "./envelope-config.js";

export type EnvelopeState = "sealed" | "sealReleasing" | "flapOpening" | "letterEmerging" | "transitioning" | "completed";

/** Owns one opening ritual. No timers: cancellation rejects the awaited animation. */
export function createEnvelopeOpening(root: HTMLElement, reveal: () => void) {
  const seal = root.querySelector<HTMLButtonElement>(".wax-seal")!;
  const assembly = root.querySelector<HTMLElement>(".seal-assembly")!;
  const hinge = root.querySelector<HTMLElement>(".envelope-hinge")!;
  const letter = root.querySelector<HTMLElement>(".envelope-insert")!;
  const room = root.closest<HTMLElement>(".darkroom")!;
  const hint = room.querySelector<HTMLElement>(".stage-hint");
  const preference = matchMedia("(prefers-reduced-motion: reduce)");
  const events = new AbortController();
  const animations = new Set<Animation>();
  let phase: EnvelopeState = "sealed";
  let generation = 0;

  function enter(next: EnvelopeState) {
    phase = next;
    root.dataset.envelopeState = next;
  }

  async function move(element: HTMLElement, keyframes: Keyframe[], duration: number) {
    const animation = element.animate(keyframes, { duration, easing: timing.easing, fill: "both" });
    animations.add(animation);
    await animation.finished;
    // Retain finished poses until the scene is replaced, then cancel them together.
  }

  function reset() {
    generation++;
    for (const animation of animations) animation.cancel();
    animations.clear();
    seal.disabled = false;
    root.removeAttribute("aria-busy");
    room.classList.remove("darkroom--unsealing");
    enter("sealed");
    if (hint) hint.style.opacity = "";
  }

  // A page restored from the back/forward cache can be opened again safely.
  window.addEventListener("pagehide", reset, { signal: events.signal });
  preference.addEventListener("change", () => {
    if (preference.matches) for (const animation of animations) animation.finish();
  }, { signal: events.signal });

  async function open() {
    if (phase !== "sealed" || events.signal.aborted) return;
    const run = ++generation;
    seal.disabled = true;
    root.setAttribute("aria-busy", "true");
    room.classList.add("darkroom--unsealing");
    const active = () => run === generation && root.isConnected && !events.signal.aborted;
    try {
      enter("sealReleasing");
      if (hint) hint.style.opacity = "0";
      if (preference.matches || typeof root.animate !== "function") {
        if (typeof seal.animate === "function") await move(seal, [{ opacity: 1 }, { opacity: .65 }], timing.reducedFeedback);
      } else {
        await move(assembly, [
          { transform: "translateZ(3px)" },
          { transform: "translate3d(0, 1.5px, 1px) scale(.975)", offset: .24 },
          { transform: "translate3d(0, -3px, 8px) rotateX(-17deg) rotate(-4deg)", offset: .78 },
          { transform: "translate3d(0, -2px, 4px) rotate(-3deg)" },
        ], timing.sealRelease);
        if (!active()) return;
        enter("flapOpening");
        await move(hinge, [
          { transform: "rotateX(0deg)", zIndex: "5" },
          { transform: "rotateX(-88deg)", zIndex: "5", offset: .49 },
          { transform: "rotateX(-90deg)", zIndex: "0", offset: .5 },
          { transform: "rotateX(-176deg)", zIndex: "0" },
        ], preference.matches ? 0 : timing.flapOpening);
        if (!active()) return;
        enter("letterEmerging");
        // Percentage travel adapts with the physical letter and envelope, even on resize.
        const lift = getComputedStyle(root).getPropertyValue("--letter-lift").trim();
        const emerge = preference.matches ? 0 : timing.letterEmerging;
        await Promise.all([
          move(letter, [
            { transform: "translateY(0)", filter: "brightness(.79)" },
            { transform: `translateY(${lift})`, filter: "brightness(1)" },
          ], emerge),
          move(root, [
            { transform: "rotate(-8deg)" },
            { transform: "translateY(18%) rotate(-6deg)" },
          ], emerge),
        ]);
      }
      if (!active()) return;
      enter("transitioning");
      reveal();
    } catch {
      // Scene changes and pagehide deliberately cancel pending animation promises.
      if (active()) { reset(); reveal(); }
    }
  }

  return {
    open,
    destroy() { events.abort(); reset(); },
  };
}
