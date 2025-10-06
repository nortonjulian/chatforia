const sr = (text) => (
  <span className="sr-only">{text}</span>
);

/**
 * Use official badge images (drop them in /public/images or CDN).
 * Keep the anchor wrapping the image for store verification linking.
 */
export default function AppBadges() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <a
        href="https://apps.apple.com/app/idXXXXXXXX"
        target="_blank"
        rel="noreferrer"
        aria-label="Download on the App Store"
      >
        {sr("Download on the App Store")}
        <img
          src="/images/appstore-badge.svg"
          alt=""
          className="h-10 w-auto"
          loading="lazy"
        />
      </a>

      <a
        href="https://play.google.com/store/apps/details?id=xxx"
        target="_blank"
        rel="noreferrer"
        aria-label="Get it on Google Play"
      >
        {sr("Get it on Google Play")}
        <img
          src="/images/googleplay-badge.svg"
          alt=""
          className="h-10 w-auto"
          loading="lazy"
        />
      </a>
    </div>
  );
}
