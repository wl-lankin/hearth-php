# hearth-php

PHP builds and the signed download catalog for [Hearth](https://github.com/wl-lankin/hearth), a local PHP development environment for Windows and macOS.

- **macOS:** PHP (cli and fpm, arm64 and x86_64) built here with [static-php-cli](https://github.com/crazywhalecc/static-php-cli), with `redis` built in and `xdebug` as a shared extension.
- **Windows:** the official builds from [windows.php.net](https://windows.php.net) and the official PECL Windows builds of `redis` and `xdebug`.

Every week a workflow publishes `manifest.json` and its minisign signature to the `manifest` release. Hearth installs only what that manifest lists and checks each download against its SHA-256.

## Manifest format (schema 1)

- `php[]`: one build per minor, OS and architecture: `minor`, `version`, `channel` (`stable` or `rc`), `os` (`windows`, `macos`), `arch` (`x64`, `arm64`, `x86_64`), `url`, `sha256`, `size`, `format` (`zip`, `tar.gz`), `root` (folder inside the archive, empty for none) and `extensions`.
- `extensions.<name>.kind`: `builtin` (compiled in), `dll` or `zend_dll` (Windows: a zip at `url` holding `file`), `zend_so` (macOS: `file` inside the PHP archive).
- `node[]`: the newest Node.js release of every major from `pins.json` `node.minMajor` up: `major`, `version`, `lts` (codename or null), `os`, `arch`, `url`, `sha256`, `format`, `root`. Checked against nodejs.org's SHASUMS256.txt.
- `composer` and `cacert`: `url` and `sha256` of Composer and the CA bundle.

`lib/manifest.mjs` (`validate`) is the reference for the format. Licensed under the MIT license.
