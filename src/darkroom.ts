import type { MemoryProject, MemoryRoll as Roll } from "./memory-project.js";
import { ui, uiAttr, setUIText, setUIAttr } from "./ui-language.js";
import { announce, announceUI, app, count, dialog, escapeHTML as esc, icon, type Photo } from "./common.js";
import { chineseAttributes } from "./typography.js";
import { createFilmAudio } from "./mechanical-audio.js";
import { instantCamera } from "./polaroid-config.js";
import { mountPolaroid } from "./polaroid.js";
import { mountSoundtrack } from "./soundtrack.js";
import { envelopeObject } from "./envelope.js";
import { envelopeMotion } from "./envelope-config.js";
import { createEnvelopeOpening } from "./envelope-motion.js";
import { loadViewerLikes, saveViewerLikes } from "./viewer-likes.js";
import { viewerCollection } from "./viewer-collection.js";
import { navigateAccount } from "./platform.js";

const scenes = ["envelope", "letter", "table", "film", "instant", "tray", "line"] as const;
type Scene = typeof scenes[number];
type Progress = {
  version: 1;
  scene: Scene;
  roll: string;
  selected: string[];
  queue: string[];
  hung: string[];
};
type Developing = "waiting" | "loading" | "revealing" | "ready" | "failed";
const fresh = (): Progress => ({ version: 1, scene: "envelope", roll: "", selected: [], queue: [], hung: [] });
const tableEntryTiming: KeyframeAnimationOptions = { duration: 1120, easing: "cubic-bezier(.33,.08,.25,1)", fill: "both" };
const photoAspect = (image: HTMLImageElement) => image.naturalWidth / image.naturalHeight || 1;
const heartBadge = (selected: boolean) =>
  `<span class="frame-heart" aria-hidden="true"${selected ? "" : " hidden"}>${icon("heart")}</span>`;

