export { default } from 'next-auth/middleware';

// Requires a signed-in session for everything under /dashboard.
export const config = {
  matcher: ['/dashboard/:path*'],
};
