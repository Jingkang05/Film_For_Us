import { templateDefaults } from "./template-config.js";

// Existing editor/API contract. Kept unchanged at the storage boundary.
export interface Photo { id: string; date: string; note: string; thumb: string; full: string }
export interface Roll { id: string; name: string; color: string; photos: Photo[] }
export interface Album { id: string; title: string; shareSlug?: string; letter: string; rolls: Roll[]; demo?: boolean; description?: string; createdAt?: string; updatedAt?: string; ending?: MemoryProject["ending"]; settings?: MemoryProject["settings"] }
export type RollPresentation = "strip" | "viewer" | "instant";
export interface MemoryRoll extends Roll { presentation: RollPresentation }
export interface MemoryProject {
  schemaVersion: 1;
  templateId: "film-darkroom-v1";
  id: string;
  title: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
  envelope: { message: string };
  rolls: MemoryRoll[];
  ending: { instantCaption: string };
  settings: { sealMotif: "rose" | "branch"; music: { title: string; src: string } };
  demo?: boolean;
}

const invalid = () => new Error("Invalid memory project data.");
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, nonempty = false): string {
  if (typeof value !== "string" || (nonempty && !value.trim())) throw invalid();
  return value;
}
function media(value: unknown): string {
  const url = text(value, true);
  // Current assets and private-image proxy URLs are relative; scripts and protocol-relative URLs are not media.
  if (!/^\/(?!\/)/.test(url) && !/^https?:\/\//i.test(url)) throw invalid();
  if (/[\u0000-\u0020\\]/.test(url)) throw invalid();
  return url;
}

/** Adapt legacy snapshots without changing their IDs, content, order or storage references. */
export function toMemoryProject(input: unknown): MemoryProject {
  const source = object(input);
  const modern = source.schemaVersion !== undefined || source.templateId !== undefined;
  if (modern && (source.schemaVersion !== 1 || source.templateId !== "film-darkroom-v1")) throw invalid();
  const defaults = templateDefaults();
  const roles: RollPresentation[] = ["strip", "viewer", "instant"];
  const photoIds = new Set<string>(), rollIds = new Set<string>();
  if (!Array.isArray(source.rolls) || source.rolls.length !== roles.length) throw invalid();
  const rolls = source.rolls.map((value, index): MemoryRoll => {
    const roll = object(value), id = text(roll.id, true);
    if (rollIds.has(id) || (modern && roll.presentation !== roles[index])) throw invalid();
    rollIds.add(id);
    const color = text(roll.color);
    if (!/^#[a-f0-9]{6}$/i.test(color) || !Array.isArray(roll.photos)) throw invalid();
    return { id, name: text(roll.name), color, presentation: roles[index], photos: roll.photos.map(value => {
      const photo = object(value), id = text(photo.id, true);
      if (photoIds.has(id)) throw invalid();
      photoIds.add(id);
      return { id, date: text(photo.date ?? ""), note: text(photo.note ?? ""), thumb: media(photo.thumb), full: media(photo.full) };
    }) };
  });
  const settings = modern || source.settings !== undefined ? object(source.settings) : defaults.settings;
  const music = object(settings.music);
  if (settings.sealMotif !== "rose" && settings.sealMotif !== "branch") throw invalid();
  const project: MemoryProject = {
    schemaVersion: 1, templateId: "film-darkroom-v1", id: text(source.id, true), title: text(source.title),
    envelope: { message: text(modern ? object(source.envelope).message : source.letter) }, rolls,
    ending: { instantCaption: text(modern || source.ending !== undefined ? object(source.ending).instantCaption : defaults.ending.instantCaption) },
    settings: { sealMotif: settings.sealMotif, music: { title: text(music.title), src: media(music.src) } },
  };
  if (source.demo !== undefined) {
    if (typeof source.demo !== "boolean") throw invalid();
    project.demo = source.demo;
  }
  for (const key of ["description", "createdAt", "updatedAt"] as const) {
    if (source[key] === undefined) continue;
    const value = text(source[key]);
    if (key !== "description" && !/^\d{4}-\d{2}-\d{2}T/.test(value)) throw invalid();
    if (key !== "description" && !Number.isFinite(Date.parse(value))) throw invalid();
    project[key] = value;
  }
  return project;
}

/** The editor and server keep the legacy letter/share contract while serializing the shared model. */
export function serializeMemoryProject(project: MemoryProject, shareSlug = ""): Album {
  const validated = toMemoryProject(project);
  return {
    id: validated.id, title: validated.title, shareSlug, letter: validated.envelope.message,
    rolls: validated.rolls.map(({ presentation, ...roll }) => roll),
    ...(validated.description !== undefined ? { description: validated.description } : {}),
    ...(validated.createdAt !== undefined ? { createdAt: validated.createdAt } : {}),
    ...(validated.updatedAt !== undefined ? { updatedAt: validated.updatedAt } : {}),
    ending: validated.ending, settings: validated.settings,
  };
}
