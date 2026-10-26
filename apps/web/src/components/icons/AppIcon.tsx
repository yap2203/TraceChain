export type AppIconName =
  | 'applications'
  | 'badge'
  | 'boxes'
  | 'close'
  | 'credentials'
  | 'evidence'
  | 'ingredients'
  | 'inventory'
  | 'menu'
  | 'plus'
  | 'reports'
  | 'scan'
  | 'stakeholders'
  | 'transfers';

interface AppIconProps {
  className?: string;
  name: AppIconName;
  size?: number;
}

export function AppIcon({ className, name, size = 18 }: AppIconProps) {
  const paths: Record<AppIconName, React.ReactNode> = {
    applications: <path d="M7 3h10v4H7zM5 5H3v16h18V5h-2M7 12h10M7 16h7" />,
    badge: (
      <>
        <path d="M12 3 5.5 6v5.5c0 4.2 2.7 7.8 6.5 9.5 3.8-1.7 6.5-5.3 6.5-9.5V6L12 3Z" />
        <path d="m9.5 12 1.6 1.6 3.6-3.8" />
      </>
    ),
    boxes: (
      <>
        <path d="m8 3-5 3 5 3 5-3-5-3ZM16 9l-5 3 5 3 5-3-5-3Z" />
        <path d="M3 6v6l5 3 3-1.8M13 6v4.8M11 12v6l5 3 5-3v-6" />
      </>
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
    credentials: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="8" cy="11" r="2" />
        <path d="M13 10h5M13 14h4M6 16h4" />
      </>
    ),
    evidence: (
      <>
        <path d="M6 3h9l4 4v14H6zM14 3v5h5" />
        <path d="m9 15 2 2 4-5" />
      </>
    ),
    ingredients: (
      <>
        <path d="M20 4C12 4 6 8 5 15c4 1 8 0 11-3 2-2 3-5 4-8Z" />
        <path d="M4 20c2-5 6-8 12-10" />
      </>
    ),
    inventory: (
      <>
        <path d="m12 3 9 5-9 5-9-5 9-5Z" />
        <path d="m3 8 9 5 9-5v8l-9 5-9-5V8Z" />
      </>
    ),
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    plus: <path d="M12 5v14M5 12h14" />,
    reports: (
      <>
        <path d="M5 3h14v18H5zM9 16v-3M12 16V9M15 16v-5" />
      </>
    ),
    scan: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5M8 12h8" />,
    stakeholders: (
      <>
        <circle cx="9" cy="8" r="3" />
        <circle cx="17" cy="10" r="2" />
        <path d="M3 20c0-4 2.5-6 6-6s6 2 6 6M15 15c3 0 5 1.6 5 5" />
      </>
    ),
    transfers: (
      <>
        <path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
        {paths[name]}
      </g>
    </svg>
  );
}
