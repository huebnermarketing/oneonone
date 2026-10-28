#!/bin/bash
# End-to-end API smoke tests. Runs against a live dev server + a database seeded with `npm run db:seed`.
#
#   npm run test:smoke                              # defaults: http://localhost:3000, $DATABASE_URL from .env
#   BASE_URL=http://localhost:3123 npm run test:smoke
#
# Requires: curl, psql, python3, openssl. Needs CRON_SECRET in the server env (reads it from .env).
# Creates temporary sessions/todos for seeded @test.com users and removes them afterwards.
# NEVER run against production — it mutates data.
set -u
B="${BASE_URL:-http://localhost:3000}"
if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then DATABASE_URL=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"'); fi
CRON="${CRON_SECRET:-$(grep -E '^CRON_SECRET=' .env 2>/dev/null | cut -d= -f2- | tr -d '"')}"
# psql does not understand Prisma's ?schema=... query parameter
PSQL_URL=$(echo "${DATABASE_URL:?set DATABASE_URL}" | sed -E 's/([?&])schema=[^&]*&?/\1/; s/[?&]$//')
PSQL="psql $PSQL_URL -tA"
pass=0; fail=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then pass=$((pass+1)); echo "  ok   $1 -> $3"; else fail=$((fail+1)); echo "  FAIL $1 -> got $3, expected $2"; fi
}
code() { curl -s -o /tmp/body -w '%{http_code}' "$@"; }
body() { cat /tmp/body; }

# sessions: create NextAuth session rows directly for seeded users
mksess() { # email -> cookie file
  local uid=$($PSQL -c "select id from \"User\" where email='$1'")
  local tok=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')
  $PSQL -c "insert into \"Session\"(id,\"sessionToken\",\"userId\",expires) values (gen_random_uuid()::text,'$tok','$uid',now()+interval '1 day')" >/dev/null
  echo "next-auth.session-token=$tok"
}
ADMIN=$(mksess nishant@test.com)
REP=$(mksess test-reporter@test.com)
ALEX=$(mksess alex@test.com)          # employee reporting to test-reporter
HITEN=$(mksess hiten@test.com)        # a different reporter

echo "## auth mapping"
check "unauth /api/todos is 401" 401 $(code $B/api/todos)
check "unauth /api/meetings is 401" 401 $(code $B/api/meetings)
check "employee /api/users is 403" 403 $(code -b "$ALEX" $B/api/users)
check "widgets route gone" 404 $(code -b "$ADMIN" $B/api/dashboard/widgets)

echo "## validation"
check "POST todos bad body 400" 400 $(code -b "$ALEX" -X POST $B/api/todos -H 'content-type: application/json' -d '{"title":""}')
grep -q '"details"' /tmp/body && echo "  ok   details present" || { echo "  FAIL no details"; fail=$((fail+1)); }
check "POST todos invalid json 400" 400 $(code -b "$ALEX" -X POST $B/api/todos -H 'content-type: application/json' -d '{bad')
check "GET notifications limit=abc 400" 400 $(code -b "$ALEX" "$B/api/notifications?limit=abc")

echo "## todo scoping"
TOTAL=$($PSQL -c 'select count(*) from "Todo"')
ADM_N=$(curl -s -b "$ADMIN" $B/api/todos | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))')
REP_N=$(curl -s -b "$REP" $B/api/todos | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))')
HIT_N=$(curl -s -b "$HITEN" $B/api/todos | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))')
check "admin sees all todos" "$TOTAL" "$ADM_N"
[ "$REP_N" -lt "$TOTAL" ] && echo "  ok   reporter sees subset ($REP_N < $TOTAL)" || { echo "  FAIL reporter sees all"; fail=$((fail+1)); }
[ "$HIT_N" -lt "$TOTAL" ] && echo "  ok   other reporter sees subset ($HIT_N < $TOTAL)" || { echo "  FAIL"; fail=$((fail+1)); }
OTHER_EMP=$($PSQL -c "select id from \"User\" where email='ritesh@test.com'")
check "reporter cannot assign todo outside team" 403 $(code -b "$REP" -X POST $B/api/todos -H 'content-type: application/json' -d "{\"title\":\"x\",\"assignedToId\":\"$OTHER_EMP\"}")
ALEX_ID=$($PSQL -c "select id from \"User\" where email='alex@test.com'")
check "reporter assigns todo to direct report" 201 $(code -b "$REP" -X POST $B/api/todos -H 'content-type: application/json' -d "{\"title\":\"smoke todo\",\"assignedToId\":\"$ALEX_ID\"}")
TODO_ID=$(python3 -c 'import json;print(json.load(open("/tmp/body"))["id"])')

