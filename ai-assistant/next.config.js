const { initOpenNextCloudflareForDev } = require('@opennextjs/cloudflare')

if (process.env.NODE_ENV !== 'production') {
  initOpenNextCloudflareForDev()
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: __dirname,
  webpack: (config) => {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    return config;
  },
}

module.exports = nextConfig
