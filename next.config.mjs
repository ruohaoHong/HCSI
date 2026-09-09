/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  outputFileTracingIncludes: {
    '/*': ['./data/reference/**/*'],
  },
}

export default nextConfig
