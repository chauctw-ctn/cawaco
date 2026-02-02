#!/bin/bash
# Alternative build script using better-sqlite3

echo "🚀 Alternative Build: Using better-sqlite3..."

# Remove old sqlite3
npm uninstall sqlite3

# Install better-sqlite3 (easier to build)
npm install better-sqlite3

echo "✅ Installed better-sqlite3"
echo "⚠️  Note: You'll need to update database.js to use better-sqlite3 API"