echo "## profile lockdown"
REP_ID=$($PSQL -c "select id from \"User\" where email='test-reporter@test.com'")
check "profile PATCH ok" 200 $(code -b "$ALEX" -X PATCH $B/api/profile -H 'content-type: application/json' -d "{\"title\":\"Smoke\",\"reportsToId\":\"$OTHER_EMP\"}")
check "reportsToId unchanged" "$REP_ID" "$($PSQL -c "select \"reportsToId\" from \"User\" where email='alex@test.com'")"

echo "## policies"
check "settings GET has cancelPolicy" 200 $(code -b "$ADMIN" $B/api/settings)
grep -q '"cancelPolicy":"REPORTER_AND_ADMIN"' /tmp/body && echo "  ok   default cancelPolicy" || { echo "  FAIL cancelPolicy missing"; fail=$((fail+1)); }
check "settings PUT bad reminder 400" 400 $(code -b "$ADMIN" -X PUT $B/api/settings -H 'content-type: application/json' -d '{"reminderHoursBefore":0}')
check "settings PUT employee 403" 403 $(code -b "$ALEX" -X PUT $B/api/settings -H 'content-type: application/json' -d '{"employeeCanViewRecording":true}')

echo "## cancel flow"
# any future SCHEDULED meeting run by test-reporter; its employee gets a session
MID=$($PSQL -c "select id from \"Meeting\" where \"reporterId\"='$REP_ID' and status='SCHEDULED' and \"meetingDate\">now() limit 1")
[ -n "$MID" ] || { echo "  FAIL no future SCHEDULED meeting for test-reporter — reseed with npm run db:seed"; fail=$((fail+1)); }
MEMP=$(mksess "$($PSQL -c "select email from \"User\" where id=(select \"employeeId\" from \"Meeting\" where id='$MID')")")
MEMP_ID=$($PSQL -c "select \"employeeId\" from \"Meeting\" where id='$MID'")
check "employee cannot cancel (REPORTER_AND_ADMIN)" 403 $(code -b "$MEMP" -X POST $B/api/meetings/$MID/cancel -H 'content-type: application/json' -d '{}')
check "other reporter cannot cancel" 403 $(code -b "$HITEN" -X POST $B/api/meetings/$MID/cancel -H 'content-type: application/json' -d '{}')
check "PATCH status CANCELLED rejected by schema" 400 $(code -b "$REP" -X PATCH $B/api/meetings/$MID -H 'content-type: application/json' -d '{"status":"CANCELLED"}')
check "reporter cancels" 200 $(code -b "$REP" -X POST $B/api/meetings/$MID/cancel -H 'content-type: application/json' -d '{"reason":"smoke"}')
check "status is CANCELLED" CANCELLED "$($PSQL -c "select status from \"Meeting\" where id='$MID'")"
check "cancel again 400" 400 $(code -b "$REP" -X POST $B/api/meetings/$MID/cancel -H 'content-type: application/json' -d '{}')
check "employee got notification" 1 "$($PSQL -c "select count(*) from \"Notification\" where \"userId\"='$MEMP_ID' and type='MEETING_CANCELLED' and link='/meetings/$MID'")"
check "audit row written" 1 "$($PSQL -c "select count(*) from \"AuditLog\" where \"entityId\"='$MID' and action='UPDATE' and details->>'status'='CANCELLED'")"
# policy switch
MID2=$($PSQL -c "select id from \"Meeting\" where status='SCHEDULED' and \"meetingDate\">now() and id<>'$MID' limit 1")
EMP2=$(mksess "$($PSQL -c "select email from \"User\" where id=(select \"employeeId\" from \"Meeting\" where id='$MID2')")")
check "admin sets ANY_PARTICIPANT" 200 $(code -b "$ADMIN" -X PUT $B/api/settings -H 'content-type: application/json' -d '{"cancelPolicy":"ANY_PARTICIPANT"}')
check "employee can now cancel" 200 $(code -b "$EMP2" -X POST $B/api/meetings/$MID2/cancel -H 'content-type: application/json' -d '{}')
PMID=$($PSQL -c "select id from \"Meeting\" where status='SCHEDULED' and \"meetingDate\">now() limit 1")
$PSQL -c "update \"Meeting\" set status='PROPOSED' where id='$PMID'" >/dev/null
check "complete a PROPOSED meeting rejected" 400 $(code -b "$ADMIN" -X PATCH $B/api/meetings/$PMID -H 'content-type: application/json' -d '{"status":"COMPLETED"}')
$PSQL -c "update \"Meeting\" set status='SCHEDULED' where id='$PMID'" >/dev/null

