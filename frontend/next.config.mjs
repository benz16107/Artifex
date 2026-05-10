/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config, { dev }) {
    // Disk cache can throw ENOENT if `.next` is removed while `next dev` is still running,
    // which then makes `/` and `/_next/static/*` 404 until a full restart + clean `.next`.
    if (dev) {
      config.cache = false;
    }
    return config;
  },
};

export default nextConfig;
