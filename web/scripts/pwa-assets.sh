#!/usr/bin/env bash
# Renders the home-screen icons and the iOS launch screens into public/.
#
# iOS ignores SVG icons and manifest icons for "Add to Home Screen": without
# a PNG apple-touch-icon it saves a blurry screenshot of the page instead. It
# also shows a launch image only if one matches the device's exact size, so
# there is one per iPhone screen below.
#
# The mark is the favicon's: a red ring around a red core on Ultron's near-black.
#
# Re-run after changing the mark:  npm run pwa-assets   (needs google-chrome)
set -euo pipefail

cd "$(dirname "$0")/.."
OUT=public
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

CHROME=${CHROME:-google-chrome}
INK="#140808"
RED="#ff2a2a"

# The mark on a 64-unit canvas, centred on (32, 32); $1 scales it.
mark() {
  local k=$1
  cat <<EOF
<defs><filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
  <feGaussianBlur stdDeviation="$(awk "BEGIN{print 2.2 * $k}")" result="b"/>
  <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
</filter></defs>
<g filter="url(#glow)" transform="translate(32 32) scale($k) translate(-32 -32)">
  <circle cx="32" cy="32" r="18" fill="none" stroke="$RED" stroke-width="4"/>
  <circle cx="32" cy="32" r="8" fill="$RED"/>
</g>
EOF
}

# render <html-file> <width> <height> <png> [scale]
render() {
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --force-device-scale-factor="${5:-1}" --window-size="$2,$3" \
    --virtual-time-budget=2000 --screenshot="$4" "file://$1" 2>/dev/null
}

# icon <size> <png> <maskable: 0|1>
# Full-bleed square: iOS and Android cut the corners themselves. The maskable
# variant shrinks the mark into the central safe zone.
icon() {
  local size=$1 png=$2 maskable=$3 k=1.15
  [[ $maskable == 1 ]] && k=0.85
  cat >"$WORK/icon.html" <<EOF
<!doctype html><html><head><style>
html,body{margin:0;background:$INK}
svg{display:block;width:${size}px;height:${size}px}
</style></head><body>
<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="$INK"/>$(mark $k)</svg>
</body></html>
EOF
  render "$WORK/icon.html" "$size" "$size" "$png"
}

# splash <css-width> <css-height> <pixel-ratio>
splash() {
  local w=$1 h=$2 dpr=$3
  local png="$OUT/splash/splash-$((w * dpr))x$((h * dpr)).png"
  cat >"$WORK/splash.html" <<EOF
<!doctype html><html><head><style>
html,body{margin:0;width:${w}px;height:${h}px;background:$INK;overflow:hidden}
body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px}
svg{width:112px;height:112px}
.name{font:700 22px/1 ui-sans-serif,system-ui,sans-serif;color:$RED;letter-spacing:.42em;padding-left:.42em;
  text-shadow:0 0 10px rgba(255,42,42,.6),0 0 28px rgba(255,42,42,.3)}
</style></head><body><svg viewBox="0 0 64 64">$(mark 1)</svg><div class="name">ULTRON</div></body></html>
EOF
  render "$WORK/splash.html" "$w" "$h" "$png" "$dpr"
  printf '    <link rel="apple-touch-startup-image" href="/splash/%s" media="(device-width: %spx) and (device-height: %spx) and (-webkit-device-pixel-ratio: %s) and (orientation: portrait)" />\n' \
    "$(basename "$png")" "$w" "$h" "$dpr"
}

mkdir -p "$OUT/splash"
rm -f "$OUT"/splash/*.png

# The favicon, as a file: the manifest lists it and browsers that take SVG use it.
cat >"$OUT/icon.svg" <<EOF
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="$INK"/><circle cx="16" cy="16" r="9" fill="none" stroke="$RED" stroke-width="2"/><circle cx="16" cy="16" r="4" fill="$RED"/></svg>
EOF

icon 180 "$OUT/apple-touch-icon.png" 0
icon 192 "$OUT/icon-192.png" 0
icon 512 "$OUT/icon-512.png" 0
icon 512 "$OUT/icon-maskable-512.png" 1

echo "<!-- launch screens: paste into index.html -->"
# CSS width, height, pixel ratio of each iPhone screen size still in use.
splash 440 956 3 # 16 Pro Max, 17 Pro Max
splash 420 912 3 # Air
splash 430 932 3 # 14 Pro Max, 15 Plus/Pro Max, 16 Plus
splash 428 926 3 # 12/13 Pro Max, 14 Plus
splash 402 874 3 # 16 Pro, 17, 17 Pro
splash 393 852 3 # 14 Pro, 15, 15 Pro, 16
splash 390 844 3 # 12, 13, 14, 16e
splash 375 812 3 # X, XS, 11 Pro, 12/13 mini
splash 414 896 3 # XS Max, 11 Pro Max
splash 414 896 2 # XR, 11
splash 375 667 2 # SE 2nd/3rd gen, 8