echo "## recording visibility"
RMID=$($PSQL -c "select m.id from \"Meeting\" m join \"MeetingRecording\" r on r.\"meetingId\"=m.id limit 1")
REMP=$($PSQL -c "select \"employeeId\" from \"Meeting\" where id='$RMID'")
REMAIL=$($PSQL -c "select email from \"User\" where id='$REMP'")
EMPC=$(mksess $REMAIL)
check "employee recording 403 by default" 403 $(code -b "$EMPC" $B/api/meetings/$RMID/recording)
check "admin enables employeeCanViewRecording" 200 $(code -b "$ADMIN" -X PUT $B/api/settings -H 'content-type: application/json' -d '{"employeeCanViewRecording":true}')
check "employee recording 200 after policy" 200 $(code -b "$EMPC" $B/api/meetings/$RMID/recording)
check "employee cannot delete recording" 403 $(code -b "$EMPC" -X DELETE $B/api/meetings/$RMID/recording)
check "employee meeting page renders" 200 $(code -b "$EMPC" $B/meetings/$RMID)
grep -q "Meeting Recording" /tmp/body && echo "  ok   recording section visible to employee" || { echo "  FAIL section hidden"; fail=$((fail+1)); }

echo "## recording pipeline"
RREP=$(mksess "$($PSQL -c "select email from \"User\" where id=(select \"reporterId\" from \"Meeting\" where id='$RMID')")")
RRID=$($PSQL -c "select id from \"MeetingRecording\" where \"meetingId\"='$RMID'")
check "employee cannot reprocess" 403 $(code -b "$EMPC" -X POST $B/api/meetings/$RMID/recording/reprocess -H 'content-type: application/json' -d '{}')
check "reprocess bad stage 400" 400 $(code -b "$RREP" -X POST $B/api/meetings/$RMID/recording/reprocess -H 'content-type: application/json' -d '{"from":"COMBINE"}')
# sandbox has no AI key configured: the route must say so before touching the pipeline
check "reprocess without AI key 400" 400 $(code -b "$RREP" -X POST $B/api/meetings/$RMID/recording/reprocess -H 'content-type: application/json' -d '{"from":"ANALYZE"}')
grep -q "API key not configured" /tmp/body && echo "  ok   reprocess error names the AI key" || { echo "  FAIL unexpected body: $(body)"; fail=$((fail+1)); }
# simulate a run that a restart killed 2h ago on its last allowed attempt; cron must fail it and surface the error
JID=$($PSQL -c "insert into \"RecordingJob\"(id,\"recordingId\",\"meetingId\",kind,\"fromStage\",stage,status,attempt,\"heartbeatAt\",\"createdAt\",\"updatedAt\") values (gen_random_uuid()::text,'$RRID','$RMID','REPROCESS','ANALYZE','ANALYZE','RUNNING',3,now()-interval '2 hours',now()-interval '2 hours',now()) returning id" | head -1)
check "reporter sees the running job" RUNNING "$(code -b "$RREP" $B/api/meetings/$RMID/recording >/dev/null; python3 -c "import json;print(json.load(open('/tmp/body'))['job']['status'])")"
check "employee does not see job details" null "$(code -b "$EMPC" $B/api/meetings/$RMID/recording >/dev/null; python3 -c "import json;print(json.dumps(json.load(open('/tmp/body'))['job']))")"
check "cron recovers stale job" 1 "$(code -X POST $B/api/cron/meetings -H "x-cron-secret: $CRON" >/dev/null; python3 -c "import json;print(json.load(open('/tmp/body'))['recordingJobsFailed'])")"
check "job marked FAILED" FAILED "$($PSQL -c "select status from \"RecordingJob\" where id='$JID'")"
check "recording marked FAILED with reason" 1 "$($PSQL -c "select count(*) from \"MeetingRecording\" where id='$RRID' and status='FAILED' and \"errorMessage\" like '%interrupted 3 times%'")"
$PSQL -c "delete from \"RecordingJob\" where id='$JID'; update \"MeetingRecording\" set status='COMPLETED', \"errorMessage\"=null where id='$RRID'" >/dev/null

