#!/bin/sh
set -e

# Install Node.js dependencies so Capacitor SPM packages are available
cd "$CI_WORKSPACE"
npm install
