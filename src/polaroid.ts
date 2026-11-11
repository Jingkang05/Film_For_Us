import { ui, uiAttr, setUIText, setUIAttr, refreshUI } from "./ui-language.js";
import { announceUI, count, escapeHTML as esc, icon, type Photo } from "./common.js";
import { setChineseTypography } from "./typography.js";
import { instantCamera, instantCopy as copy, instantMotion as timing } from "./polaroid-config.js";
import { createShutterAudio } from "./mechanical-audio.js";

type Phase = "idle" | "shutter" | "printing" | "developing" | "ready" | "complete";
type Point = { x: number; y: number };
type Pose = Point & { angle: number; sx: number; sy: number };
type Print = { index: number; card: HTMLDivElement; paper: HTMLButtonElement; wash: HTMLElement };

const stackSlots = [
  { x: -.18, y: .02, angle: 9 },
  { x: .19, y: .10, angle: -8 },
  { x: .38, y: -.07, angle: 6 },
  { x: .03, y: .24, angle: -3 },
];
const easeOut = "cubic-bezier(.19,.74,.27,1)";
const soundPreference = "roll-for-us:shutter-sound";
const transform = ({ x, y, angle, sx, sy }: Pose) =>
  `translate3d(${x}px,${y}px,0) translate(-50%,-50%) rotate(${angle}deg) scale(${sx},${sy})`;

