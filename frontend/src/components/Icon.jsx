/**
 * Small, dependency-free icon set.
 *
 * The storefront used emoji as icons, which render differently on every OS and
 * pick up the surrounding font metrics. These are 24x24 stroke icons that
 * inherit `currentColor`, so they line up with text and theme correctly.
 */
const PATHS = {
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </>
  ),
  cart: (
    <>
      <path d="M3 4h2l2.3 11.1a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L20.5 8H6" />
      <circle cx="10" cy="20" r="1.4" />
      <circle cx="18" cy="20" r="1.4" />
    </>
  ),
  heart: (
    <path d="M12 20.3 4.9 13.2a4.5 4.5 0 0 1 6.3-6.4l.8.8.8-.8a4.5 4.5 0 0 1 6.3 6.4Z" />
  ),
  pill: (
    <>
      <rect x="3.1" y="8.6" width="17.8" height="6.8" rx="3.4" transform="rotate(-45 12 12)" />
      <path d="m8.6 8.6 6.8 6.8" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.4 5.4 5.9v5.7c0 4 2.7 7.1 6.6 8.1 3.9-1 6.6-4.1 6.6-8.1V5.9Z" />
      <path d="m9.1 11.9 2 2 3.8-3.9" />
    </>
  ),
  check: <path d="m5.5 12.6 4.1 4.1 8.9-9.4" />,
  arrow: <path d="M4.5 12h13.8m-5.2-5.2L18.3 12l-5.2 5.2" />,
  truck: (
    <>
      <path d="M3 6.8h10.2v9.6H3z" />
      <path d="M13.2 10h3.8l3 3v3.4h-6.8z" />
      <circle cx="7" cy="18.4" r="1.5" />
      <circle cx="17" cy="18.4" r="1.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4.4l2.8 1.7" />
    </>
  ),
};

export default function Icon({
  name,
  size = 18,
  strokeWidth = 1.8,
  filled = false,
  className = '',
  title,
  ...rest
}) {
  const glyph = PATHS[name];
  if (!glyph) return null;

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={`icon${className ? ` ${className}` : ''}`}
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : 'true'}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {glyph}
    </svg>
  );
}
