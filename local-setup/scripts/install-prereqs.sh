#!/usr/bin/env bash
# Install everything ./deploy.sh needs on the machine you run it FROM
# (the "controller"). Safe to re-run: every step checks first and skips
# when the requirement is already met.
#
#   ./install-prereqs.sh            # install what is missing
#   ./install-prereqs.sh --check    # report only, change nothing
#   ./install-prereqs.sh --help
#
# What it installs
#   git, curl, rsync, unzip           via your distro's package manager
#   python3 + venv + pip              via your distro's package manager
#   Node.js 20 + npm                  NodeSource on Debian/RHEL, distro repo elsewhere
#   ansible-core (<2.19), ansible-lint, yamllint   into a private venv,
#                                     symlinked into ~/.local/bin
#   the ansible collections           ansible-galaxy -r ansible/requirements.yml
#
# Supported: Debian/Ubuntu (+Mint, Pop!_OS), RHEL/Fedora/Rocky/Alma/CentOS
# Stream, Arch/Manjaro/EndeavourOS, openSUSE/SLES. Other distros: the script
# tells you exactly which packages to install by hand and stops.
#
# Why a private venv for ansible? Ubuntu 24.04, Debian 12+, Fedora 38+ and
# Homebrew Python all refuse `pip install` outside a virtualenv (PEP 668,
# "error: externally-managed-environment"). A venv works identically on every
# distro and never fights the system package manager.
#
# NOT installed: Docker. The Ansible playbook installs Docker on the *target*
# itself, including when the target is this same machine.

set -euo pipefail

# ── Constants ────────────────────────────────────────────────────────────────

readonly NODE_MAJOR=20          # matches ansible/tasks/ensure-node20.yml
readonly PY_MIN_MINOR=9         # the oldest ansible-core this playbook accepts
                                # (2.15) needs 3.9; newer ones want 3.10/3.11
                                # and pip resolves to whatever this Python
                                # supports

# The playbook BREAKS on ansible-core >= 2.19 — see WINDOWS-QUICKSTART.md, and
# the "Conditional result was ..." failures it produces at play start. An
# unpinned `pip install ansible` happily lands on 2.21, so pin it here and
# verify afterwards rather than trusting the resolver.
readonly ANSIBLE_CORE_MAX="2.19"
readonly VENV_DIR="${DIGIT_ANSIBLE_VENV:-$HOME/.local/share/digit-ansible}"
readonly BIN_DIR="$HOME/.local/bin"
readonly VENV_TOOLS=(ansible ansible-playbook ansible-galaxy ansible-config
                     ansible-doc ansible-inventory ansible-vault ansible-lint
                     yamllint)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly ANSIBLE_DIR="$SCRIPT_DIR/../ansible"

CHECK_ONLY=0
FAILED=0
NOTES=("")   # placeholder stripped before use; see install_base

# ── Output helpers ───────────────────────────────────────────────────────────

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'
  C_DIM=$'\033[2m'; C_B=$'\033[1m'; C_0=$'\033[0m'
else
  C_OK=''; C_WARN=''; C_ERR=''; C_DIM=''; C_B=''; C_0=''
fi

step() { printf '\n%s==> %s%s\n' "$C_B" "$*" "$C_0"; }
ok()   { printf '  %s[ok]%s   %s\n'   "$C_OK"   "$C_0" "$*"; }
skip() { printf '  %s[skip]%s %s\n'   "$C_DIM"  "$C_0" "$*"; }
warn() { printf '  %s[warn]%s %s\n'   "$C_WARN" "$C_0" "$*"; }
err()  { printf '  %s[FAIL]%s %s\n'   "$C_ERR"  "$C_0" "$*"; FAILED=1; }
note() { NOTES+=("$*"); }
die()  { printf '\n%sERROR:%s %s\n' "$C_ERR" "$C_0" "$*" >&2; exit 1; }

usage() {
  sed -n '2,29p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
}

for arg in "$@"; do
  case "$arg" in
    --check|-n|--dry-run) CHECK_ONLY=1 ;;
    --help|-h)            usage ;;
    *) die "unknown option '$arg' (try --help)" ;;
  esac
done

# ── Privilege escalation ─────────────────────────────────────────────────────

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  else
    die "not running as root and 'sudo' is not installed. Re-run as root, or install sudo first."
  fi
fi