export function mountDarkroom(album: MemoryProject, preview: boolean, officialDemo = false) {
  const photos = new Map(album.rolls.flatMap((roll) => roll.photos.map((photo) => [photo.id, photo] as const)));
  const revealedPhotos = new Set<string>();
  const filmAudio = createFilmAudio();
  const musicControl = mountSoundtrack(app, album.settings.music);
  const restoredLikes = loadViewerLikes(album.id, photos.keys(), preview);
  const readyPrints = new Set(restoredLikes);
  let state = { ...fresh(), selected: restoredLikes };
  // A back/forward-cache restore must also begin a new reading visit.
  window.addEventListener("pageshow", event => {
    if (event.persisted) window.location.reload();
  });
  let development: Developing = "waiting";
  let timer: number | undefined;
  let justHung = "";
  let filmOffset = 0;
  let viewerIndex = -1;
  let viewerDirection = 1;
  let dialogPhoto: Photo | undefined;
  let back = false;
  let returnFocus = "";
  let preserveFocus = false;
  let previewLift: Animation | undefined;
  let previewExit: Animation | undefined;
  let unmountInstant: (() => void) | undefined;
  let finishInstantEntry: (() => void) | undefined;
  let preloadedInstant: HTMLImageElement | undefined;
  let envelopeOpening: ReturnType<typeof createEnvelopeOpening> | undefined;
  let finishEnvelopeEntry: (() => void) | undefined;

  function switchScene(scene: Scene) {
    if (state.scene === "film" && scene !== "film") filmAudio.stop();
    state.scene = scene;
    render();
    app.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
  }

  function activeRoll() { return album.rolls.find((item) => item.id === state.roll); }
  function instantRoll() { return album.rolls.find(roll => roll.presentation === "instant"); }
  function usesViewer(roll: Roll) { return roll.presentation === "viewer"; }
  function currentPhoto() {
    const id = (state.queue.length ? state.queue : state.selected).find((item) => !state.hung.includes(item));
    return id ? photos.get(id) : undefined;
  }

  const facetShade = (angle: number) => (.065 + .45 * (1 - Math.cos((angle - .8) * Math.PI / 8))).toFixed(3);
  const facetGlint = (angle: number) => (.56 * Math.exp(-((angle - .65) ** 2) / 1.6)).toFixed(3);
  const rollFacets = Array.from({ length: 16 }, (_, index) => {
    const facet = index - 8;
    const top = facet + .5;
    const bottom = facet - .5;
    return {
      style: `--turn:${facet * 22.5}deg;--print-offset:${top};--shade-top:${facetShade(top)};--shade-bottom:${facetShade(bottom)};--glint-top:${facetGlint(top)};--glint-bottom:${facetGlint(bottom)}`,
      printed: Math.abs(facet) <= 3,
    };
  });
  const axle = Array.from({ length: 8 }, (_, index) =>
    `<span class="can-axle-face" style="--turn:${index * 45}deg"></span>`).join("");

  function canister(roll: Roll, index: number, kind: "loose" | "upright" | "small") {
    const label = roll.name || `Roll ${count(index + 1)}`;
    const color = /^#[a-f0-9]{6}$/i.test(roll.color) ? roll.color : "#cfad77";
    const rgb = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16));
    const labelInk = rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 > 125 ? "#391910" : "#fff0cf";
    const print = `<span class="can-label"><strong ${chineseAttributes(label)}>${esc(label)}</strong>
      <small>ROLL ${count(index + 1)} · 35 MM · ${count(roll.photos.length)} EXP</small></span>`;
    const shell = kind !== "upright"
      ? `<span class="can-body">${print}</span><span class="can-cap can-cap--left"></span>
        <span class="can-cap can-cap--right"></span><span class="can-spool"></span>`
      : `<span class="can-volume">
        ${rollFacets.map(({ style, printed }) =>
          `<span class="can-facet" style="${style}">
            ${printed ? `<span class="can-print">${print}</span>` : ""}
          </span>`).join("")}
        <span class="can-end can-end--spool"></span><span class="can-end can-end--base"></span>
        ${axle}<span class="can-end can-end--axle"></span>
      </span>`;
    return `<span aria-hidden="true" class="canister canister--${kind}" style="--roll-color:${color};--label-ink:${labelInk}">
      ${shell}</span>`;
  }

  function envelope(open: boolean) {
    const copy = `<div class="letter-copy" dir="auto" ${chineseAttributes(album.envelope.message)}>${album.envelope.message ? esc(album.envelope.message) : ui("letterEmpty")}</div>`;
    return `<div class="letter-set ${open ? "letter-set--open" : ""}">
      ${envelopeObject(open, copy, album.settings.sealMotif)}
      ${open ? `<article class="letter-paper">
        <span class="letter-index">FILM FOR US <span>1 / 1</span></span>
        <div class="letter-reading">
          ${copy}
          <button type="button" class="paper-action" data-action="table">${ui("enterDarkroom")} ${icon("right")}</button>
        </div>
      </article>` : ""}
    </div>`;
  }

  function revealLetter() {
    const object = app.querySelector<HTMLElement>(".envelope")!;
    const insert = object.querySelector<HTMLElement>(".envelope-insert")!;
    const measure = (element: HTMLElement) => ({
      bounds: element.getBoundingClientRect(), width: element.offsetWidth, height: element.offsetHeight,
    });
    const origin = motionAllowed() ? { paper: measure(insert), envelope: measure(object) } : undefined;
    switchScene("letter");
    if (!origin) {
      announceUI("letterOpened");
      return;
    }

    const paper = app.querySelector<HTMLElement>(".letter-paper")!;
    const envelope = app.querySelector<HTMLElement>(".envelope")!;
    envelope.dataset.envelopeState = "transitioning";
    envelope.setAttribute("aria-busy", "true");
    const events = new AbortController();
    const animateFrom = (element: HTMLElement, source: ReturnType<typeof measure>, end: string, isPaper: boolean) => {
      const destination = measure(element);
      const dx = source.bounds.left + source.bounds.width / 2 - destination.bounds.left - destination.bounds.width / 2;
      const dy = source.bounds.top + source.bounds.height / 2 - destination.bounds.top - destination.bounds.height / 2;
      const scale = `scale(${source.width / destination.width}, ${source.height / destination.height})`;
      return element.animate([
        { transform: `translate(${dx}px, ${dy}px) ${isPaper ? "rotate(-6deg)" : `${end} rotate(4deg)`} ${scale}`,
          ...(isPaper ? { clipPath: "inset(0 0 28% 0)" } : { filter: "brightness(1)" }) },
        { transform: end, ...(isPaper ? { clipPath: "inset(0 0 0 0)" } : { filter: "brightness(.78)" }) },
      ], { duration: envelopeMotion.transition, easing: envelopeMotion.easing, fill: "both" });
    };
    paper.inert = true;
    const animations = [animateFrom(paper, origin.paper, "none", true),
      animateFrom(envelope, origin.envelope, getComputedStyle(envelope).transform, false)];
    const finish = () => {
      if (events.signal.aborted) return;
      events.abort();
      finishEnvelopeEntry = undefined;
      paper.inert = false;
      envelope.dataset.envelopeState = "completed";
      envelope.removeAttribute("aria-busy");
      for (const animation of animations) animation.cancel();
      announceUI("letterOpened");
    };
    finishEnvelopeEntry = finish;
    window.addEventListener("resize", finish, { signal: events.signal });
    window.addEventListener("pagehide", finish, { signal: events.signal });
    matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", finish, { signal: events.signal });
    void Promise.all(animations.map(animation => animation.finished)).then(finish, finish);
  }

  function table() {
    const title = album.title && !["Roll for us", "Film for us"].includes(album.title) ? esc(album.title) : "Film <i>for us</i>";
    return `<div class="table-heading"><h1 tabindex="-1" dir="auto" ${chineseAttributes(album.title)}>${title}</h1></div>
      <div class="rolls">${album.rolls.map((roll, index) => roll.presentation === "instant"
        ? `<button type="button" class="roll roll--3 roll--instant" data-action="instant"
            ${uiAttr(roll.photos.length === 1 ? "instantPhoto" : "instantPhotos", { count: roll.photos.length })} ${roll.photos.length ? "" : "disabled"}>
            <span class="instant-entry-object" aria-hidden="true"><img src="${instantCamera.tableSrc}" width="${instantCamera.width}" height="${instantCamera.height}" alt=""></span>
          </button>`
        : `<button type="button" class="roll roll--${index + 1}" data-action="roll" data-id="${esc(roll.id)}"
        ${uiAttr(roll.photos.length === 1 ? "rollFrame" : "rollFrames", { name: roll.name || `Roll ${index + 1}`, count: roll.photos.length })} ${roll.photos.length ? "" : "disabled"}>
        ${canister(roll, index, "loose")}
        ${roll.photos.length ? "" : `<span class="empty-roll">${ui("noPhotos")}</span>`}
      </button>`).join("")}<span class="pencil" aria-hidden="true"></span><span class="marker" aria-hidden="true"></span></div>`;
  }

  function snapshotStage() {
    const stage = app.querySelector<HTMLElement>(".stage")!;
    const { left, top, width, height } = stage.getBoundingClientRect();
    const copy = stage.cloneNode(true) as HTMLElement;
    copy.classList.add("stage-echo");
    copy.inert = true;
    copy.setAttribute("aria-hidden", "true");
    Object.assign(copy.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
    const originals = stage.querySelectorAll(".roll, .canister--loose .can-label");
    const poses = Array.from(originals, (item) => getComputedStyle(item).transform);
    copy.querySelectorAll<HTMLElement>(".roll, .canister--loose .can-label").forEach((item, index) => {
      item.style.transform = poses[index];
    });
    return copy;
  }

  function motionAllowed() {
    return typeof Element.prototype.animate === "function" && typeof DOMMatrixReadOnly === "function"
      && !matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function retreatTable(table: HTMLElement) {
    return table.animate([
      { opacity: 1, transform: "none" },
      { opacity: .65, transform: "perspective(1000px) translate3d(0, -15%, -108px) rotateX(36deg)", offset: .42 },
      { opacity: 0, transform: "perspective(1000px) translate3d(0, -23%, -174px) rotateX(61deg)" },
    ], tableEntryTiming);
  }

  function openInstant(button: HTMLButtonElement, id: string) {
    const flat = button.querySelector<HTMLImageElement>("img")!;
    const table = button.closest<HTMLElement>(".rolls")!;
    const before = motionAllowed() ? {
      bounds: flat.getBoundingClientRect(),
      width: flat.offsetWidth,
      rotation: new DOMMatrixReadOnly(getComputedStyle(button).transform),
      tableBounds: table.getBoundingClientRect(),
    } : undefined;
    if (before && table.closest(".darkroom--rolling-in")) {
      const props = table.querySelectorAll<HTMLElement>(".roll, .canister--loose .can-label");
      const transforms = Array.from(props, prop => getComputedStyle(prop).transform);
      props.forEach((prop, index) => { prop.style.transform = transforms[index]; });
    }
    state.roll = id;
    switchScene("instant");
    if (!before?.width) return;

    const room = app.querySelector<HTMLElement>(".instant-room")!;
    const front = room.querySelector<HTMLImageElement>(".instant-camera-body > img")!;
    const { left, top, width, height } = front.getBoundingClientRect();
    if (!width) return;

    const shot = document.createElement("div");
    shot.className = "instant-camera-shot";
    shot.setAttribute("aria-hidden", "true");
    Object.assign(shot.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
    const overhead = flat.cloneNode() as HTMLImageElement;
    const standing = front.cloneNode() as HTMLImageElement;
    standing.className = "instant-shot-front";
    shot.append(overhead, standing);

    const angle = Math.atan2(before.rotation.b, before.rotation.a) * 180 / Math.PI;
    const startScale = before.width / width;
    const sourceX = before.bounds.left + before.bounds.width / 2;
    const sourceY = before.bounds.top + before.bounds.height / 2;
    const dx = sourceX - left - width / 2;
    const dy = sourceY - top - height / 2;
    const tableBounds = before.tableBounds;
    button.remove();
    table.classList.add("instant-table-shot");
    table.inert = true;
    table.setAttribute("aria-hidden", "true");
    Object.assign(table.style, {
      left: `${tableBounds.left}px`, top: `${tableBounds.top}px`,
      width: `${tableBounds.width}px`, height: `${tableBounds.height}px`,
      transformOrigin: `${sourceX - tableBounds.left}px ${sourceY - tableBounds.top}px`,
    });
    room.classList.add("instant-room--entering");
    room.append(table, shot);

    const timing: KeyframeAnimationOptions = { duration: 1180, fill: "both" };
    // Ease in and out at the ends, keeping momentum through the middle poses.
    const poses = [
      { offset: 0, pan: 0, scale: startScale, lift: 0, turn: angle, pitch: 0,
        easing: "cubic-bezier(.4,0,.7,.51)" },
      { offset: .26, pan: .21, scale: startScale * 1.35, lift: 0, turn: angle * .93, pitch: -6,
        easing: "linear" },
      { offset: .53, pan: .56, scale: Math.max(1.14, startScale * 1.63), lift: .12, turn: angle * .50, pitch: -43,
        easing: "linear" },
      { offset: .78, pan: .88, scale: 1.06, lift: .037, turn: angle * .12, pitch: -12,
        easing: "cubic-bezier(.22,.51,.56,1)" },
      { offset: 1, pan: 1, scale: 1, lift: 0, turn: 0, pitch: 0,
        easing: "linear" },
    ];
    const move = shot.animate(poses.map(({ offset, easing, pan, scale, lift, turn, pitch }) => ({
      offset, easing,
      transform: `translate3d(${dx * (1 - pan)}px, ${dy * (1 - pan) - height * lift}px, 0)
        rotate(${turn}deg) scale(${scale}) perspective(780px) rotateX(${pitch}deg)`,
    })), timing);
    const turnFront = standing.animate([
      { opacity: 0 }, { opacity: 0, offset: .34 }, { opacity: 1, offset: .67 }, { opacity: 1 },
    ], timing);
    // Match the lens centers while the two views overlap.
    const alignFace = overhead.animate([
      { transform: "none", opacity: 1 },
      { transform: "none", opacity: 1, offset: .29 },
      { transform: "translate(-.6%, 1.6%)", opacity: 1, offset: .67 },
      { transform: "translate(-.6%, 1.6%)", opacity: 0, offset: .81 },
      { transform: "translate(-.6%, 1.6%)", opacity: 0 },
    ], timing);
    // Move the existing props on one flat layer and retire it before the camera settles.
    const retreat = table.animate([
      { opacity: 1, transform: "translate3d(0,0,0) scale(1)", easing: poses[0].easing },
      { offset: .42, opacity: .86, transform: `translate3d(${-dx * .21}px, ${-dy * .21}px, 0) scale(1.22)` },
      { opacity: 0, transform: `translate3d(${-dx * .66}px, ${-dy * .66 - height * .12}px, 0) scale(1.38)` },
    ], { duration: 730, fill: "both" });
    void retreat.finished.then(() => table.remove(), () => {});
    const events = new AbortController();
    const land = () => {
      if (events.signal.aborted) return;
      events.abort();
      finishInstantEntry = undefined;
      shot.remove();
      table.remove();
      room.classList.remove("instant-room--entering");
      for (const animation of [move, turnFront, alignFace, retreat]) animation.cancel();
    };
    finishInstantEntry = land;
    window.addEventListener("resize", land, { signal: events.signal });
    matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", land, { signal: events.signal });
    move.finished.then(land, land);
  }

  function enterTable() {
    const machine = app.querySelector<HTMLElement>(".viewer-machine");
    if (machine && motionAllowed() && !machine.closest(".darkroom--standing")) {
      const shot = snapshotStage();
      const track = app.querySelector<HTMLElement>(".viewer-film-track")!;
      shot.classList.add("stage-echo--viewer");
      const strip = shot.querySelector<HTMLElement>(".viewer-film-track")!;
      strip.style.transform = getComputedStyle(track).transform;
      switchScene("table");
      app.querySelector(".darkroom")!.append(shot);
      const exit = shot.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 470, easing: "ease-in", fill: "both" });
      shot.querySelector(".viewer-machine")!.animate([
        { transform: "none" }, { transform: "translateY(-75%) scale(.83) rotateX(20deg)" },
      ], { duration: 380, easing: "ease-in", fill: "both" });
      strip.animate([{ transform: strip.style.transform }, { transform: "none" }],
        { duration: 360, easing: "cubic-bezier(.5,0,.65,1)", fill: "both" });
      exit.finished.then(() => shot.remove(), () => shot.remove());
      return;
    }
    const letter = state.scene === "letter" && motionAllowed() ? snapshotStage() : undefined;
    switchScene("table");
    if (!letter) return;

    const room = app.querySelector<HTMLElement>(".darkroom")!;
    room.classList.add("darkroom--rolling-in");
    room.querySelector<HTMLElement>(".roll:last-of-type")?.addEventListener("animationend", (event) => {
      if (event.animationName === "roll-in") room.classList.remove("darkroom--rolling-in");
    });
    room.append(letter);
    letter.animate([
      { opacity: 1, transform: "none" },
      { opacity: 0, transform: "translateY(22px) scale(.985)" },
    ], { duration: 560, easing: "ease-out", fill: "both" }).finished.then(() => letter.remove(), () => letter.remove());
  }

  function openRoll(button: HTMLButtonElement, id: string) {
    if (album.rolls.find(roll => roll.id === id)?.presentation === "strip") filmAudio.prepare();
    const roll = button.querySelector<HTMLElement>(".canister")!;
    const before = motionAllowed() ? {
      bounds: roll.getBoundingClientRect(),
      width: roll.offsetWidth,
      rotation: new DOMMatrixReadOnly(getComputedStyle(button).transform),
      tilt: Number.parseFloat(getComputedStyle(roll).getPropertyValue("--can-yaw")) || 0,
      table: snapshotStage(),
    } : undefined;

    state.roll = id;
    filmOffset = 0;
    viewerIndex = -1;
    viewerDirection = 1;
    switchScene("film");
    if (!before) return;

    const room = app.querySelector<HTMLElement>(".darkroom")!;
    const upright = room.querySelector<HTMLElement>(".canister--upright")!;
    const filmSet = upright.parentElement!;
    const volume = upright.querySelector<HTMLElement>(".can-volume")!;
    const after = upright.getBoundingClientRect();
    const width = upright.offsetWidth;
    const height = upright.offsetHeight;
    if (!width || !before.width) return;

    const dx = before.bounds.left + before.bounds.width / 2 - (after.left + after.width / 2);
    const dy = before.bounds.top + before.bounds.height / 2 - (after.top + after.height / 2);
    const initialAngle = Math.atan2(before.rotation.b, before.rotation.a) * 180 / Math.PI;
    const initialScale = before.width / width;
    const finalTilt = Number.parseFloat(getComputedStyle(upright).getPropertyValue("--can-yaw"));
    upright.classList.replace("canister--upright", "canister--moving");
    Object.assign(upright.style, {
      left: `${after.left + (after.width - width) / 2}px`,
      top: `${after.top + (after.height - height) / 2}px`,
      width: `${width}px`,
      height: `${height}px`,
    });

    before.table.querySelector<HTMLElement>(`.roll[data-id="${CSS.escape(id)}"]`)!.style.visibility = "hidden";
    before.table.classList.add("stage-echo--table");
    const tableLight = document.createElement("div");
    tableLight.className = "camera-table-light";
    tableLight.setAttribute("aria-hidden", "true");
    room.classList.add("darkroom--standing");
    room.append(tableLight, before.table, upright);

    const shot = [
      { offset: 0, push: 0, zoom: 0, angle: initialAngle, tilt: before.tilt, spin: 0 },
      { offset: .25, push: .08, zoom: .04, angle: 73, tilt: 72, spin: -13 },
      { offset: .45, push: .32, zoom: .35, angle: 87, tilt: 55, spin: -6 },
      { offset: .78, push: .86, zoom: .87, angle: 90, tilt: 21, spin: 0 },
      { offset: 1, push: 1, zoom: 1, angle: 90, tilt: finalTilt, spin: 0 },
    ];
    const foot = (angle: number, tilt: number, scale: number) => {
      // Project the base cap along the barrel's axis so it plants as the camera lowers.
      const radians = Math.PI / 180;
      const radius = width * .45 * scale * Math.cos(tilt * radians);
      return { x: radius * Math.cos(angle * radians), y: radius * Math.sin(angle * radians) };
    };
    const startFoot = foot(initialAngle, before.tilt, initialScale);
    const endFoot = foot(90, finalTilt, 1);
    const travel = upright.animate(shot.map(({ offset, push, zoom, angle, tilt }) => {
      const scale = initialScale + (1 - initialScale) * zoom;
      const base = foot(angle, tilt, scale);
      const x = (dx + startFoot.x) * (1 - push) + endFoot.x * push - base.x;
      const y = (dy + startFoot.y) * (1 - push) + endFoot.y * push - base.y;
      return { offset, transform: `translate3d(${x}px, ${y}px, 0) rotate(${angle}deg) scale(${scale})` };
    }), tableEntryTiming);
    const pitch = volume.animate(shot.map(({ offset, tilt, spin }) => ({
      offset, transform: `perspective(900px) rotateY(${tilt}deg) rotateX(${spin}deg)`,
    })), tableEntryTiming);
    const retreat = retreatTable(before.table);

    const land = () => {
      travel.cancel();
      pitch.cancel();
      retreat.cancel();
      tableLight.remove();
      before.table.remove();
      upright.classList.replace("canister--moving", "canister--upright");
      for (const property of ["left", "top", "width", "height"]) upright.style.removeProperty(property);
      filmSet.prepend(upright);
      room.classList.remove("darkroom--standing");
    };
    travel.finished.then(land, land);
  }

  function film(roll: Roll) {
    const index = album.rolls.indexOf(roll);
    return `<h1 class="sr-only" tabindex="-1">${esc(roll.name)}</h1>
      <div class="film-set">${canister(roll, index, "upright")}
        <div class="film-feed" ${uiAttr("filmStrip")}>
          <div class="film-guide" aria-hidden="true">${roll.photos.length > 1
            ? '<svg viewBox="0 0 80 24" fill="none"><path d="M2 13c21-2 48 1 75-1m-9-8 10 8-10 8"/></svg>' : ""}</div>
          <div class="film-strip">${roll.photos.map((photo, i) => {
            const selected = state.selected.includes(photo.id);
            const revealed = revealedPhotos.has(photo.id);
            return `<div class="film-cell">
              <span class="frame-code" aria-hidden="true">ROLL ${count(index + 1)} · ${count(i + 1)}</span>
              <button type="button" class="frame${revealed ? " frame--revealed" : ""}" data-action="frame" data-id="${esc(photo.id)}"
                ${uiAttr(selected ? "markedFrame" : "previewFrame", { number: i + 1 })}>
                <img class="frame-image" src="${esc(photo.thumb)}" alt="" decoding="async" loading="${i === 0 ? "eager" : "lazy"}" draggable="false">
                ${selected ? heartBadge(true) : ""}
              </button><span class="frame-code" aria-hidden="true">${count(i + 1)} A</span>
            </div>`;
          }).join("")}</div>
        </div>
      </div>
      <div class="film-controls" ${uiAttr("browseFilm")}>
        <button type="button" class="icon-button" data-action="prev" ${uiAttr("previous")}>${icon("left")}</button>
        <button type="button" class="icon-button" data-action="next" ${uiAttr("next")}>${icon("right")}</button>
      </div>`;
  }

  function filmViewer(roll: Roll) {
    return `<h1 class="sr-only" tabindex="-1">${esc(roll.name || "Roll 02")}</h1>
      <div class="film-set viewer-set">
        ${canister(roll, 1, "upright")}
        <div class="viewer-feed" aria-hidden="true">
          <div class="film-strip viewer-leader"></div>
          <div class="film-strip viewer-film-track">${[...roll.photos].reverse().map((photo, i) => {
            const number = count(roll.photos.length - i);
            return `<div class="film-cell">
              <span class="frame-code">ROLL 02 · ${number}</span>
              <img src="${esc(photo.thumb)}" alt="" decoding="async">
              <span class="frame-code">${number} A</span>
            </div>`;
          }).join("")}</div>
        </div>
        <div class="viewer-machine">
          <div class="viewer-caption">
            <p class="viewer-meta" role="status"></p>
            <p class="viewer-title" dir="auto" ${chineseAttributes(roll.name)}>${esc(roll.name || "Roll 02")}</p>
          </div>
          <div class="viewer-case">
            <div class="viewer-bezel"><div class="viewer-window"><div class="viewer-image"></div>${heartBadge(false)}</div></div>
            <div class="viewer-plaque" aria-hidden="true">35 MM</div>
          </div>
          <button type="button" class="viewer-lever" data-action="advance-viewer" ${uiAttr("advanceFilm")}>
            <span class="viewer-lever-handle" aria-hidden="true"></span>
          </button>
          <span class="viewer-cue" aria-hidden="true">
            <svg viewBox="0 0 52 24" fill="none"><path d="M50 2C29 2 12 9 3 21m0-10v10l11-3"/></svg>
            <span>${ui("pressMe")}</span>
          </span>
        </div>
      </div>
      <div class="viewer-actions">
        <button type="button" class="text-button" data-action="retry-viewer" hidden>${ui("retryPhoto")}</button>
        <button type="button" class="frame-like viewer-mark" data-action="mark-viewer" ${uiAttr("likeFrame")} aria-pressed="false" hidden>${icon("heart")}</button>
      </div>`;
  }

  function showViewerFrame(roll: Roll, travel = 0) {
    const set = app.querySelector<HTMLElement>(".viewer-set")!;
    const image = set.querySelector<HTMLElement>(".viewer-image")!;
    const lever = set.querySelector<HTMLButtonElement>(".viewer-lever")!;
    const meta = set.querySelector<HTMLElement>(".viewer-meta")!;
    const mark = app.querySelector<HTMLButtonElement>('[data-action="mark-viewer"]')!;
    const retry = app.querySelector<HTMLButtonElement>('[data-action="retry-viewer"]')!;
    const photo = roll.photos[viewerIndex];
    set.style.setProperty("--viewer-step", String(viewerIndex + 1));
    set.classList.toggle("viewer-set--exposed", !!photo);
    const cue = set.querySelector<HTMLElement>(".viewer-cue")!;
    cue.hidden = !!photo && (viewerDirection > 0 || roll.photos.length === 1);
    setUIText(cue.querySelector("span")!, photo ? "rewind" : "pressMe");
    lever.disabled = !!photo && roll.photos.length === 1;
    setUIAttr(lever, viewerDirection < 0 ? "rewindFilm" : "advanceFilm");
    mark.hidden = !photo || !!state.queue.length;
    retry.hidden = true;
    if (!photo) return;

    const date = /^\d{4}-(\d{2})-(\d{2})$/.exec(photo.date);
    const frame = `Frame ${count(viewerIndex + 1)}`;
    meta.textContent = date ? `${date[1]}.${date[2]} · ${frame}` : frame;
    const marked = state.selected.includes(photo.id);
    mark.setAttribute("aria-pressed", String(marked));
    set.querySelector<HTMLElement>(".frame-heart")!.hidden = !marked;

    const thumbnail = new Image();
    setUIAttr(thumbnail, "framePhoto", { number: viewerIndex + 1 }, "alt");
    thumbnail.src = photo.thumb;
    image.replaceChildren(thumbnail);
    const full = new Image();
    setUIAttr(full, "framePhoto", { number: viewerIndex + 1 }, "alt");
    full.onload = () => { if (thumbnail.isConnected) thumbnail.replaceWith(full); };
    full.onerror = () => { if (thumbnail.isConnected) retry.hidden = false; };
    full.src = photo.full;

    if (!travel || !motionAllowed()) return;
    const handle = lever.querySelector(".viewer-lever-handle")!;
    for (const animation of handle.getAnimations()) animation.cancel();
    for (const animation of image.getAnimations()) animation.cancel();
    handle.animate([
      { transform: "none" },
      { transform: "translateY(var(--lever-throw))", offset: .37 },
      { transform: "none" },
    ], { duration: 330, easing: "ease-in-out" });
    image.animate([
      { transform: `translateX(${travel * -23}%)`, filter: "brightness(.25)" },
      { transform: "none", filter: "brightness(1)" },
    ], { duration: 320, easing: "cubic-bezier(.2,.65,.32,1)" });
  }

  function workbench() {
    const photo = currentPhoto();
    const queue = state.queue.length ? state.queue : state.selected;
    const hung = state.hung.map((id) => photos.get(id)!);
    const complete = state.scene === "line";
    return `<h1 class="sr-only" tabindex="-1">${ui(complete ? "dryingLine" : "tray")}</h1>
      <div class="drying">
        <div class="drying-track" ${uiAttr("hangingPrints")}>${hung.map((item, i) =>
          `<button type="button" class="hanging-print ${item.id === justHung ? "hanging-print--new" : ""}" data-action="print"
            data-id="${esc(item.id)}" ${uiAttr("viewPrint", { number: i + 1 })}>
            <span class="clip" aria-hidden="true"></span><img src="${esc(item.thumb)}" alt="" decoding="async">
          </button>`).join("")}</div>
      </div>
      <div class="bench">
        <div class="paper-stack" aria-hidden="true"><span>${ui("toDevelop")}</span><strong>${count(queue.length - hung.length)}</strong></div>
        <div class="tray">
          <span class="tray-water" aria-hidden="true"></span>
          ${photo && !complete ? `<button type="button" class="bath-paper bath-paper--${development}" data-action="develop"
            ${development === "loading" || development === "revealing" || development === "ready" ? "disabled" : ""}
            ${uiAttr(development === "failed" ? "retryDevelop" : "developPrint")}>
            ${development === "loading" || development === "revealing" || development === "ready"
              ? `<img class="bath-image" ${development === "loading" ? "" : `src="${esc(photo.full)}"`} ${uiAttr("developingAlt", {}, "alt")}>` : ""}
            <span class="bath-label">${ui(development === "loading" ? "loading" : development === "failed" ? "retryDevelop" : "tapDevelop")}</span>
          </button>` : ""}
          <span class="tongs" aria-hidden="true"></span>
        </div>
        <div class="bench-rolls">${album.rolls.map((roll, i) => canister(roll, i, "small")).join("")}</div>
      </div>`;
  }

  function render() {
    finishEnvelopeEntry?.();
    envelopeOpening?.destroy();
    envelopeOpening = undefined;
    resizeController?.abort();
    finishInstantEntry?.();
    unmountInstant?.();
    unmountInstant = undefined;
    const { scene } = state;
    const roll = activeRoll();
    if (scene === "instant" && roll) {
      unmountInstant = mountPolaroid(app, roll.photos, () => {
        switchScene("table");
        app.querySelector<HTMLButtonElement>(".roll--instant")?.focus({ preventScroll: true });
      }, album.ending.instantCaption);
      app.querySelector(".instant-bar")!.append(musicControl);
      return;
    }
    if (scene === "table" && instantRoll()?.photos.length && !preloadedInstant) {
      preloadedInstant = new Image();
      preloadedInstant.src = instantCamera.src;
      void preloadedInstant.decode().catch(() => {});
    }
    const viewer = scene === "film" && roll && usesViewer(roll);
    const total = photos.size;
    const selected = state.selected.length;
    const pending = viewerCollection(state.selected, readyPrints).pending.length;
    const target = state.queue.length || selected;
    const step = ["envelope", "letter"].includes(scene) ? 1 : scene === "table" || scene === "film" ? 2 : 3;
    const sceneLabel = ["THE ENVELOPE", "THE ROLLS", "THE TRAY"][step - 1];
    const status = step === 1 ? "1 / 1" : step === 2 ? `${count(album.rolls.length)} ENTRIES · ${count(total)} PHOTOS`
      : `${state.hung.length} OF ${target} DRY`;
    const ownerLink = preview
      ? `<a class="text-button preview-link" href="/editor/${encodeURIComponent(album.id)}">${ui("editorBack")}</a>`
      : album.demo ? `<a class="text-button preview-link" href="/manage#upload">${ui("uploadPhotos")}</a>` : "";
    const hint = {
      envelope: ui("openEnvelope"),
      letter: "",
      table: ui("exploreFilm"),
      film: ui(viewer ? "pressLever" : (roll?.photos.length ?? 0) > 1 ? "pullFilm" : "tapFrame"),
      instant: "",
      tray: development === "failed" ? ui("failedDevelop") : development === "ready" ? ui("readyHang") : "",
      line: ui("readBack"),
    }[scene];
    const stage = scene === "envelope" || scene === "letter"
      ? `<h1 class="sr-only" tabindex="-1">${ui(scene === "envelope" ? "openEnvelopeTitle" : "openingLetter")}</h1>${envelope(scene === "letter")}`
      : scene === "table" ? table()
      : scene === "film" && roll ? (viewer ? filmViewer(roll) : film(roll))
      : workbench();

    app.innerHTML = `<section class="darkroom darkroom--${scene}${viewer ? " darkroom--viewer" : ""}">
      <header class="scene-bar"><span>SCENE ${count(step)} <span class="scene-divider">—</span> ${sceneLabel}</span>
        <span>${preview ? "DRAFT · " : album.demo ? "DEMO · " : ""}${status}</span></header>
      <div class="stage">${stage}${scene === "envelope" ? `<div class="envelope-guidance${officialDemo && !preview ? " demo-opening-invitation" : ""}"><p class="stage-hint">${hint}</p>${officialDemo && !preview ? `<a class="text-button memory-create-cta" href="/login?next=/create" data-create-memory>${ui("createOwnMemory")}</a>` : ""}</div>` : ""}</div>
      ${scene === "line" && !preview ? `<aside class="memory-invitation"><p>${ui("createInvitation")}</p><a class="text-button memory-create-cta" href="/login?next=/create" data-create-memory>${ui("createOwnMemory")}</a></aside>` : ""}
      <footer class="scene-foot">
        ${scene === "tray" && development === "ready"
          ? `<div class="hang-prompt"><p class="stage-hint">${hint}</p><button class="action" type="button" data-action="hang">${ui("hangPrint")}</button></div>`
          : hint && scene !== "envelope" ? `<p class="stage-hint">${hint}</p>` : ""}
        <div class="scene-actions">
          ${step === 1 ? "" : scene === "film" || (scene === "tray" && !state.queue.length)
            ? `<button class="text-button" type="button" data-action="table">${icon("left")} ${ui("backTable")}</button>`
            : `<button class="text-button" type="button" data-action="reset">${ui("startOver")}</button>`}
          ${(scene === "table" || scene === "film") && selected
            ? `<button class="action" type="button" data-action="tray">${ui(pending ? pending === 1 ? "developOne" : "developCount" : "viewSavedPrints", { count: pending || selected })} ${icon("right")}</button>` : ""}
          ${ownerLink}
        </div>
      </footer>
    </section>`;
    app.querySelector(".scene-actions")!.append(musicControl);
    app.querySelector<HTMLAnchorElement>("[data-create-memory]")?.addEventListener("click", event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); void navigateAccount("/create");
    });
    if (scene === "envelope") {
      announce("");
      envelopeOpening = createEnvelopeOpening(app.querySelector<HTMLElement>(".envelope")!, revealLetter);
    }
    const feed = app.querySelector<HTMLElement>(".film-feed");
    if (feed) attachFilm(feed);
    if (viewer) showViewerFrame(roll);
  }

  function attachFilm(feed: HTMLElement) {
    feed.scrollLeft = -filmOffset;
    const previous = app.querySelector<HTMLButtonElement>('[data-action="prev"]')!;
    const next = app.querySelector<HTMLButtonElement>('[data-action="next"]')!;
    const arrow = feed.querySelector(".film-guide svg");
    const hint = app.querySelector<HTMLElement>(".stage-hint")!;
    const pullKey = (activeRoll()?.photos.length ?? 0) > 1 ? "pullFilm" : "tapFrame";
    let lastPullInput = -Infinity;
    let lastClick = -Infinity;
    let distanceToClick = 9;

    function notePullInput() {
      const now = performance.now();
      if (now - lastPullInput > 150) distanceToClick = 9;
      lastPullInput = now;
    }

    function sync() {
      if (!feed.isConnected) return;
      // The right-to-left strip pulls out of the canister as its scroll position decreases.
      const limit = feed.scrollWidth - feed.clientWidth;
      filmOffset = Math.min(limit, Math.max(0, -feed.scrollLeft));
      previous.disabled = filmOffset <= 2;
      next.disabled = filmOffset >= limit - 2;
      arrow?.toggleAttribute("hidden", next.disabled);
      const key = next.disabled && !previous.disabled ? "tapFrame" : pullKey;
      const text = hint.querySelector("[data-ui]")!;
      if (text.getAttribute("data-ui") !== key) setUIText(text, key);
    }
    sync();
    requestAnimationFrame(sync);
    feed.addEventListener("scroll", () => {
      const before = filmOffset;
      sync();
      const moved = filmOffset - before;
      if (moved < 0) distanceToClick = 9;
      const now = performance.now();
      // Count real outward travel while a drag or swipe is moving the strip.
      if (moved <= 0 || now - lastPullInput > 150) return;
      distanceToClick -= moved;
      if (distanceToClick > 0 || now - lastClick < 110 || !filmAudio.ready) return;
      filmAudio.play();
      lastClick = now;
      distanceToClick = 34;
    }, { passive: true });
    window.addEventListener("resize", sync, { signal: resizeSignal() });
    feed.addEventListener("touchmove", notePullInput, { passive: true });
    feed.addEventListener("touchend", filmAudio.prepare, { passive: true });
    feed.addEventListener("wheel", (event) => {
      if (event.deltaX || event.shiftKey) notePullInput();
    }, { passive: true });
    let startX = 0;
    let startScroll = 0;
    let pointer = -1;
    let dragged = false;
    feed.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "touch" || event.button !== 0) return;
      filmAudio.prepare();
      startX = event.clientX;
      startScroll = feed.scrollLeft;
      pointer = event.pointerId;
      dragged = false;
    });
    feed.addEventListener("pointermove", (event) => {
      if (event.pointerId !== pointer || !event.buttons) return;
      const delta = event.clientX - startX;
      if (!dragged && Math.abs(delta) < 7) return;
      if (!dragged) feed.setPointerCapture(pointer);
      dragged = true;
      notePullInput();
      feed.scrollLeft = startScroll - delta;
      event.preventDefault();
    });
    feed.addEventListener("lostpointercapture", () => { pointer = -1; });
    feed.addEventListener("pointerup", () => { pointer = -1; });
    feed.addEventListener("dragstart", (event) => event.preventDefault());
    feed.addEventListener("click", (event) => {
      if (dragged && event.detail) {
        event.stopPropagation();
        dragged = false;
      }
    }, true);
  }

  let resizeController: AbortController | undefined;
  function resizeSignal() {
    resizeController?.abort();
    resizeController = new AbortController();
    return resizeController.signal;
  }

  function positionFramePreview(source: HTMLElement) {
    const photo = dialog.querySelector<HTMLImageElement>(".photo-image")!;
    const thumbnail = source.querySelector("img")!;
    const aperture = source.getBoundingClientRect();
    const strip = source.closest(".film-strip")!.getBoundingClientRect();
    const print = dialog.querySelector<HTMLElement>(".photo-preview-lift")!;
    const canister = app.querySelector<HTMLElement>(".film-set .canister--upright");
    const aspect = photoAspect(photo.naturalWidth ? photo : thumbnail);
    const maxImageHeight = Math.max(1, innerHeight - 135);
    const width = Math.min(aperture.width * 1.55 + 16, 420, innerWidth - 36, maxImageHeight * aspect + 16);
    dialog.style.setProperty("--preview-width", `${width}px`);
    dialog.style.setProperty("--preview-aspect", String(aspect));
    const centered = aperture.left + (aperture.width - width) / 2;
    const canisterEdge = canister?.getBoundingClientRect().right ?? 0;
    const left = Math.min(Math.max(18, centered, canisterEdge - 8), innerWidth - width - 18);
    const top = Math.max(16, Math.min(strip.bottom - print.offsetHeight, innerHeight - dialog.offsetHeight - 16));
    dialog.style.setProperty("--preview-left", `${left}px`);
    dialog.style.setProperty("--preview-top", `${top}px`);
  }

  function previewOrigin(source: HTMLElement, panel: HTMLElement) {
    const from = (source.closest(".film-cell") ?? source).getBoundingClientRect();
    const to = panel.getBoundingClientRect();
    return `translate(${from.left + from.width / 2 - (to.left + to.width / 2)}px, ${from.bottom - to.bottom}px)
      scale(${from.width / to.width}, ${from.height / to.height})`;
  }

  function liftPreview(source: HTMLElement) {
    if (!motionAllowed()) return;
    const panel = dialog.querySelector<HTMLElement>(".photo-preview-lift")!;
    previewLift = panel.animate([
      { transform: previewOrigin(source, panel), opacity: .76 },
      { transform: "none", opacity: 1 },
    ], { duration: 460, easing: "cubic-bezier(.16,.78,.26,1)" });
  }

  function dismissDialog() {
    if (previewExit) return;
    const source = returnFocus && app.querySelector<HTMLElement>(returnFocus);
    const panel = dialog.querySelector<HTMLElement>(".photo-preview-lift");
    if (!source || !panel || !motionAllowed()) {
      dialog.close();
      return;
    }
    const current = getComputedStyle(panel).transform;
    previewLift?.cancel();
    const origin = previewOrigin(source, panel);
    dialog.classList.add("photo-dialog--closing");
    previewExit = panel.animate([
      { transform: current, opacity: 1 },
      { transform: origin, opacity: .55 },
    ], { duration: 245, easing: "ease-in", fill: "both" });
    previewExit.finished.then(() => dialog.close(), () => {});
  }

  function photoDialog(photo: Photo, kind: "frame" | "print", source?: HTMLButtonElement) {
    dialogPhoto = photo;
    const selected = state.selected.includes(photo.id);
    const flip = kind === "print" && back;
    const revealing = kind === "frame" && !revealedPhotos.has(photo.id);
    const photoView = `<div class="photo-view${revealing ? " photo-view--revealing" : ""}">
      <img class="photo-image" ${uiAttr("photoPreview", {}, "alt")}>
      <img class="photo-preview-thumb" src="${esc(photo.thumb)}" alt="">
      <div class="photo-load sr-only" role="status">${ui("loadingPhoto")}</div>
      ${kind === "frame" ? heartBadge(selected) : ""}
    </div>`;
    dialog.className = `photo-dialog photo-dialog--${kind}`;
    dialog.setAttribute("aria-labelledby", "photo-title");
    if (kind === "frame" && source) {
      const roll = activeRoll()!;
      const number = count(roll.photos.findIndex((item) => item.id === photo.id) + 1);
      dialog.innerHTML = `<h2 class="sr-only" id="photo-title" tabindex="-1" autofocus>${ui("framePreview")}</h2>
        <div class="photo-preview-lift"><div class="frame-preview-print">
          <span class="frame-code" aria-hidden="true">ROLL ${count(album.rolls.indexOf(roll) + 1)} · ${number}</span>
          ${photoView}
          <span class="frame-code" aria-hidden="true">${number} A</span>
        </div></div>
        <div class="dialog-actions">
          <button type="button" class="frame-like" data-dialog="select" ${uiAttr("likeFrame")} aria-pressed="${selected}" ${state.queue.length ? "hidden" : ""}>${icon("heart")}</button>
        </div>`;
      dialog.showModal();
      positionFramePreview(source);
      liftPreview(source);
      loadDialogImage(photo);
      return;
    }

    const thumbnail = source?.querySelector("img");
    if (thumbnail) dialog.style.setProperty("--print-aspect", String(photoAspect(thumbnail)));
    previewLift?.cancel();
    dialog.innerHTML = `<h2 class="sr-only" id="photo-title" tabindex="-1" autofocus>${ui(flip ? "printBack" : "developedPrint")}</h2>
      <div class="photo-preview-lift print-preview-paper${flip ? " print-preview-paper--back" : ""}">
        ${flip ? `<div class="print-note"><time datetime="${esc(photo.date)}">${photo.date ? esc(photo.date) : ui("noDate")}</time><p dir="auto" ${chineseAttributes(photo.note)}>${photo.note ? esc(photo.note) : ui("noNote")}</p></div>`
          : photoView}
      </div>
      <div class="dialog-actions print-preview-actions">
        <button type="button" class="text-button" data-dialog="flip">${icon("flip")} ${ui(flip ? "turnFront" : "turnBack")}</button>
        <button type="button" class="icon-button" data-dialog="close" ${uiAttr("close")}>${icon("close")}</button>
      </div>`;
    if (!dialog.open) {
      dialog.showModal();
      if (source) liftPreview(source);
    } else dialog.querySelector<HTMLButtonElement>(".dialog-actions button")?.focus();
    if (!flip) loadDialogImage(photo);
  }

  function loadDialogImage(photo: Photo) {
    const img = dialog.querySelector<HTMLImageElement>(".photo-image")!;
    const status = dialog.querySelector<HTMLElement>(".photo-load")!;
    status.hidden = false;
    status.innerHTML = ui("loadingPhoto");
    status.classList.add("sr-only");
    img.onload = () => {
      if (!dialog.open || !img.isConnected) return;
      const isFrame = dialog.classList.contains("photo-dialog--frame");
      if (isFrame && !previewExit && String(photoAspect(img)) !== dialog.style.getPropertyValue("--preview-aspect")) {
        const source = returnFocus && app.querySelector<HTMLElement>(returnFocus);
        if (source) positionFramePreview(source);
      }
      if (!isFrame) dialog.style.setProperty("--print-aspect", String(photoAspect(img)));
      status.hidden = true;
      img.classList.add("is-loaded");
      if (!isFrame || revealedPhotos.has(photo.id)) return;
      revealedPhotos.add(photo.id);
      app.querySelector(`[data-action="frame"][data-id="${CSS.escape(photo.id)}"]`)?.classList.add("frame--revealed");
    };
    img.onerror = () => {
      status.classList.remove("sr-only");
      status.innerHTML = `${ui("photoFailed")} <button type="button" class="paper-action" data-dialog="retry">${ui("retry")}</button>`;
    };
    img.src = photo.full;
  }

  function develop() {
    const photo = currentPhoto();
    if (!photo || (development !== "waiting" && development !== "failed")) return;
    if (!state.queue.length) state.queue = [...state.selected];
    development = "loading";
    render();
    const img = app.querySelector<HTMLImageElement>(".bath-image")!;
    img.onerror = () => {
      if (!img.isConnected) return;
      development = "failed";
      render();
      app.querySelector<HTMLButtonElement>('[data-action="develop"]')?.focus();
      announceUI("photoFailed");
    };
    img.onload = () => {
      if (!img.isConnected) return;
      development = "revealing";
      img.closest(".bath-paper")?.classList.add("bath-paper--revealing");
      img.closest(".tray")?.classList.add("tray--ripple");
      const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1850;
      timer = window.setTimeout(() => {
        development = "ready";
        render();
        app.querySelector<HTMLButtonElement>('[data-action="hang"]')?.focus();
        announceUI("developed");
      }, duration);
    };
    img.src = photo.full;
  }

  function hang() {
    const photo = currentPhoto();
    if (!photo || development !== "ready") return;
    state.hung.push(photo.id);
    readyPrints.add(photo.id);
    justHung = photo.id;
    development = "waiting";
    switchScene(state.hung.length === state.queue.length ? "line" : "tray");
    if (state.scene === "line") app.querySelector<HTMLButtonElement>('[data-action="print"]')?.focus();
    else app.querySelector<HTMLButtonElement>('[data-action="develop"]')?.focus();
    announceUI("hung", { count: state.hung.length, total: state.queue.length });
  }

  function toggleMarked(id: string) {
    const added = !state.selected.includes(id);
    state.selected = added ? [...state.selected, id] : state.selected.filter((item) => item !== id);
    saveViewerLikes(album.id, state.selected, preview);
    render();
    announceUI(added ? "marked" : "unmarked", { count: state.selected.length });
    return added;
  }

  app.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
    if (!button || button.disabled) return;
    const { action, id } = button.dataset;
    if (action === "unseal") void envelopeOpening?.open();
    if (action === "table") enterTable();
    if (action === "roll" && id) openRoll(button, id);
    if (action === "instant" && instantRoll()?.photos.length) openInstant(button, instantRoll()!.id);
    if (action === "advance-viewer" || action === "retry-viewer" || action === "mark-viewer") {
      const roll = activeRoll()!;
      if (action === "advance-viewer") {
        filmAudio.play();
        const direction = viewerDirection;
        viewerIndex += direction;
        if (viewerIndex === roll.photos.length - 1) viewerDirection = -1;
        else if (viewerIndex === 0) viewerDirection = 1;
        showViewerFrame(roll, direction);
        if (button.disabled) app.querySelector<HTMLElement>(".viewer-mark:not([hidden]), [data-action='table']")?.focus();
      } else if (action === "retry-viewer") {
        showViewerFrame(roll);
        app.querySelector<HTMLButtonElement>(".viewer-lever:not(:disabled), .viewer-mark:not([hidden])")?.focus();
      } else if (!state.queue.length) {
        toggleMarked(roll.photos[viewerIndex].id);
        app.querySelector<HTMLButtonElement>(".viewer-mark")?.focus({ preventScroll: true });
      }
    }
    if (action === "tray" && state.selected.length) {
      const collection = viewerCollection(state.selected, readyPrints);
      state.hung = collection.hung;
      if (!collection.pending.length) state.queue = [...state.selected];
      switchScene(collection.pending.length ? "tray" : "line");
    }
    if (action === "prev" || action === "next") {
      const feed = app.querySelector<HTMLElement>(".film-feed")!;
      const cell = feed.querySelector<HTMLElement>(".film-cell")!;
      const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
      if (action === "next") filmAudio.play();
      feed.scrollBy({ left: cell.offsetWidth * (action === "next" ? -1 : 1), behavior });
    }
    if ((action === "frame" || action === "print") && id) {
      const photo = photos.get(id);
      if (!photo) return;
      back = false;
      returnFocus = `[data-action="${action}"][data-id="${CSS.escape(id)}"]`;
      photoDialog(photo, action, button);
    }
    if (action === "develop") develop();
    if (action === "hang") hang();
    if (action === "reset") {
      returnFocus = '[data-action="reset"]';
      dialogPhoto = undefined;
      dialog.className = "confirm-dialog";
      dialog.setAttribute("aria-labelledby", "reset-title");
      dialog.innerHTML = `<div class="photo-sheet"><h2 id="reset-title">${ui("resetTitle")}</h2>
        <p>${ui("resetDetail")}</p>
        <div class="dialog-actions"><button type="button" data-dialog="close" class="paper-action">${ui("cancel")}</button>
        <button type="button" data-dialog="restart" class="paper-action">${ui("startOver")}</button></div></div>`;
      dialog.showModal();
    }
  });

  dialog.addEventListener("click", (event) => {
    if (previewExit) return;
    const target = event.target as Element;
    const button = target.closest<HTMLButtonElement>("[data-dialog]");
    const action = button?.dataset.dialog;
    const outsideFrame = dialog.classList.contains("photo-dialog--frame") && !action && !target.closest(".frame-preview-print");
    if (target === dialog || action === "close" || outsideFrame) {
      dismissDialog();
      return;
    }
    if (action === "restart") {
      preserveFocus = true;
      dialog.close();
      window.clearTimeout(timer);
      state = { ...fresh(), selected: state.selected };
      revealedPhotos.clear();
      development = "waiting";
      justHung = "";
      filmOffset = 0;
      switchScene("envelope");
    }
    if (!dialogPhoto) return;
    if (action === "retry") loadDialogImage(dialogPhoto);
    if (action === "select" && !state.queue.length) {
      const marked = toggleMarked(dialogPhoto.id);
      button!.setAttribute("aria-pressed", String(marked));
      dialog.querySelector<HTMLElement>(".frame-heart")!.hidden = !marked;
      if (marked && motionAllowed()) {
        button!.querySelector("svg")!.animate([{ transform: "scale(.8)" }, { transform: "scale(1.18)" },
          { transform: "none" }], { duration: 240, easing: "ease-out" });
      }
    }
    if (action === "flip") {
      back = !back;
      photoDialog(dialogPhoto, "print");
    }
  });
  dialog.addEventListener("cancel", (event) => {
    if (!dialog.classList.contains("photo-dialog")) return;
    event.preventDefault();
    dismissDialog();
  });
  dialog.addEventListener("close", () => {
    previewLift?.cancel();
    previewExit?.cancel();
    previewLift = previewExit = undefined;
    dialogPhoto = undefined;
    if (preserveFocus) preserveFocus = false;
    else if (returnFocus) app.querySelector<HTMLElement>(returnFocus)?.focus({ preventScroll: true });
  });
  window.addEventListener("resize", () => {
    if (!dialog.open || !dialog.classList.contains("photo-dialog--frame") || previewExit) return;
    const source = returnFocus && app.querySelector<HTMLElement>(returnFocus);
    if (source) {
      previewLift?.cancel();
      positionFramePreview(source);
    }
  });
  render();
}
