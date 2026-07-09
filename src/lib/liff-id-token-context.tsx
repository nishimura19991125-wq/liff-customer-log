"use client";

import { createContext, useContext, type ReactNode } from "react";

const LiffIdTokenContext = createContext<string | null>(null);

export function LiffIdTokenProvider({
  idToken,
  children,
}: {
  idToken: string | null;
  children: ReactNode;
}) {
  return (
    <LiffIdTokenContext.Provider value={idToken}>
      {children}
    </LiffIdTokenContext.Provider>
  );
}

export function useLiffIdToken(): string | null {
  return useContext(LiffIdTokenContext);
}
