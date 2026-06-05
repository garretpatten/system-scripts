#!/usr/bin/env bash
set -euo pipefail

### 1. ~/.bundle/config  —  BUNDLE_COOLDOWN: "7"
BUNDLE_CONFIG="$HOME/.bundle/config"
BUNDLE_KEY="cooldown"
BUNDLE_LINE='cooldown: "7"'

if [[ ! -f "$BUNDLE_CONFIG" ]]; then
  mkdir -p "$(dirname "$BUNDLE_CONFIG")"
  echo "$BUNDLE_LINE" >"$BUNDLE_CONFIG"
  echo "Created $BUNDLE_CONFIG"
elif ! grep -q "^${BUNDLE_KEY}:" "$BUNDLE_CONFIG"; then
  echo "$BUNDLE_LINE" >>"$BUNDLE_CONFIG"
  echo "Appended $BUNDLE_KEY to $BUNDLE_CONFIG"
else
  current=$(grep "^${BUNDLE_KEY}:" "$BUNDLE_CONFIG" | sed 's/.*"\([0-9]*\)".*/\1/')
  if [[ "$current" =~ ^[0-9]+$ ]] && ((current < 7)); then
    sed -i.bak "s|^${BUNDLE_KEY}:.*|${BUNDLE_LINE}|" "$BUNDLE_CONFIG"
    echo "Updated $BUNDLE_KEY in $BUNDLE_CONFIG ($current -> 7)"
  else
    echo "$BUNDLE_CONFIG: $BUNDLE_KEY is already ${current} day(s), no change"
  fi
fi

### 2. ~/.npmrc  —  min-release-age=7
NPMRC="$HOME/.npmrc"
NPMRC_KEY="min-release-age"
NPMRC_LINE="${NPMRC_KEY}=7"

if [[ ! -f "$NPMRC" ]]; then
  echo "$NPMRC_LINE" >"$NPMRC"
  echo "Created $NPMRC"
elif ! grep -q "^${NPMRC_KEY}=" "$NPMRC"; then
  echo "$NPMRC_LINE" >>"$NPMRC"
  echo "Appended $NPMRC_KEY to $NPMRC"
else
  current=$(grep "^${NPMRC_KEY}=" "$NPMRC" | sed "s/${NPMRC_KEY}=//")
  if [[ "$current" =~ ^[0-9]+$ ]] && ((current < 7)); then
    sed -i.bak "s|^${NPMRC_KEY}=.*|${NPMRC_LINE}|" "$NPMRC"
    echo "Updated $NPMRC_KEY in $NPMRC ($current -> 7)"
  else
    echo "$NPMRC: $NPMRC_KEY is already ${current} day(s), no change"
  fi
fi

### 3. ~/.config/pip/pip.ini  —  [global] / uploaded-prior-to = P7D
PIP_INI="$HOME/.config/pip/pip.ini"
PIP_KEY="uploaded-prior-to"
PIP_LINE="${PIP_KEY} = P7D"

if [[ ! -f "$PIP_INI" ]]; then
  mkdir -p "$(dirname "$PIP_INI")"
  printf '[global]\n%s\n' "$PIP_LINE" >"$PIP_INI"
  echo "Created $PIP_INI"
elif ! grep -q "^[[:space:]]*${PIP_KEY}[[:space:]]*=" "$PIP_INI"; then
  if grep -q '^\[global\]' "$PIP_INI"; then
    awk -v line="$PIP_LINE" '/^\[global\]/{print; print line; next}1' "$PIP_INI" >"$PIP_INI.tmp" &&
      mv "$PIP_INI.tmp" "$PIP_INI"
  else
    printf '\n[global]\n%s\n' "$PIP_LINE" >>"$PIP_INI"
  fi
  echo "Appended $PIP_KEY to $PIP_INI"
else
  current_raw=$(grep "^[[:space:]]*${PIP_KEY}[[:space:]]*=" "$PIP_INI" |
    sed 's/.*=[[:space:]]*//' | tr -d '[:space:]')
  # Extract N from P<N>D (ISO 8601 days duration)
  current_days=$(echo "$current_raw" | sed 's/^P\([0-9]*\)D$/\1/')
  if [[ "$current_days" =~ ^[0-9]+$ ]] && ((current_days < 7)); then
    sed -i.bak "s|^[[:space:]]*${PIP_KEY}[[:space:]]*=.*|${PIP_LINE}|" "$PIP_INI"
    echo "Updated $PIP_KEY in $PIP_INI ($current_raw -> P7D)"
  else
    echo "$PIP_INI: $PIP_KEY is already $current_raw (>= P7D), no change"
  fi
fi

### 4. ~/.config/uv/uv.toml  —  exclude-newer = "7 days"
UV_TOML="$HOME/.config/uv/uv.toml"
UV_KEY="exclude-newer"
UV_LINE="${UV_KEY} = \"7 days\""

if [[ ! -f "$UV_TOML" ]]; then
  mkdir -p "$(dirname "$UV_TOML")"
  echo "$UV_LINE" >"$UV_TOML"
  echo "Created $UV_TOML"
elif ! grep -q "^${UV_KEY}[[:space:]]*=" "$UV_TOML"; then
  echo "$UV_LINE" >>"$UV_TOML"
  echo "Appended $UV_KEY to $UV_TOML"
else
  current_raw=$(grep "^${UV_KEY}[[:space:]]*=" "$UV_TOML" |
    sed 's/.*=[[:space:]]*//' | tr -d '"')
  # Extract leading integer from "N days" (or "N d", etc.)
  current_days=$(echo "$current_raw" | grep -oE '^[0-9]+' || true)
  if [[ "$current_days" =~ ^[0-9]+$ ]] && ((current_days < 7)); then
    sed -i.bak "s|^${UV_KEY}[[:space:]]*=.*|${UV_LINE}|" "$UV_TOML"
    echo "Updated $UV_KEY in $UV_TOML ($current_raw -> 7 days)"
  else
    echo "$UV_TOML: $UV_KEY is already '$current_raw' (>= 7 days), no change"
  fi
fi

echo "Done."
