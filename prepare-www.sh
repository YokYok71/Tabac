#!/bin/bash
# =============================================================
# prepare-www.sh — Synchronise les assets web vers www/
# puis génère / met à jour le projet iOS via Capacitor
# =============================================================
#
# PRÉREQUIS (une seule fois) :
#   1. Node.js >= 18  →  https://nodejs.org
#   2. Xcode (Mac App Store) + Command Line Tools
#        xcode-select --install
#   3. CocoaPods
#        sudo gem install cocoapods
#
# PREMIÈRE MISE EN PLACE :
#   chmod +x prepare-www.sh
#   npm install
#   npx cap add ios
#   # Ajouter dans ios/App/App/Info.plist (permissions photos/caméra) :
#   #   <key>NSCameraUsageDescription</key>
#   #   <string>Pour photographier vos tabacs et pipes</string>
#   #   <key>NSPhotoLibraryUsageDescription</key>
#   #   <string>Pour choisir une photo depuis votre bibliothèque</string>
#   #   <key>NSPhotoLibraryAddUsageDescription</key>
#   #   <string>Pour enregistrer des photos dans votre bibliothèque</string>
#   npm run ios   (ouvre Xcode)
#   # Dans Xcode : choisir équipe de signature, puis ▶ Run
#
# APRÈS CHAQUE MODIFICATION DE index.html :
#   ./prepare-www.sh
#   # Relancer depuis Xcode (ou appuyer sur ▶)
#
# =============================================================

set -e

echo "▶ Copie des assets web vers www/ ..."
mkdir -p www
cp index.html   www/
cp manifest.json www/
cp sw.js         www/
cp icon-192.png  www/
cp icon-512.png  www/

echo "▶ Synchronisation Capacitor (iOS) ..."
npx cap sync ios

echo ""
echo "✅ Prêt ! Lance 'npx cap open ios' pour ouvrir Xcode."
