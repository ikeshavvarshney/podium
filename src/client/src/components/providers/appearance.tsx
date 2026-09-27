"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type ThemeName = "light" | "dark";

const THEME_KEY = "podium.theme";

/** Runs before paint so a stored preference never flashes the default theme. */
export const appearanceScript = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t);}catch(e){}})();`;

interface AppearanceValue {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
}

const AppearanceContext = createContext<AppearanceValue>({
  theme: "light",
  setTheme: () => {},
});

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>("light");

  useEffect(() => {
    const root = document.documentElement;
    const storedTheme = root.getAttribute("data-theme");
    if (storedTheme === "dark" || storedTheme === "light") setThemeState(storedTheme);
  }, []);

  const setTheme = useCallback((next: ThemeName) => {
    setThemeState(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Private browsing can refuse storage; the choice simply does not persist.
    }
  }, []);

  return (
    <AppearanceContext.Provider value={{ theme, setTheme }}>
      {children}
    </AppearanceContext.Provider>
  );
}

export const useAppearance = () => useContext(AppearanceContext);
