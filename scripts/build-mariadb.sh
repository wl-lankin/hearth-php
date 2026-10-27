#!/usr/bin/env bash
# Builds MariaDB for macOS from the official source, checked against MariaDB's sha256sums.txt, as a
# relocatable folder (bundled SSL, zlib and PCRE: nothing from Homebrew is linked), and smoke-tests
# it. Usage: build-mariadb.sh <version> <out-dir>   Leaves <out-dir>/mariadb-<version>/.
set -euo pipefail
VERSION="$1"
OUT="$2"

SRC="https://archive.mariadb.org/mariadb-${VERSION}/source"
FILE="mariadb-${VERSION}.tar.gz"
curl -fsSL --retry 3 -o "$FILE" "${SRC}/${FILE}"
curl -fsSL --retry 3 "${SRC}/sha256sums.txt" | grep " ${FILE}\$" | shasum -a 256 -c -

mkdir -p mariadb-src && tar xzf "$FILE" -C mariadb-src --strip-components=1
# Build-time tools only (the result links none of them).
brew install bison
export PATH="$(brew --prefix bison)/bin:${PATH}"

STAGE="${PWD}/mariadb-stage"
cmake -S mariadb-src -B mariadb-build \
  -DCMAKE_BUILD_TYPE=RelWithDebInfo \
  -DCMAKE_INSTALL_PREFIX="${STAGE}" \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=12.0 \
  -DINSTALL_LAYOUT=STANDALONE \
  -DWITH_SSL=bundled -DWITH_ZLIB=bundled -DWITH_PCRE=bundled -DWITH_LIBFMT=bundled \
  -DWITH_UNIT_TESTS=OFF -DWITH_EMBEDDED_SERVER=OFF -DWITH_MARIABACKUP=OFF \
  -DPLUGIN_ROCKSDB=NO -DPLUGIN_MROONGA=NO -DPLUGIN_SPIDER=NO -DPLUGIN_CONNECT=NO \
  -DPLUGIN_COLUMNSTORE=NO -DPLUGIN_S3=NO -DPLUGIN_OQGRAPH=NO -DPLUGIN_SPHINX=NO \
  -DPLUGIN_TOKUDB=NO -DPLUGIN_PROVIDER_BZIP2=NO -DPLUGIN_PROVIDER_LZ4=NO \
  -DPLUGIN_PROVIDER_LZMA=NO -DPLUGIN_PROVIDER_LZO=NO -DPLUGIN_PROVIDER_SNAPPY=NO \
  -DPLUGIN_PROVIDER_ZSTD=NO -DWITH_SAFEMALLOC=OFF
cmake --build mariadb-build -j"$(sysctl -n hw.ncpu)"
cmake --install mariadb-build

DIR="${OUT}/mariadb-${VERSION}"
mkdir -p "${OUT}"
cp -R "${STAGE}" "${DIR}"
# Tests and the embedded docs are not needed to run a local server.
rm -rf "${DIR}/mariadb-test" "${DIR}/mysql-test" "${DIR}/sql-bench" "${DIR}/man" "${DIR}/docs"

if otool -L "${DIR}/bin/mariadbd" | grep -E '/(opt|usr/local)/(homebrew|Cellar|opt)/'; then
  echo "::error::mariadbd links a Homebrew library"
  exit 1
fi

DATA="$(mktemp -d)"
"${DIR}/scripts/mariadb-install-db" --no-defaults --basedir="${DIR}" --datadir="${DATA}" \
  --auth-root-authentication-method=normal --skip-test-db
"${DIR}/bin/mariadbd" --no-defaults --basedir="${DIR}" --datadir="${DATA}" --port=3399 \
  --bind-address=127.0.0.1 --socket="${DATA}/smoke.sock" --pid-file="${DATA}/smoke.pid" &
for _ in $(seq 1 30); do
  "${DIR}/bin/mariadb" --no-defaults -uroot -h127.0.0.1 -P3399 -e 'select version()' 2>/dev/null && break
  sleep 1
done
"${DIR}/bin/mariadb" --no-defaults -uroot -h127.0.0.1 -P3399 -e 'select version()' | grep -q "${VERSION}"
"${DIR}/bin/mariadb-admin" --no-defaults -uroot -h127.0.0.1 -P3399 shutdown
echo "MariaDB ${VERSION} built and answering"