echo "## cron"
check "cron no secret 401" 401 $(code -X POST $B/api/cron/meetings)
check "cron with secret 200" 200 $(code -X POST $B/api/cron/meetings -H "x-cron-secret: $CRON")

echo "## pages"
for p in /dashboard /meetings /todos /employees /admin /admin/settings /insights /profile; do check "admin page $p" 200 $(code -b "$ADMIN" $B$p); done
# Pages with loading.tsx stream, so redirect() arrives in the body (NEXT_REDIRECT + meta refresh), not as a 307
denied() { curl -s -b "$ALEX" "$B$1" | grep -q 'NEXT_REDIRECT;replace;/access-denied' && echo yes || echo no; }
for p in /admin /admin/settings /admin/audit-logs /reports /employees /meetings/new /insights; do check "employee $p -> access-denied" yes "$(denied $p)"; done
check "admin /admin not redirected" no "$(curl -s -b "$ADMIN" "$B/admin" | grep -q 'NEXT_REDIRECT' && echo yes || echo no)"
check "access-denied page renders" 200 $(code -b "$ALEX" $B/access-denied)
grep -q "have access to that page" /tmp/body && echo "  ok   access-denied copy" || { echo "  FAIL access-denied copy"; fail=$((fail+1)); }

echo "## admin scheduling"
ALEX_MGR=$($PSQL -c "select m.email from \"User\" u join \"User\" m on m.id=u.\"reportsToId\" where u.email='alex@test.com'")
SCHED_AT=$(python3 -c "import datetime;print((datetime.datetime.now(datetime.UTC).replace(tzinfo=None)+datetime.timedelta(days=9)).replace(hour=6,minute=0,second=0,microsecond=0).isoformat()+'Z')")
check "admin proposes 1:1 with someone else's report" 201 $(code -b "$ADMIN" -X POST $B/api/meetings -H 'content-type: application/json' -d "{\"employeeId\":\"$ALEX_ID\",\"meetingDate\":\"$SCHED_AT\",\"meetingType\":\"IN_PERSON\"}")
ADM_MID=$(python3 -c "import json;print(json.load(open('/tmp/body'))['id'])")
check "admin is the meeting owner (not $ALEX_MGR)" "nishant@test.com" "$($PSQL -c "select r.email from \"Meeting\" m join \"User\" r on r.id=m.\"reporterId\" where m.id='$ADM_MID'")"
check "manager got no notification" 0 "$($PSQL -c "select count(*) from \"Notification\" n join \"User\" u on u.id=n.\"userId\" where u.email='$ALEX_MGR' and n.link='/meetings/$ADM_MID'")"
$PSQL -c "delete from \"Notification\" where link='/meetings/$ADM_MID'; delete from \"AuditLog\" where \"entityId\"='$ADM_MID'; delete from \"Meeting\" where id='$ADM_MID'" >/dev/null

