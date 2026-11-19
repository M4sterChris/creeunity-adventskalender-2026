import { validateConfig, isConfigDoorUnlocked } from '../script.js';

// Allowlist projection shared by GitHub publication and the private API.
export function selectReleasedContents(input, now = new Date()) {
  const config = validateConfig(input);
  return {
    version: 1, year: config.year, links: config.links, releaseMode: 'daily',
    ...(config.releaseMonth !== undefined ? { releaseMonth: config.releaseMonth } : {}),
    doors: config.doors.map(door => isConfigDoorUnlocked(door.day, config, now) ? {
      day: door.day, title: door.title, image: door.image, alt: door.alt, text: door.text, released: true,
      ...(door.audio ? { audio: door.audio } : {}),
      ...(door.puzzle ? { puzzle: { type: door.puzzle.type, serverOnly: true } } : {}),
    } : {
      day: door.day, title: `Türchen ${door.day} – Noch ein bisschen Vorfreude`,
      image: './assets/placeholder.svg', alt: 'Die Überraschung ist noch nicht veröffentlicht.', text: '', released: false,
    }),
  };
}
