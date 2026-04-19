#!/bin/sh
set -e

# Add Homebrew paths so npm is available in Xcode Cloud
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

cd "$CI_WORKSPACE"
npm install
