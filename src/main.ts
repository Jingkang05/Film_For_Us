import { toMemoryProject } from "./memory-project.js";
import { mountLanguageSwitcher, ui } from "./ui-language.js";
import { api, app, RequestError, showMessage } from "./common.js";

mountLanguageSwitcher();

async function start() {
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  if (path === "/login" || path === "/create") {
    const platform = await import("./platform.js");
    try { await (path === "/login" ? platform.mountLogin() : platform.mountCreate()); }
    catch { showMessage("editorFailed", "tryLater", () => location.reload()); }
    return;
  }
  if (path === "/dashboard" || path === "/manage" || path === "/editor" || /^\/editor\/[A-Za-z0-9_-]{16}$/.test(path)) {
    const { mountManage } = await import("./manage.js");
    await mountManage(path.startsWith("/editor/") ? path.split("/")[2] : undefined);
    return;
  }
  const source = path === "/" || path === "/demo" ? "/api/demo"
    : path === "/manage/preview" ? "/api/preview"
    : /^\/preview\/[A-Za-z0-9_-]{16}$/.test(path) ? `/api/editor/${path.split("/")[2]}/preview`
    : path.match(/^\/a\/[^/]+$/) ? `/api${path}` : null;
  if (!source) {
    showMessage("pageMissing", "checkLink");
    return;
  }
  try {
    const album = toMemoryProject(await api<unknown>(source));
    const { mountDarkroom } = await import("./darkroom.js");
    mountDarkroom(album, source === "/api/preview" || source.endsWith("/preview"), source === "/api/demo");
    const { mountViewerMenu } = await import("./platform.js");
    mountViewerMenu();
    if (new URLSearchParams(location.search).has("sidebar")) document.querySelector<HTMLButtonElement>(".viewer-menu-toggle")?.click();
  } catch (error) {
    if (error instanceof RequestError && error.status === 401) {
      if (!(await api<{ enabled: boolean }>("/api/platform")).enabled) {
        app.innerHTML = `<section class="message"><h1>${ui("signInFirst")}</h1><a class="action" href="/manage">${ui("goEditor")}</a></section>`;
        return;
      }
      const { safeNext } = await import("./platform.js");
      location.replace(`/login?next=${encodeURIComponent(safeNext(path))}`);
    } else if (error instanceof RequestError && error.status === 404) {
      showMessage("notPublished", "publishDetail");
    } else {
      showMessage("albumFailed", "tryLater", () => void start());
    }
  }
}

void start().catch(() => showMessage("albumFailed", "tryLater", () => location.reload()));
