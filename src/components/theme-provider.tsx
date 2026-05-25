"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

const STORAGE_KEY = "liff-app-theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      storageKey={STORAGE_KEY}
      disableTransitionOnChange={false}
    >
      {children}
    </NextThemesProvider>
  );
}
