const paths = {
  city: 'M3 21V9l6-3v15M9 21V3h7v18M16 21V11h5v10M1 21h22M12 6h1M12 10h1M12 14h1M6 11v1M6 15v1M19 14v1M19 18v1',
  book: 'M12 5c-3-3-7-3-10-2v16c3-1 7-1 10 2 3-3 7-3 10-2V3c-3-1-7-1-10 2v16',
  signal: 'M3 16v5M9 11v10M15 6v15M21 1v20',
  arrow: 'M4 12h16M14 6l6 6-6 6',
  pause: 'M8 5v14M16 5v14',
  play: 'm8 4 12 8-12 8z',
  external: 'M14 3h7v7M21 3l-11 11M10 3H3v18h18v-7',
  people:
    'M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-3a4 4 0 0 0-3-4M16 2a4 4 0 0 1 0 8',
  cube: 'm12 2 10 5v10l-10 5L2 17V7zM2 7l10 5 10-5M12 12v10M7 4.5l10 5',
  close: 'm6 6 12 12M6 18 18 6',
  leaf: 'M20 3C4 3 2 8 5 15s14 8 15-12zM3 21 16 8',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3 2',
} as const;

export function Icon({ name, size = 20 }: { name: keyof typeof paths; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
