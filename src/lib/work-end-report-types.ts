export type WorkEndAvailabilityField = {
  key: "general" | "ap" | "cl" | "construction";
  label: string;
  fieldId: string;
  currentValue: string;
  isActive: boolean;
};

export type WorkEndReportStatus = {
  configured: boolean;
  configError?: string;
  needsStaffBind?: boolean;
  staffName?: string;
  activeLabel: string;
  inactiveLabel: string;
  fields: WorkEndAvailabilityField[];
  canReport: boolean;
  reported?: boolean;
  updatedFields?: string[];
};
