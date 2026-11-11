import { captureEditorFocus, restoreEditorFocus, type EditorFocus } from "./editor-focus.js";
import { api, app, dialog, announce, escapeHTML as esc, postJSON, type ManageData } from "./common.js";
import { ui, t, errorKey } from "./ui-language.js";

type AlbumSummary = { id: string; title: string; photoCount: number; status: ManageData["status"]; revision: number; shareSlug: string };

export async function mountAlbumLibrary() {
  let { albums } = await api<{ albums: AlbumSummary[] }>("/api/editor");
  let busy = false;
  let pendingFocus: EditorFocus | undefined;
  let newTitle = "";
  function render(message = "", error = false) {
    pendingFocus = captureEditorFocus(app) ?? pendingFocus;
    app.innerHTML = `<section class="owner album-library">
      <header class="owner-heading"><div><a href="/demo" class="owner-brand">Film <i>for us</i></a><h1>${ui("allAlbums")}</h1></div>
        <button type="button" class="text-button" data-library="logout">${ui("signOut")}</button></header>
      <form class="owner-section album-create"><label>${ui("newAlbumTitle")}<input name="title" maxlength="80" required autocomplete="off" value="${esc(newTitle)}"></label>
        <button class="action" type="submit" name="create-album">${ui("createNewAlbum")}</button></form>
      <p class="owner-feedback ${error ? "owner-feedback--error" : ""}" >${esc(message)}</p>
      <div class="album-list">${albums.length ? albums.map(album => `<article class="album-row" data-album="${album.id}">
        <div class="album-summary"><h2><a href="/editor/${album.id}">${esc(album.title || t("untitledAlbum"))}</a></h2>
          <p>${ui(album.status === "published" ? "statusPublished" : album.status === "unpublished" ? "statusUnpublished" : "statusDraft")} · ${ui("photoCount", { count: album.photoCount })}</p></div>
        <div class="album-actions"><a class="action" href="/editor/${album.id}">${ui("editAlbum")}</a>
          <a class="text-button" href="/preview/${album.id}">${ui("previewDraft")}</a>
          ${album.status === "published" ? `<button type="button" class="text-button" data-library="copy">${ui("copyLink")}</button><button type="button" class="text-button" data-library="unpublish">${ui("unpublishAlbum")}</button>` : ""}
          <button type="button" class="text-button danger-action" data-library="delete">${ui("deleteAlbum")}</button></div>
      </article>`).join("") : `<p class="owner-empty">${ui("noAlbums")}</p>`}</div>
    </section>`;
    if (message) announce(message);
    if (!busy) { restoreEditorFocus(app, pendingFocus); pendingFocus = undefined; }
  }
  async function run(work: () => Promise<void>) {
    if (busy) return;
    pendingFocus = captureEditorFocus(app) ?? pendingFocus;
    busy = true;
    app.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input,button").forEach(control => { control.disabled = true; });
    try { await work(); }
    catch (error) {
      const message = (error as Error).message, key = errorKey(message);
      render(key === "genericError" ? message : t(key), true);
    }
    finally {
      busy = false;
      app.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input,button").forEach(control => { control.disabled = false; });
      restoreEditorFocus(app, pendingFocus); pendingFocus = undefined;
    }
  }
  app.addEventListener("input", event => {
    const input = event.target as HTMLInputElement;
    if (input.name === "title") newTitle = input.value;
  });
  app.addEventListener("submit", event => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const title = new FormData(form).get("title");
    void run(async () => {
      const result = await postJSON<ManageData>("/api/editor/create", { title });
      location.assign(`/editor/${result.shareId}`);
    });
  });
  app.addEventListener("click", event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-library]");
    if (!button || busy) return;
    const action = button.dataset.library;
    if (action === "logout") { void run(async () => { await postJSON("/api/manage/logout", {}); location.reload(); }); return; }
    const id = button.closest<HTMLElement>("[data-album]")?.dataset.album;
    const album = albums.find(album => album.id === id);
    if (!album) return;
    if (action === "copy") {
      const link = `${location.origin}/a/${encodeURIComponent(album.shareSlug || album.id)}`;
      void run(async () => {
        try { await navigator.clipboard.writeText(link); render(t("linkCopied")); }
        catch { render(link); }
      });
    }
    if (action === "unpublish") void run(async () => {
      await postJSON(`/api/editor/${album.id}/unpublish`, { revision: album.revision });
      albums = (await api<{ albums: AlbumSummary[] }>("/api/editor")).albums;
      render(t("albumUnpublishedSaved"));
    });
    if (action === "delete") {
      pendingFocus = captureEditorFocus(app);
      dialog.className = "album-delete-dialog";
      dialog.innerHTML = `<h2 id="delete-title">${ui("deleteAlbum")}</h2><p>${esc(album.title)}</p><p>${ui("deleteHelp")}</p>
        <p class="album-id">${esc(album.id)}</p><form method="dialog"><label>${ui("confirmAlbumId")}<input name="confirmation" autocomplete="off" required></label>
        <p role="status" class="owner-feedback owner-feedback--error"></p><div class="album-actions"><button type="button" class="text-button" data-cancel>${ui("cancelDelete")}</button>
        <button type="submit" class="action">${ui("deleteAlbum")}</button></div></form>`;
      dialog.setAttribute("aria-labelledby", "delete-title");
      dialog.querySelector("[data-cancel]")!.addEventListener("click", () => dialog.close());
      dialog.querySelector("form")!.addEventListener("submit", async event => {
        event.preventDefault();
        if (busy) return;
        const confirmation = new FormData(event.target as HTMLFormElement).get("confirmation");
        if (confirmation !== album.id) { dialog.querySelector('[role="status"]')!.textContent = t("deleteMismatch"); return; }
        busy = true;
        const submit = dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!;
        submit.disabled = true;
        try {
          await postJSON(`/api/editor/${album.id}/delete`, { revision: album.revision, confirmation });
          albums = albums.filter(item => item.id !== album.id);
          dialog.close(); render(t("albumDeleted"));
        } catch (error) { dialog.querySelector('[role="status"]')!.textContent = (error as Error).message; }
        finally {
          busy = false; submit.disabled = false;
          if (!dialog.open) { restoreEditorFocus(app, pendingFocus); pendingFocus = undefined; }
        }
      });
      dialog.showModal();
    }
  });
  render();
}
