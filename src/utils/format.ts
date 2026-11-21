export function fmtNum(n: unknown, lang: string): string {
  const locale = lang === "en" ? "en-US" : "ru-RU";
  return Math.round(Number(n || 0)).toLocaleString(locale);
}

export function fmtRub(n: unknown, lang: string): string {
  return `${fmtNum(n, lang)} ₽`;
}

export function escHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const GUIDE_BOOK_SVG = `<svg class="guide-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`;
