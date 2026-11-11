import { ui, setUIAttr } from "./ui-language.js";
import { announceUI, icon } from "./common.js";

export function mountSoundtrack(host: HTMLElement, music: { title: string; src: string }) {
  const { title, src } = music;
  const audio = document.createElement("audio");
  audio.preload = "auto";
  audio.autoplay = true;
  audio.loop = true;
  audio.src = src;
  audio.hidden = true;
  document.body.append(audio);

  const control = document.createElement("button");
  control.type = "button";
  control.className = "text-button soundtrack-toggle";
  setUIAttr(control, "musicLabel", { title });
  control.title = title;

  let startOnInteraction = true;

  function updateControl() {
    const playing = !audio.paused && !audio.error;
    control.setAttribute("aria-pressed", String(playing));
    control.innerHTML = `${icon(playing ? "sound" : "mute")} ${ui("music")}`;
  }

  function play(explicit = false) {
    if (audio.error) audio.load();
    void audio.play().catch((error) => {
      updateControl();
      if (explicit && error.name !== "AbortError") announceUI("musicFailed");
    });
  }

  for (const event of ["play", "pause", "error"]) audio.addEventListener(event, updateControl);
  audio.addEventListener("playing", () => { startOnInteraction = false; });
  updateControl();

  control.addEventListener("click", () => {
    startOnInteraction = false;
    audio.autoplay = false;
    const enable = audio.paused || !!audio.error;
    if (enable) play(true);
    else audio.pause();
  });

  host.addEventListener("click", (event) => {
    if (!startOnInteraction) return;
    if (control.contains(event.target as Node) || (event.target as Element).closest(".language-switcher")) return;
    startOnInteraction = false;
    play();
  }, { capture: true });

  play();
  return control;
}
