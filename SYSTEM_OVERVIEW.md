# 情報確認くん — システム概要（Claude 共有用）

LINE LIFF 上で動く社内業務ハブ。スタッフが LINE ログインし、@pocket（AtPocket）上の複数アプリと連携して工事予定・お客様情報・営業成績・勤怠・掲示板などを扱う。

このファイルは機能・構成・重要な挙動の要約です。実装の詳細は `src/` を参照してください。

---

## 技術スタック

| 領域 | 内容 |
|------|------|
| フレームワーク | Next.js 16（App Router）+ React 19 + TypeScript + Tailwind CSS 4 |
| クライアント | `@line/liff`、SWR、`next-themes` |
| ホスティング | Netlify（`@netlify/plugin-nextjs`、Node 20） |
| 認証 | LINE Login ID トークン（Bearer）をサーバで検証 → `sub`＝LINE userId → スタッフ名簿と紐づけ |
| データ | AtPocket（`ATPOCKET_DOMAIN` + 用途別アプリ ID / API キー） |

**注意:** このリポジトリの Next.js は学習データ上の慣習と異なる場合がある。`node_modules/next/dist/docs/` と `AGENTS.md` を優先すること。

---

## 画面一覧（`src/app`）

| パス | 用途 |
|------|------|
| `/` | ホーム（メニュー・おみくじ・掲示板サマリ・工事担当案件・入力続きショートカット） |
| `/calendar` | 工事カレンダー（月表示・空き枠入力・未定案件割当） |
| `/customer-info` | お客様情報の検索・編集フォーム |
| `/customer-list` | 担当顧客 CRM 一覧（書類不足・工事日未定・補助金などのフィルタ） |
| `/customer-list/[id]` | 顧客詳細 |
| `/sales-dashboard` | 営業ダッシュボード（獲得 PT・ランキング・明細） |
| `/attendance` | 勤怠打刻＋月カレンダー |
| `/work-end-report` | 稼働終了報告 |
| `/bulletin` | 社内掲示板 |
| `/internal-events` | 社内イベント一覧 |
| `/internal-events/[slug]` | 社内イベント各セクション |
| `/meeting-schedule` | 面談予定一覧・更新 |
| `/apo-acquisition` | APO 獲得フォーム |

---

## 主要機能

### 1. LIFF / LINE 認証・スタッフ紐づけ

- クライアント: `initLiffAndGetToken(NEXT_PUBLIC_LIFF_ID)` で ID トークン取得。
- API: `Authorization: Bearer <idToken>` → `resolveCallerLineAuth`（`src/lib/request-auth.ts`）。
- 検証: `verifyLineIdTokenCached`（`src/lib/line-verify.ts`）。同一トークンを短時間キャッシュ（既定 45 秒、`LINE_VERIFY_CACHE_SECONDS`、0 で無効）。成功結果のみキャッシュ。
- スタッフ名簿の LINE 欄と照合。未紐づけ時は bind UI（`/api/staff/bind`）。
- 任意で PIN ロック（`/api/staff/pin/*`）。

### 2. 工事カレンダー

**データ:** `CALENDAR_APP_ID` の工事アプリ（＋報告アプリ等）。月次ペイロードはサーバキャッシュあり。

| 操作 | API | 挙動 |
|------|-----|------|
| 月表示 | `GET /api/calendar` | 空き枠・案件・祝日などを返す |
| 空き枠に新規入力 | `POST /api/calendar/fill-empty-slot` | 空き枠レコードに顧客名・住宅ステータス等を書く。**既存枠の T番号を維持**。枠は削除しない |
| 工事日未定などの新規登録 | `POST /api/calendar/create-record` | 工事アプリに新規作成 → @pocket 自動採番の T番号を取得 → お客様情報へ連携。空き枠は削除しない |
| 未定案件を空き枠へ割当 | `POST /api/calendar/assign-case-to-slot` | 案件に施工予定日を書き込み、**その空き枠レコードを削除**（空き枠削除はこの経路のみ） |
| 割当前確認 | `GET /api/calendar/verify-empty-slot` | 枠がまだ空か確認 |
| 未定案件一覧 | `GET /api/calendar/undated-construction-cases` | AP/CL 担当の工事日未定案件（担当顧客一覧と同系統の条件） |

