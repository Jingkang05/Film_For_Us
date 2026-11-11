import { setUIText, ui, uiLanguage, type UIValues } from "./ui-language.js";
import type { UIKey } from "./ui-translations.js";
import type { Album } from "./memory-project.js";
export type { Album, Photo, Roll } from "./memory-project.js";

export interface ManageData {
  album: Album;
  status: "draft" | "published" | "unpublished";
  revision: number;
  publishedRevision: number | null;
  shareId: string;
  shareSlug: string;
  directUpload?: boolean;
}

export const app = document.querySelector<HTMLElement>("#app")!;
export const dialog = document.querySelector<HTMLDialogElement>("#dialog")!;
const announcer = document.querySelector("#announce")!;

export const escapeHTML = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]!));

export function announce(message: string) {
  announcer.removeAttribute("data-ui");
  announcer.setAttribute("lang", uiLanguage() === "zh" ? "zh-CN" : "en");
  announcer.textContent = message;
}

export function announceUI(key: UIKey, values: UIValues = {}) { setUIText(announcer, key, values); }

export class RequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}

export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new RequestError("Could not connect. Check your connection and try again.", 0);
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    throw new RequestError(result?.error ?? "Something went wrong. Try again.", response.status, result?.code);
  }
  return result as T;
}

export function postJSON<T>(url: string, data: unknown): Promise<T> {
  return api<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export const icons = {
  left: '<path d="M19 12H5m6-6-6 6 6 6"/>',
  right: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  heart: '<path d="M20.8 8.8c0 4.1-8.8 9.8-8.8 9.8s-8.8-5.7-8.8-9.8a4.6 4.6 0 0 1 8.8-2 4.6 4.6 0 0 1 8.8 2Z"/>',
  sound: '<path d="M3 9v6h4l5 4V5L7 9H3Zm13 0a4 4 0 0 1 0 6m2-9a8 8 0 0 1 0 12"/>',
  mute: '<path d="M3 9v6h4l5 4V5L7 9H3Zm13 1 5 5m0-5-5 5"/>',
  flip: '<path d="M20 10a8 8 0 1 0 0 5M20 4v6h-6"/>',
  up: '<path d="M12 19V5m-6 6 6-6 6 6"/>',
  down: '<path d="M12 5v14m-6-6 6 6 6-6"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4"/>',
} as const;

export function icon(name: keyof typeof icons) {
  return `<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;
}

export function count(value: number) {
  return String(value).padStart(2, "0");
}

export function showMessage(title: UIKey, detail: UIKey, retry?: () => void) {
  app.innerHTML = `<section class="message"><h1>${ui(title)}</h1><p>${ui(detail)}</p>${retry ? `<button type="button" class="action">${ui("retry")}</button>` : ""}</section>`;
  app.querySelector("button")?.addEventListener("click", retry!);
}
