import { uiAttr } from "./ui-language.js";
import { envelopeDesign } from "./envelope-config.js";

// The seal and pressed specimen are independent photographic alpha assets.
// Only this assembly peels up; its silhouette shadows stay on the paper below.
function waxSeal(open: boolean) {
  const seal = envelopeDesign.seals[envelopeDesign.motif];
  return `<div class="botanical-paper-shadow" aria-hidden="true">
      <span class="botanical-cast botanical-cast--near"></span>
      <span class="botanical-cast botanical-cast--far"></span>
    </div>
    <div class="seal-assembly">
      <img class="envelope-botanicals" src="${envelopeDesign.botanicals.src}" width="768" height="768" alt="" aria-hidden="true" decoding="sync">
      <button type="button" class="wax-seal" data-action="unseal"
        ${uiAttr("openEnvelope")}${open ? " disabled tabindex=\"-1\" aria-hidden=\"true\"" : ""}>
        <img class="wax-surface" src="${seal.src}" width="512" height="512" alt="" decoding="sync" fetchpriority="high" draggable="false">
      </button>
    </div>`;
}

export function envelopeObject(open: boolean, letterPreview: string) {
  return `<div class="envelope" data-envelope-state="${open ? "completed" : "sealed"}">
    <div class="envelope-back" aria-hidden="true"></div>
    <div class="envelope-mouth" aria-hidden="true"></div>
    ${open ? "" : `<div class="envelope-letter-slot" aria-hidden="true">
      <div class="envelope-insert"><span class="letter-index">FILM FOR US <span>1 / 1</span></span>
        ${letterPreview}</div>
    </div>`}
    <div class="envelope-side envelope-side--left" aria-hidden="true"></div>
    <div class="envelope-side envelope-side--right" aria-hidden="true"></div>
    <div class="envelope-pocket" aria-hidden="true">
      <svg class="envelope-fold-edges" viewBox="0 0 470 285" preserveAspectRatio="none" focusable="false">
        <path d="M0 280 216 143 235 137 254 143 470 280" fill="none" stroke="#a58d72" stroke-opacity=".54" stroke-width="1"/>
        <path d="M0 281 216 144 235 138 254 144 470 281" fill="none" stroke="#fff2d9" stroke-opacity=".68" stroke-width="1"/>
      </svg>
    </div>
    <div class="envelope-writing" aria-hidden="true">
      <span class="envelope-brand">Film <i>for us</i></span>
    </div>
    <div class="envelope-flap-shadow" aria-hidden="true"></div>
    <div class="envelope-hinge">
      <div class="envelope-flap-face envelope-flap-face--front" aria-hidden="true"><span class="stamp">PERSONAL</span></div>
      <div class="envelope-flap-face envelope-flap-face--back" aria-hidden="true"></div>
      ${waxSeal(open)}
    </div>
    <div class="envelope-crease" aria-hidden="true"></div>
  </div>`;
}