# Ask for the password the first time a system package is actually needed —
# never on a box where everything is already installed, and never in --check
# mode. Returns non-zero if it cannot get it, so the caller can report which
# packages the operator has to install by hand instead of aborting the run.
# Run a command as root. `$SUDO cmd` works when SUDO is "sudo" and also when it
# is empty (the word just vanishes) — but NOT when the command needs sudo's own
# flags: `$SUDO -E bash -` becomes `-E bash -` for a root user and dies with
# "-E: command not found". Anything needing sudo options goes through here.
run_root() {
  if [ -n "$SUDO" ]; then
    sudo -E "$@"
  else
    "$@"
  fi
}

SUDO_PRIMED=0
prime_sudo() {
  [ -z "$SUDO" ] && return 0
  [ "$SUDO_PRIMED" -eq 1 ] && return 0
  if sudo -n true 2>/dev/null; then
    SUDO_PRIMED=1
    return 0
  fi
  printf '  %ssudo is needed to install system packages%s\n' "$C_DIM" "$C_0"
  if sudo -v; then
    SUDO_PRIMED=1
    return 0
  fi
  return 1
}

# ── Distro detection ─────────────────────────────────────────────────────────

FAMILY=""       # debian | rhel | arch | suse
PKG_MGR=""
DISTRO_NAME="unknown"

detect_distro() {
  [ -r /etc/os-release ] || die "/etc/os-release not found — cannot identify this Linux distribution."
  # shellcheck disable=SC1091
  . /etc/os-release
  DISTRO_NAME="${PRETTY_NAME:-${NAME:-$ID}}"
  local ids=" ${ID:-} ${ID_LIKE:-} "
  case "$ids" in
    *" debian "*|*" ubuntu "*)             FAMILY=debian ;;
    *" rhel "*|*" fedora "*|*" centos "*)  FAMILY=rhel ;;
    *" arch "*)                            FAMILY=arch ;;
    *" suse "*|*" opensuse "*|*" sles "*)  FAMILY=suse ;;
    *)
      cat >&2 <<EOF

This script does not know '${ID:-?}' (${DISTRO_NAME}).

Install these by hand, then run ./deploy.sh directly:
  git, curl, rsync, unzip
  python3 (>= 3.${PY_MIN_MINOR}) with the venv and pip modules
  Node.js ${NODE_MAJOR}.x and npm
  ansible, ansible-lint, yamllint  (a virtualenv avoids PEP 668 problems)
  ansible-galaxy install -r local-setup/ansible/requirements.yml
EOF
      exit 2 ;;
  esac
  case "$FAMILY" in
    debian) PKG_MGR="apt-get" ;;
    rhel)   PKG_MGR="$(command -v dnf5 || command -v dnf || command -v yum || true)"
            PKG_MGR="${PKG_MGR##*/}"
            [ -n "$PKG_MGR" ] || die "no dnf/yum found on a RHEL-family system" ;;
    arch)   PKG_MGR="pacman" ;;
    suse)   PKG_MGR="zypper" ;;
  esac
}

APT_UPDATED=0
pkg_install() {
  # Install one or more distro packages. No-op in --check mode.
  [ "$#" -gt 0 ] || return 0
  if [ "$CHECK_ONLY" -eq 1 ]; then
    warn "would install: $*"
    return 0
  fi
  if ! prime_sudo; then
    err "cannot get sudo — install these by hand and re-run: $*"
    return 1
  fi
  case "$FAMILY" in
    debian)
      if [ "$APT_UPDATED" -eq 0 ]; then
        $SUDO apt-get update -qq
        APT_UPDATED=1
      fi
      DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y -qq "$@" ;;
    rhel)  $SUDO "$PKG_MGR" install -y -q "$@" ;;
    arch)  $SUDO pacman -S --needed --noconfirm "$@" ;;
    suse)  $SUDO zypper --non-interactive install -y "$@" ;;
  esac
}

# ── 1. Base tools ────────────────────────────────────────────────────────────

install_base() {
  step "Base tools (git, curl, rsync, unzip)"
  # Seeded with a placeholder that is stripped below: `${#arr[@]}` on an empty
  # array is an unbound-variable error under `set -u` on bash 4.2/4.3.
  local want=("") have=("")
  local t
  for t in git curl rsync unzip; do
    if command -v "$t" >/dev/null 2>&1; then have+=("$t"); else want+=("$t"); fi
  done
  have=("${have[@]:1}"); want=("${want[@]:1}")
  [ "${#have[@]}" -gt 0 ] && skip "already present: ${have[*]}"
  if [ "${#want[@]}" -eq 0 ]; then
    return 0
  fi
  pkg_install "${want[@]}" || return 0
  for t in "${want[@]}"; do
    if command -v "$t" >/dev/null 2>&1; then ok "$t"; else
      [ "$CHECK_ONLY" -eq 1 ] || err "$t still not on PATH after install"
    fi
  done
}

