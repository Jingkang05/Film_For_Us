// The imperative editor replaces its content after actions. Keep the user's place
// using stable album/photo IDs rather than retaining detached DOM elements.
export interface EditorFocus { selector: string; scope?: string; index?: number; kind?: "photo" | "album" }
export function captureEditorFocus(root: HTMLElement): EditorFocus | undefined {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !root.contains(active) || !active.matches("input,textarea,select,button,a")) return;
  const container = active.closest<HTMLElement>("[data-photo],[data-album]");
  const kind = container?.hasAttribute("data-photo") ? "photo" : container ? "album" : undefined;
  const attribute = kind === "photo" ? "data-photo" : "data-album";
  const scope = container ? `[${attribute}="${CSS.escape(container.getAttribute(attribute)!)}"]` : undefined;
  let selector = active.tagName.toLowerCase();
  for (const key of ["id", "name", "href", "data-action", "data-id", "data-roll", "data-library"]) {
    const value = active.getAttribute(key);
    if (value !== null) selector += `[${key}="${CSS.escape(value)}"]`;
  }
  return { selector: `${scope ? scope + " " : ""}${selector}`, scope, kind,
    index: container ? Array.from(root.querySelectorAll(`[${attribute}]`)).indexOf(container) : undefined };
}
export function restoreEditorFocus(root: HTMLElement, target?: EditorFocus) {
  if (!target) return;
  const enabled = "button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled)";
  let control = root.querySelector<HTMLElement>(target.selector);
  if (!control || control.matches(":disabled")) {
    const containers = target.kind ? root.querySelectorAll<HTMLElement>(`[data-${target.kind}]`) : [];
    const container = target.scope && root.querySelector<HTMLElement>(target.scope)
      || containers[Math.min(target.index ?? 0, containers.length - 1)];
    control = container?.querySelector<HTMLElement>(enabled) ?? root.querySelector<HTMLElement>("h1");
  }
  if (control?.tagName === "H1") control.tabIndex = -1;
  control?.focus({ preventScroll: true });
}
