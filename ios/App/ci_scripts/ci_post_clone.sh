#!/bin/sh
set -e

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin:$PATH"

# Install Node.js if not available
if ! command -v npm >/dev/null 2>&1; then
    brew install node
fi

cd "$CI_WORKSPACE"
npm install
npm run prepare
npx cap copy ios
