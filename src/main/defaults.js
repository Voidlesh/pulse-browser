'use strict'

const SEARCH_ENGINES = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=%s' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=%s' },
  ecosia: { name: 'Ecosia', url: 'https://www.ecosia.org/search?q=%s' },
  startpage: { name: 'Startpage', url: 'https://www.startpage.com/do/search?q=%s' },
}

const ANIMATION_LEVELS = ['full', 'reduced', 'off']
const BG_EFFECTS = ['particles', 'aurora', 'grid', 'stars', 'none']

const DEFAULT_SETTINGS = {
  // Start & Startseite
  startup: 'restore', // 'restore' | 'newtab' | 'pages'
  startupPages: [],
  homepage: '', // '' = Startseite (pulse://newtab)
  showHomeButton: true,
  newtabSuggestions: true,
  newtabClock: true,

  // Suche
  searchEngine: 'google',
  customSearch: { name: '', url: '' },

  // Darstellung
  accent: '#fa1e4e',
  themePreset: 'neon',
  wallpaper: '',
  bgEffect: 'particles',
  animations: 'full',
  showBookmarksBar: true,
  showSidebar: true,
  extensionsCollapsed: false,
  defaultZoom: 100,

  // Sound
  uiSounds: false,
  uiSoundVolume: 40,
  ambientMusic: false,
  ambientVolume: 30,

  // Datenschutz & Sicherheit
  adblock: true,
  doNotTrack: true,
  httpsOnly: false,
  clearOnExit: { cache: false, cookies: false, history: false, downloads: false },

  // Passwörter & Autofill
  savePasswords: true,
  autofillPasswords: true,
  autofillAddresses: true,

  // Downloads
  askDownloadLocation: false,
  downloadDir: '',

  // Tabs
  newTabPosition: 'afterActive', // 'afterActive' | 'end'
  autoSleepMinutes: 0,

  // System
  hardwareAcceleration: true,

  // Fokus-Modus
  focusMinutes: 25,
  focusBlocklist: ['youtube.com', 'twitch.tv', 'reddit.com', 'x.com', 'instagram.com', 'tiktok.com', 'facebook.com'],

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
  hiddenSuggestions: [],
  limiter: {
    ram: { enabled: false, limitMb: 4096, hard: true },
    cpu: { enabled: false, limitPercent: 50 },
    network: { enabled: false, limitKbps: 2048 },
  },
}

module.exports = { DEFAULT_SETTINGS, SEARCH_ENGINES, ANIMATION_LEVELS, BG_EFFECTS }
