const paths: Record<string, string> = {
  search: '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.6-3.6"></path>',
  folder: '<path d="M3 6.5h6l2 2h10v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>',
  import: '<path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M4 20h16"></path>',
  refresh: '<path d="M20 6v5h-5"></path><path d="M4 18v-5h5"></path><path d="M18.5 9A7 7 0 0 0 6 6.5L4 11"></path><path d="M5.5 15A7 7 0 0 0 18 17.5L20 13"></path>',
  model: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"></path><path d="m4.5 7.7 7.5 4.2 7.5-4.2"></path><path d="M12 12v9"></path>',
  cube: '<path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z"></path>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"></path><path d="m3 12 9 5 9-5"></path><path d="m3 16 9 5 9-5"></path>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"></rect><circle cx="8.5" cy="9" r="1.5"></circle><path d="m5 18 5-5 3 3 2-2 4 4"></path>',
  settings: '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.8 1.8 0 0 0 .4 2l.1.1-2.8 2.8-.1-.1a1.8 1.8 0 0 0-2-.4 1.8 1.8 0 0 0-1 1.6V21h-4v-.1A1.8 1.8 0 0 0 9 19.4a1.8 1.8 0 0 0-2 .4l-.1.1-2.8-2.8.1-.1a1.8 1.8 0 0 0 .4-2A1.8 1.8 0 0 0 3 14H3v-4h.1A1.8 1.8 0 0 0 4.6 9a1.8 1.8 0 0 0-.4-2l-.1-.1 2.8-2.8.1.1a1.8 1.8 0 0 0 2 .4A1.8 1.8 0 0 0 10 3.1V3h4v.1A1.8 1.8 0 0 0 15 4.6a1.8 1.8 0 0 0 2-.4l.1-.1 2.8 2.8-.1.1a1.8 1.8 0 0 0-.4 2A1.8 1.8 0 0 0 20.9 10h.1v4h-.1A1.8 1.8 0 0 0 19.4 15z"></path>',
  sync: '<path d="M7 7h11l-2.5-2.5"></path><path d="m18 7-2.5 2.5"></path><path d="M17 17H6l2.5 2.5"></path><path d="M6 17 8.5 14.5"></path>',
  more: '<circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle>',
  chevron: '<path d="m9 18 6-6-6-6"></path>',
  close: '<path d="M6 6l12 12M18 6 6 18"></path>',
  check: '<path d="m5 12 4 4L19 6"></path>',
};

export function icon(name: keyof typeof paths, size = 18): string {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}
