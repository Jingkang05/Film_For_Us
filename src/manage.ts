import { ui, uiAttr, setUIText, errorKey, t, refreshUI } from "./ui-language.js";
import { api, app, escapeHTML as esc, icon, postJSON, RequestError, showMessage,
  type ManageData, type Roll } from "./common.js";
import { setChineseTypography } from "./typography.js";

type Upload = {
  id: string;
  file: File;
  roll?: string;
  state: "queued" | "uploading" | "uploaded" | "failed";
  status: string;
};

const photoCount = (total: number) => ui(total === 1 ? "onePhoto" : "photoCount", { count: total });
const maxPhotoBytes = 20 * 1024 * 1024;

export async function mountManage() {
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = "/manage.css";
  document.head.append(css);
  document.title = "Album editor · Film for us";
  try {
    editor(await api<ManageData>("/api/manage"));
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
      editor(await postJSON<ManageData>(setup ? "/api/manage/setup" : "/api/manage/login", { password }));
    } catch (error) {
      setUIText(form.querySelector(".owner-feedback")!, errorKey((error as Error).message));
      button.disabled = false;
    }
  });
}

function editor(initial: ManageData) {
  let data = initial;
  let busy = false;
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
    const share = `${location.origin}/a/${data.shareId}`;
    const published = data.publishedRevision !== null;
    app.innerHTML = `<section class="owner">
      <header class="owner-heading"><div><a href="/demo" class="owner-brand">Film <i>for us</i></a><h1>${ui("albumEditor")}</h1></div>
        <button class="text-button" data-action="logout" type="button">${ui("signOut")}</button></header>
      <div class="owner-toolbar">
        <p id="revision-status">${dirty ? ui("unsaved") : ui("draftVersion", { version: data.revision })} · ${published ? ui("publishedVersion", { version: data.publishedRevision! }) : ui("unpublished")}</p>
        <div><a class="text-button" href="#upload">${ui("uploadPhotos")}</a>
          <button type="button" class="text-button" data-action="preview">${ui("previewDraft")} ${icon("right")}</button>
          <button type="button" class="action" data-action="save">${ui("saveDraft")}</button>
          <button type="button" class="action action--publish" data-action="publish">${ui("publish")}</button></div>
        <p id="owner-status" class="owner-feedback ${messageError ? "owner-feedback--error" : ""}" role="status">${feedback}</p>
        ${published ? `<div class="share-field"><label>${ui("shareLink")}<input readonly value="${esc(share)}"></label><button type="button" class="action" data-action="copy">${ui("copyLink")}</button></div>` : ""}
      </div>
      <section class="owner-section"><h2>${ui("openingLetter")}</h2>
        <label>${ui("albumTitle")}<input name="title" value="${esc(data.album.title)}" maxlength="80"></label>
        <label>${ui("yourLetter")}<textarea name="letter" dir="auto" rows="6" maxlength="2000" ${uiAttr("letterPlaceholder", {}, "placeholder")}>${esc(data.album.letter)}</textarea></label>
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
    if (busy) lockControls();
  }

  function lockControls() {
    app.querySelectorAll<HTMLInputElement>("input, textarea, select, button").forEach((field) => { field.disabled = true; });
  }

  function markDirty() {
    dirty = true;
    setUIText(app.querySelector("#revision-status")!, "unsaved");
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
    else if (input.name === "roll-name" || input.name === "roll-color") {
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
    data = await postJSON<ManageData>("/api/manage/save", { revision: data.revision, album: data.album });
    dirty = false;
  }

  async function run(work: () => Promise<void>) {
    if (busy) return;
    busy = true;
    lockControls();
    try { await work(); }
    catch (error) { notice(ui(errorKey((error as Error).message)), true); }
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
      try {
        if (item.file.size > maxPhotoBytes) throw new Error("The file exceeds the size limit.");
        if (data.directUpload) {
          const { url } = await api<{ url?: string }>(`/api/manage/upload-target?${query}`, { method: "POST" });
          if (url) {
            const result = await fetch(url, {
              method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: item.file,
            }).catch(() => null);
            if (!result?.ok) throw new Error("The photo could not be uploaded. Check your connection and try again.");
          }
        }
        data = await api<ManageData>(`/api/manage/upload?${query}`, {
          method: "POST", body: data.directUpload ? undefined : item.file,
        });
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
    if (action === "save") void run(async () => { await save(); notice(ui("draftSaved")); });
    if (action === "preview") void run(async () => { await save(); location.assign("/manage/preview"); });
    if (action === "publish") void run(async () => {
      await save();
      data = await postJSON<ManageData>("/api/manage/publish", { revision: data.revision });
      notice(ui("albumPublished"));
    });
    if (action === "logout") void run(async () => { await save(); await postJSON("/api/manage/logout", {}); location.reload(); });
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
    if (dirty) event.preventDefault();
  });
  render();
  if (location.hash === "#upload") document.getElementById("upload")?.scrollIntoView();
}
