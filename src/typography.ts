// Font selection is global and character-based. These attributes only tune
// spacing and scale for Chinese content; they never alter the stored text.
export const hasChinese = (text: string) => /\p{Script=Han}/u.test(text);

export function chineseAttributes(text: string): string {
  return hasChinese(text) ? 'data-cjk="true" lang="zh"' : "";
}

export function setChineseTypography(element: HTMLElement, text: string) {
  const chinese = hasChinese(text);
  element.toggleAttribute("data-cjk", chinese);
  if (chinese) element.lang = "zh";
  else element.removeAttribute("lang");
}
