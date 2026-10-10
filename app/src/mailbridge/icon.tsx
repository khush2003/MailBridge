import React from 'react';

export const iconPaths = {
  mail: 'M3 5h18v14H3z M3 5l9 7 9-7',
  delete: 'M5 7h14 M9 7V4h6v3 M7 7l1 14h8l1-14 M10 10v8 M14 10v8',
  archive: 'M3 4h18v5H3z M5 9v12h14V9 M9 13h6',
  reply: 'M10 4L3 10l7 6v-4c6 0 8 2 11 7-1-9-5-11-11-11z',
  replyAll: 'M7 5L2 10l5 5 M13 4l-7 6 7 6v-4c5 0 6 2 9 6-1-8-4-10-9-10z',
  forward: 'M14 4l7 6-7 6v-4c-6 0-8 2-11 7 1-9 5-11 11-11z',
  sync: 'M20 8a8 8 0 0 0-13-3L3 8 M3 3v5h5 M4 16a8 8 0 0 0 13 3l4-3 M21 21v-5h-5',
  flag: 'M5 22V3 M5 3h14l-3 5 3 5H5',
  settings: 'M4 5h16 M4 12h16 M4 19h16 M8 2v6 M16 9v6 M10 16v6',
  folder: 'M2 6h8l2 3h10v12H2z',
  search: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6',
  download: 'M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5',
  edit: 'M4 16l12-12 4 4L8 20H4z M14 6l4 4',
  link: 'M10 7l2-2a5 5 0 0 1 7 7l-2 2 M14 17l-2 2a5 5 0 0 1-7-7l2-2 M8 16l8-8',
  star: 'M12 3l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z',
  shield: 'M12 2l8 3v6c0 5-4 8-8 11-4-3-8-6-8-11V5z M8 12l3 3 5-6',
  appearance:
    'M12 3a9 9 0 1 0 0 18c3 0 3-3 1-4-2-1-1-3 1-3h3c6 0 3-11-5-11z M7 8h.01 M12 6h.01 M17 8h.01 M6 13h.01',
  keyboard:
    'M2 5h20v14H2z M6 9h.01 M10 9h.01 M14 9h.01 M18 9h.01 M6 12h.01 M10 12h.01 M14 12h.01 M18 12h.01 M7 16h10',
  rules: 'M5 3h14v18H5z M8 8h8 M8 12h8 M8 16h5',
  signature: 'M3 19h18 M4 15c5-13 9-14 6-4-3 9 0 7 3 2 1-2 1-1 1 1 0 3 3-4 5-1',
  template: 'M4 3h16v18H4z M4 8h16 M9 8v13',
  code: 'M8 6l-6 6 6 6 M16 6l6 6-6 6 M14 3l-4 18',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  chevron: 'M8 4l8 8-8 8',
  check: 'M4 12l5 5L20 6',
  close: 'M6 6l12 12 M6 18L18 6',
  pane: 'M3 4h18v16H3z M12 4v16',
};
export type IconName = keyof typeof iconPaths;
export default function MailBridgeIcon({
  name,
  className = '',
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg
      className={`mb-icon ${className}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <path d={iconPaths[name]} />
    </svg>
  );
}
