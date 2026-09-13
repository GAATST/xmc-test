import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const nextConfig: NextConfig = {
  // Allow specifying a distinct distDir when concurrently running app in a container
  distDir: process.env.NEXTJS_DIST_DIR || '.next',
  
  // Enable React Strict Mode
  reactStrictMode: true,

  // Disable the X-Powered-By header. Follows security best practices.
  poweredByHeader: false,

  // use this configuration to ensure that only images from the whitelisted domains
  // can be served from the Next.js Image Optimization API
  // see https://nextjs.org/docs/app/api-reference/components/image#remotepatterns
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'edge*.**',
        port: '',
      },
      {
        protocol: 'https',
        hostname: 'xmc-*.**',
        port: '',
      },
      {
        // External DAM (Cloudinary stand-in for Fotoware, POC) — assets
        // referenced by Image fields
        protocol: 'https',
        hostname: 'res.cloudinary.com',
        port: '',
      },
    ],
    // Disable image optimization in development to avoid upstream timeouts
    unoptimized: process.env.NODE_ENV === 'development',
  },
  
  // The DAM picker route is embedded as an iframe by Sitecore Page Builder /
  // Cloud Portal only — frame-ancestors blocks embedding by any other site.
  // Scoped to /dam-picker so it cannot interfere with the editing host itself.
  headers: async () => {
    return [
      {
        source: '/dam-picker',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self' https://*.sitecorecloud.io https://*.sitecore.io",
          },
        ],
      },
    ];
  },

  // use this configuration to serve the sitemap.xml and robots.txt files from the API route handlers
  rewrites: async () => {
    return [
      {
        // sitemap.xml serves the main sitemap
        source: '/sitemap.xml',
        destination: '/api/sitemap',
        locale: false,
      },
      {
        // Numbered sitemap index pages (e.g. /sitemap-0.xml, /sitemap-1.xml)
        source: '/sitemap-:id(\\d+).xml',
        destination: '/api/sitemap',
        locale: false,
      },
      {
        // LLM-optimized sitemap for AI crawler ingestion
        source: '/sitemap-llm.xml',
        destination: '/api/sitemap-llm',
        locale: false,
      },
      {
        source: '/robots.txt',
        destination: '/api/robots',
        locale: false,
      },
      {
        source: '/llms.txt',
        destination: '/api/llms-txt',
        locale: false,
      },
      {
        source: '/.well-known/ai.txt',
        destination: '/api/well-known/ai-txt',
        locale: false,
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin();
export default withNextIntl(nextConfig);
