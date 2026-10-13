/**
 * AppLogo
 *
 * The HumMotion hummingbird, from client/public/logo.png. To change the logo
 * everywhere, replace that file (a square PNG with a transparent background
 * works best). The browser-tab and phone home-screen icons are the separate
 * favicon-32.png and apple-touch-icon.png files next to it.
 *
 * Decorative: the product name is always written next to it, so screen
 * readers skip the image.
 */

export function AppLogo({ className = "h-8 w-8" }: { className?: string }) {
  return <img src="/logo.png" alt="" aria-hidden="true" className={`object-contain shrink-0 ${className}`} />;
}
