import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "アポ情報",
};

export default function ApoDetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
