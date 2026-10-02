#!/usr/bin/env bash
# Install Phaneroo SACCO transactional alerts on the droplet.
# Invoked by Deploy SACCO Alerts over SSH. Do not run it from a laptop
# against the live host.
#
# Usage:
#   install-on-host.sh --prepare <dest> <ssh-user>
#       Create <dest>/incoming (writable by the SSH user) for rsync.
#   install-on-host.sh <dest> <env-file> <ssh-user>
#       Build a release from <dest>/incoming, switch <dest>/current to it,
#       restart, health-check, and roll back on failure.
#   install-on-host.sh --render-unit <dest> <env-file> <node-bin>
#       Print the rendered systemd unit (for review).
#
# Layout:
#   <dest>/incoming/            rsync target, owned by the SSH user
#   <dest>/releases/<id>/       release trees, root-owned and read-only
#   <dest>/current              symlink to the live release
#   /var/lib/pivot-sacco-alerts store.json, pivot-alerts:pivot-alerts 700
#   <env-file>                  root:pivot-alerts 640, never printed
#
# The service always runs as the dedicated system user pivot-alerts, never
# as the SSH deploy user. Restarts only pivot-sacco-alerts.service. Does not
# reload Caddy, nginx, Fineract, or the payments gateway.

set -euo pipefail

DEFAULT_PORT="8095"
UNIT_NAME="pivot-sacco-alerts.service"
UNIT_PATH="/etc/systemd/system/${UNIT_NAME}"
SERVICE_USER="pivot-alerts"
DATA_DIR="/var/lib/pivot-sacco-alerts"
LEGACY_ENV_FILE="/etc/pivot-sacco/alerts.env"
KEEP_RELEASES=3

die() {
  echo "$1" >&2
  exit 1
}