その他: 工事対応者更新、施工会社候補、自分の工事担当案件一覧。

**重要:** 「同日の別空き枠を消す」処理は廃止済み。削除は未定案件割当時の対象枠のみ。

### 3. お客様情報入力 / CRM

- `/customer-info`: 検索・編集（氏名分割、AP/CL、施工会社、機器カタログ、PT 振替など）。
- 工事登録後: `syncConstructionRecordToCustomerInfoApp` で T番号キー連携。
- **T番号:** 画面で新規採番しない。工事アプリの値（自動採番 or 空き枠既存値）を `CUSTOMER_INFO_CONSTRUCTION_UNIQUE_KEY_FIELD_ID` にコピー／更新時は既存値を取込キーとして再送。
- `/customer-list`: 担当顧客一覧（書類不足・工事日未定・補助金・キャンセル等）。
- 製品カタログ・クレジット会社・AP/CL 候補などの補助 API あり。

### 4. 営業ダッシュボード

- `GET /api/sales-dashboard`: 期間別 KPI、総合 PT ランキング、APO／天下賞など。
- PT 明細: PT アプリの登録番号 ↔ お客様情報の APPT/CLPT 登録番号で突合。お客様名・AP担当者・CL担当者・契約日を表示。
- 獲得総 PT は売上 PT のみ（アポ件数は加算しない）。
- コア集計はサーバキャッシュし、呼び出しユーザ向けに personalize。

### 5. その他ドメイン

| 機能 | 概要 |
|------|------|
| 掲示板 | AtPocket 掲示板＋閲覧記録。ホームにサマリ表示 |
| 勤怠 | 出勤/退勤打刻、月カレンダー |
| 稼働終了報告 | 日次の稼働終了報告登録 |
| 社内イベント | 朝礼・連絡先・組織図など静的/API セクション |
| 面談予定 | 一覧・ステータス/日程更新 |
| APO 獲得 | フォーム定義取得＋レコード登録 |
| ホームおみくじ | 役割別のビジネスフォーチュン文言 |

---

## API ルート一覧（`src/app/api`）

### Calendar
- `GET /api/calendar`
- `POST /api/calendar/fill-empty-slot`
- `POST /api/calendar/create-record`
- `POST /api/calendar/assign-case-to-slot`
- `GET /api/calendar/verify-empty-slot`
- `GET /api/calendar/undated-construction-cases`
- `GET /api/calendar/my-construction-cases`
- `GET /api/calendar/construction-handler-staff`
- `POST /api/calendar/update-construction-handler`
- `GET /api/calendar/construction-contractors`

### Customer info / CRM
- `GET|PUT /api/customer-info/records/[recordId]`
- `GET /api/customer-info/search`
- `GET /api/customer-info/pending-records`
- `GET /api/customer-info/continue-shortcut`
- `GET /api/customer-info/ap-cl-staff`
- `GET /api/customer-info/construction-contractors`
- `GET /api/customer-info/panel-models`
- `GET /api/customer-info/power-con-models`
- `GET /api/customer-info/battery-capacity-options`
- `GET /api/customer-info/credit-companies`
- `GET /api/customers`
- `GET /api/customers/[recordId]`

### Sales / Bulletin / Staff / Attendance / その他
- `GET /api/sales-dashboard`
- `GET|POST /api/bulletin`
- `GET /api/staff` / `POST /api/staff/bind` / `GET|POST /api/staff/pin/*`
- `GET /api/attendance` / `POST /api/attendance/punch` / `GET /api/attendance/calendar`
- `GET|POST /api/work-end-report`
- `GET /api/meeting-schedule` / `PATCH .../status` / `PATCH .../schedule`
- `GET /api/apo-acquisition/form` / `POST /api/apo-acquisition/records`
- `GET /api/internal-events/contacts` / `.../vcard`

---

## 共有ライブラリのパターン（`src/lib`）

