/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client', 'googleapis', 'pdfkit'],
    // Enables src/instrumentation.ts's register() hook, which starts the
    // background sync/AI-review scheduler (see src/lib/scheduler.ts) once
    // when the server boots. Explicit here for clarity even on Next.js
    // versions where it's on by default.
    instrumentationHook: true,
  },
};

module.exports = nextConfig;
