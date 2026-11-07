// All durations are milliseconds. Material and responsive dimensions live in envelope.css.
export type SealMotif = "rose" | "branch";

export const envelopeDesign = {
  motif: "rose" as SealMotif,
  seals: {
    rose: { src: "/assets/envelope-wax-rose.webp" },
    branch: { src: "/assets/envelope-wax-branch.webp" },
  },
  botanicals: { src: "/assets/envelope-botanicals.webp" },
};

export const envelopeMotion = {
  sealRelease: 460,
  flapOpening: 820,
  letterEmerging: 900,
  transition: 620,
  reducedFeedback: 120,
  easing: "cubic-bezier(.45,0,.22,1)",
};