echo "## working days"
check "settings has workingDays Mon-Fri" "[1, 2, 3, 4, 5]" "$(code -b "$ADMIN" $B/api/settings >/dev/null; python3 -c "import json;print(json.load(open('/tmp/body'))['workingDays'])")"
SAT=$(python3 -c "import datetime as d;t=d.datetime.now(d.UTC)+d.timedelta(days=7);t+=d.timedelta(days=(5-t.weekday())%7);print(t.strftime('%Y-%m-%dT06:00:00.000Z'))")
check "meeting on a Saturday rejected" 400 $(code -b "$ADMIN" -X POST $B/api/meetings -H 'content-type: application/json' -d "{\"employeeId\":\"$ALEX_ID\",\"meetingDate\":\"$SAT\",\"meetingType\":\"IN_PERSON\"}")
grep -q "Working days are Mon" /tmp/body && echo "  ok   saturday message" || { echo "  FAIL saturday message"; fail=$((fail+1)); }
check "recurring on Sunday rejected" 400 $(code -b "$REP" -X POST $B/api/recurring-schedules -H 'content-type: application/json' -d "{\"employeeId\":\"$ALEX_ID\",\"frequency\":\"WEEKLY\",\"dayOfWeek\":0,\"timeOfDay\":\"11:00\",\"meetingType\":\"IN_PERSON\"}")
check "availability on a Saturday explains why" yes "$(code -b "$REP" "$B/api/meetings/availability?employeeId=$ALEX_ID&date=${SAT:0:10}" >/dev/null; grep -q 'not a working day' /tmp/body && echo yes || echo no)"
check "empty working days rejected" 400 $(code -b "$ADMIN" -X PUT $B/api/settings -H 'content-type: application/json' -d '{"workingDays":[]}')

echo "## meeting duration"
MON=$(python3 -c "import datetime as d;t=d.datetime.now(d.UTC)+d.timedelta(days=21);t+=d.timedelta(days=(0-t.weekday())%7);print(t.strftime('%Y-%m-%d'))")
mk() { code -b "$REP" -X POST $B/api/meetings -H 'content-type: application/json' -d "{\"employeeId\":\"$ALEX_ID\",\"meetingDate\":\"${MON}T$1:00.000Z\"$2}"; }
check "15-min meeting created" 201 $(mk 05:00 ',"durationMinutes":15')
D1=$(python3 -c "import json;print(json.load(open('/tmp/body'))['id'])")
check "stored length 15" 15 "$($PSQL -c "select \"durationMinutes\" from \"Meeting\" where id='$D1'")"
check "back-to-back (default length) allowed" 201 $(mk 05:15 '')
D2=$(python3 -c "import json;print(json.load(open('/tmp/body'))['id'])")
check "default length is 15" 15 "$($PSQL -c "select \"durationMinutes\" from \"Meeting\" where id='$D2'")"
check "overlapping 30-min meeting 409" 409 $(mk 04:50 ',"durationMinutes":30')
check "45-min length rejected" 400 $(mk 07:00 ',"durationMinutes":45')
check "availability duration=45 rejected" 400 $(code -b "$REP" "$B/api/meetings/availability?employeeId=$ALEX_ID&date=$MON&duration=45")
$PSQL -c "delete from \"Notification\" where link in ('/meetings/$D1','/meetings/$D2'); delete from \"AuditLog\" where \"entityId\" in ('$D1','$D2'); delete from \"Meeting\" where id in ('$D1','$D2');" >/dev/null

