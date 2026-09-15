#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# DIGIT Security Scan bootstrap for eGov-Global/CMS-MOZAMBIQUE.
#
#   export SECSCAN_TOKEN='<token>'   # obtain from your administrator
#   curl -fsSL https://raw.githubusercontent.com/eGov-Global/CMS-MOZAMBIQUE/master/security_scan/ansible/run.sh | bash
#
# It sets up an isolated, timestamped virtualenv, installs the Python deps into it,
# fetches + runs the scanner, then tears the venv down. See README.md for prerequisites.
# ---------------------------------------------------------------------------
set -euo pipefail

# ----- per-repo config (pin REF to a tag later for immutability) -----
REPO_FULL="eGov-Global/CMS-MOZAMBIQUE"
REPO_URL="https://github.com/${REPO_FULL}"
REF="${SECSCAN_REF:-master}"                 # override: SECSCAN_REF=<tag|sha> ... | bash
RAW="https://raw.githubusercontent.com/${REPO_FULL}/${REF}/security_scan/ansible"

grn(){ printf '\033[38;5;42m%s\033[0m\n' "$*"; }
gry(){ printf '\033[38;5;244m%s\033[0m\n' "$*"; }
amb(){ printf '\033[38;5;179m%s\033[0m\n' "$*"; }
die(){ printf '\033[38;5;167m%s\033[0m\n' "$*" >&2; exit 1; }

echo
grn "⬢  DIGIT Security Scan  —  ${REPO_FULL}"
gry "   repo: ${REPO_URL}"
gry "   ref:  ${REF}"
echo

# ----- prerequisites (cannot be auto-installed: see README) -----
# NOTE: every command below is given '</dev/null'. When this script is run as
# 'curl … | bash', our stdin IS the pipe carrying the rest of the script. A child
# that reads stdin (notably 'claude -p', which accepts a piped prompt) would consume
# the remaining script bytes; bash would then hit EOF and exit silently right here.
for t in python3 git curl claude; do
  command -v "$t" >/dev/null 2>&1 || die "missing required tool: $t  — install it and re-run (see README.md)."
done
if ! claude -p 'reply with: ok' </dev/null >/dev/null 2>&1; then
  amb "note: 'claude' does not look logged in — run 'claude' once and sign in with your org account."
fi
if [ -z "${SECSCAN_TOKEN:-}" ]; then
  amb "note: SECSCAN_TOKEN not set — the scan will run but results will NOT upload to the dashboard."
  amb "      get the token from your administrator, then:  export SECSCAN_TOKEN='...'  and re-run."
fi

# ----- isolated, timestamped venv (never conflicts; torn down on exit) -----
WORK="$(mktemp -d -t secscan-XXXXXX)"
VENV="${HOME}/.cache/cms-secscan/venv-$(date +%Y%m%d-%H%M%S)-$$"
cleanup(){ deactivate >/dev/null 2>&1 || true; rm -rf "$VENV" "$WORK" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

gry "   creating a fresh environment…"
mkdir -p "$(dirname "$VENV")"
python3 -m venv "$VENV" </dev/null
# shellcheck disable=SC1091
source "$VENV/bin/activate"
python -m pip install -q --upgrade pip </dev/null >/dev/null 2>&1 || true

# ----- fetch the tool + install deps into the venv -----
mkdir -p "$WORK/scripts"
curl -fsSL "${RAW}/requirements.txt"            -o "$WORK/requirements.txt"            </dev/null || die "could not fetch requirements.txt @ ${REF}"
curl -fsSL "${RAW}/scan.py"                     -o "$WORK/scan.py"                     </dev/null || die "could not fetch scan.py @ ${REF}"
curl -fsSL "${RAW}/scripts/build_audit_xlsx.py" -o "$WORK/scripts/build_audit_xlsx.py" </dev/null || die "could not fetch scripts/build_audit_xlsx.py @ ${REF}"
python -m pip install -q -r "$WORK/requirements.txt" </dev/null

# ----- run (interactive). '</dev/tty' re-attaches the keyboard, since our own stdin
#        is the curl|bash pipe, not the terminal. -----
python "$WORK/scan.py" </dev/tty
