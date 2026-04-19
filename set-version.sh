#!/bin/bash
# Usage: ./set-version.sh <version> <build>
# Example: ./set-version.sh 1.4 1.4.1

VERSION=$1
BUILD=$2

if [ -z "$VERSION" ] || [ -z "$BUILD" ]; then
  echo "Usage: ./set-version.sh <version> <build>"
  echo "Example: ./set-version.sh 1.4 1.4.1"
  exit 1
fi

sed -i "s/var APP_VERSION=\"[^\"]*\";var APP_BUILD=\"[^\"]*\"/var APP_VERSION=\"$VERSION\";var APP_BUILD=\"$BUILD\"/" index.html

echo "✅ index.html mis à jour : version=$VERSION build=$BUILD"
