#!/usr/bin/env bash

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "Skipping @repo/macos Swift checks: Xcode is only available on macOS."
    exit 0
fi

if ! xcrun --find swift-format >/dev/null 2>&1; then
    echo "error: swift-format is unavailable in the selected Xcode toolchain." >&2
    exit 1
fi

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "${script_directory}/.."

case "${1:-lint}" in
    lint)
        exec xcrun swift-format lint --strict --parallel --recursive TimerMac TimerMacTests
        ;;
    format)
        exec xcrun swift-format format --in-place --parallel --recursive TimerMac TimerMacTests
        ;;
    *)
        echo "usage: $0 [lint|format]" >&2
        exit 64
        ;;
esac
