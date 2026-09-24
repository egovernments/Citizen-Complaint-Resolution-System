#!/bin/sh
# Last complete ISO week (Mon..Sun). Run from cron any day after the week closes.
#
# Paths resolve relative to this script, so the checkout can live anywhere.
# The date maths is in python rather than `date -d`, which is GNU-only and absent
# on BSD and macOS.
set -eu

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

WINDOW=$(python3 -c '
import datetime
today = datetime.date.today()
end = today - datetime.timedelta(days=today.isoweekday())
print(end - datetime.timedelta(days=6), end)
')
START=${WINDOW% *}
END=${WINDOW#* }

mkdir -p "$DIR/out"
echo "# window: $START .. $END"
exec python3 "$DIR/kpi-week.py" "$START" "$END" --csv "$DIR/out/kpi-$START.csv"
