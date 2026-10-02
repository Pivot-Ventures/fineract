#!/usr/bin/env bash
# Install Phaneroo SACCO transactional alerts on the droplet.
# Invoked by Deploy SACCO Alerts over SSH. Do not run it from a laptop
# against the live host.
#
# Usage:
#   install-on-host.sh <dest> <env-file> <ssh-user>
#   install-on-host.sh --render-unit <dest> <env-file> <service-user> <service-group> <node-bin>
#
# Restarts only pivot-sacco-alerts.service. Does not reload Caddy, nginx,
# Fineract, or the payments gateway.

set -euo pipefail

PORT="8095"
UNIT_NAME="pivot-sacco-alerts.service"

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
    /|/bin|/sbin|/usr|/usr/*|/etc|/etc/*|/var|/home|/root|/opt|/opt/pivot-sacco)
      die "Alerts dest ${dest} is too broad."
      ;;
    */desk|*/desk/*|*/payments|*/payments/*)
      die "Alerts dest must not be the Desk or payments directory."
      ;;
  esac
}

validate_env_file() {
  local dest="$1"
  local env_file="$2"
  valid_abs_path "${env_file}" 512 || die "Alerts env file must be an absolute path without '..'."
  [[ "${env_file}" != */ ]] || die "Alerts env file must be a file path."
  case "${env_file}" in
    "${dest}"|"${dest}"/*)
      die "Alerts env file must live outside ${dest} so a deploy cannot delete it."
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
      die "node at ${node_bin} is under a home directory. Install Node.js 18+ as a system package so non-interactive SSH and systemd can use it."
      ;;
  esac
}

render_unit() {
  local dest="$1"
  local env_file="$2"
  local service_user="$3"
  local service_group="$4"
  local node_bin="$5"
  local template="$6"
  local rendered
  [ -f "${template}" ] || die "Missing systemd template ${template}."
  rendered="$(sed \
    -e "s#__DEST__#${dest}#g" \
    -e "s#__ENV_FILE__#${env_file}#g" \
    -e "s#__SERVICE_USER__#${service_user}#g" \
    -e "s#__SERVICE_GROUP__#${service_group}#g" \
    -e "s#__NODE_BIN__#${node_bin}#g" \
    "${template}")"
  if printf '%s\n' "${rendered}" | grep -E -q '__DEST__|__ENV_FILE__|__SERVICE_USER__|__SERVICE_GROUP__|__NODE_BIN__'; then
    die "systemd unit still contains placeholders."
  fi
  printf '%s\n' "${rendered}"
}

if [ "${1:-}" = "--render-unit" ]; then
  dest="${2:-}"
  env_file="${3:-}"
  service_user="${4:-}"
  service_group="${5:-}"
  node_bin="${6:-}"
  dest="${dest%/}"
  validate_dest "${dest}"
  validate_env_file "${dest}" "${env_file}"
  validate_account "${service_user}" "service user"
  validate_account "${service_group}" "service group"
  validate_node_bin "${node_bin}"
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  render_unit "${dest}" "${env_file}" "${service_user}" "${service_group}" "${node_bin}" "${script_dir}/pivot-sacco-alerts.service"
  exit 0
fi

if [ "$#" -ne 3 ]; then
  die "usage: install-on-host.sh <dest> <env-file> <ssh-user>"
fi

dest="${1%/}"
env_file="$2"
ssh_user="$3"
validate_dest "${dest}"
validate_env_file "${dest}" "${env_file}"
validate_account "${ssh_user}" "ssh user"

if [ ! -f "${dest}/package.json" ] || [ ! -f "${dest}/package-lock.json" ] || [ ! -f "${dest}/server.js" ]; then
  die "Alerts tree at ${dest} is incomplete."
fi
if [ ! -f "${dest}/deploy/pivot-sacco-alerts.service" ] || [ ! -f "${dest}/deploy/check-health.js" ]; then
  die "Alerts deploy files are missing under ${dest}/deploy."
fi

node_bin="$(command -v node || true)"
[ -n "${node_bin}" ] || die "node is not on PATH. Install Node.js 18 or newer as a system package."
case "${node_bin}" in
  /*) ;;
  *) die "node resolved to ${node_bin}, which is not absolute." ;;
esac
validate_node_bin "${node_bin}"
node_major="$("${node_bin}" -p 'Number(process.versions.node.split(".")[0])')"
if [ "${node_major}" -lt 18 ]; then
  die "Node.js ${node_major} is too old. Install Node.js 18 or newer."
fi
command -v npm >/dev/null 2>&1 || die "npm is not on PATH. Install it with Node.js 18+."

priv() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    command -v sudo >/dev/null 2>&1 || die "This SSH user is not root and sudo is not installed."
    sudo -n "$@"
  fi
}

if [ "$(id -u)" -eq 0 ]; then
  if ! id pivot-alerts >/dev/null 2>&1; then
    nologin="/usr/sbin/nologin"
    if [ ! -x "${nologin}" ]; then
      nologin="/bin/false"
    fi
    useradd --system --no-create-home --shell "${nologin}" --user-group pivot-alerts
  fi
  service_user="pivot-alerts"
else
  service_user="${ssh_user}"
fi
validate_account "${service_user}" "service user"
service_group="$(id -gn "${service_user}")"
validate_account "${service_group}" "service group"

mkdir -p "${dest}/data"
export CI=true
(cd "${dest}" && npm ci --omit=dev --no-audit --no-fund)
if [ "$(id -u)" -eq 0 ]; then
  chown -R "${service_user}:${service_group}" "${dest}"
fi

if [ ! -e "${env_file}" ]; then
  echo "warning: ${env_file} does not exist. The service will start, and SMS/WhatsApp will dry-run until that file is created. Provider keys are read only from this host file, never from GitHub Actions."
fi

unit_tmp="$(mktemp)"
trap 'rm -f "${unit_tmp}"' EXIT
render_unit "${dest}" "${env_file}" "${service_user}" "${service_group}" "${node_bin}" "${dest}/deploy/pivot-sacco-alerts.service" > "${unit_tmp}"
chmod 644 "${unit_tmp}"

command -v systemctl >/dev/null 2>&1 || die "systemctl is not available. This deploy installs a systemd unit."
priv install -m 644 "${unit_tmp}" "/etc/systemd/system/${UNIT_NAME}"
priv systemctl daemon-reload
priv systemctl enable "${UNIT_NAME}"
if ! priv systemctl restart "${UNIT_NAME}"; then
  echo "systemctl restart ${UNIT_NAME} failed." >&2
  priv systemctl status "${UNIT_NAME}" --no-pager || true
  priv journalctl -u "${UNIT_NAME}" -n 50 --no-pager || true
  exit 1
fi

healthy=0
for _attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if "${node_bin}" "${dest}/deploy/check-health.js" "${PORT}" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 1
done

if [ "${healthy}" -ne 1 ]; then
  echo "Alerts did not answer on 127.0.0.1:${PORT}/alerts/api/v1/health." >&2
  "${node_bin}" "${dest}/deploy/check-health.js" "${PORT}" || true
  priv systemctl status "${UNIT_NAME}" --no-pager || true
  priv journalctl -u "${UNIT_NAME}" -n 50 --no-pager || true
  exit 1
fi

"${node_bin}" "${dest}/deploy/check-health.js" "${PORT}"
echo "Alerts is listening on 127.0.0.1:${PORT}. Fineract, Caddy, nginx, Desk, and payments were not restarted."
