/** Splits text so its last word can be set in italic (presentation only; the text is unchanged). */
export function splitLastWord(text: string): [string, string] {
  const i = text.trimEnd().lastIndexOf(' ');
  return i < 0 ? ['', text] : [text.slice(0, i + 1), text.slice(i + 1)];
}
