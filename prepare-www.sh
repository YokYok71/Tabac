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

echo "▶ Copie directe vers ios/App/App/public/ ..."
mkdir -p ios/App/App/public
cp index.html    ios/App/App/public/
cp manifest.json ios/App/App/public/
cp sw.js         ios/App/App/public/
cp icon-192.png  ios/App/App/public/
cp icon-512.png  ios/App/App/public/

echo "▶ Copie du fichier de config Capacitor ..."
cp capacitor.config.json ios/App/App/capacitor.config.json

echo "▶ Vérification des fichiers xcconfig ..."
touch ios/debug.xcconfig ios/release.xcconfig

echo ""
echo "✅ Prêt ! Lance 'npx cap open ios' pour ouvrir Xcode."
