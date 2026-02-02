#!/bin/bash
set -e

echo "🚀 Starting deployment build..."

# Install dependencies
echo "📦 Installing dependencies..."
npm ci --omit=dev || npm install --production

# Try to use pre-built binaries first
echo "🔍 Checking for pre-built sqlite3 binaries..."
if [ -f node_modules/sqlite3/lib/binding/node-v108-linux-x64/node_sqlite3.node ]; then
    echo "✅ Found pre-built binary!"
else
    echo "⚠️ No pre-built binary found, attempting to build..."
    
    # Install build dependencies if available
    if command -v apt-get &> /dev/null; then
        echo "📦 Installing build tools..."
        apt-get update -qq || true
        apt-get install -y -qq python3 make g++ || true
    fi
    
    # Try to rebuild
    echo "🔨 Rebuilding sqlite3..."
    npm rebuild sqlite3 --build-from-source || {
        echo "⚠️ Build failed, trying alternative method..."
        cd node_modules/sqlite3
        npm run install --fallback-to-build || true
        cd ../..
    }
fi

# Verify installation
echo "✅ Verifying sqlite3..."
if node -e "require('sqlite3')" 2>/dev/null; then
    node -e "const sqlite3 = require('sqlite3'); console.log('SQLite3 loaded successfully');"
    echo "✅ Build completed successfully!"
else
    echo "❌ SQLite3 verification failed!"
    exit 1
fi
