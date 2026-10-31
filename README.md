# Pulse Browser

Eigener Desktop-Browser auf Chromium-Basis (Electron 45) im dunklen Gaming-Look –
unabhängig von Opera, komplett eigener Code.

## Starten

```
npm install
npm start
```

Oder Doppelklick auf `Pulse starten.cmd`.

## Funktionen

| Bereich | Was es kann |
|---|---|
| Tabs | Hintergrund-Tabs, Anheften, Stummschalten, Drag & Drop, Tab schlafen legen, geschlossene Tabs wiederherstellen (Strg+Umschalt+T), Sitzung wird beim Start wiederhergestellt |
| Control | RAM-Limiter (weich = Warnung, hart = Hintergrund-Tabs schlafen legen), CPU-Limiter (drosselt Hintergrund-Tabs), Netzwerk-Limiter, Hot-Tabs-Liste mit Live-Graphen |
| Seitenleiste | WhatsApp, Discord, Telegram, Instagram, Twitch, Spotify, X als angedockte Web-Apps; eigene per Einstellungen hinzufügen, Rechtsklick entfernt |
| Werbeblocker | EasyList/EasyPrivacy (Ghostery-Engine), Zähler pro Seite |
| Passwörter | Speichern-Abfrage nach Login, Autofill, mit Windows DPAPI verschlüsselt; CSV-Import/Export (Opera/Chrome-Format) |
| Erweiterungen | Chrome Web Store direkt nutzbar, Erweiterungs-Buttons in der Toolbar, Import der Opera-GX-Erweiterungen, entpackte Erweiterungen laden |
| Import | Lesezeichen, Verlauf und Erweiterungen aus Opera GX, Opera, Chrome, Edge, Brave |
| Sonstiges | Downloads-Manager, Verlauf mit Suche, Lesezeichenleiste, Suchen auf Seite, Zoom, Private Fenster, Berechtigungsabfragen, Speed Dial, Akzentfarbe & Hintergrundbild |

## Tastenkürzel

Strg+T/W/N, Strg+Umschalt+N (privat), Strg+L, Strg+F, Strg+D, Strg+H, Strg+J,
Strg+Tab, Strg+1…9, Alt+←/→, F5, F11, F12, Strg+Plus/Minus/0.

## Tests

```
npm test        # Unit-Tests der Kernlogik
npm run smoke   # startet den Browser mit Wegwerf-Profil und prüft echte Abläufe
```

## Aufbau

- `src/main` – Hauptprozess: Fenster, Tabs, Limiter, Passwörter, Import, IPC
- `src/preload` – Brücke zur Oberfläche bzw. zu Webseiten (Passwort-Autofill)
- `src/ui` – Browser-Oberfläche (Tabs, Toolbar, Seitenleiste, Panels)
- `src/pages/newtab` – Startseite mit Speed Dial

## Installieren & Updates

```
npm run dist      # baut dist/Pulse-Setup-<version>.exe (lokal, ohne Veröffentlichung)
```

Pulse sucht beim Start und alle 2 Stunden auf GitHub Releases
(`Voidlesh/pulse-browser`) nach neuen Versionen, lädt sie im Hintergrund und
installiert sie beim Beenden – oder sofort über „Jetzt neu starten“.

Neue Version veröffentlichen: Version in `package.json` erhöhen, committen und
einen Tag pushen (`npm version patch && git push --follow-tags`). Der Workflow
`.github/workflows/release.yml` baut und veröffentlicht dann automatisch.
Zusätzlich holt er jeden Montag neue Electron-/Chromium-Sicherheitsupdates und
veröffentlicht sie als Patch-Release.
