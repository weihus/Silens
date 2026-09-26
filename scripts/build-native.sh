#!/usr/bin/env bash
#
# build-native.sh — build Silens in native arm64, bypassing Rosetta.
#
# WHY THIS EXISTS
#   This machine's terminal can run under Rosetta (x86_64), but the Rust
#   toolchain targets aarch64-apple-darwin and the system cc/ar/libxcrun
#   are arm64-only. Under Rosetta the linker spawns `cc` in an x86_64
#   context, which can't dlopen the arm64 libxcrun -> "linking with `cc`
#   failed". Prefacing with `arch -arm64` plus explicit CC/CXX/AR wrappers
#   forces every toolchain subprocess onto the arm64 slice.
#
# USAGE
#   ./scripts/build-native.sh            # release .app + .dmg
#   ./scripts/build-native.sh --dev      # debug build only
#   ./scripts/build-native.sh --no-dmg   # skip DMG bundling
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO/src-tauri"
CC_DIR="/tmp/silens-arm64-toolchain"

# ---- 1. Create arm64 wrappers for cc/clang/ar -----------------------------
mkdir -p "$CC_DIR"
for tool in cc clang ar; do
  cat > "$CC_DIR/$tool" <<EOF
#!/bin/sh
exec /usr/bin/arch -arm64 /usr/bin/$tool "\$@"
EOF
  chmod +x "$CC_DIR/$tool"
done

# Detect: are we already native arm64, or under Rosetta?
SHELL_ARCH="$(arch | tr -d ' \n')"
if [[ "$SHELL_ARCH" == "arm64" ]]; then
  echo ">> shell is already arm64; running build directly."
  RUN() { arch -arm64 "$@"; }
else
  echo ">> shell is Rosetta ($SHELL_ARCH); wrapping with arch -arm64 + arm64 toolchain."
  RUN() { arch -arm64 env \
      CC="$CC_DIR/cc" CXX="$CC_DIR/clang" AR="$CC_DIR/ar" \
      CARGO_TARGET_AARCH64_APPLE_DARWIN_CC="$CC_DIR/cc" \
      CARGO_TARGET_AARCH64_APPLE_DARWIN_LINKER="$CC_DIR/cc" \
      CARGO_TARGET_AARCH64_APPLE_DARWIN_AR="$CC_DIR/ar" \
      "$@"; }
fi

# ---- parse args -------------------------------------------------------------
PROFILE="release"
NO_DMG=0
for arg in "$@"; do
  case "$arg" in
    --dev)    PROFILE="debug" ;;
    --no-dmg) NO_DMG=1 ;;
    *) ;;
  esac
done

echo ">> mode: $PROFILE${NO_DMG:+, no-dmg}"
cd "$SRC"

if [[ "$PROFILE" == "debug" ]]; then
  echo ">> cargo build (debug, arm64)"
  RUN cargo build
  echo ">> done: $SRC/target/debug/app"
  exit 0
fi

echo ">> frontend (npm run build)"
( cd "$REPO" && arch -arm64 npm run build >/dev/null )

echo ">> cargo build (release, arm64)"
RUN cargo build --release

# ---- 2. DMG (Tauri's bundle_dmg.sh is a flaky create-dmg fork; use hdiutil) --
if [[ "${NO_DMG:-0}" != "1" ]]; then
  echo ">> detaching any stale Silens images"
  hdiutil info 2>/dev/null | grep -oE "/Volumes/[A-Za-z0-9._-]+" | sort -u \
    | while read -r mp; do hdiutil detach "$mp" 2>/dev/null || true; done
  for dev in $(hdiutil info 2>/dev/null | grep -E "^/dev/disk" | awk '{print $1}'); do
    hdiutil detach "$dev" 2>/dev/null || true
  done

  OUT="$SRC/target/release/bundle/dmg/Silens_1.0.0_aarch64.dmg"
  rm -f "$OUT"
  echo ">> building DMG with hdiutil -> $OUT"
  hdiutil create -volname "Silens" -ov -format UDZO \
    -srcfolder "$SRC/target/release/bundle/macos" \
    "$OUT" 2>&1 | grep -viE "WARNING|deprecated|diskutil" || true

  echo ">> DMG ready: $OUT"
fi

echo ">> all done."
echo "   app : $SRC/target/release/bundle/macos/Silens.app"
[[ "${NO_DMG:-0}" != "1" ]] && echo "   dmg : $SRC/target/release/bundle/dmg/Silens_1.0.0_aarch64.dmg"
