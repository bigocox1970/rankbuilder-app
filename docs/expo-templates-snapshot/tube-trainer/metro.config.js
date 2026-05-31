const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Resolve packages that ship an `exports` map. Default since SDK 53; explicit for clarity.
config.resolver.unstable_enablePackageExports = true;

// Behind a multi-hop proxy (preview host -> Cloudflare sandbox -> container), the
// X-Forwarded-* headers arrive comma-joined ("host-a, host-b" / "https, http"). Metro
// 0.83 (SDK 54) builds `new URL(req.url, proto + "://" + host)`, which throws
// "TypeError: Invalid URL" on a comma-joined authority/scheme and 500s the web bundle
// (blank preview). Collapse both headers to their first hop before Metro parses the
// request. The native (cloudflared) path sends single values and is unaffected.
const firstHop = (v) => (typeof v === 'string' && v.includes(',') ? v.split(',')[0].trim() : v);
const enhance = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, server) => {
  const fixForwardedHeaders = (req, res, next) => {
    if (req.headers['x-forwarded-host']) req.headers['x-forwarded-host'] = firstHop(req.headers['x-forwarded-host']);
    if (req.headers['x-forwarded-proto']) req.headers['x-forwarded-proto'] = firstHop(req.headers['x-forwarded-proto']);
    return middleware(req, res, next);
  };
  return enhance ? enhance(fixForwardedHeaders, server) : fixForwardedHeaders;
};

module.exports = config;
