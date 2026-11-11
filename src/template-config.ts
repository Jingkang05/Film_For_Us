import { instantCopy } from "./polaroid-config.js";
import { envelopeDesign } from "./envelope-config.js";

// Presentation defaults, not memory content. Return fresh objects for each album.
export function templateDefaults() {
  return {
    ending: { instantCaption: instantCopy.footer },
    settings: {
      sealMotif: envelopeDesign.motif,
      music: { title: "Who Knows by Daniel Caesar", src: "/assets/who-knows.m4a?v=2" },
    },
  };
}
