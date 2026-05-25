import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { LiffPinGuard } from "@/components/liff-pin-guard";
import { LiffScrollReset } from "@/components/liff-scroll-reset";
import { ThemeProvider } from "@/components/theme-provider";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();

export const metadata: Metadata = {
  ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
  title: { default: "情報確認くん", template: "%s | 情報確認くん" },
  description: "情報確認くん — 社内向けお客様情報・工事カレンダー（LIFF）",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full overflow-x-hidden antialiased transition-colors duration-300`}
    >
      <body className="flex min-h-dvh min-w-0 flex-col overflow-x-hidden bg-slate-50 font-sans text-slate-800 antialiased transition-all duration-300 dark:bg-slate-900 dark:text-white">
        <ThemeProvider>
          <LiffScrollReset />
          <LiffPinGuard>{children}</LiffPinGuard>
        </ThemeProvider>
      </body>
    </html>
  );
}
