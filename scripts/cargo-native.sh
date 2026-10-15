#!/bin/sh
set -eu

# Rosetta Node must not pass its x86_64 launch preference to Apple's ARM tools.
if [ "$(/usr/sbin/sysctl -in sysctl.proc_translated 2>/dev/null || true)" = "1" ]; then
  exec /usr/bin/arch -arm64 cargo "$@"
fi

exec cargo "$@"
