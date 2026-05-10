import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "顧客対応ログ入力",
};

export default function LogLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