echo "## reschedule"
check "meeting to reschedule created" 201 $(mk 08:00 ',"durationMinutes":15')
D3=$(python3 -c "import json;print(json.load(open('/tmp/body'))['id'])")
check "employee accepts it" 200 $(code -b "$ALEX" -X POST $B/api/meetings/$D3/accept)
rs() { code -b "$1" -X POST $B/api/meetings/$D3/reschedule -H 'content-type: application/json' -d "{\"meetingDate\":\"${MON}T$2:00.000Z\"$3}"; }
check "employee asks to move it" 200 $(rs "$ALEX" 09:00 ',"reason":"smoke"')
check "old time kept while pending" "${MON} 08:00 $ALEX_ID" "$($PSQL -c "select to_char(\"meetingDate\" at time zone 'UTC','YYYY-MM-DD HH24:MI')||' '||\"rescheduleRequestedById\" from \"Meeting\" where id='$D3'")"
check "requester cannot accept own request" 403 $(code -b "$ALEX" -X POST $B/api/meetings/$D3/reschedule/accept)
check "admin (not a participant) cannot request" 403 $(rs "$ADMIN" 11:00 '')
check "reporter declines" 200 $(code -b "$REP" -X DELETE $B/api/meetings/$D3/reschedule)
check "request cleared" "" "$($PSQL -c "select coalesce(\"rescheduleRequestedById\",'') from \"Meeting\" where id='$D3'")"
check "reporter asks for 30 min later" 200 $(rs "$REP" 10:00 ',"durationMinutes":30')
check "employee accepts new time" 200 $(code -b "$ALEX" -X POST $B/api/meetings/$D3/reschedule/accept)
check "meeting moved + length changed" "${MON} 10:00 30" "$($PSQL -c "select to_char(\"meetingDate\" at time zone 'UTC','YYYY-MM-DD HH24:MI')||' '||\"durationMinutes\" from \"Meeting\" where id='$D3'")"
check "nothing to accept now" 400 $(code -b "$ALEX" -X POST $B/api/meetings/$D3/reschedule/accept)
$PSQL -c "delete from \"Notification\" where link like '/meetings/$D3%'; delete from \"AuditLog\" where \"entityId\"='$D3'; delete from \"CalendarEvent\" where \"meetingId\"='$D3'; delete from \"Meeting\" where id='$D3';" >/dev/null

echo "## form answers + history"
check "meeting for form created" 201 $(mk 11:00 '')
D4=$(python3 -c "import json;print(json.load(open('/tmp/body'))['id'])")
check "employee accepts it" 200 $(code -b "$ALEX" -X POST $B/api/meetings/$D4/accept)
FORM='"checkInPersonal":"p","checkInProfessional":"q","priorityGoalProfessional":"r","progressReport":"s"'
frm() { code -b "$1" -X "$2" $B/api/meetings/$D4/form -H 'content-type: application/json' -d "{$3}"; }
check "employee saves draft" 200 $(frm "$ALEX" POST "$FORM,\"draft\":true")
check "owner cannot edit before submit" 400 $(frm "$REP" PATCH '"progressReport":"x"')
check "employee submits" 200 $(frm "$ALEX" POST "$FORM")
check "draft after submit refused" 400 $(frm "$ALEX" POST "$FORM,\"draft\":true")
check "owner edits an answer" 200 $(frm "$REP" PATCH '"progressReport":"fixed by manager"')
check "admin edits an answer" 200 $(frm "$ADMIN" PATCH '"goodNews":"added by admin"')
check "employee cannot use the edit endpoint" 403 $(frm "$ALEX" PATCH '"goodNews":"x"')
check "owner cannot blank a required answer" 400 $(frm "$REP" PATCH '"checkInPersonal":""')
check "employee resubmits with a change" 200 $(frm "$ALEX" POST '"checkInPersonal":"p2","checkInProfessional":"q","priorityGoalProfessional":"r","progressReport":"fixed by manager","goodNews":"added by admin"')
check "history kinds newest first" "RESUBMITTED,EDITED,EDITED,SUBMITTED" "$(code -b "$ALEX" $B/api/meetings/$D4/form/history >/dev/null; python3 -c "import json;print(','.join(r['kind'] for r in json.load(open('/tmp/body'))))")"
check "edit recorded before/after" "s -> fixed by manager" "$($PSQL -c "select c->>'before'||' -> '||(c->>'after') from \"MeetingFormRevision\" r, jsonb_array_elements(r.changes) c where r.\"meetingId\"='$D4' and r.kind='EDITED' and c->>'field'='progressReport'")"
check "employee told about the edit" 2 "$($PSQL -c "select count(*) from \"Notification\" where link='/meetings/$D4' and type='FORM_EDITED'")"
$PSQL -c "delete from \"Notification\" where link like '/meetings/$D4%'; delete from \"AuditLog\" where \"entityId\"='$D4'; delete from \"Meeting\" where id='$D4';" >/dev/null

