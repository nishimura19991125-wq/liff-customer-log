import { parseAtPocketFileField } from "@/lib/at-pocket-file-field";
import { parsePhoneDigits } from "@/lib/customer-info-form/phone-number";
import { pocketTableCellToPlainString } from "@/lib/staff-construction-availability";

export type PocketContactFieldParsed = {
  phone: string;
  /** @pocket の連絡先列に vCard 等の添付がある */
  hasAttachment: boolean;
};

function coerceContactDisplayString(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number" || typeof raw === "boolean") {
    return String(raw).trim();
  }
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const v = coerceContactDisplayString(item);
      if (v) return v;
    }
    return "";
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (const k of [
      "value",
      "displayValue",
      "label",
      "text",
      "tel",
      "phone",
      "number",
      "caption",
    ]) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "number" || typeof v === "boolean") {
        return String(v).trim();
      }
    }
  }
  return pocketTableCellToPlainString(raw);
}

function decodeVcardTextFromBase64(base64: string): string {
  try {
    return Buffer.from(base64.trim(), "base64").toString("utf8");
  } catch {
    return "";
  }
}

/** vCard 本文から最初の TEL を抽出 */
export function telFromVcardText(text: string): string {
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  for (const line of unfolded.split(/\r?\n/)) {
    const trimmed = line.trim();
    const m = /^TEL[^:]*:(.+)$/i.exec(trimmed);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return "";
}

function phoneFromVcardFiles(raw: unknown): {
  phone: string;
  hasAttachment: boolean;
} {
  const files = parseAtPocketFileField(raw);
  if (!files.length) return { phone: "", hasAttachment: false };

  for (const file of files) {
    const name = file.name.trim().toLowerCase();
    const isVcard =
      name.endsWith(".vcf") ||
      file.mimeType.trim().toLowerCase().includes("vcard");

    if (file.contentBase64?.trim()) {
      const text = decodeVcardTextFromBase64(file.contentBase64);
      const tel = telFromVcardText(text);
      if (tel) return { phone: tel, hasAttachment: true };
      if (isVcard || text.includes("BEGIN:VCARD")) {
        return { phone: "", hasAttachment: true };
      }
    }

    if (isVcard) return { phone: "", hasAttachment: true };
  }

  return { phone: "", hasAttachment: true };
}

function deepFindPhoneString(raw: unknown, depth = 0): string {
  if (depth > 6 || raw == null) return "";
  if (typeof raw === "string") {
    const t = raw.trim();
    return parsePhoneDigits(t) ? t : "";
  }
  if (typeof raw === "number" || typeof raw === "boolean") {
    const t = String(raw).trim();
    return parsePhoneDigits(t) ? t : "";
  }
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const found = deepFindPhoneString(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (const k of [
      "value",
      "displayValue",
      "label",
      "text",
      "tel",
      "phone",
      "number",
      "caption",
      "content",
      "連絡先",
      "電話番号",
      "電話",
      "携帯",
    ]) {
      const found = deepFindPhoneString(o[k], depth + 1);
      if (found) return found;
    }
    for (const value of Object.values(o)) {
      const found = deepFindPhoneString(value, depth + 1);
      if (found) return found;
    }
  }
  return "";
}

/** @pocket「連絡先」列（テキスト・オブジェクト・vCard 添付）を正規化 */
export function parsePocketContactField(raw: unknown): PocketContactFieldParsed {
  const fromFiles = phoneFromVcardFiles(raw);
  if (fromFiles.phone) return fromFiles;

  const deepPhone = deepFindPhoneString(raw);
  if (deepPhone) {
    return { phone: deepPhone, hasAttachment: fromFiles.hasAttachment };
  }

  if (fromFiles.hasAttachment) return fromFiles;

  const coerced = coerceContactDisplayString(raw);
  if (coerced && parsePhoneDigits(coerced)) {
    return { phone: coerced, hasAttachment: false };
  }

  return { phone: coerced, hasAttachment: fromFiles.hasAttachment };
}

function escapeVcardValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** 氏名・電話番号から vCard 3.0 を生成 */
export function buildStaffVcard(staffName: string, phone: string): string {
  const name = staffName.trim();
  const formattedPhone = phone.trim();
  const lines = ["BEGIN:VCARD", "VERSION:3.0"];
  if (name) {
    lines.push(`FN:${escapeVcardValue(name)}`);
    lines.push(`N:;${escapeVcardValue(name)};;;`);
  }
  if (formattedPhone) {
    lines.push(`TEL;TYPE=CELL:${escapeVcardValue(formattedPhone)}`);
  }
  lines.push("END:VCARD");
  return `${lines.join("\r\n")}\r\n`;
}

export function vcardFileName(staffName: string): string {
  const safe = staffName
    .trim()
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "_");
  return safe ? `${safe}.vcf` : "contact.vcf";
}
