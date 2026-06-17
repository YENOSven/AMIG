# AMIG

Desktop top-down PvP game foundation using Electron, Phaser, Vite, and
Supabase Auth.

## Setup

1. Create a Supabase project.
2. In the Supabase SQL Editor, run `supabase/profiles.sql`, then
   `supabase/game_rooms.sql`. Re-run `game_rooms.sql` after app updates.
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

Create a production Windows installer and ZIP in `release/`:

```powershell
npm run release:windows
```

The release folder is cleaned first and ends with:

- `AMIG Setup 1.0.0.exe`
- `AMIG Setup 1.0.0.zip` containing that installer

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
- Atomic room joining and authenticated Supabase Realtime battles
- Base-destruction matches with credits, troop purchasing, commands, combat,
  bot strategy, and victory conditions

## Gameplay

- Earn credits automatically throughout the match.
- Use the five-slot unit hotbar or keys `1` through `5` to recruit Soldiers,
  Rangers, Tanks, Medics, and Artillery.
- Each team can field at most `20` units.
- Soldiers catch Rangers and pin them in melee, briefly disrupting their fire.
  Rangers pierce Tank armor from range. Tanks use flat armor, close-range
  movement control, and knockback to stop Soldiers. Counters use mechanics
  rather than hidden damage multipliers.
- Mixed squads coordinate in combat: frontline troops protect threatened
  support units, ranged troops anchor behind the line, Medics stay within
  support range, allies focus targets, and Artillery requires allied spotting.
- Tanks actively intercept enemies approaching Rangers, Medics, and Artillery.
  Ranged units wait for a Soldier or Tank to establish coverage before taking
  normal engagements, fall back when exposed, and regulate their pace so they
  do not outrun slower frontline units.
- Tank armor is weaker without nearby allies, Medics cannot fight alone, and
  Artillery loses pressure without spotters. Costs reflect each unit's expected
  contribution inside a coordinated army.
- Left click troops to add or remove them from the current selection. Selections
  accumulate without requiring Shift.
- Selecting a troop immediately cancels its AI task and holds its position
  while it waits for the next manual command.
- Press `A` to select your entire army.
- Use **Deselect all** to release every manually held troop back to strategic AI.
- The game can run autonomously: both commanders recruit balanced armies,
  defend, regroup, contest objectives, and attack without player input.
- Keyboard controls avoid mouse dependence: `Tab` cycles units, `F` selects
  frontline troops, `R` selects support troops, `Q`/`E` cycle mine orders,
  `B` attacks the enemy base, `Space` moves to the camera center, `H` guards,
  `G` returns troops to AI, and `C` focuses the selected squad.
- Tactical abilities raise the execution ceiling. `Z` activates **Surge** for
  faster movement and attacks at the cost of increased incoming damage. `X`
  activates **Brace** for strong damage reduction at the cost of movement and
  attack tempo. `V` orders **Focus Fire** on the enemy nearest the camera
  center. Each unit has a 14-second tactical cooldown.
- Strategic AI is always active. It chooses low-risk mines, defense, staging,
  and base attacks from army strength, mine control, and base health.
- Move the pointer to any battlefield edge to scroll the camera. Arrow keys
  also move the camera on the larger map.
- Click empty ground after selecting troops to direct them there. Right click
  also issues a formation move command. Manually commanded troops ignore combat
  until they reach their assigned formation positions, then guard and fight
  from those positions until the player deselects them.
- Troops automatically attack enemies and bases in range.
- Capture any of the seven gold mines for `+6` credits per second each.
- Mines reset to full health when captured and can be recaptured by attacking
  them with troops.
- Destroy the enemy base to win.
- After victory or defeat, choose **Play again** or press `Enter` to reset the
  battlefield while keeping the same friend room and connection.
- Open **Keybinds** from the main menu for the complete keyboard reference.

Friend matches use the room host as the authoritative economy and combat
simulation. Guests send commands and receive synchronized battle snapshots.
