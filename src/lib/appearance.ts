export type Appearance = "light" | "dark" | "system";
export const APPEARANCE_KEY = "setarchitect:appearance";
export function readAppearance(storage: Pick<Storage, "getItem">): Appearance {
  try { const value = storage.getItem(APPEARANCE_KEY); return value === "light" || value === "dark" ? value : "system"; } catch { return "system"; }
}
export function resolveAppearance(value: Appearance, systemDark: boolean) {
  return value === "system" ? systemDark ? "dark" : "light" : value;
}
export function applyAppearance(value: Appearance, systemDark: boolean) {
  const theme = resolveAppearance(value, systemDark);
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.classList.toggle("light", theme === "light");
  document.documentElement.dataset.appearance = value;
  document.documentElement.style.colorScheme = theme;
}
// Runs before styles/content paint. CSS handles System even if storage is denied.
export const appearanceScript = `(()=>{let v='system';try{const s=localStorage.getItem('${APPEARANCE_KEY}');if(s==='light'||s==='dark')v=s}catch{}const d=v==='dark'||(v==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);const h=document.documentElement;h.classList.add(d?'dark':'light');h.dataset.appearance=v;h.style.colorScheme=d?'dark':'light'})()`;