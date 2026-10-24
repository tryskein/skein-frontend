/**
 * sk-285.7.2.88 — the reminder phrases, declared ONCE for the two
 * surfaces that say them.
 *
 * The Details panel's reminder block (`details.reminders.*`) and the
 * Tasks column's reminders lens (`tasks.remindersLens.*`) describe the
 * SAME object in the same words: an alarm is armed, it rings, it has
 * been ringing since a time, it has been snoozed N times. Until this
 * task they were two hand-kept copies, and they had already drifted in
 * the way copies drift: sk-285.7.2.57 stripped the 🔔 / ⏰ emoji from
 * the Details copy and the lens copy kept them, so the same reminder
 * read «ringing» on one surface and «🔔 ringing» on the other.
 *
 * Spreading one object into both namespaces is what removes the drift
 * at the source rather than pinning it with a test: there is no second
 * string to forget. The namespaces stay separate — they are two
 * surfaces and a translator works through one screen at a time — but
 * the five phrases they share have one definition.
 *
 * `armedTitle` is deliberately NOT here: the Details row has an
 * absolute-time `title` on hover and the lens row has none, so that
 * key belongs to one surface only.
 */
const enReminderPhrases = {
  ringing: 'ringing',
  ringingSince: 'ringing since {{since}}',
  armedIn: 'rings in {{countdown}}',
  lessThanMinute: 'less than a minute',
  // The `×` here is the MULTIPLICATION SIGN in a count («snoozed 2×»),
  // not a character standing in for the icon `x`. It is a unit, and
  // `PanelResidualGlyphs.test.tsx` already exempts it by name.
  snoozed: ' · snoozed {{count}}×',
} as const;

/**
 * English dictionary (sk-285.1.17) — the SOURCE language.
 *
 * Structure: one object per namespace, keys grouped by the surface they
 * belong to. Keys are semantic (`inbox.tabs.mentions`), never the string
 * itself, so re-wording English copy never invalidates the Russian side.
 *
 * `ru.ts` mirrors this shape exactly. When you add a key here, add it
 * there too — a missing key silently falls back to English, which reads
 * as a half-translated UI rather than an error.
 */