valid_abs_path() {
  local value="$1"
  local max="$2"
  [ "${#value}" -le "$max" ] || return 1
  [[ "${value}" =~ ^/[A-Za-z0-9._/-]+$ ]] || return 1
  [[ "${value}" != *..* ]] || return 1
  [[ "${value}" != *//* ]] || return 1
  return 0
}

validate_dest() {
  local dest="$1"
  valid_abs_path "${dest}" 512 || die "Alerts dest must be an absolute directory without '..'."
  case "${dest}" in
    /|/bin|/sbin|/usr|/usr/*|/etc|/etc/*|/var|/var/lib|/home|/home/*|/root|/root/*|/opt|/opt/pivot-sacco|/tmp|/tmp/*)
      die "Alerts dest ${dest} is too broad or under a protected/home directory."
      ;;
    */desk|*/desk/*|*/payments|*/payments/*)
      die "Alerts dest must not be the Desk or payments directory."
      ;;
    "${DATA_DIR}"|"${DATA_DIR}"/*)
      die "Alerts dest must not be the data directory."
      ;;
  esac
}

validate_env_file() {
  local dest="$1"
  local env_file="$2"
  valid_abs_path "${env_file}" 512 || die "Alerts env file must be an absolute path without '..'."
  [[ "${env_file}" == *.env ]] || die "Alerts env file must end in .env."
  case "${env_file}" in
    "${dest}"|"${dest}"/*)
      die "Alerts env file must live outside ${dest} so a deploy cannot delete it."
      ;;
    "${DATA_DIR}"|"${DATA_DIR}"/*)
      die "Alerts env file must not live in the data directory."
      ;;
  esac
}

validate_account() {
  local name="$1"
  local label="$2"
  [[ "${name}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$ ]] || die "${label} must be a simple account name."
}

validate_node_bin() {
  local node_bin="$1"
  [[ "${node_bin}" =~ ^/[A-Za-z0-9._+/-]+$ ]] || die "Refusing unusual node path."
  case "${node_bin}" in
    /home/*|/root/*)
      die "node at ${node_bin} is under a home directory (hidden by ProtectHome=true). Install Node.js 18+ as a system package."
      ;;
  esac
}

render_unit() {
  local dest="$1"
  local env_file="$2"
  local node_bin="$3"
  local template="$4"
  local rendered
  [ -f "${template}" ] || die "Missing systemd template ${template}."
  rendered="$(sed \
    -e "s#__DEST__#${dest}#g" \
    -e "s#__ENV_FILE__#${env_file}#g" \
    -e "s#__NODE_BIN__#${node_bin}#g" \
    -e "s#__DATA_DIR__#${DATA_DIR}#g" \
    "${template}")"
  if printf '%s\n' "${rendered}" | grep -E -q '__[A-Z_]+__'; then
    die "systemd unit still contains placeholders."
  fi
  printf '%s\n' "${rendered}"
}

# stdin is the script itself when run as `bash -s`, so no child may read it.
priv() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@" </dev/null
  else
    sudo -n "$@" </dev/null
  fi
}

require_priv() {
  if [ "$(id -u)" -ne 0 ]; then
    command -v sudo >/dev/null 2>&1 || die "This SSH user is not root and sudo is not installed."
    sudo -n true </dev/null 2>/dev/null || die "This SSH user needs passwordless sudo (sudo -n) to install the systemd unit and service user."
  fi
}

# ---------------------------------------------------------------------------
# --render-unit
if [ "${1:-}" = "--render-unit" ]; then
  [ "$#" -eq 4 ] || die "usage: install-on-host.sh --render-unit <dest> <env-file> <node-bin>"
  dest="${2%/}"
  env_file="$3"
  node_bin="$4"
  validate_dest "${dest}"
  validate_env_file "${dest}" "${env_file}"
  validate_node_bin "${node_bin}"
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  render_unit "${dest}" "${env_file}" "${node_bin}" "${script_dir}/pivot-sacco-alerts.service"
  exit 0
fi

# ---------------------------------------------------------------------------
# --prepare
if [ "${1:-}" = "--prepare" ]; then
  [ "$#" -eq 3 ] || die "usage: install-on-host.sh --prepare <dest> <ssh-user>"
  dest="${2%/}"
  ssh_user="$3"
  validate_dest "${dest}"
  validate_account "${ssh_user}" "ssh user"
  [ "${ssh_user}" != "${SERVICE_USER}" ] || die "Do not deploy as ${SERVICE_USER}; use a separate SSH deploy user."
  require_priv
  ssh_group="$(id -gn "${ssh_user}")"
  priv install -d -m 755 -o root -g root "${dest}" "${dest}/releases"
  priv install -d -m 700 -o "${ssh_user}" -g "${ssh_group}" "${dest}/incoming"
  echo "Prepared ${dest}/incoming for upload."
  exit 0
fi

# ---------------------------------------------------------------------------
# install
[ "$#" -eq 3 ] || die "usage: install-on-host.sh <dest> <env-file> <ssh-user>"

dest="${1%/}"
env_file="$2"
ssh_user="$3"
validate_dest "${dest}"
validate_env_file "${dest}" "${env_file}"
validate_account "${ssh_user}" "ssh user"
[ "${ssh_user}" != "${SERVICE_USER}" ] || die "Do not deploy as ${SERVICE_USER}; use a separate SSH deploy user."
require_priv
command -v systemctl >/dev/null 2>&1 || die "systemctl is not available. This deploy installs a systemd unit."

incoming="${dest}/incoming"
releases="${dest}/releases"
current="${dest}/current"

if [ ! -f "${incoming}/package.json" ] || [ ! -f "${incoming}/package-lock.json" ] || [ ! -f "${incoming}/server.js" ]; then
  die "Uploaded alerts tree at ${incoming} is incomplete."
fi
if [ ! -f "${incoming}/deploy/pivot-sacco-alerts.service" ] || [ ! -f "${incoming}/deploy/check-health.js" ]; then
  die "Alerts deploy files are missing under ${incoming}/deploy."
fi
if [ -e "${current}" ] && [ ! -L "${current}" ]; then
  die "${current} exists and is not a symlink. Move it aside before deploying."
fi

node_bin="$(command -v node || true)"
[ -n "${node_bin}" ] || die "node is not on PATH. Install Node.js 18 or newer as a system package."
case "${node_bin}" in
  /*) ;;
  *) die "node resolved to ${node_bin}, which is not absolute." ;;
esac
validate_node_bin "${node_bin}"
node_major="$("${node_bin}" -p 'Number(process.versions.node.split(".")[0])' </dev/null)"
if [ "${node_major}" -lt 18 ]; then
  die "Node.js ${node_major} is too old. Install Node.js 18 or newer."
fi
npm_bin="$(command -v npm || true)"
[ -n "${npm_bin}" ] || die "npm is not on PATH. Install it with Node.js 18+."

# --- Dedicated service user -------------------------------------------------
nologin="/usr/sbin/nologin"
[ -x "${nologin}" ] || nologin="/bin/false"
if ! id "${SERVICE_USER}" >/dev/null 2>&1; then
  priv useradd --system --no-create-home --home-dir /nonexistent \
    --shell "${nologin}" --user-group "${SERVICE_USER}"
  echo "Created system user ${SERVICE_USER}."
fi
for grp in $(id -nG "${SERVICE_USER}"); do
  case "${grp}" in
    sudo|wheel|admin|root|adm|docker)
      die "${SERVICE_USER} is a member of privileged group '${grp}'. Remove it (gpasswd -d ${SERVICE_USER} ${grp}) and redeploy."
      ;;
  esac
done
current_shell="$(getent passwd "${SERVICE_USER}" | cut -d: -f7)"
case "${current_shell}" in
  */nologin|*/false) ;;
  *) priv usermod --shell "${nologin}" "${SERVICE_USER}" ;;
esac
priv usermod --lock "${SERVICE_USER}" >/dev/null 2>&1 || true
service_group="$(id -gn "${SERVICE_USER}")"
validate_account "${service_group}" "service group"

# --- Data directory (outside releases) --------------------------------------
priv install -d -m 700 -o "${SERVICE_USER}" -g "${service_group}" "${DATA_DIR}"
priv chown "${SERVICE_USER}:${service_group}" "${DATA_DIR}"
priv chmod 700 "${DATA_DIR}"
if [ -f "${dest}/data/store.json" ] && ! priv test -e "${DATA_DIR}/store.json"; then
  priv install -m 600 -o "${SERVICE_USER}" -g "${service_group}" "${dest}/data/store.json" "${DATA_DIR}/store.json"
  echo "Copied legacy ${dest}/data/store.json to ${DATA_DIR}/store.json (original left in place)."
fi

# --- Env file (never printed) ------------------------------------------------
if priv test -L "${env_file}"; then
  die "${env_file} is a symlink. Replace it with a regular file."
fi
if ! priv test -e "${env_file}"; then
  priv install -d -m 755 -o root -g root "$(dirname "${env_file}")"
  if [ "${env_file}" != "${LEGACY_ENV_FILE}" ] && priv test -f "${LEGACY_ENV_FILE}"; then
    priv install -m 640 -o root -g "${service_group}" "${LEGACY_ENV_FILE}" "${env_file}"
    echo "Copied legacy ${LEGACY_ENV_FILE} to ${env_file}. Remove the legacy file once the new one is confirmed."
  else
    priv install -m 640 -o root -g "${service_group}" /dev/null "${env_file}"
    echo "warning: ${env_file} did not exist; created it empty. Alerts will dry-run and refuse non-health routes until FINERACT_URL/ALERTS_SERVICE_KEY are set there."
  fi
fi
priv chown "root:${service_group}" "${env_file}"
priv chmod 640 "${env_file}"

env_has() {
  # True when KEY is assigned a non-empty value. Prints nothing.
  priv grep -E -q "^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=[[:space:]]*[^[:space:]#]" "${env_file}"
}
env_plain_value() {
  # Only for non-secret keys (HOST, PORT, ALERTS_LIVE).
  priv grep -E "^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=" "${env_file}" \
    | tail -n 1 | sed -E 's/^[^=]*=[[:space:]]*//; s/[[:space:]]+$//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/'
}

if env_has ALERTS_API_KEY; then
  echo "warning: ${env_file} sets ALERTS_API_KEY, which is obsolete and ignored. Staff now authenticate with their Desk login (X-Staff-Authorization) and the gateway with ALERTS_SERVICE_KEY. Remove ALERTS_API_KEY."
fi
if ! env_has FINERACT_URL && ! env_has ALERTS_SERVICE_KEY; then
  echo "warning: neither FINERACT_URL nor ALERTS_SERVICE_KEY is set in ${env_file}. The service will refuse every non-health route."
fi
if ! env_has FINERACT_TENANT && env_has FINERACT_URL; then
  echo "note: FINERACT_TENANT is not set in ${env_file}; the service default tenant will be used."
fi

env_host="$(env_plain_value HOST || true)"
case "${env_host}" in
  ""|127.0.0.1) ;;
  *) die "${env_file} sets HOST=${env_host}. The alerts service must bind 127.0.0.1 on the droplet; remove HOST from the env file." ;;
