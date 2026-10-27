#!/usr/bin/env bash
# Builds Redis for macOS from the official release source, checked against the release's published
# SHA-256, and smoke-tests it. Usage: build-redis.sh <version> <out-dir>
# Leaves <out-dir>/redis-<version>/bin/{redis-server,redis-cli}.
set -euo pipefail
VERSION="$1"
OUT="$2"

API="https://api.github.com/repos/redis/redis/releases/tags/${VERSION}"
EXPECTED="$(curl -fsSL -H "Authorization: Bearer ${GITHUB_TOKEN:-}" "$API" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s).assets.find(x=>x.name==="redis-full.tar.gz");if(!a?.digest)process.exit(1);console.log(a.digest.replace("sha256:",""))})')"
curl -fsSL --retry 3 -o redis-src.tar.gz "https://github.com/redis/redis/releases/download/${VERSION}/redis-full.tar.gz"
echo "${EXPECTED}  redis-src.tar.gz" | shasum -a 256 -c -

mkdir -p redis-src && tar xzf redis-src.tar.gz -C redis-src --strip-components=1
# The core server only (no modules), the system allocator, no TLS: a local development Redis.
# The top-level Makefile of Redis 8 also builds the modules; src/ is the server alone.
make -C redis-src/src -j"$(sysctl -n hw.ncpu)" MALLOC=libc BUILD_TLS=no

DIR="${OUT}/redis-${VERSION}"
mkdir -p "${DIR}/bin"
cp redis-src/src/redis-server redis-src/src/redis-cli "${DIR}/bin/"

# Nothing from Homebrew may be linked: users have no Homebrew.
if otool -L "${DIR}/bin/redis-server" | grep -E '/(opt|usr/local)/(homebrew|Cellar|opt)/'; then
  echo "::error::redis-server links a Homebrew library"
  exit 1
fi

"${DIR}/bin/redis-server" --port 6399 --save '' --daemonize yes --pidfile /tmp/redis-smoke.pid
for _ in 1 2 3 4 5; do "${DIR}/bin/redis-cli" -p 6399 ping 2>/dev/null | grep -q PONG && break; sleep 1; done
"${DIR}/bin/redis-cli" -p 6399 ping | grep -q PONG
"${DIR}/bin/redis-cli" -p 6399 shutdown nosave || true
echo "Redis ${VERSION} built and answering"
