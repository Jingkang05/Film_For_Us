import { prepareUpload } from "./heic-upload.js";
import { captureEditorFocus, restoreEditorFocus, type EditorFocus } from "./editor-focus.js";
import { toMemoryProject, serializeMemoryProject } from "./memory-project.js";
import { mountAlbumLibrary } from "./album-library.js";
import { ui, uiAttr, setUIText, errorKey, t, refreshUI } from "./ui-language.js";
import { api, app, announce, escapeHTML as esc, icon, postJSON, RequestError, showMessage,
  type ManageData, type Roll } from "./common.js";
import { setChineseTypography } from "./typography.js";
import { normalizeShareSlug, validShareSlug, shareSlugFromTitle } from "./share-link.js";

type Upload = {
  id: string;
  file: File;
  roll?: string;
  replace?: string;
  state: "queued" | "uploading" | "uploaded" | "failed";
  status: string;
};

const photoCount = (total: number) => ui(total === 1 ? "onePhoto" : "photoCount", { count: total });

export async function mountManage(albumId?: string) {
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = "/manage.css";
  document.head.append(css);
  document.title = "Album editor · Film for us";
  try {
    if (albumId) editor(await api<ManageData>(`/api/editor/${albumId}`));
    else await mountAlbumLibrary();
  } catch (error) {
    if (error instanceof RequestError && error.status === 401) login(error.code === "setup-required");
    else showMessage("editorFailed", "tryLater", () => location.reload());
  }
}

function login(setup: boolean) {
  app.innerHTML = `<section class="owner-login">
    <h1>${ui(setup ? "createAlbumTitle" : "albumEditor")}</h1>
    ${setup ? `<p>${ui("passwordHint")}</p>` : ""}
    <form><label>${ui("ownerPassword")}<input name="password" type="password"
        autocomplete="${setup ? "new-password" : "current-password"}" ${setup ? 'minlength="12"' : ""} required maxlength="1024"></label>
      <button type="submit" class="action">${ui(setup ? "createAlbum" : "signIn")}</button><p class="owner-feedback" role="status"></p></form>
    <a class="text-button" href="/demo">${icon("left")} ${ui("backDemo")}</a>
  </section>`;
  const form = app.querySelector("form")!;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button")!;
    button.disabled = true;
    try {
      const password = new FormData(form).get("password");
      await postJSON(setup ? "/api/manage/setup" : "/api/manage/login", { password });
      location.reload();
    } catch (error) {
      setUIText(form.querySelector(".owner-feedback")!, errorKey((error as Error).message));
      button.disabled = false;
    }
  });
}

