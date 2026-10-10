# MailBridge

An Office-style Windows mail client forked from Mailspring, with permanent local mail, independent IMAP/SMTP on both PCs, and optional encrypted Google Drive synchronization. Windows 10/11 x64 is the target. The complete native mail engine is forked too; releases must compile it from the pinned `mailsync` submodule rather than substitute an upstream binary.

## What it does

- Connects directly to company IMAP/SMTP, using the existing mature composer, attachments, threading, search, folders, and account setup.
- Captures complete incoming mail of every age and successful outgoing SMTP submissions as durable `.eml` files, including attachments.
- Keeps independent retained placements. Server expunge and folder removal never remove these placements. The normal Inbox/Sent views include retained copies.
- Opens complete original-message exports from the retained archive even when the server copy is gone or the PC is offline.
- Rebuilds a lost mail cache from the local archive, including locally saved read/flag/folder state.
- Encrypts transport objects with AES-256-GCM and a workspace pairing key protected by the OS credential store.
- Uses either a shared Google Drive for desktop folder or direct Google Drive API access. Direct access uses desktop OAuth with PKCE, token refresh, app-private storage, verified uploads, and quota reporting.
- Synchronizes sent mail, read/unread flags, stars, and archive folder placement. Independent device snapshots merge each field by a logical clock with deterministic ties.
- Confirms delivery only after the second PC durably stores and imports a checksum-verified complete message. A local upload or folder write is never proof that the other PC has it.
- Can collect encrypted cloud message objects after both explicitly confirmed PCs acknowledge them. Permanent local copies remain. Cloud checkpoints prevent deleted transfer objects from being uploaded repeatedly.
- Provides an archive/status settings page, tray support, and opt-in Windows startup. It does not receive upstream Mailspring application updates or transmit crash reports to upstream services.

## Set up two PCs without Google Drive (default)

1. Install MailBridge and add the same company account as IMAP/SMTP on both PCs. Drive sign-in and pairing are not required.
2. Let both PCs finish downloading complete mail, including attachments. Open both apps regularly.
3. Clear only older server messages through webmail after allowing several days for both PCs to download them. The local retention page confirms capture on this PC; without a separate connection it cannot verify the other PC.
4. Downloaded messages remain local after server cleanup. Delete/Junk inside MailBridge affects this PC only and leaves server storage unchanged. A message must finish capture before it can be deleted locally.

Read status, flags and folder changes travel through IMAP while the server copy exists. After server cleanup, these changes are local. A PC that misses a message before cleanup cannot retrieve it. Sent mail reaches the other PC through the server Sent folder; if the server rejects that Sent upload (for example, because the mailbox is full), only the sending PC has its retained Sent copy. PST imports likewise remain on the importing PC. These are the accepted server-only tradeoffs. Back up both PCs independently.

## Optional Google Drive archive sync

Enable **Use Google Drive for additional archive sync** in **Archive & sync** on both PCs. Existing paired installations keep their previous Drive setting until explicitly disabled. Then:

1. Install MailBridge and add the company account as IMAP/SMTP on each PC.
2. In **Archive & sync**, choose the same shared folder in Google Drive for desktop on both PCs. Keep this separate from the app's private local archive. Alternatively connect directly using the same Google account on both PCs.
3. On the first PC, create an archive and copy its pairing code. On the second PC, join using that code. It contains your encryption key: keep it private and save a recovery copy securely.
4. Leave both apps and Drive for desktop running. Confirm the other PC's displayed device ID on each PC. Monitor the pending count.
5. Before clearing old mail in webmail, wait for the native mailbox download to finish, the unretained count to reach zero, and the pending count to reach zero. Retained mail remains in the normal Inbox/Sent views.

Mailbox cleanup is deliberately performed through webmail. The app does not issue unattended server deletes. Messages removed before a PC captures their full MIME content cannot be recovered there in server-only mode.

**Drive folder status:** “Shared Drive folder available” checks local access. Drive for desktop performs the cloud upload; the other PC's receipt proves delivery. It does not claim that a local folder write proves a completed Google upload. Direct API mode reports actual API connectivity and account storage quota.

The 15 GB Google allowance is shared with the account's other storage. Permanent cloud archive mode retains all encrypted mail within that allowance. Select transfer-buffer mode on both PCs to free message objects after two-PC receipt, while state and checkpoint records remain. A new/replacement PC in buffer mode needs a copy of an existing PC's local archive to recover older messages. Enabling permanent mode again restores collected message objects from the local archive. Back up each PC's local archive independently.

## Direct Google sign-in