export const en = {
  /**
   * sk-285.6.14 / audit 2B N-1 — the sign-in screen.
   *
   * It had no dictionary at all: every string was an English literal in
   * `login.tsx`, and most of them were terminal props (`login@skein:~$`,
   * `> sign in`, `> waiting for input`) rather than copy. The rewrite
   * replaced the props with words, and words belong here — this is the
   * first screen of the product and the only one an unauthenticated
   * visitor sees, so «English only» is a worse default here than
   * anywhere else.
   */
  auth: {
    brandAria: 'Skein — sign in',
    title: 'Sign in',
    tagline: 'Task tracker for agents and people.',
    emailLabel: 'Email',
    emailPlaceholder: 'you@example.com',
    passwordLabel: 'Password',
    passwordPlaceholder: '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
    submit: 'Sign in',
    submitting: 'Signing in\u2026',
    sso: 'Log in with Keycloak',
    ssoRedirectNote: 'You will be redirected to the corporate identity provider.',
    ssoRequired: 'This account must sign in with Keycloak.',
    orPassword: 'Or sign in with a password',
    configErrorTitle: 'Cannot determine auth mode',
    configErrorBody: 'Failed to load authentication configuration. Please reload the page.',
    retry: 'Retry',
    errors: {
      email: 'Enter a valid email address',
      credentials: 'Invalid email or password',
      rateLimit: 'Too many attempts. Wait 60 seconds.',
      unavailable: 'Service unavailable. Try again.',
      network: 'Network error. Try again.',
    },
    // sk-674.18 T059 — the public screens (screens 1.13, 2.5–2.9): links of
    // the sign-in page, registration, invitation by link, password reset and
    // email confirmation. One message per refusal code (`codes`).
    links: {
      signup: 'Sign up',
      noAccount: 'No account yet?',
      forgotPassword: 'Forgot password?',
      signIn: 'Sign in',
      haveAccount: 'Already have an account?',
    },
    inviteLoginNote: 'Sign in to accept the invitation to {{name}}',
    loadErrorTitle: 'Could not load the page',
    codes: {
      emailTaken: 'This email is already registered.',
      usernameTaken: 'This name is taken.',
      usernameInvalid:
        '3 to 30 characters: lowercase Latin letters, digits, “_” and “-”; must start with a letter or a digit.',
      passwordWeak:
        'The password is too weak: at least 8 bytes once UTF-8 encoded, at most 72.',
      passwordPwned: 'This password has appeared in a known data breach — choose a different one.',
      termsRequired: 'Accept the terms of use and the privacy policy to continue.',
      captchaFailed: 'The check did not pass. Complete it again.',
      rateLimited: 'Too many attempts. Wait a minute and try again.',
      signupDisabled: 'Registration is closed on this installation.',
      invalidRequest: 'Check the form: some fields are not filled in correctly.',
      tokenInvalid: 'The link has expired. Request a new one.',
      emailDisabled:
        'Mail is not connected on this installation — the password cannot be reset by email. Contact your administrator.',
      passwordLoginDisabled:
        'This installation signs in through SSO — recover the password at your identity provider.',
      invitationInvalid: 'The invitation is invalid or has expired. Ask the owner to send a new one.',
      spaceDeleted: 'The space you were invited to was deleted.',
      unavailable: 'Service unavailable. Try again.',
      network: 'Network error. Try again.',
    },
    signup: {
      title: 'Sign up for Skein',
      usernameLabel: 'Username',
      usernameHint: 'People mention you by this name with @; other users see it.',
      generate: 'Generate from email',
      suggestions: 'Available names:',
      passwordLabel: 'Password',
      captchaPending: 'Complete the check above to continue.',
      captchaLoadError: 'The check could not be loaded. Reload the page.',
      submit: 'Sign up',
      submitting: 'Signing up…',
    },
    invite: {
      heading: 'Invitation',
      title: 'You are invited to {{name}}',
      invitedBy: 'Invited by: {{name}}',
      accept: 'Accept',
      decline: 'Decline',
      alreadyMember: 'You are already in {{name}}',
      open: 'Open',
      otherEmail: 'This invitation is for a different address.',
      switchAccount: 'Sign out and sign in with another account',
      askOwnAddress: 'Ask the owner to invite your address.',
      signupClosed:
        'New accounts cannot be created here — ask the owner to invite an address that already has an account.',
      signupSubmit: 'Sign up and join {{name}}',
      otherAccountChoice:
        'Already have an account under another address? Ask the owner to invite it — or sign up here, it will be a separate account.',
    },
    forgot: {
      title: 'Password recovery',
      submit: 'Send the link',
      submitting: 'Sending…',
      sent: 'If an account with this address exists, we have sent it an email with a link. The link is valid for a limited time.',
    },
    reset: {
      title: 'New password',
      passwordLabel: 'New password',
      submit: 'Save',
      submitting: 'Saving…',
      done: 'The password has been changed. Sign in with the new password.',
      requestNew: 'Request a new link',
      openApp: 'Open Skein',
    },
    confirm: {
      title: 'Email confirmation',
      confirming: 'Confirming the email…',
      done: 'Email confirmed',
      openInbox: 'Open Inbox',
      expired: 'The link has expired. Send the email again from the settings.',
      openSettings: 'Open settings',
      emailDisabled: 'Mail is not connected on this installation — there is nothing to confirm.',
    },
  },

  common: {
    // sk-674.18 T056 — the page's space choice (screens 1.11, 1.12): a
    // filter of that one page, `?space=`.
    spaceFilter: {
      label: 'Space',
      personal: 'Personal',
      all: 'All',
      allMine: 'All my spaces',
    },
    // sk-674.18 T055 — a person who left the space or whose account was
    // deleted (screens 1.10, INV-18), everywhere people are shown.
    person: {
      departed: 'left',
      departedTitle: 'Left the space',
      deleted: 'account deleted',
      deletedTitle: 'Account deleted',
      deletedName: 'Deleted user',
    },
    // sk-674.18 T053 — loss of access and ownership in a live tab (screens 1.15).
    accessLoss: {
      spaceRemoved: 'You are no longer a member of {{name}}',
      spaceDeleted: 'Space {{name}} was deleted',
      projectLost: 'The project is no longer available',
      ownerAssignedNew: 'You are the owner of the new space {{name}}',
      ownerAssigned: 'You are the owner of space {{name}}',
    },
    cancel: 'Cancel',
    close: 'Close',
    create: 'Create',
    loading: 'Loading…',
    loadingMore: 'Loading more…',
    unknown: 'unknown',
    unassigned: 'unassigned',
    me: 'me',
    clearSearch: 'Clear search',
    errorTitle: 'ERROR',
    closeNotification: 'Close notification',

    /**
     * sk-514 (15) — the product's clock vocabulary.
     *
     * The English forms are byte-for-byte what the formatter printed
     * before the dictionary existed: this change moves the SOURCE of
     * the strings, not the strings. Every test that asserts the
     * English clock therefore judges that nothing moved.
     */
    time: {
      justNow: 'just now',
      secondsAgo_one: '{{count}} sec ago',
      secondsAgo_other: '{{count}} sec ago',
      minutesAgo_one: '{{count}} min ago',
      minutesAgo_other: '{{count}} min ago',
      hoursAgo_one: '{{count}} hour ago',
      hoursAgo_other: '{{count}} hours ago',
      daysAgo_one: '{{count}} day ago',
      daysAgo_other: '{{count}} days ago',
      months: [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
      ],
      absolute: '{{year}}-{{month2}}-{{day2}}',
      absoluteZoned: '{{year}}-{{month2}}-{{day2}} UTC',
      stamp: '{{year}}-{{month2}}-{{day2}} {{hh}}:{{mm}} UTC',
    },

    attributes: {
      blocked: 'Blocked',
      blockedBy: 'Blocked by {{ids}}',
      standingAria: 'Standing (perpetual obligation)',
      standingTitle: 'Standing — a perpetual obligation',
    },
    // sk-551.28 — plain words: the `[ y · … ]` terminal dialect was
    // retired by sk-414.2, and no `y` / `n` key was ever bound here.
    confirmDialog: {
      title: 'Confirm',
      confirm: 'Confirm',
      cancel: 'Cancel',
    },
    language: {
      label: 'Language',
      en: 'English',
      ru: 'Русский',
      switchTo: 'Switch interface language to {{name}}',
      // sk-285.6.15 — the accessible name of the flag-only rail button. A
      // flag is a picture; without a text name the control announces as
      // a bare "button".
      current: 'Language: {{name}}',
    },
  },

  chrome: {
    connection: {
      connecting: '[connecting]',
      reconnecting: '[reconnecting]',
      disconnected: '[disconnected]',
    },
    version: {
      banner:
        'A new version of Skein is out. Reload the page so it keeps working correctly.',
      reload: 'Reload',
      later: 'Later',
    },
    push: {
      aria: 'Notifications',
      body: 'Turn on desktop notifications? Skein will push new tasks, mentions and reminders to you.',
      yes: 'Yes',
      later: 'Not now',
    },
    theme: {
      loading: 'Loading themes…',
      myThemes: 'My themes',
      teamThemes: 'Team themes',
      openEditor: 'Open the editor',
      createNew: 'Create a new one…',
      // Segment cells (sk-285.7.11, AM3). Each names the theme it
      // SELECTS, not the one you are leaving — a segment answers "which
      // one", so the cell for the active theme reads as a statement of
      // where you are rather than as an instruction to go elsewhere.
      group: 'Theme',
      light: 'Light theme',
      dark: 'Dark theme',
      // sk-389 — the server refused the write. Without this the click
      // read as simply ignored: the theme did not change and nothing
      // said why.
      saveFailed: 'Could not save the theme — it stayed as it was',
    },
  },

  header: {
    brandAria: 'Skein — go to main view',
    queuesAria: 'Queues',
    // sk-285.7 T024 — the phone's single Queues control. It replaces
    // the four badges, so its name carries the SUM of their counts.
    queuesTotal: 'Queues',
    queuesTotalAria: 'Queues — {{count}} unread',
    queuesTotalTitle: 'Queues — Inbox, Mentions and Watching together',
    badges: {
      inbox: 'Inbox',
      mentions: 'Mentions',
      watching: 'Watching',
    },
    badgeTitles: {
      inbox: 'Inbox — tasks assigned to you',
      mentions: 'Mentions — where someone @-mentioned you',
      watching: 'Watching — unread updates on tasks you follow',
    },
    menu: 'Menu',
    closeMenu: 'Close menu',
    accountMenu: 'Account menu — {{user}}',
    lenses: 'Lenses',
    onMe: 'On me',
    onMeTitle: "Tasks assigned to you by others that you've accepted",
    delegated: 'Delegated',
    delegatedTitleOn:
      'Delegated mode is ON — showing tasks I created and assigned to someone else (self-assigned tasks excluded).',
    delegatedTitleOff:
      'Toggle Delegated mode — show only tasks I created and assigned to someone else (self-assigned tasks are excluded).',
    reminders: 'Reminders',
    remindersAria: 'Reminders',
    remindersAriaRinging_one: 'Reminders — {{count}} task ringing',
    remindersAriaRinging_other: 'Reminders — {{count}} tasks ringing',
    remindersTitleRinging_one:
      'Reminders: {{count}} task is ringing right now — open the lens to snooze or switch it off.',
    remindersTitleRinging_other:
      'Reminders: {{count}} tasks are ringing right now — open the lens to snooze or switch them off.',
    remindersTitleActive:
      'Reminders lens is ON — tasks with reminders, most urgent first.',
    remindersTitleInactive:
      'Reminders lens — show tasks that have reminders (ringing ones first).',
    activityAria: 'Activity',
    hotZone: 'HOT ZONE',
    hotZoneAria: 'HOT ZONE — the activity war-room',
    appearance: 'Appearance',
    // sk-285.7.11 (AM3) — the hint no longer describes the click:
    // a segment states which theme is on, so "click to flip" was
    // explaining a control that is now self-evident. What is NOT
    // evident is the right-click, which is the artboard's own
    // sentence beside this segment.
    themeHint: 'Right-click for saved themes',
    // sk-551.5 — Appearance: open the issue in a pop-up window, per view.
    // The view names are `filters:view.*`, the words the view switch uses.
    issueModal: {
      label: 'Open the issue in a pop-up window',
      saveFailed: "Couldn't save the pop-up window setting — it is back as it was",
    },
    // sk-551.7 — Appearance: interface density, beside the theme.
    density: {
      label: 'Density',
      normal: 'Normal',
      compact: 'Compact',
      saveFailed: "Couldn't save the density — it is back as it was",
    },
    // sk-551.8 — Appearance: the left-panel layout, beside the density.
    // On a phone the layout is always sheets, whatever is chosen; the
    // switch stays visible (a profile setting) and says so.
    navLayout: {
      label: 'Left panel',
      columns: 'Columns side by side',
      sections: 'Sections in one column',
      mobileHint: 'On a narrow screen the panels are shown as sheets',
      saveFailed: "Couldn't save the left panel layout — it is back as it was",
    },
    settings: 'Settings',
    // sk-674.18 T057 — the «Spaces» tab (screens 1.14).
    account: 'Account',
    spaces: 'Spaces',
    apiKeys: 'API keys',
    users: 'Users',
    notifications: 'Notifications',
    // sk-402 — `push` left with the drawer entry that pointed at the
    // deleted push page; `password` is the entry that replaced it.
    password: 'Password',
    theme: 'Theme',
    inspect: 'Inspect element',
    inspectArmed: 'Inspect — armed',
    inspectAria: 'Inspect element for theme editing',
    inspectTitleArmed:
      'Inspect armed — click an element to tell the agent what to edit. Esc to cancel.',
    inspectTitleIdle:
      'Click an element to tell the agent what to edit. Esc to cancel.',
    logout: 'Log out',
    logoutFailed: 'Logout failed',
  },

  projects: {
    title: 'Projects',
    collapseColumn: 'Collapse Projects column',
    expandColumnWithCount: 'Expand Projects column — {{count}} projects',
    searchPlaceholder: 'search projects…',
    searchAria: 'Search projects',
    loading: 'Loading projects…',
    loadFailed: 'Failed to load projects',
    empty: 'No projects',
    emptySearch: 'No projects match',
    emptyOnMe: 'No projects with tasks from others yet',
    emptyDelegated: "No projects you've delegated tasks in yet",
    allProjects: 'All projects',
    selectAll: 'Select all projects',
    // sk-674.18 T051 — space rows (screens 1.1) and the K2 line.
    selectSpace: 'Select space {{name}}',
    expandSpace: 'Expand space {{name}}',
    collapseSpace: 'Collapse space {{name}}',
    spaceSettings: 'Settings for space {{name}}',
    spaceEmpty: 'No projects available',
    spaceEmptyAskAgent: 'Ask your agent to create a project',
    spaceEmptyJoinFirst: 'Add yourself as a member to create projects',
    agentCreatesProjects: 'Your agent creates projects',
    select: 'Select project {{name}}',
    expandComponents: 'Expand components of {{name}}',
    collapseComponents: 'Collapse components of {{name}}',
    countsAria:
      '{{open}} open, {{inProgress}} in progress, {{blocked}} blocked',
    countsAriaWithStanding:
      '{{open}} open, {{inProgress}} in progress, {{blocked}} blocked, {{standing}} standing',
    standingTitle: '{{count}} standing',
    selectComponent: 'Filter tasks by component {{name}}',
    deselectComponent: 'Deselect component {{name}}',
    tooltip: {
      // sk-514 (9) — the project popup's labels. They used to be 21
      // hardcoded English literals bypassing the dictionary; the Russian
      // interface showed them as foreign text. Contrast and type were
      // measured and are fine — the unreadability was linguistic.
      open: 'open',
      inProgress: 'in progress',
      blocked: 'blocked',
      deferred: 'deferred',
      standing: '∞ standing',
      closed: 'closed',
      assignedToMe: 'assigned to me',
      createdByMe: 'created by me',
      lastActivity: 'last activity',
      // sk-551.15 — the line about the caller in the compact card.
      me: 'me:',
    },
    // sk-551.15 — the accessible name of the ⓘ on a project row.
    about: {
      open: 'About {{name}}',
    },
  },

  inbox: {
    title: 'Queues',
    totalCountAria_one: '{{count}} unread across all queues',
    totalCountAria_other: '{{count}} unread across all queues',
    queueSelectAria: 'Queue',
    // sk-674.18 T054 — read a failed queue again.
    retry: 'Retry',
    panelAria: '{{queue}} queue',
    tabs: {
      inbox: 'Inbox',
      mentions: 'Mentions',
      watching: 'Watching',
    },
    collapseColumn: 'Collapse Queues column',
    expandColumnWithCounts:
      'Expand Queues column — {{total}} unread: Inbox {{inbox}}, Mentions {{mentions}}, Watching {{watching}}',
    empty: {
      inbox: 'No incoming tasks',
      mentions: 'No new mentions',
      watching: 'Not watching anything yet',
    },
    loading: {
      inbox: 'Loading inbox…',
      mentions: 'Loading mentions…',
      watching: 'Loading watching…',
    },
    error: {
      inbox: 'Failed to load inbox',
      invitations: 'Failed to load invitations',
      mentions: 'Failed to load mentions',
      watching: 'Failed to load watching',
    },
    card: {
      openIssue: 'Open issue {{id}}: {{title}}',
      from: 'from',
      accept: 'Accept',
      acceptAria: 'Accept {{id}}',
      acceptTitle: 'Accept this task',
      accepted: 'accepted',
      acceptedAria: '{{id}} accepted',
    },
    // sk-674.18 T054 — the space of a queue card (screens 1.3–1.5).
    space: {
      personal: 'Personal',
    },
    // sk-674.18 T054 — the invitation card pinned above the Inbox tasks
    // (screens 1.3).
    invitation: {
      groupAria: 'Invitations to spaces: {{count}}',
      title: 'You are invited to {{space}}',
      meta: 'Invited by {{inviter}} · valid until {{date}}',
      accept: 'Accept',
      acceptAria: 'Accept the invitation to {{space}}',
      decline: 'Decline',
      declineAria: 'Decline the invitation to {{space}}',
      unconfirmedHint: 'Open the link in the invitation email — it confirms your email — or',
      sendConfirmation: 'send a confirmation email',
      confirmationSent: 'Confirmation email sent',
      confirmationFailed: 'Could not send the confirmation email',
      emailDisabled: 'Email is turned off on this installation',
      rateLimited: 'Too many attempts — try again in a minute',
      joined: 'You are in {{space}}',
      open: 'Open',
      noLongerValid: 'The invitation is no longer valid',
      emailUnconfirmed: 'Confirm your email to accept the invitation',
      acceptFailed: 'Could not accept the invitation',
      declineFailed: 'Could not decline the invitation',
    },
    mentionCard: {
      openIssue: 'Open issue {{id}}: {{title}} (mention by {{actor}})',
      mentionedYouIn: 'mentioned you in',
      comment: 'comment',
      thisIssue: 'this issue',
      someone: 'someone',
    },
    // sk-396 — the panel of the "Watching" tab: the explanation of emptiness, a link to
    // settings and the truncation banner. The emptiness keys are named by the NAMES OF REASONS
    // (`watchingEmptiness.ts#WatchingEmptinessKind`): the verdict is produced by
    // a pure function, and the text for it is chosen by the dictionary — otherwise
    // the sentence would have to be assembled from literals inside it, and none
    // of the four reasons would be translated.
    watching: {
      unavailable: 'Subscriptions exist, but their issues are currently unavailable.',
      settingsLink: 'Notification settings',
      settingsFixLink: 'Enable channels in notification settings',
      // sk-622.21 (US-5) — the column's numbers count CARDS of both kinds
      // (subscriptions and historical cards), so the copy says «cards»
      // wherever a card number is shown.
      truncated:
        'Showing {{shown}} of {{total}} cards — the list is truncated, the number above is complete.',
      // sk-551.10 — the Open / Closed / All filter and its line.
      filter: {
        aria: 'Which cards to show',
        open: 'Open',
        closed: 'Closed',
        all: 'All',
        summary: {
          open: 'Open: {{total}}',
          closed: 'Closed: {{total}}',
          all: 'All: {{total}}',
        },
        shown: 'showing {{shown}}',
        explainLink: 'what is watching',
        explain:
          "You automatically watch issues you created yourself or handed to an agent as a top-level errand, and issues assigned to you. Subtasks your agents create on their own don't subscribe you. Watching means notifications about changes — it doesn't assign anything to you.",
        countHint:
          'Watching {{n}} — unread updates on issues you watch, open and closed ones alike. How many cards you have is shown under the filter.',
      },
      // sk-551.10 — bulk unwatch. sk-551.33 — `select` names the icon
      // that starts select mode (its tooltip and accessible name), and the
      // strip reads «Selected N · Stop watching · Cancel». sk-551.49 — the
      // strip is one line: the count sits in the button
      // (`unwatchSelectedN`), Cancel is an × icon (`cancelSelect` is its
      // accessible name, `cancelSelectHint` its tooltip), `selected` is
      // only the hidden live region now.
      actions: {
        select: 'Select several',
        cancelSelect: 'Cancel',
        cancelSelectHint: 'Cancel (Esc)',
        selected: 'Selected {{n}}',
        unwatchSelectedN: 'Stop watching · {{n}}',
        unwatchSelectedHint: 'Stop watching the selected issues',
        // sk-622.21 (US-6) — the selection holds only historical cards (no
        // subscription left, so the action is «remove», not «stop
        // watching»), or a mix of both kinds.
        removeSelectedN: 'Remove · {{n}}',
        removeSelectedHint: 'Remove the selected cards — you no longer watch these issues',
        unwatchOrRemoveSelectedN: 'Stop watching / remove · {{n}}',
        unwatchOrRemoveSelectedHint:
          'Stop watching the selected subscriptions and remove the selected cards without one',
        unwatchClosed: 'Stop watching closed · {{n}}',
        confirmTitle: 'Stop watching closed issues?',
        // sk-622.21 (US-6) — the sweep by state records NO opt-out, and
        // {{n}} counts cards of both kinds, historical ones included.
        confirmBody:
          'Cards of closed issues to remove: {{n}}. Automatic subscriptions are removed, and cards without a subscription are removed too. No opt-out is recorded: if an issue is reopened or assigned to you, its automatic subscription may come back.',
        confirmKeptManual: 'Subscriptions you made by hand ({{n}}) stay.',
        confirmButton: 'Stop watching · {{n}}',
        done: 'Stopped watching: {{n}}',
        doneWithRemoved: 'Stopped watching: {{n}}. Cards without a subscription removed: {{h}}',
        removedOnly: 'Cards without a subscription removed: {{h}}',
        failed: "Couldn't stop watching — nothing was changed.",
        // sk-622.21 (US-6) — the failure of «Remove» and of a mixed selection.
        failedRemove: "Couldn't remove the cards — nothing was changed.",
        failedMixed: "Couldn't stop watching or remove the cards — nothing was changed.",
      },
      filterEmpty: {
        open: 'No cards of open issues.',
        closed: 'No cards of closed issues.',
        all: 'No cards.',
      },
      empty: {
        'no-subscriptions':
          "You're not watching any issues yet. A subscription appears when you create an issue (or give an agent a top-level errand) or get assigned one — or when you press Watch on the issue itself.",
        'no-matching-events': 'Cards: {{total}}. No new events on them yet.',
        'all-read': 'Cards: {{total}}. All events on them have been read.',
        'feed-channels-off':
          "Cards: {{total}}. Nothing new will appear in the feed: every reason's feed channel is off in settings.",
      },
    },
    watchingCard: {
      openIssue: 'Open issue {{id}}: {{title}}',
      openIssueUnread: 'Open issue {{id}}: {{title}} ({{count}} unread)',
      reasonsAria: 'watch reasons',
      reasonTitle: "You're watching this issue because: {{reason}}",
      // sk-551.10, item 2 — what each reason means.
      reasonHints: {
        creator:
          "Author: you created this issue, or gave it to an agent as a top-level errand. Automatic — subtasks your agents file don't subscribe you.",
        assignee: "Assignee: the issue is assigned to you, so you watch it automatically.",
        manual: 'Manual: you pressed Watch yourself. “Stop watching closed” leaves it alone.',
        mention: 'Mention: an older reason — being @-mentioned used to subscribe you; it no longer does.',
        commenter: 'Commenter: an older reason — commenting used to subscribe you; it no longer does.',
      },
      reasons: {
        manual: 'manual',
        assignee: 'assignee',
        creator: 'creator',
        mention: 'mention',
        commenter: 'commenter',
      },
      recent: 'Recent (7d):',
      recentWithNew: 'Recent (7d, {{count}} new):',
      newBadge: '({{count}} new)',
      noRecent: 'no recent activity',
      unsubscribeAria: 'Unsubscribe from {{id}}',
      unsubscribeTitle: 'Stop watching {{id}}',
      unsubscribeHint:
        "Stop watching. The automatic subscription won't come back; you can always watch it again by hand.",
      // sk-551.33 — the card head's lead-in in select mode, where a click
      // ticks the card (a toggle button, `aria-pressed`) instead of
      // opening it.
      selectLeadIn: 'Select issue.',
      // sk-303.13 (T028 / US-6) — a subtree card's × leaves the ANCESTOR
      // named in the title, never the descendant whose activity the user
      // has been reading, so the label says both.
      unsubscribeSubtreeAria:
        'Unsubscribe from {{id}} — the issue and its descendants',
      subtreeNote: 'watching this issue and its descendants — activity below is the descendants\u2019',
      // sk-622.21 (US-5) — the same note on a historical card, where there
      // is no subscription to speak of.
      subtreeNoteHistorical: 'activity below is the descendants\u2019',
      // Visually hidden lead-ins. They EXTEND the visible text rather
      // than replace it (WCAG 2.5.3), so they say only what the click
      // does; the id, the title and the event line are read after.
      openLeadIn: 'Open issue.',
      openLeadInUnread: 'Open issue, unread events: {{count}}.',
      openEventOwn: 'Open {{id}}:',
      openEventDescendant: 'Open descendant issue:',
      // sk-622.21 (US-5, US-6) — a historical card: no subscription, only
      // notifications left in the window. Its action is «remove», never
      // «unsubscribe».
      historicalNote: "You no longer watch this — the card stays for its recent notifications",
      removeAria: 'Remove card {{id}}',
      // What the request does (DELETE /watch on a card without a
      // subscription): the card leaves Watching; nothing is opted out.
      removeHint:
        'Remove the card from Watching. You no longer watch this issue, so no opt-out is recorded.',
    },
    // sk-551.24 — the event line of a Watching card
    // (`lib/formatEventLine.ts#formatEventLine`). Verbs only: the actor is
    // a login and the values on either side of an arrow are contract
    // values (`in_progress`, `wont_do`), printed as they came.
    eventLine: {
      someone: 'someone',
      yes: 'yes',
      no: 'no',
      stale: '(stale)',
      verb: {
        created: 'created the issue',
        closed: 'closed the issue',
        archived: 'archived the issue',
        accepted: 'accepted the task',
        claimed: 'claimed the task',
        unclaimed: 'released the lock',
        statusChanged: 'changed status',
        outcomeChanged: 'changed outcome',
        commented: 'commented',
        mentionedYou: 'mentioned you',
        dependencyAdded: 'added a dependency',
        dependencyRemoved: 'removed a dependency',
        reparented: 'moved the issue in the tree',
        attachmentAdded: 'added an attachment',
        reminderRang: 'rang a reminder',
        changedField: 'changed',
        updatedFields: 'updated',
        updated: 'updated the issue',
        // An event type this client has no words for: named by its raw
        // type, the same way an unknown status is shown as it came.
        other: '{{event}}',
      },
    },
  },

  tasks: {
    heading: 'Tasks',
    // sk-285.7.2.66 — the board caption in the Tasks column header.
    // The axis word is a dictionary of its own rather than a reuse of
    // `filters:kanbanAxis.*`: those are control LABELS in nominative
    // Title Case, and this sentence needs the word in running text —
    // which in Russian is a different case form (the one after "by"), not a
    // lower-cased label.
    boardNote: 'Kanban — columns by',
    boardAxis: {
      status: 'status',
      priority: 'priority',
      type: 'type',
      assignee: 'assignee',
      project: 'project',
      component: 'component',
      label: 'label',
    },
    headingAria: 'Tasks — {{path}}',
    collapseColumn: 'Collapse Tasks column',
    expandColumn: 'Expand Tasks column',
    expandColumnWithCount: 'Expand Tasks column — {{count}} tasks',
collapsedChip: '{{total}} · {{collapsed}} collapsed',
    collapsedChipAria:
      '{{total}} tasks total, {{collapsed}} hidden under collapsed rows',
    collapsedTooltip:
      '{{total}} total · {{collapsed}} hidden under collapsed rows — expand rows to see all',
    loadedSoFarTooltip:
      'Rows loaded so far. Hybrid search has no exact match count — scroll to load more.',
    loading: 'Loading tasks…',
    loadingTree: 'Loading tree…',
    loadFailed: 'Failed to load tasks',
    projectNotFound:
      'Project not found. It may have been hidden — pick another from the list on the left.',
    // sk-674.18 T052 — the place names a space the caller cannot see or
    // that does not exist; the two read the same.
    spaceNotFound: 'Space not found',
    spaceNotFoundBack: 'All projects',
    empty: 'No tasks',
    emptyVisible: 'No tasks visible to you.',
    emptyFiltered: 'No tasks match the filters',
    // sk-303.14 (T025) — an EMPTY unreviewed selection is the answer the
    // reader wanted, not a failure, so it is said in the vocabulary of the
    // set rather than through the generic filter copy.
    emptyUnreviewed:
      'Nothing unreviewed — you have already read everything you delegated.',
    treeTooLarge: 'Tree too large (>1000 nodes). Narrow the filter set.',
    treeTooLargeAnchored:
      "The epic's subtree exceeds 1000 nodes. Narrow the filter set.",
    activeLens: 'Active lens: {{lens}}',
    anchor: {
      back: 'Back to codes',
      backAria: 'Back to the codes that were found',
      backInline: 'back to codes',
      label: 'epic subtree',
      loadFailed: "Failed to load the epic's subtree.",
      empty: "The epic's subtree is empty or unavailable.",
    },
    card: {
      openIssue: 'Open issue {{id}}: {{title}}',
      openIssueRinging: 'Open issue {{id}}: {{title}} (reminder ringing)',
      ringingTitle: 'Reminder ringing',
      delegatedStarTitle: 'You created this and assigned it to someone else',
      delegatedByMe: 'Delegated by me · ',
      labels: 'labels: {{names}}',
      createdWhen: 'created {{when}}',
      components_one: '{{count}} component',
      components_other: '{{count}} components',
      // sk-407 (3) — the variant with a trailing `· ` is gone: its last
      // reader was the tree's `progress` cell, and in a table cell a
      // separator has nothing to separate from. One form left, shared by
      // the list card and the tree column. The list card joins its own
      // meta segments (any of which the user can switch off), so a
      // separator baked into a segment would dangle the moment the
      // segment after it is gone.
      epicProgressPlain: '({{closed}}/{{total}} closed)',
      // sk-489 (T012, US-6) — "done X/Y" on the chip. A SECOND key
      // rather than a reword of the one above: the pair above keeps its
      // meaning (closed of total, a STATUS breakdown) for an api that
      // does not send the outcome numbers (US-10), and both forms have
      // to exist side by side for the whole rollout window. Which one
      // the chip prints is decided by `progressNumbers().fromNewFields`,
      // never by the presence of a number.
      epicProgressDone: '({{done}}/{{counted}} done)',
      // sk-540.3 — the same pair with the excluded-from-scope tail
      // (`details:closeOutcome.excludedShort`, passed in as `excluded`).
      // Without it an epic of 1 done and 9 won't-do read as finished.
      epicProgressDoneExcluded: '({{done}}/{{counted}} done, {{excluded}})',
      relevanceTooltip:
        'Search relevance {{percent}}% (RRF: vector + full-text)',
      relevanceAria: 'Relevance {{percent}} percent',
      depIconsAria: 'Dependency relationships',
    },
    tree: {
      // sk-285.2.11 — accessible name of the role="tree" container.
      ariaLabel: 'Task tree',
      collapse: 'Collapse',
      expand: 'Expand',
      jumpAria: 'Jump to first occurrence {{id}}',
      jumpLabel: '↻ see {{id}}',
      hiddenParent: 'Cross-project parent (no access)',
      contextParent: 'Parent shown for context — not a match for the current filter',
      contextParentAria:
        'Open {{id}}: {{title}} (parent shown for context, not a filter match)',
      // sk-285.2.19 (step 4) — the table's sort, and the price of doing
      // it without ever flattening the tree. `sortScope` is printed above
      // the header AND read out with every sortable heading, because a
      // local order that a reader takes for a global one is a table they
      // read wrong with no way of noticing.
      sortOrder: '{{field}}, {{direction}}',
      sortAsc: 'ascending',
      sortDesc: 'descending',
      sortScope:
        'Sorted by {{order}} — within each branch. The hierarchy is never flattened, so the top row is the first branch’s, not the whole project’s.',
      // sk-285.2.19 (step 5) — printed after `sortScope` only while the
      // standing band is actually holding roots above the sorted ones,
      // so the caption never promises an order the top of the table does
      // not keep.
      sortScopeStanding:
        'Standing tasks are held above all of it — that band is outside the sort.',
      sortColumnTitle:
        'Sort by {{column}} within each branch — click again to reverse',
    },
    blob: {
      extracted_one: 'extracted {{count}} code',
      extracted_other: 'extracted {{count}} codes',
      foundSummary: '· {{found}} found · {{notFound}} not found',
      exitAria: 'Exit pasted-codes mode',
      chipsAria: 'Pasted issue codes',
      openChip: 'Open {{code}}',
      openChipWithTitle: 'Open {{code}}: {{title}}',
      notFoundTitle: 'Not found or not visible to you',
      notFoundAria: '{{code}} — not found',
      resolving: 'Resolving codes…',
      resolveFailed: 'Failed to resolve pasted codes',
      emptyNoCodes: 'No codes found in the pasted text',
      emptyNoMatches: 'None of the pasted codes matched a visible task',
      expandEpic: 'expand subtree',
      expandEpicTitle: "Expand the epic's subtree in the task tree",
      expandEpicAria: "Expand the subtree of epic {{id}}",
    },
    remindersLens: {
      // sk-285.7.2.88 — the ⏰ that used to open this heading is drawn
      // by `IconAlarm` in `TasksColumn.tsx` now. The four emoji this
      // lens carried (⏰ heading, 🔔 ringing, 🔔 ringingSince, ⏰
      // armedIn) were the same four sk-285.7.2.57 took out of the
      // Details panel, in the second copy of the dictionary.
      heading: 'Reminders',
      ringingCount: '{{count}} ringing',
      loading: 'Loading reminders…',
      loadFailed: 'Failed to load reminders',
      empty: 'No reminders. Set one from a task card.',
      openIssue: 'Open task {{id}}: {{title}}',
      ...enReminderPhrases,
    },
    // sk-285.2.3 — Kanban board (third view mode of this very column).
    kanban: {
      columnAria_one: '{{name}} column, {{count}} task — drop a task here to move it',
      columnAria_other:
        '{{name}} column, {{count}} tasks — drop a task here to move it',
      columnAriaLocked_one:
        '{{name}} column, {{count}} task — read-only, tasks cannot be moved in or out',
      columnAriaLocked_other:
        '{{name}} column, {{count}} tasks — read-only, tasks cannot be moved in or out',
      columnAriaFiltered: '{{name}} column — hidden by the status filter',
      columnEmpty: 'Empty',
      lockedTooltip:
        'Standing tasks are perpetual obligations: the server allows neither moving one into the regular flow nor turning a task into one. Change such a status from the task itself.',
      showAllStatusesFor: 'Show every status — {{name}} is hidden by the status filter',
      // sk-551.32 — the inverse of the sliver above.
      foldColumn: 'Collapse {{name}} — put the status filter back',
      closedWindowNote_one:
        '{{count}} more task closed over {{days}} days ago is not shown',
      closedWindowNote_other:
        '{{count}} more tasks closed over {{days}} days ago are not shown',
      loadMore: 'Load more tasks',
      dragInstructions:
        'Drag a card into another column with the pointer to write that column\u2019s value onto the task. From the keyboard, press Enter to open the task and edit the field in the details panel.',
      announceStart: 'Picked up task {{id}}',
      announceOver: 'Task {{id}} is over the {{column}} column',
      announceDrop: 'Task {{id}} dropped into the {{column}} column',
      announceCancel: 'Task {{id}} returned to its column',
      errorVersionConflict:
        'The task changed while you were dragging it — the card is back where it was. Reopen it to see the current state.',
      errorGeneric: 'Failed to move the task',
      // sk-285.2.4 — configurable axis.
      noColumns: 'Nothing to lay out on this axis',
      noComponent: 'No component',
      noLabel: 'No labels',
      alsoIn: 'also in: {{columns}}',
      readOnlyAxisTooltip:
        'Columns by project are read-only: Skein cannot move tasks between projects — the equivalent is a copy plus a supersedes link, which is a deliberate act, not a drag.',
      // sk-285.2.5 — the switchable card properties. Component and label
      // NAMES are project data and stay untranslated; only the caption in
      // front of them is copy.
      cardComponents: 'components: {{names}}',
      cardLabels: 'labels: {{names}}',
      cardUpdated: 'upd. {{when}}',
      cardCreated: 'created {{when}}',
      // sk-285.2.6 — the board's focus on a handful of projects. Project
      // handles are data, interpolated as-is and never translated.
      focusActive: 'Focused on: {{projects}}',
      focusHidden_one: '· {{count}} task hidden',
      focusHidden_other: '· {{count}} tasks hidden',
      focusReset: 'All projects',
      focusPaused_one:
        'Focus on {{count}} project is paused — project {{project}} is open',
      focusPaused_other:
        'Focus on {{count}} projects is paused — project {{project}} is open',
      focusResume: 'Back to all projects',
      // sk-674.18 T052 — the focus on a space place that holds none of it.
      focusPausedSpace_one:
        'Focus on {{count}} project is paused — it is not in space {{space}}',
      focusPausedSpace_other:
        'Focus on {{count}} projects is paused — none of them is in space {{space}}',
    },
  },

  filters: {
    // sk-407 (1) — the wording is carried across by MEANING
    // rather than word for word: the Russian names the two things you
    // can search by (the task's text and its code), and so does this.
    searchPlaceholder: 'Search by task text or code',
    searchAria: 'Search tasks',
    scopeAria: 'Search scope',
    withinFilters: 'within filters',
    withinFiltersAria: 'Search within filters',
    withinFiltersTooltip:
      'When ON, your status / type / source filters are re-applied to the search. When OFF, the search runs across everything in scope and the filter chips are cleared.',
    allProjects: 'all projects',
    allProjectsAria: 'Search all projects',
    allProjectsTooltip:
      'When ON, the search spans every project you can see and the project list jumps to “All Projects”. When OFF, it stays scoped to the current project.',
    allProjectsTooltipDisabled:
      'Already searching across every project you can see.',
    degraded:
      'Search is running in reduced-recall mode (semantic index unavailable) — you may see fewer matches than usual.',
    toggleLabel: 'Filters',
    toggleShow: 'Show filters',
    toggleHide: 'Hide filters',
    toggleActiveCount: ', active filters: {{count}}',
    toggleNoneActive: ', no active filters',
    toggleTitleCount: 'Filters applied: {{count}}',
    panelAria: 'Task filters',
    // sk-285.7 T025 — the panel's layout switch (handoff §6). `note` is
    // the caption that states out loud what the ONE panel means: the
    // same filters back Cards, Tree and Board, so nothing here is a
    // per-view setting.
    layout: {
      note: 'Filters apply to Cards, Tree and Board alike',
      groupAria: 'Filter panel layout',
      select: 'Comboboxes',
      // Deliberately NOT «Show filters as …»: the panel's collapse
      // toggle is already named «Show filters», and two buttons whose
      // accessible names share that prefix are one ambiguous target for
      // a screen-reader user picking from a list.
      selectAria: 'Panel layout: comboboxes',
      chips: 'Quick list',
      chipsAria: 'Panel layout: quick list',
    },
    // sk-285.1.18 — visible labels of the filter dropdowns. Each one names
    // the DIMENSION, not the picked value: the value is what the select
    // itself shows.
    labels: {
      assignee: 'Assignee',
      status: 'Status',
      priority: 'Priority',
      type: 'Type',
      source: 'Source',
      depTypes: 'Tree edges',
      view: 'View',
      viewSettings: 'View settings',
      kanbanAxis: 'Columns',
      kanbanCardFields: 'Card properties',
      treeColumns: 'Table columns',
      listCardFields: 'Card attributes',
      projectFocus: 'Project focus',
      sort: 'Sort by',
    },
    // sk-285.7.11 (VS3/VS4/VS5) — the View settings panel's own chrome:
    // the artboard (`#2b`) closes the panel with a ✕, offers the picker
    // through a dashed "+ Add attribute" chip, and rules off a footer
    // carrying the scope sentence and "Reset to default".
    viewSettings: {
      close: 'Close view settings',
      // sk-285.7.2.70 — one name per chip, as the artboard writes it
      // (`aria-label="Remove {{ a }}"`). Ten chips used to share the
      // single word «Close».
      removeAttribute: 'Remove {{attribute}}',
      addAttribute: 'Add attribute',
      reset: 'Reset to default',
      // The artboard writes "Applies to Cards and Board. Tree has its own
      // columns." — a sentence that is FALSE here: this app keeps three
      // independent sets (list / board / tree), each stored under its own
      // key, which is exactly why the panel shows the knobs of the view
      // you are in and nothing else. Saying otherwise would document a
      // model the code does not implement.
      scope: 'Applies to the current view. Cards, Board and Tree each keep their own set.',
    },
    status: {
      active: 'Active',
      activeTitle: 'Everything except Done',
      open: 'Open',
      in_progress: 'In progress',
      blocked: 'Blocked',
      deferred: 'Deferred',
      standing: '∞ Standing',
      standingTitle: 'Standing (perpetual obligations)',
      closed: 'Done',
      all: 'All',
      // sk-303.14 (T025) — a SELECTION over the status axis, offered only
      // under the Delegated lens.
      unreviewed: 'Unreviewed',
      unreviewedTitle:
        'Closed results I delegated and have not marked reviewed yet',
    },
    priority: {
      all: 'All',
      allTitle: 'All priorities',
      p0Title: 'Priority 0 (highest)',
      p1Title: 'Priority 1',
      p2Title: 'Priority 2',
      p3Title: 'Priority 3',
      p4Title: 'Priority 4 (lowest)',
    },
    origin: {
      all: 'All',
      allTitle: 'All sources',
      human: 'From a human',
      humanTitle: 'Human-driven',
      agent: 'From an agent',
      agentTitle: 'Agent-autonomous',
    },
    type: {
      all: 'All',
    },
    depTypes: {
      parentChild: 'Hierarchy is the tree spine and cannot be turned off',
      blocks: 'Blocks edges (hard dependencies)',
      waitsFor: 'Waits-for edges (gate-driven dependencies)',
      related: 'Related edges (soft cross-links)',
      discoveredFrom: 'Discovered-from edges (provenance trail)',
      supersedes: 'Supersedes edges (replacement chain)',
      duplicates: 'Duplicates edges (merge candidates)',
    },
    view: {
      cards: 'Cards',
      cardsTitle: 'Cards view',
      tree: 'Tree',
      treeTitle: 'Tree view',
      kanban: 'Board',
      kanbanTitle: 'Kanban board — columns by the field you pick',
    },
    // sk-285.2.4 — which issue field the board's columns project.
    kanbanAxis: {
      status: 'Status',
      statusTitle: 'open \u2192 in progress \u2192 deferred \u2192 done',
      priority: 'Priority',
      priorityTitle: 'Five columns, P0 to P4',
      type: 'Type',
      typeTitle: 'bug, feature, task, epic, \u2026',
      assignee: 'Assignee',
      assigneeTitle: 'Who is doing what, plus an unassigned column',
      project: 'Project',
      projectTitle:
        'Makes sense across projects. Read-only: a task cannot be dragged into another project',
      component: 'Component',
      componentTitle:
        'A task with two components is shown in both columns; a drag replaces the one you dragged it out of',
      label: 'Label',
      labelTitle:
        'A task with two labels is shown in both columns; a drag replaces the one you dragged it out of',
    },
    // sk-285.2.5 — the board's display properties: a flat list of
    // switches (Linear), not a field constructor (YouTrack).
    kanbanCardFields: {
      none: 'Title only',
      statedByColumn: 'The column head already says this',
      id: 'ID',
      idTitle: 'The task identifier under the title',
      type: 'Type',
      typeTitle: 'Type chip: bug, feature, task, …',
      status: 'Status',
      statusTitle: 'Status chip',
      priority: 'Priority',
      priorityTitle: 'P0…P4 chip',
      assignee: 'Assignee',
      assigneeTitle: 'Who it is assigned to; “unassigned” if nobody',
      components: 'Components',
      componentsTitle: 'Every component of the task, comma-separated',
      labels: 'Labels',
      labelsTitle: 'Every label of the task, comma-separated',
      updated: 'Updated',
      updatedTitle: 'When the task was last touched',
      created: 'Created',
      createdTitle: 'When the task was filed',
      blocked: 'Blocked',
      blockedTitle:
        'The derived blocked marker — it comes from the dependency graph, so no column ever states it',
      delegated: 'Delegated by me',
      delegatedTitle: '★ on tasks you created and handed to someone else',
    },
    // sk-285.2.19 — the tree table's column switches. The same list of
    // toggles as the board's card properties; the title column is not in
    // it — the chevron, the indent and the connector live there.
    treeColumns: {
      none: 'Titles only',
      /**
       * sk-285.2.19 — heading of the pinned first column. It is NOT one
       * of the switchable columns (there is no `titleTitle` option
       * description to go with it): the picker never lists it, only the
       * table's header row prints it.
       */
      title: 'Task',
      titlePinned: 'The title column is pinned first — the tree lives in it',
      id: 'ID',
      idTitle: 'The task identifier',
      status: 'Status',
      statusTitle: 'Status chip',
      blocked: 'Blocked',
      blockedTitle:
        'The derived blocked marker — it comes from the dependency graph, not from the status',
      priority: 'Priority',
      priorityTitle: 'P0…P4 chip',
      type: 'Type',
      typeTitle: 'Type chip: bug, feature, task, …',
      assignee: 'Assignee',
      assigneeTitle: 'Who it is assigned to; “unassigned” if nobody',
      components: 'Components',
      componentsTitle: 'The components of the task',
      labels: 'Labels',
      labelsTitle: 'The labels of the task',
      progress: 'Progress',
      progressTitle: 'Done/counted children of an epic; empty on other tasks',
      updated: 'Updated',
      updatedTitle: 'When the task was last touched',
      created: 'Created',
      createdTitle: 'When the task was filed',
    },
    // The list card's attribute switches. The same list of toggles as
    // the board's card properties and the tree's table columns; the
    // title is not in it — a card with no title is unreadable, not
    // narrowed.
    listCardFields: {
      none: 'Titles only',
      titlePinned: 'The title always shows — the card is unreadable without it',
      id: 'ID',
      idTitle: 'The task identifier on its own line under the title',
      blocked: 'Blocked',
      blockedTitle:
        'The derived blocked marker — it comes from the dependency graph, not from the status',
      status: 'Status',
      statusTitle: 'Status chip',
      priority: 'Priority',
      priorityTitle: 'P0…P4 chip',
      type: 'Type',
      typeTitle: 'Type chip: bug, feature, task, …',
      assignee: 'Assignee',
      assigneeTitle: 'Who it is assigned to; “unassigned” if nobody',
      components: 'Components',
      componentsTitle: 'The component of the task, or how many it has',
      labels: 'Labels',
      labelsTitle: 'Every label of the task, comma-separated',
      progress: 'Progress',
      progressTitle: 'Done/counted children of an epic; empty on other tasks',
      updated: 'Updated',
      updatedTitle: 'When the task was last touched',
      created: 'Created',
      createdTitle: 'When the task was filed',
      delegated: 'Delegated by me',
      delegatedTitle: '★ on tasks you created and handed to someone else',
    },
    sort: {
      relevance: 'Relevance',
      priorityUpdated: 'Priority + Updated',
      priority: 'Priority',
      updated: 'Updated',
      created: 'Created',
      id: 'ID',
    },
    assignee: {
      /** Empty state of the assignee dropdown — no assignee filter applied. */
      anyone: 'Anyone',
      nothingFound: 'No one matches',
      /** sk-285.5.5 — directory query in flight; rows on screen may be stale. */
      searching: 'Searching…',
      /** sk-285.5.5 — backend truncated the match list. */
      searchHasMore: 'More matches than shown — narrow the term',
    },
    // sk-285.2.6 — which projects the board shows tasks from.
    projectFocus: {
      allProjects: 'All projects',
      paused: 'Paused — project {{project}} is open',
      // sk-674.18 T052 — on a space place that holds no focused project.
      pausedSpace: 'Paused — no focused project in space {{space}}',
      nothingFound: 'No project matches',
      // sk-285.7.2.71 — the reset is a `CloseButton`, and an unnamed one
      // inherits the theme's factory «Close». It clears a focus; it does
      // not close anything.
      clear: 'Clear project focus',
    },
  },

  attachments: {
    loading: 'loading attachments…',
    loadFailed: 'failed to load attachments',
    empty: 'none',
    listAria: 'attachments',
    downloadAria: 'download {{filename}}',
    downloadTitle: 'download',
    deleteAria: 'delete {{filename}}',
    deleteTitle: 'delete',
    deleteFailed: 'delete failed',
    downloadFailed: 'download failed',
    // sk-414.2 — the delete dialog per artboard 4b: the title asks, the
    // body says WHAT exactly is irreversible (the file leaves everyone on
    // the issue, not just the person clicking), the button names the act.
    // The bracket dialect went with the frame.
    confirmDelete: {
      title: 'Delete attachment?',
      message:
        '{{filename}} disappears for everyone on this issue. This cannot be undone.',
      confirm: 'Delete',
    },
    upload: {
      triggerAria: 'upload attachment',
      pick: 'click to choose a file, or drop one here',
      // sk-414.2 — the aside on the dropzone prompt: the limit is stated
      // BEFORE a file is picked, not only in the error afterwards.
      limitHint: 'up to {{limit}}, one file',
      // A file is held over the card: the zone unfolds ahead of the drop
      // and names the target, so "where exactly am I dropping this" is
      // answered rather than guessed.
      dropHere: 'Release to attach to {{id}}',
      uploading: 'uploading {{filename}}…',
      // sk-414.3 — the pending row's metadata. A file still going up has
      // no server-side size and no stamp: the line says what is
      // happening rather than how big it is.
      pendingMeta: 'uploading · just now',
      inputAria: 'select attachment file',
      progressAria: 'uploading {{filename}}',
      progressValue: '{{loaded}} of {{total}}',
      progressPercent: '{{loaded}} of {{total}} · {{percent}}%',
      cancel: 'Cancel',
      fallbackName: 'attachment',
      // The zone stays mounted under the error plaque — the invitation
      // changes to "try another one" instead of vanishing.
      retry: 'Choose another file or drop one here',
      // sk-414.2 — until this wave the three typed upload failures lived
      // as English literals inside `humanError()` in
      // AttachmentDropzone.tsx. The title names the cause, the detail
      // names the file and the numbers — artboard 4b.
      errors: {
        tooLarge: 'File is too large.',
        tooLargeDetail: '{{filename}} — {{size}}, limit {{limit}}.',
        mimeBlocked: 'File type is not allowed.',
        mimeBlockedDetail: '{{filename}} — executables are not accepted.',
        limitReached: 'Attachment limit reached.',
        limitReachedDetail: 'This issue already holds the maximum number of files.',
        storageQuota: 'The space is out of room for attachments.',
        storageQuotaDetail: 'Its {{quota}} are used up — delete files you no longer need.',
        storageQuotaDetailBare: 'Delete files you no longer need.',
        generic: 'Upload failed.',
        dismiss: 'Dismiss',
      },
    },
  },

  comments: {
    filterAria: 'Filter comments by author kind',
    humans: 'Humans',
    humansAria: "Humans{{suffix}} — includes agent comments posted on the human's instruction",
    humansTitle:
      "Show comments posted by humans (includes agent comments posted on the human's instruction)",
    agents: 'Agents',
    agentsAria:
      'Agents{{suffix}} — agent-autonomous notes (handoff, progress, side-quests)',
    agentsTitle:
      'Show comments posted autonomously by agents (handoff notes, progress, side-quests)',
    // sk-285.7.2.56 — reference `1b` heads the empty thread «Comments ·
    // none yet» and the `> ` prompt is the terminal dialect the redesign
    // removed elsewhere (`[ post ]`). This string is now the heading's
    // aside, not a sentence of its own.
    none: 'none yet',
    noneMatchFilter: 'no comments match the active filter',
    // sk-414.2 — artboard 4d, "the filter hid everything": an empty
    // screen has to say WHY it is empty and offer the way out in one
    // press.
    // sk-415: the Russian `one` category covers 21, 31, 101 too, so its
    // phrase has to carry the number — and the parity guard requires the
    // same placeholders on both sides. English `one` really is just 1.
    noneMatchFilterAgents_one: '{{count}} comment was written by an agent',
    noneMatchFilterAgents_other: 'all {{count}} were written by agents',
    // sk-414.5 — the mirror for the other chip: either one can be
    // turned off, and the sentence has to name what is missing. One
    // neutral phrasing («3 comments hidden») would tell the reader
    // exactly what they can already see.
    noneMatchFilterHumans_one: '{{count}} comment was written by a human',
    noneMatchFilterHumans_other: 'all {{count}} were written by humans',
    resetFilter: 'Reset filter',
    // The thread is not empty, part of it is filtered out — the row owns
    // up to that and offers to show it, instead of silently coming up
    // short.
    hiddenByFilter_one: '{{count}} agent comment hidden',
    hiddenByFilter_other: '{{count}} agent comments hidden',
    hiddenByFilterHumans_one: '{{count}} human comment hidden',
    hiddenByFilterHumans_other: '{{count}} human comments hidden',
    showHidden: 'show',
    // Optimistic insert: the comment is on screen but not yet stored.
    sending: 'sending…',
    // sk-285.7.2.56 (audit D2B-9) — the second half of the placeholder
    // `Sk Details.dc.html` writes. It is the only place the composer
    // tells anyone that typing `@name` notifies that person; without it
    // the feature is discoverable only by accident.
    placeholder: 'add comment… @mention to notify',
    addAria: 'Add comment',
    editAria: 'Edit comment',
    // The card's shared waiting plaque, same wording shape as the
    // sibling sections.
    loading: 'loading comments…',
    // sk-285.7 fidelity D3 — the bracket dialect is terminal-era chrome
    // that outlived the terminal. `Sk Details.dc.html` labels this button
    // «Post», and the three labels below are the whole of what this
    // component says on its buttons.
    post: 'Post',
    cancel: 'Cancel',
    save: 'Save',
    edit: 'Edit',
    delete: 'Delete',
    edited: '· edited',
    editedAt: 'edited {{when}}',
    deletedBody: 'comment deleted',
    staleEdit: 'the comment changed, please refresh',
    kind: {
      directed: 'directed',
      autonomous: 'autonomous',
      directedTitle: 'Agent posted this comment on the user’s instruction',
      autonomousTitle: 'Agent posted this comment on its own initiative',
      aria: 'comment kind: {{label}} — {{title}}',
    },
    confirmDelete: {
      title: 'Delete comment?',
      message: 'Delete this comment? This cannot be undone.',
      confirm: 'Delete',
    },
  },

  details: {
    empty: 'Select a task to view details',
    // sk-489 (T012, SC-008) — the close-outcome vocabulary. ONE block for
    // every surface that names an outcome: the card header (US-7), the
    // close modal (US-1), the edit control (US-12) and the epic section's
    // child rows. Surfaces in other namespaces reach it with the
    // `details:` prefix — a second copy would drift on the first reword.
    //
    // The four labels are picked by `lib/closeOutcome.ts#closeOutcomeLabelKey`
    // and ONLY by it: an outcome the client does not know has no key here,
    // and the renderer prints the raw string instead (INV-2).
    closeOutcome: {
      done: 'done',
      wontDo: "won't do",
      duplicate: 'duplicate',
      superseded: 'superseded',
      // sk-540.5 — children closed with a non-done outcome are "excluded
      // from scope": the count describes a change of scope, not the effort
      // spent (a cancelled task may have been worked on for days).
      // The full form is the ring's tail (US-5) AND the one caption of an
      // empty denominator on the chip, the tree cell and the branch row
      // (every counted child excluded, where a bare "0/0" would read like
      // "no children at all"). Hidden at zero, and absent entirely when
      // the api did not send the number (US-10) — never rendered as 0.
      excludedCount: 'excluded from scope: {{count}}',
      // sk-540.3 — the short tail of the compact surfaces (chip, tree
      // cell, branch row), next to "done / counted".
      excludedShort: 'excluded: {{count}}',
      // The close modal (US-1, US-2).
      modalLabel: 'Outcome',
      modalTargetLabel: 'Target issue',
      modalTargetPlaceholder: 'e.g. sk-42',
      modalTargetDescription:
        'Links this issue to the target: duplicate of it, or superseded by it.',
      // The card control (US-12). `editAria` names the edit dialog;
      // `editAriaCurrent` names the header control itself — the value is
      // baked into its accessible name the way the neighbouring chips bake
      // theirs (`header.statusAria`, `header.changeType`), because an
      // `aria-label` replaces the button's contents and the outcome would
      // otherwise never be announced.
      editLabel: 'Change outcome',
      editAria: 'Change the close outcome of {{id}}',
      editAriaCurrent: 'Change the close outcome of {{id}} — currently {{outcome}}',
    },
    // sk-421.1 T015 — the «Blocked by» block under the properties row (US-5).
    blocked: {
      title: 'Blocked by:',
      unavailable: 'unavailable',
    },
    // sk-479 (sk-423 contract) — links to issues outside the reader's
    // horizon. The fact of a link, NOT blocking: their status is unknown
    // and the count does not depend on it. `note_*` — the card, `row_*` —
    // the epic section's sub-line, `explain` — why the issue may not be
    // ready to work on.
    unavailableLinks: {
      note_one: 'Linked to {{count}} task in projects you cannot access',
      note_other: 'Linked to {{count}} tasks in projects you cannot access',
      row_one: 'linked to {{count}} task in projects you cannot access',
      row_other: 'linked to {{count}} tasks in projects you cannot access',
      explain:
        'Not counted as blocking: their status is hidden from you. The task may still be waiting on them even though it is not marked blocked.',
    },
    // sk-421.1 T011 — properties row. Source labels (US-10); the key is
    // picked by `sourceLabelKey` in src/lib/issueProperties.ts.
    properties: {
      // sk-421.1 T014 — the properties row (US-1…US-13). Every segment
      // carries a visible word; icons are decoration only.
      aria: 'Task properties',
      parent: 'parent',
      parentUnavailable: 'unavailable',
      parentFailed: 'failed to load',
      openParent: 'Open parent {{id}}: {{title}}',
      labels: 'labels',
      components: 'components',
      componentsCount: 'components: {{count}}',
      componentsMore: '+{{count}}',
      archived: 'archived',
      due: 'due',
      estimate: 'estimate',
      estimateHoursMinutes: '{{hours}} h {{minutes}} min',
      estimateHours: '{{hours}} h',
      estimateMinutes: '{{minutes}} min',
      deferUntil: 'deferred until',
      sourceLabel: 'source',
      link: 'link',
      claimedBy: 'claimed by agent {{name}} since',
      claimedNoName: 'claimed by agent since',
      accepted: 'accepted',
      started: 'started',
      updated: 'updated',
      source: {
        human: 'human',
        agentDirected: 'agent on request',
        agentAutonomous: 'agent on its own',
      },
    },
    // sk-285.7 T019 — the mobile full-screen description sheet. The
    // back control names the surface it returns to (the Tasks list),
    // not the act ("Close"): on a phone the sheet covers everything, so
    // the label has to say where you land, not what disappears.
    sheet: {
      title: 'Task description',
      back: 'Tasks',
      backAria: 'Back to the task list',
      position: '{{position}} of {{total}}',
      nextAria: 'Next task in the list',
    },
    loadingIssue: 'Loading issue {{id}}…',
    notFound: 'Issue {{id}} not found (or you do not have access)',
    loadFailed: 'Failed to load issue {{id}}',
    /* sk-285.6.8 — THE single empty-state template for the card:
     * no prefix, lower case, no full stop. Every section uses it —
     * the private '— none' / '> no attachments yet.' / 'No reminders
     * on this task.' variants are gone. */
    emptyValue: 'none',
    addAttachment: 'Upload file',
    sections: {
      description: 'Description',
      acceptanceCriteria: 'Acceptance criteria',
      notes: 'Notes',
      // sk-421.1 T017 (US-9) — the «Design» section, right after Notes.
      design: 'Design',
    },
    sectionsMore: {
      comments: 'Comments',
      attachments: 'Attachments',
      dependencies: 'Dependencies',
      commits: 'Commits',
      activity: 'Activity',
      watchers: 'Watchers',
    },
    reminders: {
      title: 'Reminders',
      add: 'Add reminder',
      ...enReminderPhrases,
      armedTitle: 'Rings at {{when}}',
      lastReason: ' · “{{reason}}”',
      snooze: 'Snooze',
      dismiss: 'Turn off',
      snoozeDateAria: 'Snooze until a date',
      snoozeDateBtn: 'until date',
      reasonPlaceholder: 'Reason (optional)',
      reasonAria: 'Snooze reason',
      whenAria: 'When it rings',
      notePlaceholder: 'Note (optional)',
      noteAria: 'Reminder note',
      create: 'Set',
      chips: {
        hours: '+{{count}}h',
        day1: '+1 day',
        day3: '+3d',
        day5: '+5d',
        week1: '+1 week',
      },
    },
    epic: {
      title: 'Epic progress',
      noChildren: 'No children',
      // sk-421.2 SC-014 — the third bar case: nothing is counted, yet there
      // ARE children (standing ones), so "No children" would be a lie.
      barNoneCounted: 'no task counts toward progress',
      progressAria: '{{done}} of {{total}} done',
      // sk-460.12 — the ring and the list below it count DIFFERENT things,
      // and that is acceptable only if it is said out loud.
      // The ring counts the epic rollup (direct children, server-side);
      // the list's category counters cover the whole subtree. Without this
      // line the card shows "10%" beside a list of 23 rows and nothing
      // explains why.
      ringScope: 'Counts direct children only. The list below covers the whole subtree.',
      counters: 'Done {{done}} · Not done {{notDone}}',
      // sk-460.5 — the label of the branch progress indicator (design html:330:
      // "{{doneText}} children closed" next to the 80×4 bar).
      //
      // ITS OWN string, not `tasks:card.epicProgressPlain`: the same key is
      // printed by the task card (`TaskCard.tsx`) and the row of the Tasks column
      // tree (`TaskTreeNode.tsx`), and an edit for the epic section would rewrite
      // them as well — the design's form belongs to THIS surface.
      //
      // The pair of numbers stays IN THE TEXT on purpose: under `forced-colors` a share
      // shown by the bar alone becomes unreadable, and the numbers are the
      // only carrier of meaning that survives there (the same
      // requirement is pinned by `EpicProgressSection.test.tsx`).
      branchClosed: '{{closed}}/{{total}} children closed',
      // sk-489 (T012, US-6) — the same pair counted by the outcome rule.
      // Separate key for the same reason `branchClosed` is separate from
      // `tasks:card.epicProgressPlain`: the wording belongs to THIS
      // surface, and the old form stays alive for an old api (US-10).
      branchDone: '{{done}}/{{counted}} children done',
      // sk-540.3 — with the excluded-from-scope tail
      // (`closeOutcome.excludedShort`, passed in as `excluded`).
      branchDoneExcluded: '{{done}}/{{counted}} children done, {{excluded}}',
      inProgress: ' · {{count}} in progress',
      blocked: ' · {{count}} blocked',
      deferred: ' · {{count}} deferred',
      unavailable: ' · {{count}} unavailable',
      standing: ' · ∞ {{count}} standing',
      loadingChildren: 'Loading children…',
      loadChildrenFailed: 'Failed to load children',
      openChild: 'Open child issue {{id}}: {{title}}',
      // sk-421.2.8 T010 — the blockers sub-line under a child row (US-1,
      // US-6). The hidden record reuses `blocked.unavailable`.
      blockersPrefix: 'blocked:',
      blockersMore: '+{{count}}',
      blockersMoreDescription: '{{count}} more',
      blockersList: 'All blockers',
      newChildTitle: 'New child title',
      childType: 'Child type',
      adding: 'Adding…',
      addChild: 'Add',
      addChildToggle: 'Add child',
      // sk-421.2 T018 (SC-016) — a child row in a project the caller
      // cannot see. The existing `tasks:tree.hiddenParent` does not fit:
      // wrong namespace, and it says "parent" where these are children.
      noAccess: 'no access',
      // sk-421.2 T019 — the "too large" refusal in List mode. The shared
      // `tasks:treeTooLarge` does not fit: it advises narrowing the filter
      // set, and the epic card has no filters, so the advice would be
      // impossible to act on. This states the FACT only; counters and the
      // mode switch stay put.
      tooLargeList: 'Too many child issues',
      // sk-421.2 T020 — the "too large" refusal in Tree mode. Here the
      // advice IS actionable: List asks for depth 1 and usually succeeds
      // on the same epic. Wording taken from the spec verbatim.
      tooLargeTree: 'The tree is too large — switch to the list',
      // sk-421.2 T022 — the section's mode switch. The group carries a
      // name so a screen reader announces WHAT is being switched, not
      // only which option is selected.
      modeGroup: 'Children view mode',
      modeList: 'List',
      modeTree: 'Tree',
      // sk-421.3 T06 (US-1, SC-005) — category headings of the List.
      //
      // Only these two are localized. The heading of a STATUS category is
      // the contract value in English words and comes from the shared
      // `statusChipText`, not from a dictionary: SC-005 keeps row labels
      // and status headings equal to the wire value, and a second spelling
      // rule would drift from the first.
      categoryUnavailable: 'unavailable',
      // sk-421.3 T13a (PK-1 item 4, SC-002, SC-017) — the "no status"
      // category: a row whose status is empty and which is NOT an
      // unavailable-task stub. Localized for the same reason
      // `categoryUnavailable` is: there is nothing to print — the value
      // is absent — and an empty heading beside a count tells the user
      // nothing.
      categoryNoStatus: 'no status',
      // sk-421.3 T07 (US-9, SC-005) — the grouping organ. Two labels, and
      // each names the ACTION the press performs, not the current state:
      // the same rule the collapse organ follows.
      groupByStatus: 'Group by status',
      ungroup: 'Ungroup',
      // sk-421.3 T16 (US-6, US-9) — the mass-collapse organ under the
      // epic Tree. Two labels, and each names the ACTION the press
      // performs rather than the current state — the same rule the
      // grouping organ follows.
      collapseAll: 'Collapse all',
      expandAll: 'Expand all',
      // The accessible name of a category heading carries the label AND
      // the count — the count is beside the label on screen, so a name
      // without it would say less than the eye sees (R-7, m-7).
      //
      // m-8 — PLURAL FORMS, not one string with a number glued on. A
      // category holding a single row announced «open — 1 issues»: the
      // kind of wrongness only a screen reader utters, so nobody reading
      // the screen ever sees it. Russian needs no variants here — its
      // wording is "tasks: N", a label-and-value form correct for every
      // N — and the dictionary parity guard compares BASE keys, so one
      // language may carry plural categories the other does not.
      categoryAria_one: '{{label}} — {{count}} issue',
      categoryAria_other: '{{label}} — {{count}} issues',
    },
    closedReason: {
      aria: 'Close reason',
      label: 'Closed',
      reviewed: 'Reviewed',
      markAction: 'Mark as reviewed',
      markTitle:
        'Drop this result from your unreviewed list. The task\u2019s status does not change and the assignee is not told.',
    },
    commits: {
      noMessage: '(no message)',
      by: 'by {{author}} · ',
      linked: 'linked {{when}}',
    },
    watchers: {
      loading: 'loading…',
      stopWatching: 'Stop watching',
      add: 'Watch this issue',
    },
    deps: {
      // sk-414.2 — group headings per artboard 4c. Direction is carried
      // by the group, which is why the rows no longer draw an arrow.
      //
      // sk-414.4 retired the two keys these replaced — `outgoing` /
      // `incoming`, the lowercase prose labels «this depends on
      // (outgoing):» and «depends on this (incoming):». They are deleted
      // rather than left unused: a section that needs a direction label
      // tomorrow should find the heading, not the sentence.
      groupOutgoing: 'Depends on',
      groupIncoming: 'Depended on by',
      loading: 'loading…',
      // sk-414.4 retired `typeAria`: the type field carries a VISIBLE
      // label now (`typeLabel`), and an aria-label there would replace
      // it in the accessible name instead of adding to it (WCAG 2.5.3).
      // Visible field labels: until this wave the form's fields carried
      // accessible names only, and artboard 4c draws it with real
      // <label>s.
      typeLabel: 'Link type',
      idLabel: 'Issue ID',
      idAria: 'Issue id to depend on',
      idPlaceholder: 'issue id (e.g. demo-42)',
      idRequired: 'Issue id required',
      add: 'Add',
      addAffordance: 'Add dependency',
      cancel: 'Cancel',
      removeAria: 'Remove link to {{id}}',
      // An edge whose target the caller cannot see: the type and the
      // direction are known, the issue behind it is not. This is NOT an
      // error and NOT "no data".
      redacted: 'hidden · no access to project',
      redactedHint:
        'the issue lives in another project — only type and direction are visible',
    },
    activity: {
      loading: 'loading…',
      created: 'created this task',
    },
    editable: {
      edit: 'Edit',
      editAria: 'Edit {{title}}',
      saving: 'saving…',
      unsaved: 'unsaved',
      saveFailed: 'save failed — {{message}}',
      // sk-425 — the refused text stays in the editor; these say why and
      // offer the retry. The claim holder is the card's own
      // `lockedByUsername` (the refusal carries only a session id, which
      // is never shown).
      retry: 'Retry',
      retryAria: 'Retry saving {{title}}',
      reason: {
        lockedBy: 'the issue is claimed by {{user}}; edits are refused until the claim is released',
        locked: 'the issue is claimed by another session; edits are refused until the claim is released',
        versionConflict: 'the issue was changed meanwhile; your text is kept, Retry saves it over the new version',
        // sk-492 — the same conflict for a header field (priority, type):
        // there is no kept text and no Retry, the card is re-read.
        versionConflictField: 'the issue was changed meanwhile; the card now shows the current version, pick again',
      },
      // sk-492 — the toast for a refused save of a header field, which has
      // no room to say why in place. `message` is `saveFailureReason`.
      fieldSaveFailed: 'change not saved — {{message}}',
    },
    addDescription: 'Add description',
    addAcceptanceCriteria: 'Add acceptance criteria',
    addNotes: 'Add notes',
    addDesign: 'Add design',
    // sk-285.7.2.55 — the VISIBLE label of an empty section's
    // affordance. `Sk Details.dc.html` lists the four stubs with the
    // one-word actions «Add» / «Add» / «Upload» / «Add»: the section's
    // own heading sits on the same row, two elements to the left, and
    // already names the field. The long phrases above stay — they are
    // the ACCESSIBLE names now, because four buttons called «Add» on
    // one panel are indistinguishable to a screen reader, and each of
    // them contains its button's visible word (WCAG 2.5.3).
    emptyAdd: {
      add: 'Add',
      upload: 'Upload',
      watch: 'Watch',
    },
    title: {
      aria: 'Issue title',
      placeholder: '(untitled)',
      saving: 'saving…',
      saveFailed: 'title save failed — {{message}}',
    },
    // sk-674.18 T055 — releasing another holder's claim (screens 1.10, US-16).
    forceUnlock: {
      button: 'Release claim',
      title: 'Release the claim?',
      confirm: '{{name}} has held this issue since {{time}}. Release the claim?',
      confirmNoName: 'Another session has held this issue since {{time}}. Release the claim?',
      confirmLabel: 'Release',
      done: 'Claim on {{id}} released',
    },
    // sk-674.18 T055 — refusals of the spaces feature, by code
    // (lib/saveFailureReason.ts#refusalReason).
    refusal: {
      ambiguousProject: 'several projects have this name — name one by prefix: {{candidates}}',
      ambiguousProjectBare: 'several projects have this name — name one by prefix',
      ambiguousProjectCandidate: '{{prefix}} ({{space}})',
      forceUnlockForbidden: 'only the project owner, the space owner or an admin can release this claim',
      assigneeNotAllowed: 'this person can no longer work in the project; the previous assignee is kept',
      notSpaceMember: 'join the space as a member first — admin access is not membership',
      memberViaSpace: 'this person is in the project through its space and cannot be removed from the project alone',
      concurrentChange: 'someone changed the members at the same moment; nothing was changed — try again',
      storageQuota: 'the space has run out of room for attachments — delete files you no longer need',
      projectQuota: 'the space has reached its project limit',
    },
    header: {
      crossProjectChip: 'from {{handle}}',
      // sk-674.18 T055 — the space chip before the project code (screens 1.10).
      spaceChipAria: 'Open space {{name}}',
      personalSpace: 'Personal',
      crossProjectChipTitle:
        "This issue was minted under a different project's id prefix (its parent's). It lives in the current project but inherits the parent's prefix.",
      changeType: 'Change type — currently {{type}}',
      typeTitle: 'Type: {{type}}',
      priorityAria: 'Priority P{{priority}}',
      statusAria: 'Status: {{status}}',
      statusAriaBlocked: 'Status: {{status}} (blocked by dependencies)',
      statusTitleBlocked: '{{status}} — blocked by dependencies',
      readyToClose: 'Ready to close',
      readyToCloseTitle: 'All {{count}} children closed',
      accept: 'Accept',
      dropFromDelegated: 'Drop from Delegated',
      dropFromDelegatedAria: 'Drop {{id}} from Delegated',
      dropFromDelegatedTooltip:
        'Stop tracking this delegated task. Bell notifications are silenced too.',
      resumeTracking: 'Resume tracking',
      resumeTrackingAria: 'Resume tracking {{id}}',
      resumeTrackingTooltip:
        'Resume tracking this issue in Delegated. Bell stays silenced — use Watch to re-arm notifications.',
      watch: 'Watch',
      watching: 'Watching',
      watchTitle: 'Click to watch',
      unwatchTitle: 'Click to unwatch',
      created: 'created {{date}}',
      createdTitle: 'Created {{exact}}',
      createdTitleRelative: 'Created {{exact}} ({{relative}})',
      version: 'v{{version}}',
      versionTitle:
        'Issue version {{version}} — an edit counter. It grows on every change and is what concurrent edits are reconciled against.',
      closeAria: 'Close issue (Esc)',
      closeTitle: 'Close (Esc)',
      shortcuts: {
        toInProgress: 'in progress',
        close: 'close',
        resume: 'resume',
        retire: 'retire',
        reopen: 'reopen',
      },
      dropConfirm: {
        title: 'Drop from Delegated?',
        body: "You'll stop seeing this in Delegated and stop receiving notifications. Proceed?",
        confirm: 'Drop',
      },
      statusChangeFailed: 'Failed to change status',
    },
    move: {
      button: 'Move',
      buttonAria: 'Move {{id}} to a different epic',
      tooltip: 'Move this issue under a different epic (or top-level)',
      modalTitle: 'Move issue',
      description:
        'Pick an epic to host {{id}}, or choose Top-level to remove the current parent. Searches across every visible project.',
      topLevel: '— Top-level (no parent)',
      destination: 'Destination epic',
      searchPlaceholder: 'search epics by id or title…',
      pickDestination: 'Pick a destination epic or "Top-level"',
      currentlyTopLevel: 'Currently top-level (no parent edge).',
      currentParent: 'Current parent: {{ids}}',
      currentParents: 'Current parents: {{ids}}',
      movedTopLevel: '{{id}} is now top-level',
      movedUnder: '{{id}} moved under {{target}}',
      failed: 'failed to move issue',
      // sk-674.18 T055 — a parent behind a hidden edge (decision on T009).
      hiddenParent:
        "This issue's parent is not available to you. Moving it would remove a link to an issue you cannot see, so it cannot be moved.",
    },
    people: {
      aria: 'People involved',
      unassigned: 'unassigned',
      current: 'Current assignee: {{username}}',
      creator: 'Creator: {{username}}',
      pastDismissed: 'Past assignee (dropped from Delegated): {{username}}',
      past: 'Past assignee: {{username}}',
      /* sk-285.6.10 — visible role captions on the people row. Lower
       * case: these caption a name, they are not headings. */
      roleCreator: 'author',
      roleAssignee: 'assignee',
      rolePast: 'previously',
      roleBoth: 'author & assignee',
      bothTitle: 'Created and assigned to {{username}}',
    },
    subtask: {
      button: 'Create subtask',
      buttonAria: 'Create subtask under standing task {{id}}',
      tooltip:
        "Standing tasks aren't claimed directly — spawn a child cycle to act on this obligation.",
      modalTitle: 'New cycle under {{id}}',
      titleLabel: 'Cycle title',
      titlePlaceholder: 'e.g. merge upstream v2.3.1',
      titleRequired: 'Title is required',
      createFailed: 'Failed to create subtask',
    },
    statusReason: {
      titleRetire: 'Retire standing task {{id}}',
      title: '{{verb}} issue {{id}}',
      verbClosed: 'Close',
      verbDeferred: 'Defer',
      verbDefault: 'Change status',
      verbRetire: 'Retire',
      retireBlurb:
        'Retiring a standing task closes it permanently. It is only allowed when every child (cycle) is already closed.',
      reasonLabel: 'Reason (optional)',
      reasonLabelRetire: 'Reason for retiring',
      placeholder: 'Why are you transitioning to {{status}}?',
      placeholderRetire:
        'Why retire it? (no longer relevant / moved off the fork / EOL)',
      standingChildren:
        'Cannot retire — this standing task still has non-closed children. Close or retire them first:',
      ok: 'OK',
    },
    fileViewer: {
      errorTitle: 'File viewer error',
      closeAria: 'Close file viewer',
      closeTitle: 'Close (Esc)',
      loadFailed: 'The viewer failed to load.',
      closeViewer: 'Close viewer',
    },
  },

  // sk-396 — the dictionary of THIS notification settings page. The former
  // contents of the space described the categories page, torn down by
  // sk-303.13: the keys `sectionTitle`, `selectAll`, `categories.*`,
  // `events.*` addressed a surface that does not exist, and were removed together with
  // it. The names of the reason registry rows come from the SERVER and do not live in
  // the dictionary — see the docblock of `NotificationsPage.tsx`.
  notifications: {
    intro: {
      title: 'What these notifications are',
      body: 'Each row is a reason Skein can bother you about. Every reason has two independent channels: the in-app feed and a push to your device. A dash means the reason has no such channel at all.',
    },
    saved: {
      title: 'Saved',
      body: 'Settings updated.',
      dismiss: 'Dismiss saved message',
    },
    error: 'Error',
    loadFailed: "couldn't load settings",
    loading: 'Loading settings',
    retry: 'Retry',
    save: 'Save',
    cancel: 'Cancel',
    reasons: {
      title: 'Reasons',
      description:
        'What to tell you, and where. This setting is shared across all your devices.',
      empty: 'The reasons registry is empty.',
      tableCaption: 'Notification reasons: feed channel and push channel',
      columnReason: 'Reason',
      channels: {
        feed: 'Feed',
        push: 'Push',
      },
      // The em dash is decoration; this sentence is what a screen reader
      // hears in its place.
      noChannel: '{{reason}}: this reason has no {{channel}} channel',
      switchAria: '{{reason}}: {{channel}}',
    },
    agent: {
      legend: 'Agent actions',
      title: 'Agent actions',
      description:
        "On by default. Don't notify me about what an agent did — anyone's, not only yours — on issues and projects you merely watch. Personal events still arrive in both the feed and push: you were assigned, the assignee accepted, the status of an issue you delegated changed, you were @mentioned, or a reminder fired. Turn this off if you also want the feed to include the machine echo of large agent runs.",
      checkbox: "Don't notify about agent actions",
    },
    // sk-551.10 — the personal «unwatch on close» setting.
    unwatchOnClose: {
      legend: 'Closed issues',
      title: 'Closed issues',
      description:
        "Off by default. When an issue is closed, stop watching it if you were watching only because you created it or it was assigned to you. Issues you chose to watch by hand stay. If the issue is reopened, the subscription comes back. Issues that are already closed are not affected — for those, use “Stop watching closed” in the Watching queue.",
      checkbox: 'Stop watching issues when they are closed',
    },
    // sk-565 — the personal «assign the issues my agent creates to me»
    // setting. Its own panel, its own query and save: it is NOT part of the
    // reason form above nor of the review form below (D8).
    issueCreate: {
      title: 'Issue creation',
      label: 'Assign issues my agent creates to me',
      description:
        'On by default. When your agent creates an issue over MCP without naming an assignee, the issue is assigned to you and accepted. An assignee named by the agent always wins. Not applied to standing issues or to subtasks under someone else\'s issue. Issues created in the web interface are not affected. The change applies right away, with no Save button.',
      loadFailed: "Couldn't load the issue-creation setting",
      saveFailed: "Couldn't save the issue-creation setting — it was left as it was",
      // Spoken by the panel's polite live region; the spinner beside the
      // switch is decoration only.
      loading: 'Loading the issue-creation setting',
      saving: 'Saving the issue-creation setting',
    },
  },

  // sk-403 — the password change page. The texts of the strength ASSESSMENT ITSELF
  // (`warning`, `suggestions`) do not get here: they are produced by the zxcvbn
  // library, and its language is chosen by the translation package at the moment the
  // factory is built — see `lib/passwordStrength.ts`. Here is only what we write.
  password: {
    title: 'Change password',
    description:
      "Change your own account password. There is no composition rule (no required uppercase/digit/symbol) — length and, when enabled by your organization, a breach check are what's enforced.",
    success: {
      title: 'Password changed',
      body: 'Your password has been changed.',
    },
    failed: 'Could not change password',
    unexpected: 'Something went wrong — try again.',
    sso: 'Managed via SSO',
    fields: {
      current: 'Current password',
      new: 'New password',
      confirm: 'Confirm new password',
      newHint:
        'At least {{min}} bytes long once UTF-8 encoded (most characters are 1 byte; some scripts and emoji use more). 15+ recommended — length matters more than mixing character types.',
    },
    submit: 'Change password',
    errors: {
      currentRequired: 'Enter your current password.',
      newRequired: 'Enter a new password.',
      tooShort: 'Password must be at least {{min}} bytes once UTF-8 encoded.',
      tooLong:
        'Password must not exceed {{max}} bytes once UTF-8 encoded — try a shorter one.',
      mismatch: 'Passwords do not match.',
      currentIncorrect: 'Current password is incorrect.',
      pwned: 'This password has appeared in a known data breach — choose a different one.',
    },
    strength: {
      aria: 'Password strength: {{level}}',
      levels: {
        veryWeak: 'Very weak',
        weak: 'Weak',
        fair: 'Fair',
        good: 'Good',
        strong: 'Strong',
      },
    },
    pwned: {
      checking: 'Checking against known breaches…',
      found: 'This password has appeared in a known data breach.',
    },
  },

  push: {
    device: {
      title: 'Push on this device',
      description:
        'Skein will send desktop notifications from this browser — new tasks, mentions and reminders — even while the tab is closed.',
      unsupportedTitle: 'Push is not supported',
      unsupportedBody:
        'This browser cannot show desktop push notifications (no Service Worker / Push API). Open Skein in Chrome, Firefox or Edge on the desktop. In Safari on iOS web push only works for apps added to the home screen.',
      deniedTitle: 'Notifications are blocked',
      deniedBody:
        'You blocked notifications for this site in the browser. The switch here cannot turn them back on — lift the block in the browser settings: click the padlock (or “Site information”) to the left of the address, find “Notifications” and set it to “Allow”, then reload the page.',
      switchOn: 'Push on this device is on',
      switchOff: 'Turn on push on this device',
      permission: 'Browser permission:',
      permissionLabels: {
        granted: 'granted',
        denied: 'blocked',
        default: 'not requested',
      },
      serviceErrorTitle: "The browser couldn't reach its push service",
      serviceErrorBody:
        "The subscription failed: the browser couldn't connect to Google's push service (FCM). Skein itself is fine — push works in Firefox, for instance; this is a limitation of the particular browser.",
      // <b> / <code> are rendered by <Trans>; keep the tags in the copy so
      // a translator can move the emphasis where their language needs it.
      braveKnown:
        '<b>Brave</b> disables Google push by default. Open <code>brave://settings/privacy</code>, turn on “Use Google services for push messaging” and <b>restart Brave completely</b>. If that does not help, create a fresh Brave profile or use Chrome / Edge / Firefox.',
      braveMaybe:
        'If this is <b>Brave</b> — open <code>brave://settings/privacy</code>, turn on “Use Google services for push messaging” and restart the browser. Otherwise try Chrome, Edge or Firefox on the desktop and check that your network / VPN is not blocking Google services.',
    },
    devices: {
      title: 'Devices',
      description:
        'Browsers where you turned push on. Any device can be unsubscribed right here — the current one carries the “this device” badge.',
      error: 'Error',
      loadFailed: 'could not load the devices',
      empty: 'No device has push enabled yet.',
      thisDevice: 'this device',
      meta: 'added {{created}} · last seen {{lastSeen}}',
      unsubscribeAria: 'Unsubscribe device {{device}}',
      unsubscribe: 'Unsubscribe',
    },
    categories: {
      title: 'Push notification categories',
      description:
        'Which push notifications to send to the desktop. Everything is on by default; a disabled category reaches no device at all.',
      error: 'Error',
      saveFailed: 'could not save the settings',
      empty: 'No categories available.',
    },
    unsupportedFooter:
      'You can still configure the categories — they apply to push on every device where it is on. To receive push, open Skein in a supported browser. More about in-app notifications on the <link>Notifications</link> tab.',
    internalError: 'internal error — please try again',
  },

  // sk-489 — the acknowledgement mechanics: the settings panel and the sign section on
  // the card. Both places are the requester's PERSONAL bookkeeping, invisible
  // to the assignee; the wording says so, and it therefore has to be translated
  // as a whole, not just the field labels.
  review: {
    prefs: {
      title: 'Review of results',
      description:
        'Closed issues you assigned to others wait for you to read them. Here: the master switch for review reminders, the default of the flag for new issues, and the reminder schedule. All of this is about you only: the assignee sees none of it.',
      saved: 'Review settings saved',
      errorTitle: 'Review settings error',
      loadFailed: "couldn't load review settings",
      // Refusal on the FORM's own check of what was typed. Names the
      // offending field, because three of them are on screen at once.
      malformed:
        'A schedule value must be an integer — or leave the field empty for the built-in default. Check: {{fields}}.',
      mechanic: {
        label: 'Enable review reminders',
        description:
          'Off — the unreviewed set, the second number next to Delegated, and the reminders about it all disappear for you. Nothing is deleted: turn it back on, and everything returns.',
      },
      requiredDefault: {
        label: 'Require review by default',
        description:
          'Applied on every issue-creation path where the flag is not set explicitly.',
      },
      fields: {
        burstCount: 'Reminders in the first hour (unaccepted)',
        unacceptedInterval: 'Background interval, unaccepted (minutes)',
        unreviewedInterval: 'Background interval, unreviewed (minutes)',
      },
      bounds: {
        known: 'Allowed {{min}}…{{max}} {{unit}}. Empty — built-in default: {{factory}}.',
        unknown: 'Empty — built-in default applies.',
        units: {
          items: 'items',
          minutes: 'minutes',
        },
      },
      save: 'Save',
      // The page hosts a second Save; a screen reader listing controls has
      // no panel context to tell them apart, so the accessible name names
      // this panel and keeps the visible word as its prefix (WCAG 2.5.3).
      saveAria: 'Save review settings',
    },
    flag: {
      title: 'Review',
      label: 'Needs review of the result',
      onDescription:
        'Once closed, the issue will enter unreviewed until I mark it read. The assignee cannot see this.',
      offDescription:
        'The issue will not enter unreviewed. Clearing the flag is not a review mark: turning it back on brings the issue back too.',
    },
  },

  /**
   * sk-522 — the one-time secret reveal modal (`SecretReveal.tsx`).
   *
   * Before this task the file did not import `useTranslation` at all: nine
   * English literals reached the DOM — six visible and three lines
   * of the live region `role="status"`, which the card did not count.
   *
   * `warningDefault` is deliberately NOT a module constant: in the component body
   * it is resolved on every render, so switching the language without
   * reloading moves it (the same trap that
   * `ErrorFrame.tsx#resolvedTitle` avoided).
   *
   * The case is lowercase where it was in the literals: this is the terminal
   * aesthetic of the buttons (`TerminalLabel`), not an oversight.
   */
  secretReveal: {
    valueLabel: 'value',
    copy: 'copy',
    copied: 'copied!',
    clipboardUnavailable:
      'clipboard unavailable — select the value above and copy manually.',
    acknowledgeManual: 'I copied manually',
    dismiss: "I've copied it, dismiss",
    warningDefault:
      'this value is shown only once. it is stored as a bcrypt hash on the server — we cannot retrieve it for you later.',
    // The live region lines: a screen reader reads them, they get into the
    // markup the same way as visible text, so they are translated the same way.
    announce: {
      copied: 'Copied to clipboard',
      copyFailed: 'Could not access clipboard. Select the value manually.',
      manualAcknowledged: 'Manual copy acknowledged',
    },
  },

  settings: {
    title: 'Settings',
    mainAria: 'Settings',
    tabsAria: 'Settings sections',
    back: 'Back to tasks',
    tabs: {
      account: 'Account',
      password: 'Password',
      spaces: 'Spaces',
      apiKeys: 'API keys',
      users: 'Users',
      notifications: 'Notifications',
      theme: 'Theme',
    },
    // sk-674.18 T058 — "API keys" (screens 1.14, K2).
    keys: {
      allSpaces: 'A key sees all your spaces.',
      connectTitle: 'Connection',
      connectWhere: 'Put this .mcp.json into the agent’s project.',
      connectKey: 'Set the SKEIN_API_KEY environment variable to a key created below.',
      connectCheck: 'To check: ask the agent to call skein_whoami — it names you.',
    },
    // sk-674.18 T058 — "Users": the spaces of an account (screens 1.14, K6).
    users: {
      spacesLabel: 'Spaces',
      spacesHint: 'Checking a space makes the person a member right away, without asking them.',
      ownerLocked: 'Owner — change the owner first',
      changeOwnerLink: 'settings for {{name}}',
      spacesLoadFailed: 'Could not load the person’s spaces.',
      spacesUnavailable: 'Spaces did not load — the person joins the default spaces.',
      removalTitle: 'Remove {{name}} from spaces?',
      removalConfirm: 'Save',
      removalCancel: 'Cancel',
      saveSpacesFailed: 'Could not save the spaces: {{message}}',
      deactivateKeeps: 'Assignments and space memberships are kept.',
      ownsLead: 'Owns:',
      ownsTail: '— change the owner.',
    },
  },

  // sk-674.18 T057 — the «Spaces» tab, creating a space, space settings,
  // invitation, owner change (screens 2.1–2.4, 2.14).
  spaces: {
    // Quota and limit labels — one label for one number (K3).
    quota: {
      seats: 'Seats taken: {{used}} of {{limit}}',
      seatsWithInvitations_one: 'Seats taken: {{used}} of {{limit}} ({{count}} of them an invitation)',
      seatsWithInvitations_other: 'Seats taken: {{used}} of {{limit}} ({{count}} of them invitations)',
      projects: 'Projects in the space: {{count}} of {{quota}}',
      storage: 'Files in all projects of the space: {{used}} of {{quota}}',
      personalProjects: 'Projects: {{count}} of {{quota}}',
      personalStorage: 'Files: {{used}} of {{quota}}',
      storageStopped: ' · uploads stopped',
      owned: 'Your spaces: {{owned}} of {{limit}}',
    },
    list: {
      settingsAria: 'Settings for {{name}}',
      invitationsTitle: 'Invitations',
      mineTitle: 'My spaces',
      newSpace: 'New space',
      adminOnly: 'New spaces are created by the administrator',
      loading: 'Loading…',
      loadFailed: 'Could not load spaces.',
      retry: 'Retry',
      caption: 'My spaces',
      col: { name: 'Name', kind: 'Kind', role: 'Role', members: 'Members', settings: 'Settings' },
      kind: { personal: 'personal', common: 'common' },
      role: { owner: 'owner', member: 'member', adminAccess: 'admin access' },
      noMembers: '—',
      personal: 'Personal',
    },
    create: {
      title: 'New space',
      name: 'Name',
      hint: 'A space is a team: projects and people. You can invite people after creating it.',
      owner: 'Owner',
      ownerSearch: 'Find by name, username or email',
      ownerSelf: 'Me ({{name}})',
      submit: 'Create',
      cancel: 'Cancel',
      failed: 'Could not create the space.',
      errors: {
        owned_limit: 'Your spaces: {{owned}} of {{limit}} — you cannot create another.',
        admin_only: 'New spaces are created by the administrator.',
        space_creation_disabled: 'Creating spaces is turned off on this instance.',
        external_user: 'An external user cannot own a space.',
      },
    },
    settings: {
      backToList: 'My spaces',
      notFound: 'Space not found',
      loading: 'Loading…',
      loadFailed: 'Could not load the space.',
      retry: 'Retry',
      invite: 'Invite',
      add: 'Add',
      nameLabel: 'Name',
      save: 'Save',
      renamed: 'Space renamed',
      renameFailed: 'Could not rename: {{message}}',
      membersTitle: 'Members ({{count}})',
      membersCaption: 'Members',
      membersCol: { username: 'Username', name: 'Name', role: 'Role', actions: 'Actions' },
      invitationsCol: { email: 'Email', expires: 'Expires', status: 'Status', actions: 'Actions' },
      role: { owner: 'owner', member: 'member' },
      deactivated: 'deactivated',
      remove: 'Remove',
      removeAria: 'Remove {{name}}',
      invitationsTitle: 'Invitations ({{count}})',
      invitationsCaption: 'Invitations',
      invitationsEmpty: 'No pending invitations.',
      invitationUntil: 'until {{date}}',
      invitationStatus: { pending: 'pending', not_accepted: 'not accepted' },
      resend: 'Resend',
      resendAria: 'Resend the invitation to {{email}}',
      resendCaptcha: 'Confirm you are not a robot — the invitation to {{email}} is sent again once the check passes.',
      revoke: 'Revoke',
      revokeAria: 'Revoke the invitation to {{email}}',
      resent: 'Invitation sent again',
      revoked: 'Invitation revoked',
      actionFailed: 'That did not work: {{message}}',
      dangerTitle: 'Danger zone',
      changeOwner: 'Change owner',
      delete: 'Delete space',
      leave: 'Leave space',
      cannotDelete: {
        common_space_not_empty: 'The common space cannot be deleted while it has projects',
        common_space_enabled: 'New users would have nowhere to land',
      },
      deleted: 'Space {{name}} deleted',
      left: 'You left {{name}}',
      removed: '{{name}} removed from {{space}}',
    },
    removal: {
      removeTitle: 'Remove {{name}} from {{space}}?',
      leaveTitle: 'Leave {{space}}?',
      loading: 'Counting the consequences…',
      previewFailed: 'Could not count the consequences.',
      retry: 'Retry',
      openAssigned_one: '{{count}} open issue loses its assignee.',
      openAssigned_other: '{{count}} open issues lose their assignee.',
      myOpenAssigned_one: '{{count}} of your open issues loses its assignee.',
      myOpenAssigned_other: '{{count}} of your open issues lose their assignee.',
      claims: 'Claims held by {{name}} and by agents of {{name}} are released.',
      myClaims: 'Claims held by you and your agents are released.',
      projects: '{{name}} leaves every project of {{space}} and stops watching its issues.',
      myProjects: 'You leave every project of {{space}} and stop watching its issues.',
      owned: 'Projects owned by {{name}} — {{projects}} — stay with the owner of {{space}}.',
      myOwned: 'Projects you own — {{projects}} — stay with the owner of {{space}}.',
      keys: 'Agent keys of {{name}} lose access to {{space}}; notifications from {{space}} stop.',
      myKeys: 'Your agent keys lose access to {{space}}; notifications from {{space}} stop.',
      history: 'History stays: the name {{name}} is shown greyed out, marked “left”.',
      myHistory: 'History stays: your name is shown greyed out, marked “left”.',
      confirmRemove: 'Remove',
      confirmLeave: 'Leave',
      cancel: 'Cancel',
    },
    deletion: {
      title: 'Delete {{name}} forever?',
      summary: 'Projects ({{projects}}), issues ({{issues}}) and attachments ({{storage}}) are deleted.',
      invitations: 'Pending invitations are revoked. Members lose access at once.',
      owner: 'Owner: {{owner}} — will not be notified of the deletion.',
      typeName: 'Type the space name',
      confirm: 'Delete',
      cancel: 'Cancel',
      loading: 'Counting what will be deleted…',
      previewFailed: 'Could not count what will be deleted.',
      retry: 'Retry',
      errors: {
        name_mismatch: 'The name does not match.',
      },
    },
    owner: {
      title: 'Change the owner of {{space}}',
      current: 'Current: {{name}}',
      next: 'New owner',
      placeholder: 'Pick a member',
      stays: '{{name}} stays a member.',
      noCandidates: 'The space has no other members — add a person first.',
      confirm: 'Change',
      cancel: 'Cancel',
      done: 'The owner of {{space}} is {{name}}',
    },
    invite: {
      title: 'Invite to {{space}}',
      field: 'Email or name',
      placeholder: 'dev@client.io or a name',
      suggestionsAria: 'Matching people',
      seatsOneMore: '{{seats}}. The invitation takes one more.',
      noSeats: '{{seats}} — no seats left. Revoke an invitation or remove a member.',
      invite: 'Invite',
      add: 'Add',
      cancel: 'Cancel',
      done: 'Done',
      pickOrEmail: 'Pick a person from the list or type an email.',
      badEmail: 'This is not an email address.',
      pickForAdd: 'To add at once, pick a person from the list.',
      sent: 'Invitation sent',
      alreadyMember: '{{name}} is already in the space',
      alreadyPending: 'An invitation is already waiting for an answer',
      resend: 'Send again',
      resent: 'Invitation sent again',
      added: '{{name}} added to {{space}}',
      captcha: 'Confirm you are not a robot — the invitation is sent once the check passes.',
      captchaUnavailable: 'Could not load the check. Try again later.',
      // The server asks for the check, and this server has no Turnstile
      // key: «later» will not help.
      captchaNotConfigured: 'The check is not set up on this server — contact the administrator.',
      failed: 'Could not send the invitation.',
      errors: {
        no_such_user: 'There is no such user',
        email_disabled: 'Mail is not set up on this instance — a new person cannot be invited. Contact the administrator',
        external_user: 'An external user cannot be invited to a space',
        no_seats: 'No seats left. Revoke an invitation or remove a member',
        daily_limit: 'No invitations left for today, try tomorrow',
        captcha_failed: 'The check did not pass, try again',
        already_member: 'This person is already in the space',
        invitation_not_pending: 'The invitation is no longer waiting for an answer',
      },
    },
  },

  // sk-674.18 T058 — the «Account» tab, email confirmation, account
  // deletion (screens 2.9, 2.13).
  account: {
    // sk-674.18 T059 — the consent checkbox of registration (screens 2.6,
    // 2.7); `<terms>` / `<privacy>` are links when their addresses are set.
    consent:
      'I accept the <terms>terms of use</terms> and the <privacy>privacy policy</privacy>',
    title: 'Account',
    loading: 'Loading…',
    loadFailed: 'Could not load the account.',
    retry: 'Retry',
    email: 'Email',
    username: 'Username',
    readOnly: 'read only',
    confirmed: '✓ confirmed',
    unconfirmed: '⚠ not confirmed',
    sendConfirmation: 'Send email',
    confirmationHint: 'Confirmation is needed to accept invitations to spaces from Inbox.',
    confirmationSent: 'Email sent to {{email}}',
    rateLimited: 'An email can be sent at most once a minute — try again a bit later.',
    emailDisabled: 'Mail is not set up on this instance.',
    confirmationFailed: 'Could not send the email.',
    dangerTitle: 'Danger zone',
    deleteAccount: 'Delete account',
    // The public page after deletion (screens 2.13).
    deletedPage: {
      title: 'Account deleted',
      body: 'The account and everything that belonged only to you have been deleted. The email and the username cannot be registered again.',
      signIn: 'Sign in',
    },
    deletion: {
      blockedTitle: 'The account cannot be deleted yet',
      blockedIntro: 'You own spaces with other people in them:',
      blockedMembers_one: '{{name}} ({{count}} member)',
      blockedMembers_other: '{{name}} ({{count}} members)',
      openSettings: 'Open settings',
      blockedOutro: 'Delete these spaces — ownership cannot be handed over yet.',
      ownsCommon: 'You own the common space. Ask the administrator to change its owner.',
      title: 'Delete the account forever?',
      now: 'Immediately, with no way back.',
      spaces: '“Personal” and the spaces where you are the only member are deleted: {{list}}.',
      personalOnly: 'Your “Personal” space is deleted with all its projects.',
      spaceItem_one: '{{name}} ({{count}} project)',
      spaceItem_other: '{{name}} ({{count}} projects)',
      assigned_one: 'In other spaces {{count}} of your open issues loses its assignee, and you leave their projects and watcher lists; comments stay under a pseudonym.',
      assigned_other: 'In other spaces {{count}} of your open issues lose their assignee, and you leave their projects and watcher lists; comments stay under a pseudonym.',
      noAssigned: 'You leave other spaces; comments stay under a pseudonym.',
      keys: 'Every agent key stops working.',
      names: 'The email and the username cannot be registered again.',
      password: 'Password',
      confirm: 'Delete account',
      cancel: 'Cancel',
      close: 'Close',
      loading: 'Checking whether the account can be deleted…',
      previewFailed: 'Could not check whether the account can be deleted.',
      retry: 'Retry',
      errors: {
        invalid_credentials: 'Wrong password.',
        account_deletion_disabled: 'Account deletion is turned off on this instance.',
        owns_spaces_with_members: 'You own spaces with other people in them.',
        owns_common_space: 'You own the common space. Ask the administrator to change its owner.',
      },
      failed: 'Could not delete the account.',
    },
  },

  search: {
    title: 'Search',
    placeholder: 'Issues, comments, projects, components…',
    inputAria: 'Search for',
    submit: 'Search',
    kindsAria: 'What to show',
    kind: {
      issue: 'Issues',
      comment: 'Comments',
      project: 'Projects',
      component: 'Components',
    },
    prompt: 'Type a query: search covers issues, comments, projects and components across every project you can see.',
    loading: 'Searching…',
    loadingMore: 'Loading more…',
    more: 'Show more',
    failed: 'Search failed.',
    retry: 'Retry',
    empty: 'Nothing found for “{{q}}”.',
    resultsAria: 'Search results for “{{q}}”',
    untitled: 'untitled',
    degraded: 'Semantic search is unavailable right now — only exact text matches are shown. Results that match by meaning may be missing.',
    everywhere: 'Search everywhere',
    everywhereAria: 'Search everywhere: “{{q}}” — issues, comments, projects and components',
    // sk-674.18 T056 — the row's label with two spaces or more (screens 1.11).
    spaceProject: '{{space}} · {{project}}',
  },

  ticker: {
    title: 'Live ticker',
    tableAria: 'Live activity ticker — newest first',
    online: 'online',
    offline: 'offline',
    connection: 'SignalR connection: {{status}}',
    empty: 'no events match the active filters',
    noAccess: 'No access to this project',
    col: {
      time: 'Time',
      actor: 'Who',
      origin: 'Origin',
      verb: 'Action',
      type: 'Entity',
      id: 'Id',
      title: 'Title',
    },
    origin: {
      human: 'human',
      autonomous: 'agent',
      unknown: 'system',
    },
    verb: {
      created: 'created',
      accepted: 'accepted',
      updated: 'updated',
      status_changed: 'changed status',
      archived: 'archived',
      closed: 'closed',
      claimed: 'claimed',
      unclaimed: 'unclaimed',
      deleted: 'deleted',
    },
    entity: {
      issue: 'issue',
      comment: 'comment',
      dependency: 'dependency',
      project: 'project',
      component: 'component',
      user: 'user',
      attachment: 'attachment',
      dep: 'dependency',
    },
  },

  shell: {
    skipToContent: 'Skip to main content',
    workspace: 'Workspace',
    resizeColumn: 'Resize {{col}} column',
    boardWorkspaceHint:
      'The board has taken over the workspace: Queues and Projects are folded into the slivers on the left. Click either one to reopen it — the board remembers that and stops folding it.',
    treeWorkspaceHint:
      'The tree has taken over the workspace: Queues and Projects are folded into the slivers on the left, so the whole table fits. Click either one to reopen it — the tree remembers that and stops folding it.',
    // sk-551.8 — the sections layout: one navigation column holding the
    // Projects and Queues sections, its sliver, its two handles and its
    // own board/tree hint. Section names are the columns' own titles.
    nav: {
      projects: 'Projects',
      queues: 'Queues',
      expandSection: 'Expand the {{section}} section',
      collapseSection: 'Collapse the {{section}} section',
      collapseColumn: 'Collapse the column',
      expandColumnWithCounts:
        'Expand the column — {{projects}} projects; {{total}} unread in queues: Inbox {{inbox}}, Mentions {{mentions}}, Watching {{watching}}',
      expandColumnQueuesOnly:
        'Expand the column — {{total}} unread in queues: Inbox {{inbox}}, Mentions {{mentions}}, Watching {{watching}}',
      resizeSplit: 'Resize the Projects and Queues sections',
      resizeWidth: 'Resize the navigation column',
      sectionsWorkspaceHint:
        'The view has taken over the workspace: Projects and Queues are folded into the sliver on the left. Click it to reopen the column — the view remembers that and stops folding it.',
    },
    // sk-285.7 T019 — the mobile zone strip. Names are the zones' own
    // column titles, so the phone and the wide layout call them the same
    // thing.
    zoneTabs: 'Zones',
    // sk-285.7 fidelity M1 — every tab carries its own count now, so the
    // accessible name has to say what the number counts. The strip-wide
    // `zoneTabsTotal` it replaces named one zone from outside all three.
    zoneTabWithCount: '{{zone}}, {{count}} items',
    zone: {
      queues: 'Queues',
      projects: 'Projects',
      tasks: 'Tasks',
    },
  },
} as const;

export type Resources = typeof en;
