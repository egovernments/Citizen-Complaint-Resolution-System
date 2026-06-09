#!/usr/bin/env bash
# DIGIT MCP Server — Installation Script
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/ChakshuGautam/DIGIT-MCP/main/install.sh | bash
#
# Or with options:
#   curl -fsSL ... | bash -s -- --client cursor --mode local
#
# Supports: claude-code, cursor, windsurf, vscode
# Modes:   remote (default, no install needed) or local (clones + builds)

set -euo pipefail

# ── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ── Defaults ─────────────────────────────────────────────────────────────────
INSTALL_DIR="${HOME}/.digit-mcp"
MCP_REMOTE_URL="https://mcp.egov.theflywheel.in/mcp"
REPO_URL="https://github.com/ChakshuGautam/DIGIT-MCP.git"
CLIENT=""
MODE=""
SKIP_PROMPTS=false
ENV_FILE=""

# ── Helpers ──────────────────────────────────────────────────────────────────
info()  { echo -e "${BLUE}▸${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
err()   { echo -e "${RED}✗${NC} $*" >&2; }
bold()  { echo -e "${BOLD}$*${NC}"; }

banner() {
  echo ""
  echo -e "${CYAN}╭──────────────────────────────────────╮${NC}"
  echo -e "${CYAN}│${NC}  ${BOLD}DIGIT MCP Server${NC} — Installer        ${CYAN}│${NC}"
  echo -e "${CYAN}│${NC}  ${DIM}eGov platform tools for Claude${NC}       ${CYAN}│${NC}"
  echo -e "${CYAN}╰──────────────────────────────────────╯${NC}"
  echo ""
}

# ── Parse args ───────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --client)  CLIENT="$2";  shift 2 ;;
    --mode)    MODE="$2";    shift 2 ;;
    --dir)     INSTALL_DIR="$2"; shift 2 ;;
    --yes|-y)  SKIP_PROMPTS=true; shift ;;
    --env)     ENV_FILE="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: install.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --client NAME   Target client: claude-code, cursor, windsurf, vscode"
      echo "  --mode MODE     Installation mode: remote (default) or local"
      echo "  --dir PATH      Local install directory (default: ~/.digit-mcp)"
      echo "  --env FILE      Path to .env file with CRS_USERNAME, CRS_PASSWORD, etc."
      echo "  --yes, -y       Skip confirmation prompts"
      echo "  --help, -h      Show this help"
      exit 0
      ;;
    *) err "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Detect OS ────────────────────────────────────────────────────────────────
detect_os() {
  case "$(uname -s)" in
    Darwin) echo "macos" ;;
    Linux)  echo "linux" ;;
    MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
    *) echo "unknown" ;;
  esac
}

OS="$(detect_os)"

# ── Client config paths ─────────────────────────────────────────────────────
get_config_path() {
  local client="$1"
  case "$client" in
    claude-code)
      echo "${HOME}/.claude.json"
      ;;
    cursor)
      if [[ "$OS" == "macos" ]]; then
        echo "${HOME}/.cursor/mcp.json"
      else
        echo "${HOME}/.cursor/mcp.json"
      fi
      ;;
    windsurf)
      if [[ "$OS" == "macos" ]]; then
        echo "${HOME}/.codeium/windsurf/mcp_config.json"
      else
        echo "${HOME}/.codeium/windsurf/mcp_config.json"
      fi
      ;;
    vscode)
      if [[ "$OS" == "macos" ]]; then
        echo "${HOME}/Library/Application Support/Code/User/mcp.json"
      else
        echo "${HOME}/.config/Code/User/mcp.json"
      fi
      ;;
    *)
      err "Unsupported client: $client"
      exit 1
      ;;
  esac
}

# ── Detect installed clients ────────────────────────────────────────────────
detect_clients() {
  local found=()

  # Claude Code — check for the CLI
  if command -v claude &>/dev/null; then
    found+=("claude-code")
  elif [[ -f "${HOME}/.claude.json" ]]; then
    found+=("claude-code")
  fi

  # Cursor
  if command -v cursor &>/dev/null || [[ -d "${HOME}/.cursor" ]]; then
    found+=("cursor")
  fi

  # Windsurf
  if [[ -d "${HOME}/.codeium/windsurf" ]]; then
    found+=("windsurf")
  fi

  # VS Code
  if command -v code &>/dev/null; then
    found+=("vscode")
  fi

  echo "${found[@]}"
}

