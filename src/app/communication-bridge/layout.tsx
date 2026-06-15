import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "コミュニケーションブリッジ",
};

export default function CommunicationBridgeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