esac
port="$(env_plain_value PORT || true)"
[ -n "${port}" ] || port="${DEFAULT_PORT}"
[[ "${port}" =~ ^[0-9]{1,5}$ ]] && [ "${port}" -ge 1 ] && [ "${port}" -le 65535 ] || die "PORT in ${env_file} is not a valid port."
if [ "$(env_plain_value ALERTS_LIVE || true)" = "true" ]; then
  echo "ALERTS_LIVE=true: SMS/WhatsApp will be sent live."
else
  echo "ALERTS_LIVE is not true: SMS/WhatsApp will dry-run."
fi

# --- Build the release -------------------------------------------------------
release_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
release="${releases}/${release_id}"
priv install -d -m 755 -o root -g root "${releases}"
priv install -d -m 755 -o root -g root "${release}"

build_tmp="$(mktemp -d)"
unit_tmp="${build_tmp}/unit"
unit_backup="${build_tmp}/unit.prev"
cleanup() { rm -rf "${build_tmp}"; }
trap cleanup EXIT

priv cp -R "${incoming}/." "${release}/"
# Never carry env or data files into a release.
priv rm -rf -- "${release}/.env" "${release}/alerts.env" "${release}/data" "${release}/node_modules"

node_dir="$(dirname "${node_bin}")"
priv env -i \
  PATH="${node_dir}:/usr/local/bin:/usr/bin:/bin" \
  HOME="${build_tmp}" \
  CI=true \
  npm_config_cache="${build_tmp}/npm-cache" \
  "${npm_bin}" ci --prefix "${release}" --omit=dev --ignore-scripts --no-audit --no-fund