export function mountPolaroid(host: HTMLElement, photos: Photo[], onBack: () => void, caption = copy.footer) {
  host.innerHTML = `<section class="instant-room" data-phase="idle" aria-labelledby="instant-title">
    <h1 class="sr-only" id="instant-title" tabindex="-1">${ui("instantEntry")}</h1>
    <header class="instant-bar">
      <button type="button" class="instant-icon instant-back" ${uiAttr("backTable")}>${icon("left")}</button>
    </header>
    <div class="instant-stage">
      <div class="instant-camera">
        <div class="instant-camera-body">
          <img src="${instantCamera.src}" width="${instantCamera.width}" height="${instantCamera.height}" ${uiAttr("cameraAlt", {}, "alt")} draggable="false">
          <span class="instant-slot" aria-hidden="true"></span>
          <span class="instant-flash" aria-hidden="true"></span>
          <button type="button" class="instant-shutter" ${uiAttr("capturePhoto")} aria-describedby="instant-instruction">
            <span aria-hidden="true"></span>
          </button>
        </div>
        <svg class="instant-leader" viewBox="0 0 ${instantCamera.width} ${instantCamera.height}" fill="none" aria-hidden="true">
          <path d="M 1 359 Q 14 336 45 336 M 37 328 L 45 336 L 37 344" vector-effect="non-scaling-stroke"/>
        </svg>
        <div class="instant-hint" id="instant-instruction">
          <span class="instant-hint-title">${ui("capturePhoto")}</span>
          <span class="instant-hint-text">${ui("firstHint")}</span>
        </div>
        <div class="instant-finish" hidden>
          <span>${ui("captured")}</span>
          <button type="button" class="instant-link instant-replay">${icon("flip")} ${ui("replay")}</button>
        </div>
      </div>
      <span class="instant-feature-anchor" aria-hidden="true"></span>
      <span class="instant-stack-anchor" aria-hidden="true"></span>
      <div class="instant-prints"></div>
    </div>
    <footer class="instant-foot">
      <p class="instant-caption">${esc(caption)}</p>
      <button type="button" class="instant-icon instant-sound" ${uiAttr("shutterSound")}></button>
      <div class="instant-counter">
        <span>${ui("printCount")}</span>
        <span class="instant-count">00 <i>/</i> ${count(photos.length)}</span>
      </div>
    </footer>
    <dialog class="instant-detail">
      <div class="instant-detail-body">
        <button type="button" class="instant-detail-close" ${uiAttr("closePrint")} autofocus>${icon("close")}</button>
        <figure class="instant-detail-print"></figure>
      </div>
    </dialog>
  </section>`;

  const room = host.querySelector<HTMLElement>(".instant-room")!;
  const find = <T extends HTMLElement = HTMLElement>(selector: string) => room.querySelector<T>(selector)!;
  const stage = find(".instant-stage");
  const camera = find(".instant-camera-body");
  const slot = find(".instant-slot");
  const flash = find(".instant-flash");
  const shutter = find<HTMLButtonElement>(".instant-shutter");
  const hintTitle = find(".instant-hint-title");
  const hintText = find(".instant-hint-text");
  const prints = find(".instant-prints");
  const featureAnchor = find(".instant-feature-anchor");
  const stackAnchor = find(".instant-stack-anchor");
  const counter = find(".instant-count");
  const sound = find<HTMLButtonElement>(".instant-sound");
  const finish = find(".instant-finish");
  const replay = find<HTMLButtonElement>(".instant-replay");
  const detail = find<HTMLDialogElement>(".instant-detail");
  const detailPrint = find(".instant-detail-print");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const events = new AbortController();
  const { signal } = events;
  const audio = createShutterAudio();
  const animations = new Set<Animation>();
  const prepared = new Map<number, Print>();
  const stack: Print[] = [];
  let phase: Phase = "idle";
  let printed = 0;
  let featured: Print | undefined;
  let soundEnabled = true;
  try { soundEnabled = localStorage.getItem(soundPreference) !== "off"; } catch { /* Use the default for this visit. */ }

  function updateSound() {
    sound.setAttribute("aria-pressed", String(soundEnabled));
    sound.innerHTML = icon(soundEnabled ? "sound" : "mute");
  }
  sound.hidden = typeof AudioContext !== "function";
  updateSound();

  function setPhase(next: Phase) {
    phase = next;
    room.dataset.phase = next;
    shutter.setAttribute("aria-disabled", String(next !== "idle" && next !== "ready"));
  }

  function makeImage(photo: Photo, onUnavailable?: (status: HTMLElement) => void) {
    const aperture = document.createElement("span");
    aperture.className = "instant-image";
    const image = new Image();
    image.alt = "";
    image.draggable = false;
    image.decoding = "async";
    const status = document.createElement("span");
    status.className = "instant-image-status";
    setUIText(status, "imageUnavailable");
    status.hidden = true;
    const wash = document.createElement("span");
    wash.className = "instant-wash";
    wash.setAttribute("aria-hidden", "true");
    aperture.append(image, status, wash);
    const unavailable = () => {
      image.hidden = true;
      status.hidden = false;
      onUnavailable?.(status);
    };
    image.onload = () => { image.hidden = false; };
    image.onerror = () => {
      if (photo.thumb && photo.thumb !== photo.full && image.getAttribute("src") !== photo.thumb) {
        image.src = photo.thumb;
        return;
      }
      unavailable();
    };
    image.hidden = true;
    const source = photo.full || photo.thumb;
    if (source) image.src = source;
    else unavailable();
    return { aperture, wash };
  }

  function prepare(index: number) {
    const existing = prepared.get(index);
    if (existing) return existing;
    const photo = photos[index];
    const card = document.createElement("div");
    card.className = "instant-card";
    card.dataset.index = String(index + 1);
    const paper = document.createElement("button");
    paper.className = "instant-paper";
    paper.type = "button";
    paper.disabled = true;
    setUIAttr(paper, "viewPrint", { number: count(index + 1) });
    const { aperture, wash } = makeImage(photo, (status) => {
      status.id = `instant-unavailable-${index + 1}`;
      paper.setAttribute("aria-describedby", [paper.getAttribute("aria-describedby"), status.id].filter(Boolean).join(" "));
      if (featured?.paper === paper && paper.isConnected) announceUI("imageUnavailable");
    });
    const caption = document.createElement("span");
    caption.className = "instant-note";
    caption.id = `instant-note-${index + 1}`;
    if (photo.note) paper.setAttribute("aria-describedby", [paper.getAttribute("aria-describedby"), caption.id].filter(Boolean).join(" "));
    caption.dir = "auto";
    caption.textContent = photo.note;
    setChineseTypography(caption, photo.note);
    paper.append(aperture, caption);
    card.append(paper);
    const print = { index, card, paper, wash };
    prepared.set(index, print);
    return print;
  }

  function preload() {
    photos.slice(printed, printed + 2).forEach((_, offset) => prepare(printed + offset));
  }

  function centerOf(element: HTMLElement): Point {
    const stageBox = stage.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return { x: box.left + box.width / 2 - stageBox.left, y: box.top + box.height / 2 - stageBox.top };
  }

  function featurePose(): Pose {
    return { ...centerOf(featureAnchor), angle: -5, sx: 1, sy: 1 };
  }

  function stackPose(print: Print): Pose {
    const anchor = centerOf(stackAnchor);
    const position = stackSlots[print.index % stackSlots.length];
    const size = print.card.offsetWidth;
    const style = getComputedStyle(stage);
    const spread = Number(style.getPropertyValue("--stack-spread"));
    const scale = Number(style.getPropertyValue("--stack-scale"));
    const radians = Math.abs(position.angle) * Math.PI / 180;
    const halfHeight = scale * (Math.cos(radians) * print.card.offsetHeight + Math.sin(radians) * size) / 2;
    const y = Math.min(anchor.y + position.y * size * spread, stage.clientHeight - halfHeight - 12);
    return { x: anchor.x + position.x * size * spread, y,
      angle: position.angle, sx: scale, sy: scale };
  }

  function put(print: Print, pose: Pose) {
    print.card.style.transform = transform(pose);
  }

  function placePrints() {
    if (featured) put(featured, featurePose());
    for (const print of stack) put(print, stackPose(print));
  }

  function play(element: HTMLElement, frames: Keyframe[], duration: number, easing = "linear", delay = 0) {
    if (signal.aborted || reduced.matches || typeof element.animate !== "function") return Promise.resolve();
    const animation = element.animate(frames, { duration, delay, easing, fill: "both" });
    animations.add(animation);
    return animation.finished.catch(() => {}).then(() => {
      animations.delete(animation);
      animation.cancel();
    });
  }

  async function move(print: Print, poses: (Pose & { offset?: number; easing?: string })[], duration: number, easing = "linear") {
    put(print, poses[poses.length - 1]);
    await play(print.card, poses.map(({ offset, easing, ...pose }) => ({
      transform: transform(pose), offset, easing,
    })), duration, easing);
  }

  async function fall(print: Print) {
    print.card.dataset.layer = "falling";
    print.paper.disabled = true;
    const from = featurePose();
    const to = stackPose(print);
    await move(print, [
      { ...from, offset: 0, easing: "cubic-bezier(.34,.08,.69,.53)" },
      { ...from, x: from.x + (to.x - from.x) * .37, y: from.y - 8, angle: 1, sx: .97, sy: .97,
        offset: .29, easing: "cubic-bezier(.46,.06,.77,.69)" },
      { ...to, x: to.x + 5, y: to.y + 7, angle: to.angle + 1.5, offset: .83, easing: easeOut },
      { ...to, offset: 1 },
    ], timing.fall);
    if (signal.aborted) return;
    print.card.dataset.layer = "stacked";
    print.paper.disabled = false;
    stack.push(print);
  }

  async function retireOldest() {
    if (stack.length < stackSlots.length) return;
    const oldest = stack.shift()!;
    oldest.paper.disabled = true;
    oldest.card.dataset.layer = "retiring";
    await play(oldest.card, [{ opacity: 1 }, { opacity: 0 }], 470, easeOut);
    oldest.card.remove();
  }

  async function eject(print: Print) {
    const outlet = centerOf(slot);
    const size = print.card.offsetWidth;
    const length = print.card.offsetHeight;
    const scale = slot.offsetWidth / size;
    const travel = length * scale * .97;
    // The projected short edge matches the slot. The clipped edge remains fixed
    // at the rollers as the sheet advances along its own long axis.
    const start: Pose = { ...outlet, y: outlet.y + travel / 2, angle: 0, sx: scale, sy: scale * .97 };
    const clear: Pose = { ...start, y: outlet.y - travel / 2 };
    print.card.dataset.layer = "ejecting";
    const feedEase = "cubic-bezier(.32,.09,.33,1)";
    await Promise.all([
      move(print, [start, clear], timing.ejection, feedEase),
      play(print.paper, [{ clipPath: "inset(0 0 100% 0)" }, { clipPath: "inset(0 0 0% 0)" }], timing.ejection, feedEase),
    ]);
    if (signal.aborted) return;
    print.card.dataset.layer = "lifting";
    const end = featurePose();
    await move(print, [
      { ...clear, offset: 0, easing: "ease-out" },
      { ...clear, x: clear.x + 4, y: clear.y - 5, offset: .14, easing: "cubic-bezier(.2,.35,.3,1)" },
      { x: clear.x + (end.x - clear.x) * .76, y: clear.y + (end.y - clear.y) * .53 - size * .075,
        angle: 8, sx: .89, sy: .94, offset: .72, easing: easeOut },
      { ...end, offset: 1 },
    ], timing.display);
  }

  async function capture() {
    if ((phase !== "idle" && phase !== "ready") || printed >= photos.length || detail.open) return;
    const print = prepare(printed);
    prepared.delete(printed);
    const previous = featured;
    featured = undefined;
    setPhase("shutter");
    if (soundEnabled) audio.play();
    setUIText(hintTitle, "printing");
    setUIText(hintText, "nextHint");

    await Promise.all([
      play(camera, [{ transform: "none" }, { transform: "translateY(1px) rotate(-.22deg)", offset: .32 },
        { transform: "none" }], timing.shutter, "ease-out"),
      play(shutter.firstElementChild as HTMLElement, [{ transform: "scale(1)", opacity: 0 },
        { transform: "scale(.9)", opacity: 1, offset: .35 }, { transform: "scale(1)", opacity: 0 }], timing.shutter, "ease-out"),
      play(flash, [{ opacity: 0 }, { opacity: .65, offset: .28 }, { opacity: 0 }], timing.flash, "ease-out"),
    ]);
    if (signal.aborted) return;

    setPhase("printing");
    print.card.style.zIndex = String(10 + printed);
    refreshUI(print.card);
    prints.append(print.card);
    const flight = eject(print);
    const stackMotion = previous ? (async () => {
      // Leave the previous print suspended for the first visible advance of the new one.
      await play(previous.card, [{ opacity: 1 }, { opacity: 1 }], timing.fallDelay);
      if (signal.aborted) return;
      await Promise.all([fall(previous), retireOldest()]);
    })() : Promise.resolve();
    const develop = play(print.wash, [{ opacity: .94 }, { opacity: .60, offset: .38 },
      { opacity: 0 }], timing.development, "ease-out", timing.ejection * .62);
    print.wash.style.opacity = "0";

    await flight;
    if (signal.aborted) return;
    setPhase("developing");
    await Promise.all([stackMotion, develop]);
    if (signal.aborted) return;

    featured = print;
    print.card.dataset.layer = "featured";
    print.paper.disabled = false;
    printed++;
    counter.firstChild!.textContent = `${count(printed)} `;
    placePrints();
    const complete = printed === photos.length;
    setPhase(complete ? "complete" : "ready");
    setUIText(hintTitle, complete ? "captured" : "capturePhoto");
    finish.hidden = !complete;
    if (complete && document.activeElement === shutter) replay.focus({ preventScroll: true });
    const missing = !print.paper.querySelector<HTMLElement>(".instant-image-status")!.hidden;
    announceUI(missing ? complete ? "printProgressMissingComplete" : "printProgressMissing"
      : complete ? "printProgressComplete" : "printProgress", { count: printed, total: photos.length });
    preload();
  }

  function reset() {
    featured = undefined;
    printed = 0;
    stack.length = 0;
    prints.replaceChildren();
    counter.firstChild!.textContent = "00 ";
    finish.hidden = true;
    setUIText(hintTitle, "capturePhoto");
    setUIText(hintText, "firstHint");
    setPhase("idle");
    preload();
    shutter.focus({ preventScroll: true });
    announceUI("printProgress", { count: 0, total: photos.length });
  }

  find(".instant-back").addEventListener("click", onBack, { signal });
  sound.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    if (!soundEnabled) audio.stop();
    updateSound();
    try { localStorage.setItem(soundPreference, soundEnabled ? "on" : "off"); } catch { /* Keep the in-memory preference. */ }
  }, { signal });
  shutter.addEventListener("click", () => void capture(), { signal });
  replay.addEventListener("click", reset, { signal });
  prints.addEventListener("click", (event) => {
    const paper = (event.target as HTMLElement).closest<HTMLButtonElement>(".instant-paper");
    if (!paper || paper.disabled) return;
    const index = Number(paper.parentElement!.dataset.index) - 1;
    const photo = photos[index];
    const { aperture } = makeImage(photo);
    const caption = document.createElement("figcaption");
    caption.dir = "auto";
    caption.id = "instant-detail-note";
    detail.setAttribute("aria-describedby", caption.id);
    caption.textContent = photo.note;
    setChineseTypography(caption, photo.note);
    detailPrint.replaceChildren(aperture, caption);
    setUIAttr(detail, "viewPrint", { number: count(index + 1) });
    detail.showModal();
  }, { signal });
  detail.addEventListener("click", (event) => {
    if (event.target === detail || (event.target as HTMLElement).closest(".instant-detail-close")) detail.close();
  }, { signal });
  detail.addEventListener("close", () => detailPrint.replaceChildren(), { signal });
  const resize = new ResizeObserver(() => {
    if (phase === "idle" || phase === "ready" || phase === "complete") placePrints();
  });
  resize.observe(stage);
  reduced.addEventListener("change", () => {
    if (reduced.matches) for (const animation of animations) animation.finish();
  }, { signal });
  preload();

  return () => {
    events.abort();
    resize.disconnect();
    audio.close();
    for (const animation of animations) animation.cancel();
  };
}
