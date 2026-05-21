import { NextResponse } from "next/server";

import { customerInfoConfigReady } from "@/lib/customer-info-config";
import {
  fetchPowerConModelsForManufacturer,
  mergeCatalogModelOptions,
} from "@/lib/product-catalog-models";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const cfg = customerInfoConfigReady();
  if (!cfg.ok) {
    return NextResponse.json(
      { error: cfg.error, disabled: true },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const manufacturer = url.searchParams.get("manufacturer")?.trim() ?? "";
  const keep1 = url.searchParams.get("keep1")?.trim() ?? "";
  const keep2 = url.searchParams.get("keep2")?.trim() ?? "";

  if (!manufacturer) {
    return NextResponse.json({ options: [], configured: false });
  }

  try {
    const options = await fetchPowerConModelsForManufacturer(manufacturer);
    if (options === null) {
      return NextResponse.json({
        options: [],
        configured: false,
      });
    }
    return NextResponse.json({
      options: mergeCatalogModelOptions(options, [keep1, keep2]),
      configured: true,
    });
  } catch (e) {
    console.error("[api/customer-info/power-con-models]", e);
    return NextResponse.json(
      { error: "パワコン品番一覧の取得に失敗しました" },
      { status: 502 },
    );
  }
}
