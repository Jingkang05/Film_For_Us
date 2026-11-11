import { mountLanguageSwitcher, ui } from "./ui-language.js";
import { api, app, type Album, RequestError, showMessage } from "./common.js";

mountLanguageSwitcher();

async function start() {
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  if (path === "/manage") {
    const { mountManage } = await import("./manage.js");
    await mountManage();
    return;
  }
  const source = path === "/" || path === "/demo" ? "/api/demo"
    : path === "/manage/preview" ? "/api/preview"
    : path.match(/^\/a\/[^/]+$/) ? `/api${path}` : null;
  if (!source) {
    showMessage("pageMissing", "checkLink");
    return;
  }
  try {
    const album = await api<Album>(source);
    const { mountDarkroom } = await import("./darkroom.js");
    mountDarkroom(album, source === "/api/preview");
  } catch (error) {
    if (error instanceof RequestError && error.status === 401) {
      app.innerHTML = `<section class="message"><h1>${ui("signInFirst")}</h1><a class="action" href="/manage">${ui("goEditor")}</a></section>`;
    } else if (error instanceof RequestError && error.status === 404) {
      showMessage("notPublished", "publishDetail");
    } else {
      showMessage("albumFailed", "tryLater", () => void start());
    }
  }
}

void start();
