import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "お客様情報入力",
};

export default function CustomerInfoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
