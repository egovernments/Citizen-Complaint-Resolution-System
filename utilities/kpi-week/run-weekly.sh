#!/bin/sh
# Last complete Monday-to-Sunday week. Run from cron any day after it closes.
#
# Paths resolve relative to this script, so the checkout can live anywhere.
# The date maths is in python rather than `date -d`, which is GNU-only and
# absent on BSD and macOS.
set -eu

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

# Same zone kpi-week.py resolves, or the host's idea of "today" picks the wrong
# week whenever the two disagree across midnight.
if [ -z "${TZ_NAME:-}" ] && [ -f "$DIR/kpi.env" ]; then
    TZ_NAME=$(sed -n 's/^[[:space:]]*TZ_NAME[[:space:]]*=[[:space:]]*//p' "$DIR/kpi.env" | tail -1)
fi
TZ_NAME=${TZ_NAME:-UTC}
export TZ_NAME

WINDOW=$(python3 -c '
import datetime, os, zoneinfo
today = datetime.datetime.now(zoneinfo.ZoneInfo(os.environ["TZ_NAME"])).date()
end = today - datetime.timedelta(days=today.isoweekday())
print(end - datetime.timedelta(days=6), end)
')
START=${WINDOW% *}
END=${WINDOW#* }

mkdir -p "$DIR/out"
echo "# window: $START .. $END  (TZ_NAME=$TZ_NAME)"
exec python3 "$DIR/kpi-week.py" "$START" "$END" --csv "$DIR/out/kpi-$START.csv"