# ── 2. Python ────────────────────────────────────────────────────────────────

PYTHON=""

install_python() {
  step "Python 3 with venv and pip"

  local pkgs=()
  case "$FAMILY" in
    debian) pkgs=(python3 python3-venv python3-pip) ;;
    rhel)   pkgs=(python3 python3-pip) ;;   # venv ships inside python3 here
    arch)   pkgs=(python python-pip) ;;
    suse)   pkgs=(python3 python3-pip) ;;
  esac

  if ! command -v python3 >/dev/null 2>&1; then
    pkg_install "${pkgs[@]}" || return 0
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    [ "$CHECK_ONLY" -eq 1 ] && { warn "python3 missing"; return 0; }
    err "python3 still not on PATH"; return 0
  fi
  PYTHON="$(command -v python3)"

  local ver minor
  ver="$($PYTHON -c 'import sys;print("%d.%d"%sys.version_info[:2])')"
  minor="${ver#*.}"
  if [ "${ver%%.*}" -lt 3 ] || { [ "${ver%%.*}" -eq 3 ] && [ "$minor" -lt "$PY_MIN_MINOR" ]; }; then
    err "python $ver is too old — need 3.$PY_MIN_MINOR or newer"
    return 0
  fi
  ok "python $ver at $PYTHON"

  # `venv` is a separate package on Debian/Ubuntu and its absence only shows up
  # when you try to use it, with a message that names the wrong package.
  if ! $PYTHON -c 'import venv, ensurepip' >/dev/null 2>&1; then
    pkg_install "${pkgs[@]}" || return 0
    if ! $PYTHON -c 'import venv, ensurepip' >/dev/null 2>&1; then
      [ "$CHECK_ONLY" -eq 1 ] && { warn "python venv module missing"; return 0; }
      err "python3 cannot create virtualenvs (venv/ensurepip missing)"
      return 0
    fi
  fi
  ok "venv module available"
}

# ── 3. Node.js ───────────────────────────────────────────────────────────────

node_major() {
  command -v node >/dev/null 2>&1 || { echo 0; return; }
  node --version 2>/dev/null | sed -n 's/^v\([0-9]\{1,\}\)\..*/\1/p' | head -1 | grep -q . \
    && node --version | sed -n 's/^v\([0-9]\{1,\}\)\..*/\1/p' || echo 0
}

install_node() {
  step "Node.js $NODE_MAJOR and npm"
  # The controller builds digit-ui and the configurator, so node lives HERE,
  # not only on the target.
  local have; have="$(node_major)"
  if [ "$have" -ge "$NODE_MAJOR" ] && command -v npm >/dev/null 2>&1; then
    skip "node v$(node --version | tr -d v) and npm $(npm --version) already installed"
    return 0
  fi
  if [ "$have" -gt 0 ] && [ "$have" -lt "$NODE_MAJOR" ]; then
    note "Node v$have was replaced with Node $NODE_MAJOR. If another project needs the old version, manage it with nvm instead."
  fi
  # Ubuntu's archive nodejs is v18 AND ships no npm — the same trap
  # ansible/tasks/ensure-node20.yml documents. Use NodeSource on deb/rpm.
  if [ "$CHECK_ONLY" -eq 1 ]; then
    warn "would install Node.js $NODE_MAJOR (found: $( [ "$have" -eq 0 ] && echo none || echo "v$have" ))"
    return 0
  fi
  if ! prime_sudo; then
    err "cannot get sudo — install Node.js $NODE_MAJOR by hand and re-run"
    return 0
  fi
  case "$FAMILY" in
    debian)
      pkg_install ca-certificates gnupg || return 0
      curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | run_root bash -
      APT_UPDATED=1
      DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y -qq nodejs ;;
    rhel)
      curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | run_root bash -
      $SUDO "$PKG_MGR" install -y -q nodejs ;;
    arch)
      pkg_install nodejs npm || return 0 ;;
    suse)
      pkg_install "nodejs${NODE_MAJOR}" "npm${NODE_MAJOR}" 2>/dev/null || pkg_install nodejs npm ;;
  esac
  have="$(node_major)"
  if [ "$have" -ge "$NODE_MAJOR" ] && command -v npm >/dev/null 2>&1; then
    ok "node $(node --version), npm $(npm --version)"
  else
    err "Node $NODE_MAJOR not available after install (found: $( [ "$have" -eq 0 ] && echo none || echo "v$have" ))"
  fi
}

