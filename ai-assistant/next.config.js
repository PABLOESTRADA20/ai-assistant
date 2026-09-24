const path = require('path')
const { initOpenNextCloudflareForDev } = require('@opennextjs/cloudflare')

if (process.env.NODE_ENV !== 'production') {
  initOpenNextCloudflareForDev()
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: __dirname,
  webpack: (config, { isServer }) => {
    config.resolve = config.resolve || {}
    config.resolve.alias = config.resolve.alias || {}
    // Bypass package.json exports resolution for prisma client
    config.resolve.alias['@/app/generated/prisma'] = path.resolve(
      __dirname,
      'app/generated/prisma/index.js'
    )
    return config
  },
}

module.exports = nextConfig
