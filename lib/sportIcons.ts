// Zaf Play's drawn sport icons (64 × 64), copied from the website's lib/sportIcons.ts.
// Colours are CSS-style variables replaced at draw time: --ic line, --ic-a pink, --ic-b blue, --cut the tile behind.
export const SPORT_ICONS: Record<string, string> = {
  'basketball':
    '<circle cx="32" cy="32" r="22" fill="var(--ic-a)"/> <path d="M32 10v44M10 32h44M17 15.5c8 9 8 24 0 33M47 15.5c-8 9-8 24 0 33" stroke="var(--cut)" stroke-width="2.6" stroke-linecap="round" fill="none"/>',
  'beach-volleyball':
    '<circle cx="32" cy="24" r="15" fill="var(--ic-b)"/> <path d="M32 24c0-8 5-13 11-13M32 24c-7 4-14 3-16-1M32 24c5 6 4 12 0 15" stroke="var(--cut)" stroke-width="2.6" stroke-linecap="round" fill="none"/> <path d="M8 50c4-4 8-4 12 0s8 4 12 0 8-4 12 0 8 4 12 0" stroke="var(--ic)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  'football':
    '<circle cx="32" cy="32" r="22" stroke="var(--ic)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/> <path d="M32 23l8.6 6.2-3.3 10.1H26.7l-3.3-10.1z" fill="var(--ic-a)"/> <path d="M32 23v-9M40.6 29.2l8.7-2.8M37.3 39.3l5.3 7.3M26.7 39.3l-5.3 7.3M23.4 29.2l-8.7-2.8" stroke="var(--ic)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  'gymnastics':
    '<path d="M20 6v18M44 6v18" stroke="var(--ic)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/> <circle cx="20" cy="33" r="9" stroke="var(--ic-a)" stroke-width="4" fill="none"/> <circle cx="44" cy="33" r="9" stroke="var(--ic-a)" stroke-width="4" fill="none"/> <path d="M8 56h48" stroke="var(--ic)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  'handball':
    '<path d="M8 50V14h48v36" stroke="var(--ic)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/> <path d="M14 20h36M14 28h36M14 36h36M22 14v36M32 14v36M42 14v36" stroke="var(--ic)" stroke-width="1.4" opacity=".45"/> <circle cx="32" cy="42" r="12" fill="var(--ic-a)"/> <path d="M22 37c6 3 14 3 20 0M26 52c2-5 2-15-1-20M38 52c-2-5-2-15 1-20" stroke="var(--cut)" stroke-width="2.6" stroke-linecap="round" fill="none"/>',
  'padbol':
    '<rect x="6" y="14" width="52" height="36" rx="6" stroke="var(--ic)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/> <path d="M32 14v36" stroke="var(--ic)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/> <circle cx="20" cy="32" r="9" fill="var(--ic-a)"/> <path d="M20 27.5l3.8 2.8-1.5 4.5h-4.6l-1.5-4.5z" fill="var(--cut)"/>',
  'padel':
    '<g transform="rotate(-38 28 26)"> <path d="M28 4c9 0 15 7 15 16 0 10-7 17-12 21h-6c-5-4-12-11-12-21 0-9 6-16 15-16z" fill="var(--ic)"/> <g fill="var(--cut)"><circle cx="23" cy="14" r="1.8"/><circle cx="28" cy="12" r="1.8"/><circle cx="33" cy="14" r="1.8"/><circle cx="21" cy="21" r="1.8"/><circle cx="28" cy="19" r="1.8"/><circle cx="35" cy="21" r="1.8"/><circle cx="24" cy="27" r="1.8"/><circle cx="32" cy="27" r="1.8"/></g> <path stroke-width="5" d="M28 41v17" stroke="var(--ic)" stroke-linecap="round" stroke-linejoin="round" fill="none"/></g> <circle cx="50" cy="49" r="7.5" fill="var(--ic-a)"/>',
  'pickleball':
    '<g transform="rotate(-38 28 26)"> <rect x="15" y="4" width="26" height="36" rx="12" fill="var(--ic-b)"/> <path stroke-width="5" d="M28 40v18" stroke="var(--ic)" stroke-linecap="round" stroke-linejoin="round" fill="none"/></g> <circle cx="50" cy="49" r="8" fill="var(--ic-a)"/> <g fill="var(--cut)"><circle cx="47.5" cy="46.5" r="1.4"/><circle cx="52.5" cy="46.5" r="1.4"/><circle cx="50" cy="50.5" r="1.4"/><circle cx="46.5" cy="52.5" r="1.2"/><circle cx="53.5" cy="52.5" r="1.2"/></g>',
  'squash':
    '<g transform="rotate(-38 28 26)"> <path d="M28 3c7 0 11 6 11 14s-6 17-9 21h-4c-3-4-9-13-9-21S21 3 28 3z" stroke="var(--ic)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/> <path d="M22 13h12M21 20h14M23 27h10M28 5v32" stroke="var(--ic)" stroke-width="1.4" opacity=".55"/> <path stroke-width="4.5" d="M28 38v20" stroke="var(--ic)" stroke-linecap="round" stroke-linejoin="round" fill="none"/></g> <circle cx="51" cy="50" r="6.5" fill="#0b1030" stroke="var(--ic)" stroke-width="1.6"/> <g fill="var(--ic-a)"><circle cx="49.2" cy="50" r="1.4"/><circle cx="52.8" cy="50" r="1.4"/></g>',
  'swimming':
    '<circle cx="44" cy="17" r="5.5" fill="var(--ic)"/> <path d="M10 33c8-9 20-12 30-4l6 5" stroke="var(--ic)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/> <path d="M6 44c4-4 9-4 13 0s9 4 13 0 9-4 13 0 9 4 13 0" stroke="var(--ic-b)" stroke-width="3.5" stroke-linecap="round" fill="none"/> <path d="M6 54c4-4 9-4 13 0s9 4 13 0 9-4 13 0 9 4 13 0" stroke="var(--ic-a)" stroke-width="3.5" stroke-linecap="round" fill="none"/>',
  'tennis':
    '<g transform="rotate(-38 28 26)"> <ellipse cx="28" cy="19" rx="12" ry="15" stroke="var(--ic)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/> <path d="M20 12h16M17 19h22M20 26h16M24 5.5v27M32 5.5v27" stroke="var(--ic)" stroke-width="1.4" opacity=".55"/> <path stroke-width="5" d="M28 34v24" stroke="var(--ic)" stroke-linecap="round" stroke-linejoin="round" fill="none"/></g> <circle cx="50" cy="49" r="8" fill="var(--ic-a)"/> <path stroke-width="1.8" d="M43.5 45c3 2 10 2 13 0M43.5 53c3-2 10-2 13 0" stroke="var(--cut)" stroke-linecap="round" fill="none"/>',
  'volleyball':
    '<circle cx="32" cy="32" r="22" fill="var(--ic-b)"/> <path d="M32 32c0-11 7-19 17-20M32 32c-10 6-21 5-25-1M32 32c8 9 7 18 1 22" stroke="var(--cut)" stroke-width="2.6" stroke-linecap="round" fill="none"/>',
}

export function sportSvg(slug: string | undefined, c: { ic: string; a: string; b: string; cut: string }): string | null {
  const d = slug ? SPORT_ICONS[slug] : undefined;
  if (!d) return null;
  const inner = d.replace(/var\(--ic-a\)/g, c.a).replace(/var\(--ic-b\)/g, c.b).replace(/var\(--cut\)/g, c.cut).replace(/var\(--ic\)/g, c.ic);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${inner}</svg>`;
}
