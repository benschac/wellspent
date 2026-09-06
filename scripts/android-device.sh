#!/usr/bin/env bash

set -euo pipefail

readonly metro_port="${METRO_PORT:-8081}"
readonly api_port="${API_PORT:-3001}"
readonly app_id="${ANDROID_APP_ID:-com.benschac.timer}"
readonly app_scheme="${EXPO_SCHEME:-timer}"

fail() {
  printf 'android-device: %s\n' "$1" >&2
  exit 1
}

command -v adb >/dev/null 2>&1 || fail "adb is not installed or is not on PATH"

for port in "$metro_port" "$api_port"; do
  case "$port" in
    ''|*[!0-9]*) fail "ports must be numeric" ;;
  esac
done

device_serial="${ANDROID_SERIAL:-}"

if [[ -n "$device_serial" ]]; then
  [[ "$(adb -s "$device_serial" get-state 2>/dev/null)" == "device" ]] ||
    fail "ANDROID_SERIAL=$device_serial is not an authorized connected device"
else
  device_serials=()

  while IFS=$'\t' read -r serial state; do
    if [[ "$state" == "device" ]]; then
      device_serials+=("$serial")
    fi
  done < <(adb devices | tail -n +2)

  case "${#device_serials[@]}" in
    0) fail "no authorized Android device is connected" ;;
    1) device_serial="${device_serials[0]}" ;;
    *) fail "multiple Android devices are connected; set ANDROID_SERIAL" ;;
  esac
fi

for port in "$metro_port" "$api_port"; do
  if command -v nc >/dev/null 2>&1 &&
    ! nc -z 127.0.0.1 "$port" >/dev/null 2>&1; then
    fail "nothing is listening on localhost:$port"
  fi

  adb -s "$device_serial" reverse "tcp:$port" "tcp:$port"
done

readonly encoded_metro_url="http%3A%2F%2Flocalhost%3A${metro_port}"
readonly dev_client_url="${app_scheme}://expo-development-client/?url=${encoded_metro_url}"

printf 'Reversed Metro tcp:%s and API tcp:%s on %s.\n' \
  "$metro_port" "$api_port" "$device_serial"

adb -s "$device_serial" shell am force-stop "$app_id"
adb -s "$device_serial" shell am start -W \
  -a android.intent.action.VIEW \
  -d "$dev_client_url" \
  "$app_id"
