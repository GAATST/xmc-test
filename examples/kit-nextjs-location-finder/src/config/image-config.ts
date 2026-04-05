/**
 * Image configuration constants
 * These match the remotePatterns defined in next.config.ts
 * Extracted here to avoid importing next.config which can cause bundling issues
 */
export const IMAGE_REMOTE_PATTERNS = [
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
] as const;

