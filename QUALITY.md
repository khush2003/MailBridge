# MailBridge quality pass

The interface preserves the compact Office-style mail workspace while using a consistent blue, slate, and white palette, clear active states, rounded controls, and short 100–140 ms feedback. Menus, ribbon changes, and newly displayed messages animate without delaying clicks. Reduced-motion preferences disable those transitions. Keyboard focus stays visible. The sidebar navigation follows the resized folder pane.

Search uses the inherited query engine and suggestion controls, including Outlook's F3 shortcut. All/Unread states reflect the actual query; Unread scopes to the current folder. The ribbon exposes the existing folder picker and distinguishes Mark read/unread and Flag/Unflag. Archive and Delete respect the current perspective's permitted actions. Multi-account titles follow the viewed mailbox.

Correctness fixes:

- Stopped, stale, missing-heartbeat, or unreadable status data cannot report that capture is complete or that server mail is safe to clear.
- Navigating between folders resets the previous search origin, so clearing a subsequent search returns to the correct folder.
- Slow search suggestions cannot overwrite a newer query, or update an unmounted component.
- Upstream update code is removed from the fork's update manager. An accidental method call cannot replace MailBridge with Mailspring.
- Offline download notices distinguish connection problems and unknown completion from a known number of unfinished downloads.

Validation covers the full inherited desktop suite, archive/controller/Drive tests, native MIME retention and sending, and real Electron interaction tests. The workspace test waits for rendered MIME bodies after reading-mode changes, checks retained attachments, search and its keyboard shortcut, the folder menu, pane resizing, reduced motion, and preferences. Windows CI additionally verifies credential protection, sign-in startup registration, PST MIME serialization, installation, five installed launches, and uninstall cleanup.

Local verification: 2,627 desktop tests and 23 archive/controller tests passed; TypeScript and lint checks passed. All 13 native archive integration tests passed, including two independent PCs retaining full mail and attachments after webmail cleanup, private local deletion, undo, cache recovery, offline export, and SMTP success when Sent APPEND is refused for quota reasons. Additional inherited engine scenarios exercise IMAP personalities, folder moves, UID changes, flags, deletion, reconnection, and database invariants.

These checks use synthetic accounts and local mail servers. A pilot on the two actual PCs remains necessary for the company's authentication requirements and Outlook COM/PST integration. Server-only mode cannot deliver already-cleaned mail to a PC that missed it, or transfer a Sent copy rejected by the server. Local deletion leaves server storage intact. The executable remains an unsigned review build unless a publisher certificate is configured.
