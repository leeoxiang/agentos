/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // wagmi/viem pull in optional peer deps that Next resolves at build time
    // even though nothing calls them.
    config.externals.push("pino-pretty", "lokijs", "encoding");

    // The `wagmi/connectors` barrel re-exports the Base Account connector,
    // which reaches the Coinbase CDP SDK and its unpublished @x402/* peers.
    // AgentOS only ever constructs the injected connector, so cut that branch
    // at its root rather than installing a payment SDK we reimplemented here.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@base-org/account": false,
      "@coinbase/cdp-sdk": false,
    };
    return config;
  },
};

export default nextConfig;
