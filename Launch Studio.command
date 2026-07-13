#!/bin/zsh
# Double-click this file to start Localized Screenshot Studio (Tauri + engine + UI).
cd "$(dirname "$0")" || exit 1

echo "Starting Localized Screenshot Studio…"
echo "Project: $(pwd)"
echo ""

npm run tauri:dev

echo ""
echo "Studio exited. Press any key to close this window."
read -k 1
