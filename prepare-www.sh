#!/bin/bash
set -e

echo "▶ Copie des assets web vers www/ ..."
mkdir -p www
cp index.html    www/
cp manifest.json www/
cp sw.js         www/
cp icon-192.png  www/
cp icon-512.png  www/

echo "▶ Synchronisation Capacitor (iOS) ..."
npx cap copy ios

echo ""
echo "✅ Prêt ! Lance 'npx cap open ios' pour ouvrir Xcode."
