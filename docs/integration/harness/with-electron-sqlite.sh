#!/bin/sh
# Run a command with better-sqlite3's Electron build in place; always put the Node build back.
B=$(dirname "$0")/../../../node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node
restore() { cp ${BS3_NODE:?path to the Node build of better_sqlite3.node} "$B"; }
trap restore EXIT INT TERM
cp ${BS3_ELECTRON:?path to the Electron (ABI 133) build} "$B"
"$@"
