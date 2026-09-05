import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The contracts and the frontend are separate npm projects in one directory,
  // so Next.js finds two lockfiles and guesses wrong about which is the root.
  outputFileTracingRoot: here,

  webpack: (config, { isServer }) => {
    // The relayer SDK ships its cryptography as WebAssembly, which webpack
    // will not load without this flag.
    config.experiments = { ...config.experiments, asyncWebAssembly: true };

    if (!isServer) {
      // The SDK's web entry point pulls in Node built-ins along paths the
      // browser never takes. Stubbing them keeps the bundler from trying to
      // polyfill code that will not run.
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      };
    }

    return config;
  },
};

export default nextConfig;