# ── 4. Ansible in a private venv ─────────────────────────────────────────────

install_ansible() {
  step "Ansible, ansible-lint and yamllint"

  if [ "$CHECK_ONLY" -eq 1 ]; then
    local t
    local missing=()
    for t in ansible-playbook ansible-lint yamllint; do
      command -v "$t" >/dev/null 2>&1 || missing+=("$t")
    done
    if [ "${#missing[@]}" -eq 0 ]; then
      skip "$(ansible --version | head -1)"
    else
      warn "would create a venv at $VENV_DIR and install: ${missing[*]}"
    fi
    # Still check the ceiling. An existing ansible-core >= 2.19 is exactly the
    # condition the pin exists to prevent, and reporting the box as ready when
    # the deploy cannot run would defeat the point of --check.
    if command -v ansible >/dev/null 2>&1; then
      check_ansible_core "$(command -v ansible)"
    fi
    return 0
  fi

  [ -n "$PYTHON" ] || { err "python3 unavailable — skipping ansible"; return 0; }

  if [ ! -x "$VENV_DIR/bin/python" ]; then
    mkdir -p "$(dirname "$VENV_DIR")"
    "$PYTHON" -m venv "$VENV_DIR"
    ok "created venv at $VENV_DIR"
  else
    skip "venv already at $VENV_DIR"
  fi

  # --upgrade keeps re-runs cheap and idempotent; pip's own resolver decides
  # whether anything actually changes.
  "$VENV_DIR/bin/python" -m pip install --quiet --upgrade pip wheel

  # A constraints file, not just a version spec on the command line: it also
  # stops ansible-lint from pulling a newer ansible-core in as a dependency.
  local constraints="$VENV_DIR/digit-constraints.txt"
  printf 'ansible-core<%s\n' "$ANSIBLE_CORE_MAX" > "$constraints"

  # ansible-core, not the batteries-included `ansible` package: the collections
  # this playbook needs are installed from requirements.yml a step later, so the
  # 800-odd bundled ones are pure download.
  "$VENV_DIR/bin/python" -m pip install --quiet --upgrade -c "$constraints" \
      ansible-core ansible-lint yamllint \
    || { err "pip install of ansible-core failed — see the output above"; return 0; }

  mkdir -p "$BIN_DIR"
  local t linked=0
  for t in "${VENV_TOOLS[@]}"; do
    if [ -x "$VENV_DIR/bin/$t" ]; then
      # Only ever replace a symlink we own. A real binary from the distro
      # package manager is left alone, and reported instead.
      if [ -e "$BIN_DIR/$t" ] && [ ! -L "$BIN_DIR/$t" ]; then
        warn "$BIN_DIR/$t exists and is not a symlink — left untouched"
        continue
      fi
      ln -sfn "$VENV_DIR/bin/$t" "$BIN_DIR/$t"
      linked=$((linked + 1))
    fi
  done
  ok "linked $linked tools into $BIN_DIR"

  case ":$PATH:" in
    *":$BIN_DIR:"*) : ;;
    *) note "$BIN_DIR is not on your PATH. Add this to ~/.bashrc or ~/.zshrc, then open a new shell:
             export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
  esac

  local ver
  ver="$("$VENV_DIR/bin/ansible" --version 2>/dev/null | head -1)" || ver=""
  [ -n "$ver" ] && ok "$ver"

  check_ansible_core "$VENV_DIR/bin/ansible"
}

