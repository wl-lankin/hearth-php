// Shared test data (no tests here, so importing it registers none).

const sha = 'a'.repeat(64);

export const example = {
  schema: 1,
  generated: '2026-10-23T12:00:00Z',
  php: [
    {
      minor: '8.4', version: '8.4.27', channel: 'stable', os: 'windows', arch: 'x64',
      url: 'https://downloads.php.net/~windows/releases/php-8.4.27-nts-Win32-vs17-x64.zip', sha256: sha, size: 35295232,
      format: 'zip', root: '',
      extensions: {
        redis: { version: '6.3.0', kind: 'dll', url: 'https://example.test/redis.zip', sha256: sha, file: 'php_redis.dll' },
        xdebug: { version: '3.5.3', kind: 'zend_dll', url: 'https://example.test/xdebug.zip', sha256: sha, file: 'php_xdebug.dll' },
      },
    },
    {
      minor: '8.4', version: '8.4.27', channel: 'stable', os: 'macos', arch: 'arm64',
      url: 'https://github.com/wl-lankin/hearth-php/releases/download/php-8.4.27/php-8.4.27-macos-arm64.tar.gz',
      sha256: sha, size: 1, format: 'tar.gz', root: 'php-8.4.27',
      extensions: { redis: { kind: 'builtin' }, xdebug: { kind: 'zend_so', file: 'lib/xdebug.so' } },
    },
  ],
  composer: { version: '2.8.12', url: 'https://getcomposer.org/download/2.8.12/composer.phar', sha256: sha },
  cacert: { date: '2026-09-09', url: 'https://curl.se/ca/cacert-2026-09-09.pem', sha256: sha },
};
