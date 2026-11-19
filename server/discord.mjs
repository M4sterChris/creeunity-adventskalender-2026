export function discordAuthorization({ clientId, redirectUri }, state) {
  const url = new URL('https://discord.com/oauth2/authorize');
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'identify', state }).toString();
  return url.href;
}

export async function discordIdentity({ clientId, clientSecret, redirectUri }, code, fetcher = fetch) {
  const response = await fetcher('https://discord.com/api/oauth2/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Discord-Anmeldung fehlgeschlagen.');
  const token = await response.json();
  if (typeof token.access_token !== 'string' || !token.access_token || token.token_type?.toLowerCase() !== 'bearer') throw new Error('Discord-Anmeldung fehlgeschlagen.');
  // Only identify: no email, guild access, bot, DMs or retained access tokens.
  const identity = await fetcher('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(10000),
  });
  if (!identity.ok) throw new Error('Discord-Anmeldung fehlgeschlagen.');
  const user = await identity.json();
  if (typeof user.id !== 'string' || !/^\d{5,30}$/.test(user.id)) throw new Error('Discord-Anmeldung fehlgeschlagen.');
  // The identify response also contains profile fields. Discard them: the
  // calendar only needs the stable Discord ID, never names, email or passwords.
  return { id: user.id };
}