# ── Prompt user to select client ────────────────────────────────────────────
select_client() {
  local clients
  read -ra clients <<< "$(detect_clients)"

  if [[ ${#clients[@]} -eq 0 ]]; then
    warn "No supported MCP clients detected."
    echo ""
    info "Supported clients: claude-code, cursor, windsurf, vscode"
    read -rp "Enter client name: " CLIENT
    return
  fi

  if [[ ${#clients[@]} -eq 1 ]]; then
    CLIENT="${clients[0]}"
    ok "Detected client: ${BOLD}${CLIENT}${NC}"
    return
  fi

  echo ""
  bold "Detected MCP clients:"
  for i in "${!clients[@]}"; do
    echo "  $((i+1))) ${clients[$i]}"
  done
  echo ""
  read -rp "Select client [1]: " choice
  choice="${choice:-1}"
  CLIENT="${clients[$((choice-1))]}"
}

# ── Select mode ──────────────────────────────────────────────────────────────
select_mode() {
  echo ""
  bold "Installation mode:"
  echo "  1) remote  — Connect to hosted server (no install, recommended)"
  echo "  2) local   — Clone repo and run locally via stdio"
  echo ""
  read -rp "Select mode [1]: " choice
  choice="${choice:-1}"
  case "$choice" in
    1|remote) MODE="remote" ;;
    2|local)  MODE="local" ;;
    *) MODE="remote" ;;
  esac
}

# ── Write JSON config (portable, no jq required) ────────────────────────────
write_config_remote() {
  local config_path="$1"
  local client="$2"
  local dir
  dir="$(dirname "$config_path")"
  mkdir -p "$dir"

  local server_entry
  server_entry=$(cat <<'ENTRY'
{
      "type": "http",
      "url": "MCP_URL_PLACEHOLDER"
    }
ENTRY
)
  server_entry="${server_entry/MCP_URL_PLACEHOLDER/$MCP_REMOTE_URL}"

  write_mcp_entry "$config_path" "$client" "$server_entry"
}

write_config_local() {
  local config_path="$1"
  local client="$2"
  local env_args=""

  # Collect environment variables
  local crs_env="${CRS_ENVIRONMENT:-chakshu-digit}"
  local crs_user="${CRS_USERNAME:-}"
  local crs_pass="${CRS_PASSWORD:-}"

  # Read from .env file if provided
  if [[ -n "$ENV_FILE" && -f "$ENV_FILE" ]]; then
    info "Reading environment from ${ENV_FILE}"
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    crs_env="${CRS_ENVIRONMENT:-$crs_env}"
    crs_user="${CRS_USERNAME:-$crs_user}"
    crs_pass="${CRS_PASSWORD:-$crs_pass}"
  fi

  # Prompt for missing credentials
  if [[ -z "$crs_user" ]] && [[ "$SKIP_PROMPTS" != "true" ]]; then
    echo ""
    bold "DIGIT credentials (for API authentication):"
    read -rp "  Username [ADMIN]: " crs_user
    crs_user="${crs_user:-ADMIN}"
    read -rsp "  Password [eGov@123]: " crs_pass
    echo ""
    crs_pass="${crs_pass:-eGov@123}"
  fi
  crs_user="${crs_user:-ADMIN}"
  crs_pass="${crs_pass:-eGov@123}"

  local dir
  dir="$(dirname "$config_path")"
  mkdir -p "$dir"

  local server_entry
  server_entry=$(cat <<ENTRY
{
      "type": "stdio",
      "command": "node",
      "args": ["${INSTALL_DIR}/dist/index.js"],
      "env": {
        "CRS_ENVIRONMENT": "${crs_env}",
        "CRS_USERNAME": "${crs_user}",
        "CRS_PASSWORD": "${crs_pass}"
      }
    }
ENTRY
)

  write_mcp_entry "$config_path" "$client" "$server_entry"
}

# ── Merge MCP entry into existing config ─────────────────────────────────────
write_mcp_entry() {
  local config_path="$1"
  local client="$2"
  local server_entry="$3"

  if [[ -f "$config_path" ]]; then
    # File exists — use python3 to merge (available on macOS + Linux)
    python3 -c "
import json, sys, os

config_path = sys.argv[1]
server_json = sys.argv[2]
client = sys.argv[3]

# Read existing config
with open(config_path, 'r') as f:
    try:
        config = json.load(f)
    except json.JSONDecodeError:
        config = {}

# claude-code uses top-level mcpServers
# cursor/windsurf/vscode use nested mcpServers
key = 'mcpServers'
if key not in config:
    config[key] = {}

entry = json.loads(server_json)
config[key]['DIGIT-MCP'] = entry

with open(config_path, 'w') as f:
    json.dump(config, f, indent=2)
    f.write('\n')

" "$config_path" "$server_entry" "$client"
  else
    # New file
    python3 -c "
import json, sys

server_json = sys.argv[1]
entry = json.loads(server_json)
config = {'mcpServers': {'DIGIT-MCP': entry}}

with open(sys.argv[2], 'w') as f:
    json.dump(config, f, indent=2)
    f.write('\n')
" "$server_entry" "$config_path"
  fi
}

# ── Install locally (clone + build) ─────────────────────────────────────────
install_local() {
  # Check prerequisites
  local missing=()
  command -v node  &>/dev/null || missing+=("node")
  command -v npm   &>/dev/null || missing+=("npm")
  command -v git   &>/dev/null || missing+=("git")

  if [[ ${#missing[@]} -gt 0 ]]; then
    err "Missing prerequisites: ${missing[*]}"
    info "Install Node.js 18+ and git, then try again."
    exit 1
  fi

  # Check Node.js version
  local node_major
  node_major=$(node -e "console.log(process.versions.node.split('.')[0])")
  if [[ "$node_major" -lt 18 ]]; then
    err "Node.js 18+ required (found v${node_major})"
    exit 1
  fi

  # Clone or update
  if [[ -d "${INSTALL_DIR}/.git" ]]; then
    info "Updating existing installation..."
    git -C "$INSTALL_DIR" pull --ff-only 2>/dev/null || {
      warn "Pull failed, continuing with existing version"
    }
  else
    info "Cloning DIGIT-MCP..."
    git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
  fi

  # Install and build
  info "Installing dependencies..."
  (cd "$INSTALL_DIR" && npm install --omit=dev 2>&1 | tail -1)
  ok "Dependencies installed"

  info "Building..."
  (cd "$INSTALL_DIR" && npm run build 2>&1 | tail -1)
  ok "Build complete"
}

# ── Copy skills to Claude Code ───────────────────────────────────────────────
install_skills() {
  local client="$1"
  if [[ "$client" != "claude-code" ]]; then
    return
  fi

  local skills_src=""
  if [[ "$MODE" == "local" && -d "${INSTALL_DIR}/skills" ]]; then
    skills_src="${INSTALL_DIR}/skills"
  fi

  # If remote mode, download skills from GitHub
  if [[ "$MODE" == "remote" && -z "$skills_src" ]]; then
    local tmp_dir
    tmp_dir=$(mktemp -d)
    local base_url="https://raw.githubusercontent.com/ChakshuGautam/DIGIT-MCP/main/skills"

    info "Downloading Claude Code skills..."
    mkdir -p "${tmp_dir}/digit" "${tmp_dir}/digit-tenant-setup" "${tmp_dir}/digit-pgr-operations" "${tmp_dir}/digit-ui-building"

    local failed=false
    curl -fsSL "${base_url}/digit/SKILL.md" -o "${tmp_dir}/digit/SKILL.md" 2>/dev/null || failed=true
    curl -fsSL "${base_url}/digit-tenant-setup/SKILL.md" -o "${tmp_dir}/digit-tenant-setup/SKILL.md" 2>/dev/null || failed=true
    curl -fsSL "${base_url}/digit-tenant-setup/error-reference.md" -o "${tmp_dir}/digit-tenant-setup/error-reference.md" 2>/dev/null || failed=true
    curl -fsSL "${base_url}/digit-pgr-operations/SKILL.md" -o "${tmp_dir}/digit-pgr-operations/SKILL.md" 2>/dev/null || failed=true
    curl -fsSL "${base_url}/digit-ui-building/SKILL.md" -o "${tmp_dir}/digit-ui-building/SKILL.md" 2>/dev/null || failed=true
    curl -fsSL "${base_url}/digit-ui-building/ui-review-checklist.md" -o "${tmp_dir}/digit-ui-building/ui-review-checklist.md" 2>/dev/null || failed=true

    if [[ "$failed" == "true" ]]; then
      warn "Could not download skills (network issue or branch not merged yet)"
      rm -rf "$tmp_dir"
      return
    fi
    skills_src="$tmp_dir"
  fi

  if [[ -z "$skills_src" || ! -d "$skills_src" ]]; then
    return
  fi

  local skills_dest="${HOME}/.claude/skills"
  mkdir -p "$skills_dest"

  local skill_dirs=("digit" "digit-tenant-setup" "digit-pgr-operations" "digit-ui-building")
  for skill in "${skill_dirs[@]}"; do
    if [[ -d "${skills_src}/${skill}" ]]; then
      mkdir -p "${skills_dest}/${skill}"
      cp -r "${skills_src}/${skill}/." "${skills_dest}/${skill}/"
    fi
  done

  ok "Installed 4 Claude Code skills (digit, tenant-setup, pgr-operations, ui-building)"
}

# ── Main ─────────────────────────────────────────────────────────────────────
main() {
  banner

  # Select client if not specified
  if [[ -z "$CLIENT" ]]; then
    if [[ "$SKIP_PROMPTS" == "true" ]]; then
      CLIENT="claude-code"
    else
      select_client
    fi
  fi

  # Select mode if not specified
  if [[ -z "$MODE" ]]; then
    if [[ "$SKIP_PROMPTS" == "true" ]]; then
      MODE="remote"
    else
      select_mode
    fi
  fi

  local config_path
  config_path="$(get_config_path "$CLIENT")"

  echo ""
  info "Client:  ${BOLD}${CLIENT}${NC}"
  info "Mode:    ${BOLD}${MODE}${NC}"
  info "Config:  ${DIM}${config_path}${NC}"
  echo ""

  # Confirm
  if [[ "$SKIP_PROMPTS" != "true" ]]; then
    read -rp "Proceed? [Y/n] " confirm
    confirm="${confirm:-Y}"
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
      info "Cancelled."
      exit 0
    fi
    echo ""
  fi

  # Install
  if [[ "$MODE" == "local" ]]; then
    install_local
    write_config_local "$config_path" "$CLIENT"
  else
    write_config_remote "$config_path" "$CLIENT"
  fi

  ok "MCP server configured in ${config_path}"

  # Install Claude Code skills
  install_skills "$CLIENT"

  # Done
  echo ""
  echo -e "${GREEN}╭──────────────────────────────────────╮${NC}"
  echo -e "${GREEN}│${NC}  ${BOLD}Installation complete!${NC}               ${GREEN}│${NC}"
  echo -e "${GREEN}╰──────────────────────────────────────╯${NC}"
  echo ""

  if [[ "$CLIENT" == "claude-code" ]]; then
    info "Restart Claude Code, then try:"
    echo -e "  ${DIM}> set up a new city for PGR complaints${NC}"
    echo -e "  ${DIM}> file a complaint about a broken streetlight${NC}"
    echo -e "  ${DIM}> build a PGR complaint management UI${NC}"
  else
    info "Restart ${CLIENT}, then use DIGIT-MCP tools in your AI chat."
  fi
  echo ""

  if [[ "$MODE" == "remote" ]]; then
    info "Server: ${DIM}${MCP_REMOTE_URL}${NC}"
  else
    info "Server: ${DIM}${INSTALL_DIR}/dist/index.js${NC} (stdio)"
  fi
  echo ""
}

main "$@"
