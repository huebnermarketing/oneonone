# Keka HR Integration (Leave & Public Holidays)

The app can use **Keka** to respect employee leave and office public holidays (US and India) when finding the next available meeting slot. If Keka is configured, the system will skip days when either the reporter or the employee is on leave or when the date is a public holiday for their office.

## Employee sync (who can use the app)

Keka is the source of truth for employees. Code: `lib/keka-employees.ts` (API client; strips every personal field on arrival), `lib/keka-sync.ts` (mapping + rules, runs through the CSV import planner in `lib/user-import.ts`), `lib/sign-in-gate.ts` (sign-in decisions).

| Trigger | What happens |
|---|---|
| Admin → **Sync from Keka** | Preview (new / update / no change / error, departments to create, promotions, skipped) → Apply. The first applied sync switches on the daily sync. |
| Daily (hourly cron, runs once ~23 h after the last sync) | Same sync, applied automatically. Never runs until an admin has applied the first one. |
| Sign-in, email not in the app | Looked up in Keka by work email. Active → account created and signed in. Not in Keka / left → refused (`NotInKeka`). Keka down → refused (`KekaUnavailable`). Keka not configured → refused (`NotRegistered`). `INITIAL_ADMIN_EMAILS` always get in. |
| Sign-in, email in the app | Inactive → refused. Active → signed in; Keka data older than 24 h is refreshed in the background. |

**Field ownership**

| Keka owns (sync overwrites; read-only in the app for synced users) | App owns (sync never touches) |
|---|---|
| Name, email, job title, department (`groups` type 2), manager (`reportsTo.email`), phone (work, else mobile), country, Keka ID, employee number, joining date, left the company | Role (auto-promoted to Manager when someone reports to them, never auto-demoted), time zone, working hours, avatar, manual deactivation |

- Leavers (`employmentStatus` ≠ 0 or exit date passed) are deactivated and their sessions revoked. Users linked to Keka but missing from the directory listing are looked up one by one.
- Users not in Keka (added manually or by CSV) are never deactivated for being absent.
- A manager who isn't in the app yet is left blank with a warning and linked on a later sync.
- Non-company emails in Keka are skipped; leavers who were never in the app are ignored.
- Never pulled: date of birth, gender, marital status, blood group, addresses, personal email, family, salary.

Local testing without real Keka: set `KEKA_API_BASE_URL` / `KEKA_TOKEN_URL` to a mock server (plus dummy `KEKA_COMPANY`, `KEKA_CLIENT_ID`, `KEKA_CLIENT_SECRET`, `KEKA_API_KEY`).

## What is used from Keka

- **Leave requests** – Approved leave for an employee (by Keka employee ID).
- **Holiday calendars** – One calendar for US office holidays and one for India office holidays. Only dates in the relevant calendar are treated as holidays (based on the user’s `country` in the app).

## Requirements

1. **Keka API access** – Create an app in the [Keka Developer Portal](https://developers.keka.com/) to get:
   - Client ID
   - Client secret
   - API key

2. **Holiday calendars in Keka** – Create or use existing holiday calendars (e.g. “US Office”, “India Office”) and note their **calendar IDs** (UUIDs). You can get calendar IDs from: **Keka → Time → Holiday Calendar**, or via the API: `GET /time/holidayscalendar`.

3. **Employee mapping** – Each user in the app who should have leave checked must have their **Keka employee ID** set (see below). You can find Keka employee IDs in Keka (employee profile) or via the API: `GET /hris/employees` or `POST /hris/employees/search` (e.g. by email).

## Environment variables

Add to `.env`:

```env
# Keka API (optional – if not set, leave/holiday checks are skipped)
KEKA_COMPANY=yourcompany
KEKA_ENVIRONMENT=keka
KEKA_CLIENT_ID=...
KEKA_CLIENT_SECRET=...
KEKA_API_KEY=...

# Holiday calendar UUIDs from Keka (optional)
KEKA_HOLIDAY_CALENDAR_ID_US=...
KEKA_HOLIDAY_CALENDAR_ID_IN=...
```

- **KEKA_COMPANY** – Your Keka subdomain (e.g. `acme` for `acme.keka.com`).
- **KEKA_ENVIRONMENT** – `keka` (production) or `kekademo` (sandbox). Default: `keka`.
- **KEKA_HOLIDAY_CALENDAR_ID_US** – UUID of the US office holiday calendar in Keka.
- **KEKA_HOLIDAY_CALENDAR_ID_IN** – UUID of the India office holiday calendar in Keka.

## User setup

- **Country** – Set each user’s **Country** (e.g. `US` or `IN`) in their profile. This decides which holiday calendar is used (US vs India).
- **Keka Employee ID** – For leave to be considered, the user must have **Keka Employee ID** set. Super Admins can set this in User Management when editing a user (if the field is exposed). The value must match the employee ID in Keka (UUID from `GET /hris/employees` or from the employee’s profile in Keka).

If **Keka Employee ID** is blank, only public holidays (for their country) are considered; leave from Keka is not checked.

## Where it’s used

- **Recurring meeting availability** – When finding the “first free” occurrence, dates are skipped if either the reporter or the employee has that day as a holiday or approved leave in Keka.
- **Creating a new recurring schedule** – The first occurrence is chosen by skipping dates that are holiday/leave for either party.
- **One-time meeting – pick a date** – If the chosen date is a holiday or either person is on leave (from Keka), the API returns no slots and a message asking to pick another day.

## API details (for reference)

- **Token:** `POST https://login.keka.com/connect/token` (or `login.kekademo.com` for sandbox)  
  Body: `grant_type=kekaapi&scope=kekaapi&client_id=...&client_secret=...&api_key=...`
- **Holidays:** `GET https://{company}.keka.com/api/v1/time/holidayscalendar/{calendarId}/holidays?calendarYear=YYYY`
- **Leave:** `GET https://{company}.keka.com/api/v1/time/leaverequests?employeeIds=id1,id2&from=...&to=...`  
  Only **approved** leave (status = 1) is treated as unavailable. Date range max 90 days.

Rate limit: 50 requests per minute.

## Keka Employee ID

Set automatically by the employee sync. It can still be entered by hand (Admin → edit user) for users who are not synced.