function editor(initial: ManageData) {
  let data = initial;
  const endpoint = `/api/editor/${encodeURIComponent(data.shareId)}`;
  // Validate at the same boundary used by the Viewer, and populate all template-supported fields.
  const normalize = () => { data.album = serializeMemoryProject(toMemoryProject(data.album), data.album.shareSlug); };
  normalize();
  let busy = false;
  let pendingFocus: EditorFocus | undefined;
  let dirty = false;
  let feedback = "";
  let messageError = false;
  let uploads: Upload[] = [];
  let uploadTarget = data.album.rolls[0].id;

  function notice(value: string, error = false) {
    feedback = value;
    messageError = error;
    const status = app.querySelector<HTMLElement>("#owner-status");
    if (status) {
      status.innerHTML = value;
      status.classList.toggle("owner-feedback--error", error);
      announce(status.textContent ?? "");
    }
  }

  function rollFields(roll: Roll, index: number) {
    return `<fieldset class="owner-roll"><legend>${ui("rollNumber", { number: index + 1 })} <small>${photoCount(roll.photos.length)}</small></legend>
      <div class="roll-fields"><label>${ui("rollName")}<input name="roll-name" data-roll="${roll.id}" maxlength="40" value="${esc(roll.name)}"></label>
      <label>${ui("labelColor")}<input type="color" name="roll-color" data-roll="${roll.id}" value="${esc(roll.color)}"></label></div>
      ${roll.photos.length ? roll.photos.map((photo, i) => `<article class="owner-photo" data-photo="${photo.id}">
        <img src="${esc(photo.thumb)}" ${uiAttr("photoNumber", { number: i + 1 }, "alt")} loading="lazy">
        <div class="owner-photo-fields">
          <label>${ui("photoDate")}<input type="date" name="date" data-id="${photo.id}" value="${esc(photo.date)}"></label>
          <label>${ui("photoNote")}<textarea name="note" dir="auto" data-id="${photo.id}" maxlength="600" rows="2">${esc(photo.note)}</textarea></label>
          <div class="owner-photo-actions">
            <label>${ui("moveRoll")}<select name="move" data-id="${photo.id}">
              ${data.album.rolls.map((item, j) => `<option value="${item.id}" ${item.id === roll.id ? "selected" : ""}>${esc(item.name || `Roll ${j + 1}`)}</option>`).join("")}
            </select></label>
            <button type="button" class="icon-button" data-action="up" data-id="${photo.id}" ${uiAttr("moveUp", { number: i + 1 })} ${i === 0 ? "disabled" : ""}>${icon("up")}</button>
            <button type="button" class="icon-button" data-action="down" data-id="${photo.id}" ${uiAttr("moveDown", { number: i + 1 })} ${i === roll.photos.length - 1 ? "disabled" : ""}>${icon("down")}</button>
            <button type="button" class="text-button" data-action="remove" data-id="${photo.id}">${ui("remove")}</button>
            <label class="replace-photo">${ui("replacePhoto")}<input type="file" name="replace" data-id="${photo.id}" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"></label>
          </div>
        </div>
      </article>`).join("") : `<p class="owner-empty">${ui("emptyRoll")}</p>`}</fieldset>`;
  }

  function uploadModule() {
    const queued = uploads.filter((item) => item.state === "queued").length;
    return `<section id="upload" class="owner-section upload-module" aria-labelledby="upload-heading">
      <h2 id="upload-heading" tabindex="-1">${ui("uploadPhotos")}</h2>
      <label>${ui("destinationRoll")}<select name="upload-roll">
        ${data.album.rolls.map((roll, i) => `<option value="${roll.id}" ${uploadTarget === roll.id ? "selected" : ""}>${esc(roll.name || `Roll ${i + 1}`)}</option>`).join("")}
      </select></label>
      <label class="upload-drop">
        <strong>${icon("upload")} ${ui("choosePhotos")}</strong>
        <span>${ui("dropPhotos")}</span>
        <input name="files" type="file" ${uiAttr("choosePhotos")} aria-describedby="upload-formats"
          accept="image/*,.heic,.heif" multiple>
      </label>
      <p id="upload-formats" class="owner-empty">${ui("uploadFormats")}</p>
      <ul class="upload-list" aria-live="polite">${uploads.map((item) => `<li data-state="${item.state}">
        <span class="upload-name">${esc(item.file.name)}</span><span>${ui(item.status ? errorKey(item.status) : item.state === "queued" ? "readyUpload" : item.state === "uploading" ? "uploading" : "addedToRoll")}</span>
        <div class="upload-row-actions">
          ${item.state === "failed" && item.roll ? `<button class="text-button" type="button" data-action="retry" data-id="${item.id}" ${uiAttr("retryFile", { name: item.file.name })}>${ui("retry")}</button>` : ""}
          ${item.state === "queued" || item.state === "failed"
            ? `<button class="text-button" type="button" data-action="discard-upload" data-id="${item.id}" ${uiAttr("discardFile", { name: item.file.name })}>${ui("remove")}</button>` : ""}
        </div>
      </li>`).join("")}</ul>
      <button class="action" type="button" data-action="upload" ${queued ? "" : "disabled"}>${queued ? ui(queued === 1 ? "uploadOne" : "uploadCount", { count: queued }) : ui("uploadDraft")}</button>
    </section>`;
  }

  function render() {
    pendingFocus = captureEditorFocus(app) ?? pendingFocus;
    const share = `${location.origin}/a/${encodeURIComponent(data.shareSlug || data.shareId)}`;
    const published = data.status === "published";
    app.innerHTML = `<section class="owner">
      <header class="owner-heading"><div><a href="/demo" class="owner-brand">Film <i>for us</i></a><h1>${ui("albumEditor")}</h1></div>
        <button class="text-button" data-action="logout" type="button">${ui("signOut")}</button></header>
      <a href="/editor" class="text-button">${icon("left")} ${ui("allAlbums")}</a>
      <div class="owner-toolbar">
        <p id="revision-status">${dirty ? ui("unsaved") : ui("draftVersion", { version: data.revision })} · ${published ? ui("publishedVersion", { version: data.publishedRevision! }) : ui("unpublished")}</p>
        <div><a class="text-button" href="#upload">${ui("uploadPhotos")}</a>
          <button type="button" class="text-button" data-action="preview">${ui("previewDraft")} ${icon("right")}</button>
          <button type="button" class="action" data-action="save">${ui("saveDraft")}</button>
          <button type="button" class="action action--publish" data-action="publish">${ui("publish")}</button></div>
        <p id="owner-status" class="owner-feedback ${messageError ? "owner-feedback--error" : ""}" >${feedback}</p>
        ${published ? `<div class="share-field"><label>${ui("shareLink")}<input readonly value="${esc(share)}"></label><button type="button" class="action" data-action="copy">${ui("copyLink")}</button></div>` : ""}
      </div>
      <section class="owner-section"><h2>${ui("openingLetter")}</h2>
        <label>${ui("albumTitle")}<input name="title" value="${esc(data.album.title)}" maxlength="80"></label>
        <label>${ui("yourLetter")}<textarea name="letter" dir="auto" rows="6" maxlength="2000" ${uiAttr("letterPlaceholder", {}, "placeholder")}>${esc(data.album.letter)}</textarea></label>
      </section>
      <section class="owner-section owner-link" aria-labelledby="link-heading">
        <h2 id="link-heading">${ui("customLink")}</h2>
        <div class="slug-controls">
          <label for="share-slug">${ui("urlSuffix")}<span class="slug-input"><span aria-hidden="true">/a/</span><input id="share-slug" name="share-slug" dir="ltr" type="text" maxlength="80" value="${esc(data.album.shareSlug ?? "")}" autocomplete="off" autocapitalize="none" spellcheck="false" aria-describedby="slug-help slug-error" aria-invalid="false"></span></label>
          <button type="button" class="text-button" data-action="slug-title">${ui("useAlbumTitle")}</button>
        </div>
        <p id="slug-help" class="owner-empty">${ui("slugHelp")}</p>
        <p id="slug-error" class="slug-error owner-feedback--error" aria-live="polite"></p>
        <p class="slug-preview"><span>${ui("linkAfterPublish")}</span><span id="slug-preview" dir="ltr"></span></p>
        <p class="owner-empty">${ui("slugPublishHint")}</p>
      </section>
      <section class="owner-section"><h2>${ui("templateSettings")}</h2>
        <label>${ui("description")}<textarea name="description" rows="2" maxlength="2000">${esc(data.album.description ?? "")}</textarea></label>
        <label>${ui("instantCaption")}<textarea name="instant-caption" rows="2" maxlength="600">${esc(data.album.ending!.instantCaption)}</textarea></label>
        <label>${ui("sealMotif")}<select name="seal-motif"><option value="rose" data-ui="sealRose" ${data.album.settings!.sealMotif === "rose" ? "selected" : ""}>${esc(t("sealRose"))}</option><option value="branch" data-ui="sealBranch" ${data.album.settings!.sealMotif === "branch" ? "selected" : ""}>${esc(t("sealBranch"))}</option></select></label>
        <label>${ui("soundtrackTitle")}<input name="music-title" maxlength="160" value="${esc(data.album.settings!.music.title)}"></label>
        <p class="owner-empty">${ui("soundtrackHelp")}</p>
      </section>
      ${uploadModule()}
      <section class="owner-section owner-rolls"><h2>${ui("rollsPhotos")}</h2>
        ${data.album.rolls.map(rollFields).join("")}
      </section>
    </section>`;
    app.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[name=title], input[name=roll-name], textarea').forEach((field) => {
      setChineseTypography(field, field.value);
    });
    refreshUI(app);
    updateLinkPreview();
    if (busy) lockControls();
    else { restoreEditorFocus(app, pendingFocus); pendingFocus = undefined; }
  }

  function lockControls() {
    app.querySelectorAll<HTMLInputElement>("input, textarea, select, button").forEach((field) => { field.disabled = true; });
  }

  function markDirty() {
    dirty = true;
    setUIText(app.querySelector("#revision-status")!, "unsaved");
  }

  function updateLinkPreview() {
    const value = data.album.shareSlug ?? "";
    const valid = validShareSlug(value);
    app.querySelector("#share-slug")?.setAttribute("aria-invalid", String(!valid));
    const error = app.querySelector("#slug-error");
    if (error) {
      if (valid) { error.removeAttribute("data-ui"); error.textContent = ""; }
      else setUIText(error, "slugInvalid");
    }
    const preview = app.querySelector("#slug-preview");
    if (preview) preview.textContent = valid ? `${location.origin}/a/${normalizeShareSlug(value) || data.shareId}` : "";
  }

  function photoLocation(id: string) {
    for (const roll of data.album.rolls) {
      const index = roll.photos.findIndex((photo) => photo.id === id);
      if (index !== -1) return { roll, index, photo: roll.photos[index] };
    }
  }

  function onInput(event: Event) {
    const input = event.target as HTMLInputElement | HTMLTextAreaElement;
    setChineseTypography(input, input.value);
    if (input.name === "title" || input.name === "letter") data.album[input.name] = input.value;
    else if (input.name === "description") data.album.description = input.value;
    else if (input.name === "instant-caption") data.album.ending!.instantCaption = input.value;
    else if (input.name === "seal-motif") data.album.settings!.sealMotif = input.value as "rose" | "branch";
    else if (input.name === "music-title") data.album.settings!.music.title = input.value;
    else if (input.name === "share-slug") {
      data.album.shareSlug = input.value;
      updateLinkPreview();
    } else if (input.name === "roll-name" || input.name === "roll-color") {
      const roll = data.album.rolls.find((item) => item.id === input.dataset.roll)!;
      roll[input.name === "roll-name" ? "name" : "color"] = input.value;
    } else if (input.name === "date" || input.name === "note") {
      const match = photoLocation(input.dataset.id!);
      if (match) match.photo[input.name] = input.value;
    } else return;
    markDirty();
  }

  async function save() {
    if (!dirty) return;
    if (!validShareSlug(data.album.shareSlug ?? "")) throw new Error("Use up to 80 English letters, numbers, hyphens or underscores for the URL suffix.");
    data = await postJSON<ManageData>(`${endpoint}/save`, { revision: data.revision, album: serializeMemoryProject(toMemoryProject(data.album), data.album.shareSlug) });
    normalize();
    dirty = false;
  }

  async function run(work: () => Promise<void>) {
    if (busy) return;
    pendingFocus = captureEditorFocus(app) ?? pendingFocus;
    busy = true;
    lockControls();
    try { await work(); }
    catch (error) {
      const message = (error as Error).message, key = errorKey(message);
      notice(key === "genericError" ? esc(message) : ui(key), true);
    }
    finally {
      busy = false;
      render();
    }
  }

  async function upload(items: Upload[]) {
    await save();
    for (const item of items) {
      item.roll ??= uploadTarget;
      item.state = "uploading";
      item.status = "";
      render();
      const query = new URLSearchParams({ id: item.id, roll: item.roll, revision: String(data.revision) });
      if (item.replace) query.set("replace", item.replace);
      try {
        const prepared = await prepareUpload(item.file, () => {
          item.status = "Converting HEIC/HEIF to JPEG…";
          render();
          announce(t("convertingHeic"));
        });
        item.status = "";
        render();
        if (data.directUpload) {
          const { url, headers } = await api<{ url?: string; headers?: Record<string, string> }>(`${endpoint}/upload-target?${query}`, { method: "POST" });
          if (url) {
            const result = await fetch(url, {
              method: "PUT", headers: headers ?? { "Content-Type": "application/octet-stream" }, body: prepared,
            }).catch(() => null);
            if (!result?.ok && result?.status !== 412) throw new Error("The photo could not be uploaded. Check your connection and try again.");
          }
        }
        data = await api<ManageData>(`${endpoint}/upload?${query}`, {
          method: "POST", body: data.directUpload ? undefined : prepared,
        });
        normalize();
        item.state = "uploaded";
        item.status = "";
      } catch (error) {
        item.state = "failed";
        item.status = (error as Error).message;
      }
      render();
    }
    const failed = items.filter((item) => item.state === "failed").length;
    notice(ui(items.length - failed === 1 ? "uploadedOne" : "uploaded", { count: items.length - failed }) + (failed ? ui("uploadFailedCount", { count: failed }) : ""), failed > 0);
  }

  function stageFiles(files: FileList) {
    if (busy || !files.length) return;
    const batch: Upload[] = Array.from(files, (file) => ({
      file, id: crypto.randomUUID(), state: "queued", status: "",
    }));
    uploads = [...uploads.filter((item) => item.state !== "uploaded"), ...batch];
    render();
    app.querySelector<HTMLButtonElement>('[data-action="upload"]')?.focus({ preventScroll: true });
  }

  app.addEventListener("input", onInput);
  app.addEventListener("change", (event) => {
    const field = event.target as HTMLInputElement;
    if (busy) return;
    if (field.name === "upload-roll") uploadTarget = field.value;
    if (field.name === "files" && field.files) stageFiles(field.files);
    if (field.name === "replace" && field.files?.[0]) {
      const match = photoLocation(field.dataset.id!);
      if (match) {
        const item: Upload = { id: crypto.randomUUID(), replace: match.photo.id, roll: match.roll.id, file: field.files[0], state: "queued", status: "" };
        uploads.push(item);
        void run(() => upload([item]));
      }
    }
    if (field.name === "move") {
      const match = photoLocation(field.dataset.id!);
      const destination = data.album.rolls.find((roll) => roll.id === field.value);
      if (!match || !destination || match.roll === destination) return;
      match.roll.photos.splice(match.index, 1);
      destination.photos.push(match.photo);
      markDirty();
      notice(ui("photoMoved"));
      render();
    }
  });

  app.addEventListener("dragover", (event) => {
    const zone = (event.target as HTMLElement).closest(".upload-drop");
    if (!zone || !event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = busy ? "none" : "copy";
    if (!busy) zone.classList.add("is-dragging");
  });
  app.addEventListener("dragleave", (event) => {
    const zone = (event.target as HTMLElement).closest(".upload-drop");
    if (zone && !zone.contains(event.relatedTarget as Node | null)) zone.classList.remove("is-dragging");
  });
  app.addEventListener("drop", (event) => {
    const zone = (event.target as HTMLElement).closest(".upload-drop");
    if (!zone || !event.dataTransfer?.files.length) return;
    event.preventDefault();
    zone.classList.remove("is-dragging");
    stageFiles(event.dataTransfer.files);
  });

  app.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
    if (!button || busy) return;
    const { action, id } = button.dataset;
    if (action === "slug-title") {
      const slug = shareSlugFromTitle(data.album.title);
      if (!slug) { notice(ui("slugTitleEmpty"), true); return; }
      data.album.shareSlug = slug;
      const field = app.querySelector<HTMLInputElement>("#share-slug")!;
      field.value = slug;
      markDirty();
      updateLinkPreview();
      field.focus();
    }
    if (action === "save") void run(async () => { await save(); notice(ui("draftSaved")); });
    if (action === "preview") void run(async () => { await save(); busy = false; location.assign(`/preview/${data.shareId}`); });
    if (action === "publish") void run(async () => {
      await save();
      data = await postJSON<ManageData>(`${endpoint}/publish`, { revision: data.revision });
      normalize();
      notice(ui("albumPublished"));
    });
    if (action === "logout") void run(async () => { await save(); await postJSON("/api/manage/logout", {}); busy = false; location.reload(); });
    if (action === "upload") {
      const queued = uploads.filter((item) => item.state === "queued");
      if (queued.length) void run(() => upload(queued));
    }
    if (action === "retry") {
      const item = uploads.find((item) => item.id === id && item.state === "failed");
      if (item) void run(() => upload([item]));
    }
    if (action === "discard-upload") {
      uploads = uploads.filter((item) => item.id !== id);
      render();
      app.querySelector<HTMLInputElement>('[name="files"]')?.focus({ preventScroll: true });
    }
    if (action === "copy") {
      const field = app.querySelector<HTMLInputElement>(".share-field input")!;
      const selectLink = () => {
        field.select();
        notice(ui("copySelected"));
      };
      if (navigator.clipboard) void navigator.clipboard.writeText(field.value).then(() => notice(ui("linkCopied")), selectLink);
      else selectLink();
    }
    if (id && (action === "remove" || action === "up" || action === "down")) {
      const match = photoLocation(id);
      if (!match) return;
      const { roll, index, photo } = match;
      if (action === "remove" && !confirm(t("removePhotoConfirm"))) return;
      roll.photos.splice(index, 1);
      if (action !== "remove") roll.photos.splice(index + (action === "up" ? -1 : 1), 0, photo);
      markDirty();
      render();
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (dirty || busy || uploads.some(item => item.state !== "uploaded")) event.preventDefault();
  });
  render();
  if (location.hash === "#upload") document.getElementById("upload")?.scrollIntoView();
}
