import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { APPEARANCE_KEY, applyAppearance, readAppearance, type Appearance } from "@/lib/appearance";
const AppearanceContext = createContext<{ appearance: Appearance; setAppearance: (value: Appearance) => void }>({ appearance: "system", setAppearance: () => {} });
export const useAppearance = () => useContext(AppearanceContext);
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, update] = useState<Appearance>("system");
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    let selected = readAppearance({ getItem: key => window.localStorage.getItem(key) });
    const sync = () => { update(selected); applyAppearance(selected, media.matches); };
    const systemChange = () => { if (selected === "system") sync(); };
    const selectionChange = () => { selected = readAppearance({ getItem: key => window.localStorage.getItem(key) }); sync(); };
    const storageChange = (event: StorageEvent) => { if (event.key === APPEARANCE_KEY || event.key === null) selectionChange(); };
    sync(); media.addEventListener("change", systemChange);
    window.addEventListener("appearance-change", selectionChange); window.addEventListener("storage", storageChange);
    return () => { media.removeEventListener("change", systemChange); window.removeEventListener("appearance-change", selectionChange); window.removeEventListener("storage", storageChange); };
  }, []);
  const setAppearance = (value: Appearance) => {
    // Fail visibly rather than claim a preference persisted when storage refused it.
    localStorage.setItem(APPEARANCE_KEY, value);
    window.dispatchEvent(new Event("appearance-change"));
  };
  return <AppearanceContext.Provider value={{ appearance, setAppearance }}>{children}</AppearanceContext.Provider>;
}