Folder mode requires no Google developer credentials. For direct sign-in, the distributor supplies a Google **Desktop app** OAuth client with Drive API enabled. Fill `app/mailbridge-oauth.json` before packaging, or use **Developer connection settings** in the app. Both PCs must use credentials from the same Google application. Only `drive.appdata` is requested. Access/refresh tokens and archive keys are encrypted by Electron safeStorage; Linux development requires a usable desktop keyring. End users sign in in their own browser.

## Import Outlook PST backups

On Windows, add the destination company account, open **Archive & sync**, choose that account under **Import existing Outlook mail**, then select a PST backup. Classic Outlook 2010 or Microsoft 365 must be installed. The importer creates a disposable copy before Outlook opens it; your selected source remains untouched. Allow enough disk space for that copy and the imported mail. Leave the original PST backup intact until you have checked the results on both PCs.

Large PSTs are copied before Outlook opens them. The import section reports copy percentage, Outlook startup and folder export stages, message counts, and failures. Keep enough free disk space for the temporary PST copy plus all imported mail. Cancel stops the current import and keeps messages already imported; retry deduplicates them. An exporter that reports no progress for 15 minutes stops with a prompt to check classic Outlook.

Import includes sent and received mail, HTML/plain bodies, attachments, inline content IDs, dates, Message-IDs, read status, and flags. It excludes unsent drafts, calendars, and contacts. Messages that cannot be exported are counted as warnings. Retrying a completed import deduplicates messages by their stable identity. Outlook COM compatibility requires verification on a PC with classic Outlook; CI checks the MIME serializer and native import independently.

## Build and verify

```sh
git clone --recurse-submodules https://github.com/khush2003/MailBridge.git
cd MailBridge
npm ci
npm run typecheck
node --test test/mailbridge/*.test.cjs
```

The **MailBridge Windows** workflow builds the modified native engine with MSBuild/vcpkg, runs the real native integration tests on Windows, packages the desktop client, opens the packaged app for a smoke test, and generates `MailBridge-Setup-0.2.0.exe` with Inno Setup. Review builds are unsigned. Production signing is opt-in: set repository variable `MAILBRIDGE_SIGNED_BUILDS=true` and secrets `MAILBRIDGE_PFX_BASE64` and `MAILBRIDGE_PFX_PASSWORD` for your Authenticode certificate. Signing covers executable/DLL/native-module files and the installer. Build information and SHA-256 hashes accompany the artifact. No executable packing/obfuscation or antivirus evasion is used. A signature helps establish publisher identity; it cannot guarantee every antivirus or Windows reputation result.

For Linux development, build libetpan with a local prefix, then MailCore and mailsync with that prefix in their include/library search paths. Copy the resulting `mailsync` to `app/mailsync`. See `mailsync/BUILDING.md`. `npm start` runs the source app; `npm run build -- --skip-installers` produces a standalone Linux directory for verification.

## Storage and recovery

The private configuration directory is `%APPDATA%/MailBridge` on Windows. Its `mailbridge/blobs` directory contains complete plaintext `.eml` messages, `records` immutable descriptors, and `state` native state snapshots. These stay on the PC. Only authenticated encrypted objects enter the shared Drive folder. `settings.json` stores encrypted credentials, and `sync-journal.json` stores clocks and receipts. Cache reset deletes the IMAP cache, not this permanent archive. Back up the entire private configuration directory while the app is closed. Restoring it under the same Windows user preserves the device identity and protected credentials.

For a replacement PC or Windows user, start with a fresh MailBridge profile and quit before adding accounts. Copy only the backed-up `mailbridge/blobs`, `mailbridge/records`, and `mailbridge/state` directories into the fresh profile. Keep the new profile's settings and device identity; do not copy the old `config.json`, `settings.json`, or `sync-journal.json` into it. Reopen MailBridge, add the same company email address, join the archive using the saved pairing code, and confirm the new device on both PCs. This restores mail while generating new credentials and delivery receipts. Permanent cloud archive mode can also download existing cloud copies; transfer-buffer mode requires the local backup for mail already collected from Drive.

The fork's source remains GPL-3.0, with the upstream Mailspring/Mailspring-Sync notices preserved. MailBridge is independent of Microsoft and the upstream Mailspring service.

### PST backups (0.1.3)

In **Archive & sync → PST backups**, choose a folder outside the live MailBridge profile,
then click **Back up now**. To schedule snapshots, enable **Back up automatically** and
choose daily or weekly. Due backups start while the main mail window is open; a failed
scheduled attempt retries no more than once an hour. Classic Outlook must be installed
and its profile accessible. Complete any Outlook profile or password prompts.

