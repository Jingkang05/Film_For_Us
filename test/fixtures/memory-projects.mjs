import { demo } from "../../server/demo.mjs";
export const albumA = structuredClone(demo);
// Synthetic local-only data. No personal uploads or cloud storage writes.
export const albumB = {
  schemaVersion: 1, templateId: "film-darkroom-v1", id: "fixture-memory-b", title: "A letter from Mira to Rowan",
  envelope: { message: "Dear Rowan,\n\nHere are the quiet moments from our autumn walks.\n\nWith love,\nMira" },
  rolls: [
    { id: "b-walks", name: "Autumn walks", color: "#cfad77", presentation: "strip", photos: [photo("b-rain", "rain-2", "Two seats, one afternoon.")] },
    { id: "b-tides", name: "Quiet tides", color: "#b84a32", presentation: "viewer", photos: [photo("b-sea", "sea-2", "The tide came in.")] },
    { id: "b-home", name: "Coming home", color: "#555e43", presentation: "instant", photos: [photo("b-home-photo", "home-2", "The lights were waiting.")] },
  ],
  ending: { instantCaption: "Until our next walk. — Mira" },
  settings: { sealMotif: "rose", music: { title: "Who Knows by Daniel Caesar", src: "/assets/who-knows.m4a?v=2" } },
};
function photo(id, asset, note) { return { id, date: "2026-10-01", note, thumb: `/samples/${asset}-thumb.webp`, full: `/samples/${asset}.webp` }; }
