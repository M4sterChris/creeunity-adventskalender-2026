export class CalendarAPI {
  constructor(fetcher = fetch) { this.fetcher = (...args) => fetcher(...args); }
  async request(path, body) {
    const response = await this.fetcher(`./api/${path}`, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
      signal: AbortSignal.timeout(12000),
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json', 'X-Calendar-Request': '1' }, body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (!response.ok && !(response.status === 429 && Number.isFinite(data.lockedUntil))) {
      const error = new Error(data.message || 'Die Prüfung ist gerade nicht verfügbar. Dein Versuch wurde nicht gezählt.');
      error.status = response.status;
      throw error;
    }
    return data;
  }
  session() { return this.request('session'); }
  statuses() { return this.request('puzzles'); }
  openDoor(year, day) { return this.request(`opened/${year}/${day}`, {}); }
  resetOpened(year) { return this.request(`opened/${year}/reset`, { confirm: true }); }
  answer(year, day, answer) { return this.request(`puzzles/${year}/${day}/answer`, { answer }); }
  logout() { return this.request('logout', {}); }
  exportAccount() { return this.request('account/export'); }
  deleteAccount() { return this.request('account/delete', { confirm: true }); }
}

export function attemptMessage(status, now = Date.now()) {
  if (!status) return '';
  if (status.lockedUntil > now) {
    const seconds = Math.ceil((status.lockedUntil - now) / 1000);
    return `Noch ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} Minuten Pause für dieses Türchen. Danach hast du wieder 10 Versuche.`;
  }
  const remaining = status.lockedUntil ? 10 : status.remainingAttempts;
  return `Noch ${remaining} von 10 Versuchen. Nach 10 Fehlversuchen pausiert dieses Türchen für 15 Minuten.`;
}
