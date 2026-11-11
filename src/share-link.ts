export const normalizeShareSlug = (value: string) => value.normalize("NFKC").trim().toLowerCase();

export function validShareSlug(value: string) {
  const slug = normalizeShareSlug(value);
  return slug.length <= 80 && (!slug || /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/.test(slug));
}

export function shareSlugFromTitle(title: string) {
  return normalizeShareSlug(title).normalize("NFKD").replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-").slice(0, 80).replace(/^-+|-+$/g, "");
}
