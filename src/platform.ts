import { api, app, postJSON, RequestError } from "./common.js";
import { ui, uiAttr, setUIText, t, errorKey } from "./ui-language.js";

export function safeNext(value: string | null): string {
  return value && /^(?:\/create|\/dashboard|\/editor\/[A-Za-z0-9_-]{16}|\/preview\/[A-Za-z0-9_-]{16})$/.test(value) ? value : "/dashboard";
}
export async function accountDestination(destination: "/create" | "/dashboard") {
  try {
    const session = await api<{ authenticated: boolean }>("/api/auth/session");
    return session.authenticated ? destination : `/login?next=${destination}`;
  } catch { return `/login?next=${destination}`; }
}
export async function navigateAccount(destination: "/create" | "/dashboard") {
  location.assign(await accountDestination(destination));
}
export function studioStyles() {
  if (document.querySelector('link[href="/manage.css"]')) return;
  const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "/manage.css"; document.head.append(css);
}
export async function requireAccount() {
  const session = await api<{ authenticated: boolean }>("/api/auth/session");
  if (session.authenticated) return true;
  location.replace(`/login?next=${encodeURIComponent(safeNext(location.pathname))}`);
  return false;
}
export async function mountLogin() {
  studioStyles(); document.title = "Sign in · Film For Us";
  const next = safeNext(new URLSearchParams(location.search).get("next"));
  try { if ((await api<{ authenticated: boolean }>("/api/auth/session")).authenticated) { location.replace(next); return; } } catch { /* Show a useful server error on submission. */ }
  let email = "", sent = false, busy = false, until = 0;
  app.innerHTML = `<section class="owner-login platform-login"><a class="owner-brand" href="/">Film <i>for us</i></a>
    <h1>${ui("accountLogin")}</h1><p>${ui("loginIntro")}</p>
    <form><label>${ui("emailAddress")}<input type="email" name="email" autocomplete="email" maxlength="254" required></label>
      <div data-code hidden><label>${ui("verificationCode")}<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{8}" maxlength="8"></label></div>
      <button class="action" type="submit">${ui("sendCode")}</button>
      <button class="text-button" type="button" data-resend hidden>${ui("resendCode")}</button>
      <button class="text-button" type="button" data-change-email hidden>${ui("changeEmail")}</button>
      <p class="owner-feedback" role="status" aria-live="polite"></p>
    </form><a class="text-button" href="/">${ui("backHome")}</a></section>`;
  const form = app.querySelector("form")!, emailInput = form.querySelector<HTMLInputElement>('[name="email"]')!, codeInput = form.querySelector<HTMLInputElement>('[name="code"]')!;
  const submit = form.querySelector<HTMLButtonElement>('[type="submit"]')!, resend = form.querySelector<HTMLButtonElement>("[data-resend]")!, status = form.querySelector<HTMLElement>('[role="status"]')!;
  function cooldown() {
    const seconds = Math.max(0, Math.ceil((until - Date.now()) / 1000));
    resend.disabled = busy || seconds > 0;
    setUIText(resend, seconds ? "resendWait" : "resendCode", { seconds });
  }
  const timer = window.setInterval(cooldown, 1000);
  window.addEventListener("pagehide", () => clearInterval(timer), { once: true });
  async function run(work: () => Promise<void>) {
    if (busy) return;
    busy = true; submit.disabled = true; emailInput.readOnly = true; resend.disabled = true;
    setUIText(submit, "working"); status.textContent = ""; status.classList.remove("owner-feedback--error");
    try { await work(); } catch (error) { setUIText(status,errorKey((error as Error).message)); status.classList.add("owner-feedback--error"); }
    finally { busy = false; submit.disabled = false; emailInput.readOnly = sent; cooldown(); setUIText(submit, sent ? "verifyCode" : "sendCode"); }
  }
  async function send() {
    email = emailInput.value.trim();
    const result = await postJSON<{ cooldown: number }>("/api/auth/otp", { email });
    until = Date.now() + result.cooldown * 1000; sent = true;
    form.querySelector<HTMLElement>("[data-code]")!.hidden = false; codeInput.required = true; resend.hidden = false;
    form.querySelector<HTMLElement>("[data-change-email]")!.hidden = false;
    setUIText(status, "codeSent"); codeInput.focus();
  }
  form.addEventListener("submit", event => { event.preventDefault(); void run(async () => {
    if (!sent) return send();
    await postJSON("/api/auth/verify", { email, code: codeInput.value });
    location.replace(next);
  }); });
  resend.addEventListener("click", () => { if (Date.now() >= until) void run(send); });
  form.querySelector("[data-change-email]")!.addEventListener("click", () => {
    if (busy) return;
    sent = false; codeInput.value = ""; codeInput.required = false; form.querySelector<HTMLElement>("[data-code]")!.hidden = true;
    resend.hidden = true; form.querySelector<HTMLElement>("[data-change-email]")!.hidden = true; emailInput.readOnly = false; emailInput.focus();
    setUIText(submit,"sendCode"); status.removeAttribute("data-ui"); status.textContent = "";
  });
}
export async function mountCreate() {
  studioStyles(); document.title = "Create a Memory · Film For Us";
  if (!await requireAccount()) return;
  app.innerHTML = `<section class="owner create-page"><a class="owner-brand" href="/">Film <i>for us</i></a>
    <h1>${ui("createMemory")}</h1><p class="create-intro">${ui("createIntro")}</p>
    <article class="template-choice"><img src="/assets/instax-mini-evo-table.webp" alt="">
      <div><h2>${ui("vintageDarkroom")}</h2><p>${ui("templateIntro")}</p>
      <button class="action" type="button">${ui("startCreating")}</button></div></article>
    <p class="owner-feedback" role="status"></p><a class="text-button" href="/dashboard">${ui("backStudio")}</a></section>`;
  const button = app.querySelector<HTMLButtonElement>("button")!;
  let busy = false;
  button.addEventListener("click", async () => {
    if (busy) return; busy = true; button.disabled = true; setUIText(button, "working");
    try { const result = await postJSON<{ shareId: string }>("/api/editor/create", { title: t("untitledAlbum") }); location.assign(`/editor/${result.shareId}`); }
    catch (error) { setUIText(app.querySelector('[role="status"]')!,errorKey((error as Error).message)); if (error instanceof RequestError && error.status === 401) location.assign("/login?next=/create"); busy = false; button.disabled = false; setUIText(button, "startCreating"); }
  });
}
export function mountViewerMenu() {
  if (document.querySelector(".viewer-menu-toggle")) return;
  const button = document.createElement("button"), menu = document.createElement("dialog");
  button.type = "button"; button.className = "viewer-menu-toggle"; button.setAttribute("aria-haspopup", "dialog"); button.setAttribute("aria-controls", "viewer-menu"); button.setAttribute("aria-expanded", "false");
  button.innerHTML = `<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 7h16M4 12h16M4 17h16"/></svg><span class="sr-only">${ui("viewerMenu")}</span>`;
  menu.className = "viewer-menu"; menu.id = "viewer-menu"; menu.setAttribute("aria-labelledby", "viewer-menu-title");
  menu.innerHTML = `<div class="viewer-menu-panel"><button class="text-button" type="button" data-close ${uiAttr("closeMenu")}>${ui("closeMenu")}</button>
    <h2 id="viewer-menu-title">Film <i>for us</i></h2><nav><a href="/login?next=/create" data-destination="/create">${ui("createMemory")}</a>
    <a href="/login?next=/dashboard" data-destination="/dashboard">${ui("myStudio")}</a></nav></div>`;
  document.body.append(button, menu);
  button.addEventListener("click", () => { menu.showModal(); button.setAttribute("aria-expanded", "true"); });
  menu.querySelector("[data-close]")!.addEventListener("click", () => menu.close());
  menu.addEventListener("click", event => { if (event.target === menu) menu.close(); });
  menu.addEventListener("close", () => { button.setAttribute("aria-expanded", "false"); button.focus({ preventScroll: true }); });
  menu.querySelectorAll<HTMLAnchorElement>("[data-destination]").forEach(link => link.addEventListener("click", event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); menu.close(); void navigateAccount(link.dataset.destination as "/create" | "/dashboard");
  }));
}
