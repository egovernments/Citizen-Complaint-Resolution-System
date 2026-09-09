#!/usr/bin/env bash

# Load KEY=VALUE records without evaluating the file as shell code.
#
# Docker/Compose dotenv files allow unquoted values containing spaces, while
# `source file.env` parses the words after the first space as a command. That
# made a perfectly valid value such as
#
#   NOVU_SMS_BODY=Complaint {{payload.complaintNo}} status is {{payload.status}}
#
# abort the Novu bootstrap before it reached the API. This parser intentionally
# implements only the dotenv surface this bootstrap needs: comments, an
# optional `export`, quoted or unquoted values, and "caller environment wins".
# It does not eval command substitutions or expand shell expressions.
load_dotenv_defaults() {
  local env_file="$1"
  local line key value first last

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -z "$line" || "${line:0:1}" == "#" ]] && continue

    if [[ "$line" == export[[:space:]]* ]]; then
      line="${line#export}"
      line="${line#"${line%%[![:space:]]*}"}"
    fi

    if [[ "$line" != *=* ]]; then
      echo "Invalid dotenv entry in ${env_file}: ${line}" >&2
      return 1
    fi

    key="${line%%=*}"
    value="${line#*=}"
    key="${key#"${key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"

    if [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      echo "Invalid dotenv key in ${env_file}: ${key}" >&2
      return 1
    fi

    # Values already present in the caller's environment always win over the
    # tracked defaults (which intentionally contain non-secret placeholders).
    [[ -n "${!key+x}" ]] && continue

    if [[ ${#value} -ge 2 ]]; then
      first="${value:0:1}"
      last="${value:${#value}-1:1}"
      if [[ ( "$first" == "'" && "$last" == "'" ) ||
            ( "$first" == '"' && "$last" == '"' ) ]]; then
        value="${value:1:${#value}-2}"
      fi
    fi

    printf -v "$key" '%s' "$value"
    export "$key"
  done < "$env_file"
}
