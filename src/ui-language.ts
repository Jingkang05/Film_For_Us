import { errorKeys, uiTranslations, type UIKey, type UILanguage } from "./ui-translations.js";

export type UIValues = Record<string, string | number>;
export const languageStorageKey = "roll-for-us:ui-language";
let language: UILanguage = "zh";
try { if (localStorage.getItem(languageStorageKey) === "en") language = "en"; } catch { /* In-memory switching remains available. */ }

const escape = (value: string) => value.replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
export const uiLanguage = () => language;
export function t(key: UIKey, values: UIValues = {}): string {
  return uiTranslations[language][key].replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match));
}
export const errorKey = (message: string): UIKey => errorKeys[message] ?? "genericError";

// Only explicitly marked leaf nodes and attributes are updated. Never traverse or
// rewrite user text, input values, scene markup, animations, images or audio.
export function ui(key: UIKey, values: UIValues = {}): string {
  return `<span data-ui="${key}" data-ui-values="${escape(JSON.stringify(values))}" lang="${language === "zh" ? "zh-CN" : "en"}">${escape(t(key, values))}</span>`;
}
// Attribute-only controls get the UI language locally. Mixed user-content
// containers and form values keep their existing language metadata.
const attributeLanguage = (key: UIKey, attribute: string) => attribute !== "placeholder"
  && !["rollFrames", "rollFrame", "viewPrint", "chooseChinese", "chooseEnglish"].includes(key);
export function uiAttr(key: UIKey, values: UIValues = {}, attribute = "aria-label"): string {
  return `data-ui-${attribute}="${key}" data-ui-${attribute}-values="${escape(JSON.stringify(values))}" ${attribute}="${escape(t(key, values))}"${attributeLanguage(key, attribute) ? ` lang="${language === "zh" ? "zh-CN" : "en"}"` : ""}`;
}
export function setUIText(element: Element, key: UIKey, values: UIValues = {}) {
  element.setAttribute("data-ui", key);
  element.setAttribute("data-ui-values", JSON.stringify(values));
  element.setAttribute("lang", language === "zh" ? "zh-CN" : "en");
  element.textContent = t(key, values);
}
export function setUIAttr(element: Element, key: UIKey, values: UIValues = {}, attribute = "aria-label") {
  element.setAttribute(`data-ui-${attribute}`, key);
  element.setAttribute(`data-ui-${attribute}-values`, JSON.stringify(values));
  element.setAttribute(attribute, t(key, values));
  if (attributeLanguage(key, attribute)) element.setAttribute("lang", language === "zh" ? "zh-CN" : "en");
}
export function refreshUI(root: ParentNode = document) {
  for (const element of root.querySelectorAll("[data-ui]")) {
    setUIText(element, element.getAttribute("data-ui") as UIKey, JSON.parse(element.getAttribute("data-ui-values") || "{}"));
  }
  for (const attribute of ["aria-label", "placeholder", "title", "alt"]) {
    for (const element of root.querySelectorAll(`[data-ui-${attribute}]`)) {
      setUIAttr(element, element.getAttribute(`data-ui-${attribute}`) as UIKey,
        JSON.parse(element.getAttribute(`data-ui-${attribute}-values`) || "{}"), attribute);
    }
  }
  root.querySelectorAll<HTMLButtonElement>("[data-ui-language]").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.uiLanguage === language));
  });
}
export function setUILanguage(next: UILanguage) {
  language = next;
  try { localStorage.setItem(languageStorageKey, language); } catch { /* Keep the preference in memory. */ }
  refreshUI();
}
export function mountLanguageSwitcher() {
  const switcher = document.createElement("nav");
  switcher.className = "language-switcher";
  switcher.setAttribute("aria-label", t("language"));
  setUIAttr(switcher, "language");
  switcher.innerHTML = `<button type="button" data-ui-language="zh" lang="zh-CN" ${uiAttr("chooseChinese")} aria-pressed="${language === "zh"}">中</button>
    <span aria-hidden="true">/</span>
    <button type="button" data-ui-language="en" lang="en" ${uiAttr("chooseEnglish")} aria-pressed="${language === "en"}">EN</button>`;
  switcher.addEventListener("click", event => {
    event.stopPropagation();
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-ui-language]");
    if (button) setUILanguage(button.dataset.uiLanguage as UILanguage);
  });
  document.body.append(switcher);
  refreshUI();
  // Native modal dialogs make the rest of the page inert. Move the same control
  // into the top layer while a modal is open so switching remains usable there.
  const syncLayer = () => {
    const modal = document.querySelector<HTMLDialogElement>("dialog[open]");
    const parent = modal ?? document.body;
    if (switcher.parentElement !== parent) parent.append(switcher);
  };
  new MutationObserver(syncLayer).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
  window.addEventListener("storage", event => {
    if (event.key === languageStorageKey) {
      language = event.newValue === "en" ? "en" : "zh";
      refreshUI();
    }
  });
}