echo "## recording parts (validation only; no S3 here)"
check "meeting for recording created" 201 $(mk 12:00 '')
D5=$(python3 -c "import json;print(json.load(open('/tmp/body'))['id'])")
check "overlapping parts rejected" 400 $(code -b "$REP" -X POST $B/api/meetings/$D5/recording/process -H 'content-type: application/json' -d '{"totalChunks":4,"duration":60,"parts":[{"start":0,"end":3},{"start":2,"end":4}]}')
check "part past uploaded chunks rejected" 400 $(code -b "$REP" -X POST $B/api/meetings/$D5/recording/process -H 'content-type: application/json' -d '{"totalChunks":2,"duration":60,"parts":[{"start":0,"end":3}]}')
check "total over the max length rejected" 400 $(code -b "$REP" -X POST $B/api/meetings/$D5/recording/process -H 'content-type: application/json' -d '{"totalChunks":2,"duration":36000,"parts":[{"start":0,"end":1},{"start":1,"end":2}]}')
$PSQL -c "delete from \"Notification\" where link like '/meetings/$D5%'; delete from \"AuditLog\" where \"entityId\"='$D5'; delete from \"Meeting\" where id='$D5';" >/dev/null

echo "## recurring schedule edit moves the series"
check "schedule Mon 10:00 created" 201 $(code -b "$REP" -X POST $B/api/recurring-schedules -H 'content-type: application/json' -d "{\"employeeId\":\"$ALEX_ID\",\"frequency\":\"WEEKLY\",\"dayOfWeek\":1,\"timeOfDay\":\"10:00\",\"durationMinutes\":30,\"meetingType\":\"IN_PERSON\"}")
RS=$(python3 -c "import json;print(json.load(open('/tmp/body'))['schedule']['id'])")
RM=$(python3 -c "import json;print(json.load(open('/tmp/body'))['meeting']['id'])")
check "employee accepts first meeting" 200 $(code -b "$ALEX" -X POST $B/api/meetings/$RM/accept)
check "accept created the next one with the schedule's length" "2 30" "$($PSQL -c "select count(*)||' '||min(\"durationMinutes\") from \"Meeting\" where \"recurringScheduleId\"='$RS' and status='SCHEDULED'")"
check "move to Wed 16:30" 200 $(code -b "$REP" -X PATCH $B/api/recurring-schedules/$RS -H 'content-type: application/json' -d '{"dayOfWeek":3,"timeOfDay":"16:30"}')
check "both upcoming meetings moved" 2 "$(python3 -c "import json;print(json.load(open('/tmp/body'))['movedMeetingCount'])")"
TZQ="(select replace(coalesce(\"timeZone\",'Asia/Kolkata'),'Asia/Calcutta','Asia/Kolkata') from \"User\" where id='$REP_ID')"
check "all upcoming on Wed 16:30 (reporter time)" "3 16:30" "$($PSQL -c "select distinct extract(dow from \"meetingDate\" at time zone 'UTC' at time zone $TZQ)||' '||to_char(\"meetingDate\" at time zone 'UTC' at time zone $TZQ,'HH24:MI') from \"Meeting\" where \"recurringScheduleId\"='$RS' and status<>'CANCELLED'")"
check "one week apart, next generation after the last" "7 7" "$($PSQL -c "with m as (select \"meetingDate\" d from \"Meeting\" where \"recurringScheduleId\"='$RS' order by 1) select extract(day from max(d)-min(d))::int||' '||extract(day from (select \"nextMeetingDate\" from \"RecurringSchedule\" where id='$RS')-max(d))::int from m")"
check "Sunday still refused on edit" 400 $(code -b "$REP" -X PATCH $B/api/recurring-schedules/$RS -H 'content-type: application/json' -d '{"dayOfWeek":0}')
$PSQL -c "delete from \"Notification\" where link like '/meetings/%' and \"createdAt\" > now() - interval '5 minutes' and \"userId\" in ('$ALEX_ID','$REP_ID'); delete from \"AuditLog\" where \"entityId\"='$RS' or \"entityId\" in (select id from \"Meeting\" where \"recurringScheduleId\"='$RS'); delete from \"Meeting\" where \"recurringScheduleId\"='$RS'; delete from \"RecurringSchedule\" where id='$RS';" >/dev/null

