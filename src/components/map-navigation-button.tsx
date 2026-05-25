"use client";

import {
  buildMapNavigation,
  type MapNavigationInput,
} from "@/lib/map-navigation";

type MapNavigationButtonProps = MapNavigationInput & {
  className?: string;
  onNavigateClick?: () => void;
};

export function MapNavigationButton({
  pinpointAddress,
  normalAddress,
  className = "",
  onNavigateClick,
}: MapNavigationButtonProps) {
  const nav = buildMapNavigation({ pinpointAddress, normalAddress });
  if (!nav) return null;

  return (
    <a
      href={nav.mapUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        e.stopPropagation();
        onNavigateClick?.();
      }}
      className={`inline-flex w-full items-center justify-center rounded-lg bg-blue-600 p-3 text-[15px] font-bold text-white shadow-md transition active:scale-[0.98] active:bg-blue-700 ${className}`}
    >
      {nav.label}
    </a>
  );
}