# Read the core version out of `ansible --version` and fail if it is at or above
# the ceiling. Belt and braces over the constraints file: a resolver surprise
# here costs a whole deploy, and the failure it produces mid-play
# ("Conditional result was ...") does not point back at the version.
check_ansible_core() {
  local bin="$1" line core
  line="$("$bin" --version 2>/dev/null | head -1)" || return 0
  core="$(printf '%s' "$line" | sed -n 's/.*core \([0-9][0-9]*\.[0-9][0-9]*\).*/\1/p')"
  if [ -z "$core" ]; then
    warn "could not read the ansible-core version from: $line"
    return 0
  fi
  # Numeric compare on major.minor without bc.
  local cmaj cmin xmaj xmin
  cmaj="${core%%.*}"; cmin="${core#*.}"
  xmaj="${ANSIBLE_CORE_MAX%%.*}"; xmin="${ANSIBLE_CORE_MAX#*.}"
  if [ "$cmaj" -gt "$xmaj" ] || { [ "$cmaj" -eq "$xmaj" ] && [ "$cmin" -ge "$xmin" ]; }; then
    err "ansible-core $core is too new — the playbook requires < $ANSIBLE_CORE_MAX.
           Pin it by hand:  $VENV_DIR/bin/pip install 'ansible-core<$ANSIBLE_CORE_MAX'"
  else
    ok "ansible-core $core (< $ANSIBLE_CORE_MAX, as the playbook requires)"
  fi
}

# ── 5. Ansible collections ───────────────────────────────────────────────────

install_collections() {
  step "Ansible collections (ansible.posix, community.general)"
  local req="$ANSIBLE_DIR/requirements.yml"
  if [ ! -f "$req" ]; then
    warn "requirements.yml not found at $req — skipping (run this script from the repo)"
    return 0
  fi
  if [ "$CHECK_ONLY" -eq 1 ]; then
    warn "would run: ansible-galaxy collection install -r $req"
    return 0
  fi
  local galaxy="$VENV_DIR/bin/ansible-galaxy"
  [ -x "$galaxy" ] || galaxy="$(command -v ansible-galaxy || true)"
  [ -n "$galaxy" ] || { err "ansible-galaxy not found"; return 0; }
  if "$galaxy" collection install -r "$req" >/dev/null 2>&1; then
    ok "collections installed"
  else
    err "ansible-galaxy failed. Re-run it by hand to see why:
           $galaxy collection install -r $req"
  fi
}

# ── 6. Final verification ────────────────────────────────────────────────────

verify() {
  step "Verifying"
  local t
  for t in git curl rsync python3 node npm; do
    if command -v "$t" >/dev/null 2>&1; then ok "$t — $(command -v "$t")"; else err "$t is missing"; fi
  done
  for t in ansible-playbook ansible-lint yamllint; do
    if command -v "$t" >/dev/null 2>&1; then
      ok "$t — $(command -v "$t")"
    elif [ -x "$VENV_DIR/bin/$t" ]; then
      warn "$t installed at $VENV_DIR/bin/$t but not on PATH yet"
    else
      err "$t is missing"
    fi
  done

  # The one that matters is whichever `ansible` deploy.sh will actually find,
  # which may be a distro package shadowing ours rather than the venv.
  if command -v ansible >/dev/null 2>&1; then
    check_ansible_core "$(command -v ansible)"
  fi
}

# ── Main ─────────────────────────────────────────────────────────────────────

main() {
  detect_distro
  printf '%sDIGIT deploy prerequisites%s\n' "$C_B" "$C_0"
  printf '  distribution : %s\n' "$DISTRO_NAME"
  printf '  family       : %s (%s)\n' "$FAMILY" "$PKG_MGR"
  printf '  mode         : %s\n' "$( [ "$CHECK_ONLY" -eq 1 ] && echo 'check only, nothing will change' || echo 'install' )"

  install_base
  install_python
  install_node
  install_ansible
  install_collections
  [ "$CHECK_ONLY" -eq 1 ] || verify

  NOTES=("${NOTES[@]:1}")
  if [ "${#NOTES[@]}" -gt 0 ]; then
    step "Read this"
    local n
    for n in "${NOTES[@]}"; do printf '  • %s\n' "$n"; done
  fi

  echo
  if [ "$FAILED" -ne 0 ]; then
    printf '%sSome prerequisites are still missing — see the [FAIL] lines above.%s\n' "$C_ERR" "$C_0"
    exit 1
  fi
  if [ "$CHECK_ONLY" -eq 1 ]; then
    printf '%sCheck complete.%s Re-run without --check to install anything marked [warn].\n' "$C_B" "$C_0"
  else
    printf '%sAll prerequisites are in place.%s Next: write your host_vars file, then\n' "$C_OK" "$C_0"
    printf '  cd %s && ./deploy.sh <your-tenant-name>\n' "$(cd "$ANSIBLE_DIR" 2>/dev/null && pwd || echo local-setup/ansible)"
  fi
}

main