Backups export retained received and sent mail, attachments, account/folder placement,
read status and flags. Locally hidden mail is included under its local Trash/Junk folder.
Drafts, contacts and calendars are excluded. Each run writes a fresh dated snapshot;
previous successful backups are never overwritten or automatically deleted. Large
archives are split into PST parts at approximately 20 GiB. Allow substantial free disk
space and time for a full snapshot, especially after importing a 16 GiB archive.

The permanent live MIME archive stays in `%APPDATA%\\MailBridge\\mailbridge`;
AppData is persistent storage, not a temporary directory. PSTs are additional portable
backups. Copy completed snapshots to another disk for protection against disk failure.
Incomplete attempts remain in `.mailbridge-incomplete-*` folders and do not count as a
successful backup. After a canceled or timed-out operation, close any leftover backup
store in Outlook before deleting its incomplete folder.

Verification covers helper compilation on Windows, EML/MSG round trips including
Unicode, original dates, recipients and attachment bytes, backup completion gating,
error/cancel handling, and the actual settings interface. A real PST export/import with
classic Outlook and the user's 16 GiB archive still requires a Windows pilot; CI has no
Outlook installation or licensed profile.

This version also loads the MailBridge main interface immediately, gives new and reopened
popout drafts the MailBridge header, and finishes account setup without a subscription
or newsletter page.

### Optional app password and upgrades

In **Archive & sync → App password**, enter any nonempty password and confirm it. The
password is stored as a salted scrypt verifier. MailBridge locks at every startup;
**Lock now** locks all app windows. Change or remove the password using the current one.
Mail downloads continue while locked, and mail notifications are suppressed. This is an
app access lock, not encryption of the mail archive or exported PSTs. Keep using Windows
account protection and disk encryption to protect files outside the app. The verifier
is stored in the same persistent profile as your account configuration.

Run the new installer over the existing installation: **do not uninstall first**.
The stable installer identity and installation folder allow in-place upgrades. Account
configuration, retained mail, backup settings and the app password live outside the app
installation directory and are preserved. Complete or cancel an active Outlook import
or PST export before updating.

From this version onward, **Archive & sync → App updates → Check for updates** checks
this installation's private Tailscale feed. The app verifies an Ed25519-signed manifest,
then streams and verifies the installer SHA-256 and exact size. **Restart and update**
waits for a graceful app exit, runs the update in the existing app directory and reopens
MailBridge. It does not use the original client's update service. If the private server
is unavailable, the installed app is unchanged; download a verified new installer and
run it over the current installation instead. This first update from older builds needs
the downloaded installer because those builds do not contain the new update controls.

### Fluent interface and quality checks (0.2.0)

The compact ribbon groups common mail commands and moves secondary commands into an
icon menu on narrower windows. Shared icon menus support arrows, Home/End, typeahead
and Escape, restore focus, and close when the app locks. Reading popouts, saved drafts,
new composers, account setup and settings use the MailBridge interface. Settings have
persistent category navigation, accessible keyboard selection and a single content
scroll area. Old subscription, welcome/authentication routes and billing notifications
are bypassed, including for preserved upstream identities.

Import reports copy percentage, Outlook startup, folder export and import counts.
Cancellation signals the Outlook worker to detach its disposable PST before fallback
termination. Backups show message counts and provide cancellation without replacing
previous successful snapshots. Optional Drive archive sync can be paused; a current
transfer finishes before pausing. Company IMAP downloads continue. **Sync Mail** resumes
archive sync, including when invoked from a reading popout.

Verification opens the real packaged Windows app and exercises mailbox spacing at
1280 and 980 pixels, context menus, setup completion, all settings categories, draft
and reading popouts, lock/unlock across windows, and visible import/backup feedback.
The progress UI uses controlled workers: the 16 GiB copy indicator is a fixture, not
proof of importing the user's PST. Native tests use controlled IMAP/SMTP servers;
archive transport and cancellation tests use local/fake transports. CI upgrades the
previous installed version with a populated fixture profile, verifies all existing
profile bytes, unlocks it with its original password, and displays retained mail.

A real company account, real Google Drive credentials, classic Outlook COM operations,
the user's 16 GiB PST, Windows antivirus reputation and a second physical PC were not
available for this verification. These still need a pilot on the intended PCs. The
installer is unsigned unless a distributor configures Authenticode signing.

Version comparison now handles packaged commit suffixes. This release uses 0.2.0 so
the existing 0.1.3 updater can recognize it before evaluating the affected patch
component. Later patch updates are recognized normally by the corrected comparator.
