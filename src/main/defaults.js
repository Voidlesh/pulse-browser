'use strict'

const SEARCH_ENGINES = {
  google: 'https://www.google.com/search?q=%s',
  duckduckgo: 'https://duckduckgo.com/?q=%s',
  bing: 'https://www.bing.com/search?q=%s',
  brave: 'https://search.brave.com/search?q=%s',
  ecosia: 'https://www.ecosia.org/search?q=%s',
}

const DEFAULT_SETTINGS = {
  accent: '#fa1e4e',
  wallpaper: '',
  searchEngine: 'google',
  adblock: true,
  restoreSession: true,
  showBookmarksBar: true,
  sidebarApps: [
    { id: 'whatsapp', title: 'WhatsApp', url: 'https://web.whatsapp.com/' },
    { id: 'discord', title: 'Discord', url: 'https://discord.com/app' },
    { id: 'telegram', title: 'Telegram', url: 'https://web.telegram.org/' },
    { id: 'instagram', title: 'Instagram', url: 'https://www.instagram.com/' },
    { id: 'twitch', title: 'Twitch', url: 'https://www.twitch.tv/' },
    { id: 'spotify', title: 'Spotify', url: 'https://open.spotify.com/' },
    { id: 'x', title: 'X', url: 'https://x.com/' },
  ],
  speedDial: [
    { title: 'YouTube', url: 'https://www.youtube.com/' },
    { title: 'Twitch', url: 'https://www.twitch.tv/' },
    { title: 'Reddit', url: 'https://www.reddit.com/' },
    { title: 'Steam', url: 'https://store.steampowered.com/' },
    { title: 'GitHub', url: 'https://github.com/' },
    { title: 'Wikipedia', url: 'https://de.wikipedia.org/' },
  ],
  limiter: {
    ram: { enabled: false, limitMb: 4096, hard: true },
    cpu: { enabled: false, limitPercent: 50 },
    network: { enabled: false, limitKbps: 2048 },
  },
}

module.exports = { DEFAULT_SETTINGS, SEARCH_ENGINES }
