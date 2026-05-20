/** カンマ付き整数入力（PT・金額・枚数など共通） */
export {
  formatPtWithCommas as formatCommaInteger,
  parsePtDigitsOnly as parseCommaIntegerDigits,
  ptValueForPocketTransfer as commaIntegerForPocket,
} from "@/lib/customer-info-form/pt-transfer";