| モジュール | 役割 |
|------------|------|
| `request-auth.ts` | Bearer → LINE 検証 → `lineUserId` / 401 |
| `line-verify.ts` | LINE verify API ＋短 TTL キャッシュ |
| `atpocket.ts` | fields / list / get / create / update / delete |
| `atpocket-write-with-import-key.ts` | 取込キー（T番号）付き書き込み |
| `sync-construction-to-customer-info.ts` | 工事 → お客様情報連携 |
| `calendar-*-cache` / `sales-dashboard-response-cache` / `staff-roster-cache` 等 | ドメイン別 TTL キャッシュ |
| `liff-session` / `liff-swr` / `liff-chrome` | クライアント共通 UI・セッション切れ |

**キャッシュ方針の区別**
- **認証結果**（LINE verify）: 短時間キャッシュ可。
- **@pocket の業務データ**: 画面ごとに既存キャッシュ方針あり。認証キャッシュはデータをキャッシュしない。

---

## 環境変数カテゴリ（名前のみ・秘密は書かない）

- **公開:** `NEXT_PUBLIC_LIFF_ID`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_HOME_WEATHER_*`
- **LINE:** `LINE_LOGIN_CHANNEL_ID`, `LINE_VERIFY_CACHE_SECONDS`
- **AtPocket 共通:** `ATPOCKET_DOMAIN`, `ATPOCKET_AUTH_HEADER`
- **工事カレンダー:** `CALENDAR_APP_ID`, `CALENDAR_*_FIELD_ID`, `CALENDAR_*_ATPOCKET_API_KEY*`, `CALENDAR_EMPTY_FILL_*`, `CALENDAR_*_CACHE_*`
- **お客様情報 / CRM:** `CUSTOMER_INFO_*`, `CUSTOMER_CRM_*`
- **営業ダッシュボード:** `SALES_DASHBOARD_*`
- **スタッフ / PIN:** `STAFF_*`
- **掲示板:** `BULLETIN_*`, `BULLETIN_VIEWS_*`
- **勤怠 / 稼働終了:** `ATTENDANCE_*`, `WORK_END_REPORT_*`
- **面談 / APO:** `MEETING_SCHEDULE_*`, `APO_ACQUISITION_*`
- **その他:** `PRODUCT_CATALOG_*`, `TRADING_PARTNER_*`

---

## ディレクトリの目安

```
src/app/           … 画面・API ルート
src/components/    … UI（カレンダー月表示、ダッシュボード、フォーム等）
src/lib/           … AtPocket・認証・ドメインロジック・キャッシュ
src/hooks/         … クライアントフック
```

---

## Claude 向け作業メモ

1. **認証を壊さない:** 401・セッション期限切れ（`LINE_SESSION_EXPIRED`）の挙動を維持。
2. **空き枠削除は割当のみ:** 新規登録・空き枠入力・お客様情報更新では枠を消さない。
3. **T番号は工事由来:** LIFF で勝手に新規採番フォーマットを作らない。
4. **取込キー書き込み:** カレンダー系の更新は `writePocketRecordWithImportKey` 経由を優先。
5. **日付表示:** UI は `formatDisplayYmd`（`yyyy/mm/dd`）。内部キーは `YYYY-MM-DD`。
6. **変更範囲は最小:** 依頼と無関係なリファクタや別機能の巻き込みを避ける。
7. **秘密情報:** `.env` / API キーをコミットしない。
8. **コミット/プッシュ:** ユーザーが明示したときのみ。

---

## 代表的なデータ連携フロー

```
[LINE LIFF]
    │ Bearer ID Token
    ▼
[Next.js API] ── verifyLineIdTokenCached ──► LINE verify API
    │
    ├─ スタッフ名簿 bind（LINE userId ↔ 氏名）
    │
    ├─ 工事カレンダーアプリ (@pocket)
    │     ├─ 空き枠入力 / 新規 / 未定案件割当
    │     └─ T番号（自動採番 or 既存）
    │            │
    │            ▼
    └─ お客様情報アプリ (@pocket)  … T番号をキーに同期・更新
            │
            ▼
      営業ダッシュボード … PT / 契約 / APO 等を集計表示
```