echo "## user import"
check "employee cannot download template" 403 $(code -b "$ALEX" "$B/api/admin/import-users?format=template")
check "admin template 200" 200 $(code -b "$ADMIN" "$B/api/admin/import-users?format=template")
check "template header" "email,first_name,last_name" "$(head -1 /tmp/body | cut -d, -f1-3)"
check "admin export 200" 200 $(code -b "$ADMIN" "$B/api/admin/import-users?format=export")
cp /tmp/body /tmp/users-export.csv
IMP_BODY=$(python3 -c "import json;print(json.dumps({'csv':open('/tmp/users-export.csv').read()}))")
check "export re-import preview 200" 200 $(code -b "$ADMIN" -X POST $B/api/admin/import-users -H 'content-type: application/json' -d "$IMP_BODY")
check "export re-import is all unchanged" "0 0 0" "$(python3 -c "import json;s=json.load(open('/tmp/body'))['summary'];print(s['create'],s['update'],s['error'])")"
check "import without email column 400" 400 $(code -b "$ADMIN" -X POST $B/api/admin/import-users -H 'content-type: application/json' -d '{"csv":"first_name\nA"}')
check "preview writes nothing" 0 "$(code -b "$ADMIN" -X POST $B/api/admin/import-users -H 'content-type: application/json' -d '{"csv":"email,first_name\nsmoke.import@whitelabeliq.com,Smoke"}' >/dev/null; $PSQL -c "select count(*) from \"User\" where email='smoke.import@whitelabeliq.com'")"

echo "## keka sync (server without KEKA_* env)"
check "employee cannot see keka sync" 403 $(code -b "$ALEX" $B/api/admin/keka-sync)
check "admin keka status 200" 200 $(code -b "$ADMIN" $B/api/admin/keka-sync)
check "keka status has configured flag" yes "$(python3 -c "import json;print('yes' if 'configured' in json.load(open('/tmp/body')) else 'no')")"
if python3 -c "import json,sys;sys.exit(0 if json.load(open('/tmp/body'))['configured'] else 1)"; then
  echo "  skip keka POST checks (Keka configured on this server)"
else
  check "keka sync without config 400" 400 $(code -b "$ADMIN" -X POST $B/api/admin/keka-sync -H 'content-type: application/json' -d '{}')
fi

# cleanup: restore cancelled fixtures, remove temp rows, reset policies
$PSQL -c "update \"Meeting\" set status='SCHEDULED' where id in ('$MID','$MID2'); delete from \"Notification\" where link in ('/meetings/$MID','/meetings/$MID2') and type='MEETING_CANCELLED'; update \"User\" set title=null where id='$ALEX_ID'; delete from \"Todo\" where id='$TODO_ID'; delete from \"AuditLog\" where \"entityId\" in ('$MID','$MID2') and action='UPDATE' and details->>'status'='CANCELLED'; delete from \"Session\" where expires < now()+interval '2 days';" >/dev/null
curl -s -o /dev/null -b "$ADMIN" -X PUT $B/api/settings -H 'content-type: application/json' -d '{"cancelPolicy":"REPORTER_AND_ADMIN","employeeCanViewRecording":false}'
echo; echo "PASS=$pass FAIL=$fail"
[ "$fail" -eq 0 ]
