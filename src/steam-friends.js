'use strict';

let steamClient = null;

function configureSteamClient(client) {
  if (!client || typeof client !== 'object') {
    throw new TypeError('A Steam client is required.');
  }

  steamClient = client;
}

function normalizeFriendName(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function personaNameFor(steamID64, fallback = 'Steam friend') {
  return steamClient?.users?.[steamID64]?.player_name || fallback;
}

async function getFriendProfiles(excludedSteamID64 = '') {
  if (!steamClient) {
    return [];
  }

  const friendIDs = Object.entries(steamClient.myFriends ?? {})
    .filter(([steamID64, relationship]) =>
      relationship === 3 && steamID64 !== String(excludedSteamID64),
    )
    .map(([steamID64]) => steamID64);
  const missingProfiles = friendIDs.filter(
    (steamID64) => !steamClient.users?.[steamID64]?.player_name,
  );
  let requestedProfiles = {};

  if (missingProfiles.length > 0 && typeof steamClient.getPersonas === 'function') {
    try {
      requestedProfiles = await steamClient.getPersonas(missingProfiles);
    } catch (error) {
      console.warn(`Could not refresh Steam friend names: ${error.message}`);
    }
  }

  return friendIDs.flatMap((steamID64) => {
    const name = steamClient.users?.[steamID64]?.player_name ||
      requestedProfiles?.[steamID64]?.player_name;

    return name ? [{ steamID64, name }] : [];
  });
}

function profileMatches(profile, query, exact = false) {
  const normalizedName = normalizeFriendName(profile.name);
  const normalizedQuery = normalizeFriendName(query);

  return exact
    ? normalizedName === normalizedQuery
    : normalizedName.includes(normalizedQuery);
}

async function resolveFriendsByName(query, excludedSteamID64 = '') {
  const profiles = await getFriendProfiles(excludedSteamID64);
  const exactMatches = profiles.filter(
    (profile) => profileMatches(profile, query, true),
  );

  return exactMatches.length > 0
    ? exactMatches
    : profiles.filter((profile) => profileMatches(profile, query));
}

async function resolveLeadingFriend(tokens, excludedSteamID64 = '') {
  if (/^\d{17}$/.test(tokens[0] ?? '')) {
    const steamID64 = tokens[0];
    return {
      candidates: [{
        steamID64,
        name: personaNameFor(steamID64),
      }],
      remainingText: tokens.slice(1).join(' ').trim(),
    };
  }

  const profiles = await getFriendProfiles(excludedSteamID64);

  for (const exact of [true, false]) {
    for (let splitIndex = tokens.length - 1; splitIndex >= 1; splitIndex -= 1) {
      const query = tokens.slice(0, splitIndex).join(' ');
      const candidates = profiles.filter(
        (profile) => profileMatches(profile, query, exact),
      );

      if (candidates.length > 0) {
        return {
          candidates,
          remainingText: tokens.slice(splitIndex).join(' ').trim(),
        };
      }
    }
  }

  return { candidates: [], remainingText: '' };
}

module.exports = {
  configureSteamClient,
  getFriendProfiles,
  normalizeFriendName,
  personaNameFor,
  profileMatches,
  resolveFriendsByName,
  resolveLeadingFriend,
};