priv rm -rf -- "${build_tmp}/npm-cache"
priv chown -R root:root "${release}"
priv chmod -R u=rwX,go=rX "${release}"

render_unit "${dest}" "${env_file}" "${node_bin}" "${release}/deploy/pivot-sacco-alerts.service" > "${unit_tmp}"
chmod 644 "${unit_tmp}"

# --- Remember the previous state for rollback --------------------------------
prev_release=""
if [ -L "${current}" ]; then
  prev_release="$(readlink "${current}")"
  case "${prev_release}" in
    "${releases}"/*) [ -d "${prev_release}" ] || prev_release="" ;;
    *) prev_release="" ;;
  esac
fi
had_unit=0
if priv test -f "${UNIT_PATH}"; then
  priv cat "${UNIT_PATH}" > "${unit_backup}"
  had_unit=1
fi

switch_current() {
  local target="$1"
  priv ln -sfn "${target}" "${current}.new"
  priv mv -Tf "${current}.new" "${current}"
}

health_ok() {
  local attempt
  for attempt in $(seq 1 20); do
    if "${node_bin}" "${current}/deploy/check-health.js" "${port}" 127.0.0.1 </dev/null >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

show_diagnostics() {
  priv systemctl status "${UNIT_NAME}" --no-pager || true
  priv journalctl -u "${UNIT_NAME}" -n 50 --no-pager || true
}

rollback() {
  echo "Deploy of ${release_id} failed. Rolling back." >&2
  show_diagnostics
  if [ -n "${prev_release}" ]; then
    switch_current "${prev_release}"
  else
    priv rm -f "${current}"
  fi
  if [ "${had_unit}" -eq 1 ]; then
    priv install -m 644 "${unit_backup}" "${UNIT_PATH}"
  else
    priv systemctl disable "${UNIT_NAME}" >/dev/null 2>&1 || true
    priv systemctl stop "${UNIT_NAME}" >/dev/null 2>&1 || true
    priv rm -f "${UNIT_PATH}"
  fi
  priv systemctl daemon-reload
  if [ "${had_unit}" -eq 1 ]; then
    priv systemctl reset-failed "${UNIT_NAME}" >/dev/null 2>&1 || true
    if priv systemctl restart "${UNIT_NAME}"; then
      echo "Restored the previous unit${prev_release:+ and release ${prev_release}}." >&2
    else
      echo "Restart of the previous version also failed. Investigate on the host." >&2
    fi
  fi
  priv rm -rf -- "${release}"
  exit 1
}

# --- Switch, restart, verify -------------------------------------------------
switch_current "${release}"
priv install -m 644 "${unit_tmp}" "${UNIT_PATH}"
priv systemctl daemon-reload
priv systemctl enable "${UNIT_NAME}" >/dev/null
priv systemctl reset-failed "${UNIT_NAME}" >/dev/null 2>&1 || true
if ! priv systemctl restart "${UNIT_NAME}"; then
  echo "systemctl restart ${UNIT_NAME} failed." >&2
  rollback
fi
if ! health_ok; then
  echo "Alerts did not answer on 127.0.0.1:${port}/v1/health." >&2
  "${node_bin}" "${current}/deploy/check-health.js" "${port}" 127.0.0.1 </dev/null || true
  rollback
fi
"${node_bin}" "${current}/deploy/check-health.js" "${port}" 127.0.0.1 </dev/null

# --- Prune old releases (keep the newest KEEP_RELEASES) -----------------------
mapfile -t all_releases < <(priv find "${releases}" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort)
excess=$(( ${#all_releases[@]} - KEEP_RELEASES ))
if [ "${excess}" -gt 0 ]; then
  for old in "${all_releases[@]:0:${excess}}"; do
    [[ "${old}" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9]+$ ]] || continue
    [ "${releases}/${old}" != "${release}" ] || continue
    priv rm -rf -- "${releases:?}/${old}"
    echo "Pruned old release ${old}."
  done
fi

if [ -f "${dest}/server.js" ]; then
  echo "note: legacy files from the pre-release layout remain directly under ${dest} (server.js, src/, data/, ...). They are unused now; remove them after confirming ${DATA_DIR}/store.json."
fi

echo "Alerts release ${release_id} is live on 127.0.0.1:${port} as ${SERVICE_USER}. Fineract, Caddy, nginx, Desk, and payments were not restarted."
