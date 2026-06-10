# AMIG

Desktop top-down PvP game foundation using Electron, Phaser, Vite, and
Supabase Auth.

## Setup

1. Create a Supabase project.
2. In the Supabase SQL Editor, run `supabase/profiles.sql`, then
   `supabase/game_rooms.sql`.
3. In Supabase Realtime Settings, disable **Allow public access** so all match
   channels must pass the room authorization policies.
4. Copy `.env.example` to `.env`.
5. Add the project URL and anon/publishable key to `.env`.
6. In Supabase **Authentication -> URL Configuration**, add this exact
   redirect URL: `amig://auth/confirmed`.
   Keep `icrackedsahil://auth/confirmed` temporarily if verification emails
   were sent before the rename.
7. In the **Confirm signup** email template, ensure the confirmation button
   links to `{{ .ConfirmationURL }}`.
8. Install and launch the desktop app:

```powershell
npm install
npm start
```

Electron keeps a persistent Chromium profile for the app. Supabase stores and
refreshes remembered player sessions there. Players can clear **Keep me signed
in** during login to use a session that ends when the desktop app exits. Never
put a Supabase service role key in the game client.

Launch with desktop development tools and hot reload:

```powershell
npm run dev
```

Create a Windows installer in `release/`:

```powershell
npm run package
```

## macOS Installer

A Mac installer is a `.dmg`, not a `.exe`. Building it requires macOS. The
included GitHub Actions workflow builds one universal installer for Intel and
Apple Silicon Macs.

1. In the GitHub repository settings, add the Actions variable
   `SUPABASE_URL`.
2. Add the Actions secret `SUPABASE_PUBLISHABLE_KEY`.
3. Open **Actions -> Build macOS installer -> Run workflow**.
4. Download the `AMIG-macOS` artifact when the workflow finishes.

The unsigned development DMG may trigger Gatekeeper. Public distribution
requires an Apple Developer ID certificate and notarization.

## Current Foundation

- Email/password signup and login through Supabase Auth
- Persistent login sessions and automatic token refresh
- Row-level security for player profiles
- Authenticated Phaser top-down arena shell
- Sandboxed Electron window with Node integration disabled
- Fullscreen main menu with bot matches and private friend rooms
- Atomic room joining and authenticated Supabase Realtime movement

Friend movement is synchronized through authenticated Realtime channels.
Shooting, damage, scoring, and anti-cheat validation still need an authoritative
match host/server.
