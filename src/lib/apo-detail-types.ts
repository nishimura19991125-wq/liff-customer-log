export type ApoDetailItem = {
  /** 項目名（「AP担当者」など） */
  label: string;
  /** @pocket の値。空欄でも行は残すので空文字が入る */
  value: string;
};

export type ApoDetailGroupView = {
  title: string;
  items: ApoDetailItem[];
};

export type ApoDetailPayload = {
  configured: boolean;
  recordId: string;
  /** 見出しに出すお客様名。11項目には含まれないが、どの案件か示すために持つ */
  customerName: string;
  groups: ApoDetailGroupView[];
  error?: string;
};
