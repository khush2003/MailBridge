# MailBridge quality pass

The interface preserves the compact Office-style mail workspace while using a consistent blue, slate, and white palette, clear active states, rounded controls, and short 100–140 ms feedback. Menus, ribbon changes, and newly displayed messages animate without delaying clicks. Reduced-motion preferences disable those transitions. Keyboard focus stays visible. The sidebar navigation follows the resized folder pane.

Search uses the inherited query engine and suggestion controls, including Outlook's F3 shortcut. All/Unread states reflect the actual query; Unread scopes to the current folder. The ribbon exposes the existing folder picker and distinguishes Mark read/unread and Flag/Unflag. Archive and Delete respect the current perspective's permitted actions. Multi-account titles follow the viewed mailbox.

Correctness fixes:

- Stopped, stale, missing-heartbeat, unreadable status data, or an outdated native capture scan cannot report that capture is complete or that server mail is safe to clear.
- Navigating between folders resets the previous search origin, so clearing a subsequent search returns to the correct folder.
- Slow search suggestions cannot overwrite a newer query, or update an unmounted component.
- Upstream update code is removed from the fork's update manager. An accidental method call cannot replace MailBridge with Mailspring.
- Bulk message expunge and folder deletion are blocked in both native task phases while retention is enabled. The UI offers webmail cleanup guidance instead of destructive server commands.
- Retention preflight failures appear as brief status-bar notices, and search suggestion errors are handled without an unhandled rejection.
- Calendar formatting uses bounded buffers; malformed alarm durations stop safely, and positive alarm durations keep their forward direction. Local AddressSanitizer and UndefinedBehaviorSanitizer checks cover boundary values and malformed input.
- Server-only status polling reads aggregate native statistics instead of parsing and serializing every archived message. This keeps periodic status work small as the archive grows.
- Compose and other split controls use the shared flat button styling. Menu-only dropdowns support Enter, Space, and Escape and report their expanded state. New accounts start without a promotional signature.
- Notification actions are keyboard-accessible, Dismiss controls do not duplicate across renders, and nested alert changes update their priority. Retry timers are cleared on unmount.
- The test harness tolerates the engine rotating its log between filesystem checks; a regression covers the transient missing file. The 5,000-message MODSEQ fixture now places messages outside the existing 90-day body-cache window, as its flag-sync test requires.
- Offline download notices distinguish connection problems and unknown completion from a known number of unfinished downloads.

Validation covers the full inherited desktop suite, archive/controller/Drive tests, native MIME retention and sending, and real Electron interaction tests. The workspace test waits for rendered MIME bodies after reading-mode changes, checks retained attachments, search and its keyboard shortcut, the folder menu, pane resizing, reduced motion, and preferences. Windows CI additionally verifies credential protection, sign-in startup registration, PST MIME serialization, installation, five installed launches, and uninstall cleanup.

Local verification: 2,630 desktop tests and 24 archive/controller tests passed; TypeScript and lint checks passed. The 14 native archive integration tests cover two independent PCs retaining full mail and attachments after webmail cleanup, private local deletion, undo, cache recovery, offline export, and SMTP success when Sent APPEND is refused for quota reasons. The broader native run, including the corrected MODSEQ rerun, passed 108 checks with 90 unavailable-server/optional-comparison cases skipped. It exercises IMAP personalities, folder moves, UID changes, flags, deletion, reconnection, and database invariants. Two additional calendar-sanitizer and log-rotation checks passed. All 14 retention cases were rerun on the final aggregate-statistics implementation.

These checks use synthetic accounts and local mail servers. A pilot on the two actual PCs remains necessary for the company's authentication requirements and Outlook COM/PST integration. Server-only mode cannot deliver already-cleaned mail to a PC that missed it, or transfer a Sent copy rejected by the server. Local deletion leaves server storage intact. The executable remains an unsigned review build unless a publisher certificate is configured.
