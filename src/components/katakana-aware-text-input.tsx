"use client";

import { filterKatakanaInput } from "@/lib/customer-info-form/katakana-input";
import { useEffect, useRef, useState, type ComponentProps } from "react";

type KatakanaAwareTextInputProps = Omit<
  ComponentProps<"input">,
  "value" | "onChange"
> & {
  value: string;
  onChange: (next: string) => void;
  katakanaOnly?: boolean;
};

export function KatakanaAwareTextInput({
  value,
  onChange,
  katakanaOnly = false,
  ...props
}: KatakanaAwareTextInputProps) {
  const [display, setDisplay] = useState(value);
  const composingRef = useRef(false);

  useEffect(() => {
    if (!composingRef.current) {
      setDisplay(value);
    }
  }, [value]);

  if (!katakanaOnly) {
    return (
      <input
        {...props}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  const commit = (raw: string) => {
    const filtered = filterKatakanaInput(raw);
    setDisplay(filtered);
    onChange(filtered);
  };

  return (
    <input
      {...props}
      value={display}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={(e) => {
        composingRef.current = false;
        commit(e.currentTarget.value);
      }}
      onChange={(e) => {
        const next = e.target.value;
        setDisplay(next);
        if (composingRef.current) return;
        commit(next);
      }}
    />
  );
}
