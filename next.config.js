/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep the ffmpeg-static binary out of the server bundle so recording compression can spawn it
  serverExternalPackages: ['ffmpeg-static'],
  experimental: {
    // proxy.ts matches /api, and Next buffers proxied request bodies up to this size (default 10 MB).
    // Recording chunks are small, but attachments and backup restores can be larger — keep the old 50 MB headroom.
    proxyClientMaxBodySize: '50mb',
  },
}

module.exports = nextConfig
