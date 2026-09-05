import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The contracts and the frontend are separate npm projects in one directory,
  // so Next.js finds two lockfiles and guesses wrong about which is the root.
  outputFileTracingRoot: here,

  // The floating dev-tools badge. Useful while building, wrong in a demo: it
  // is the framework's mark sitting on top of the product's, and a reviewer
  // watching a recording has no reason to know which is which. It never
  // appears in a production build, so this only affects `next dev` — which is
  // exactly where the recording is made.
  devIndicators: false,

  webpack: (config, { isServer }) => {
    // Client only, deliberately. The relayer SDK ships its cryptography as
    // WebAssembly and needs `asyncWebAssembly` to load — but enabling it on
    // the server build changes how webpack emits modules there, which breaks
    // Next's own dev-tools chunks and surfaces as
    // `__webpack_modules__[moduleId] is not a function` on every page.
    //
    // The SDK never runs on the server: it is behind a dynamic import inside a
    // client component, so the server build has no reason to know about WASM.
    if (!isServer) {
      config.experiments = { ...config.experiments, asyncWebAssembly: true };

      // The SDK's web entry pulls in Node built-ins along paths the browser
      // never takes. Stubbing them stops the bundler polyfilling code that
      // will not run.
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
