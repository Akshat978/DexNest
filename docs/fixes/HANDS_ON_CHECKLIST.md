# DexNest 0.5.0: hands-on checklist

For checking the fixes on your own data. Each line is something to try and
what you should see. Tick what works; anything that does not is worth a note.

Everything here was checked on scratch data, not on yours. This list is how
it gets checked on yours.

## Before you start

- [ ] **Make a backup.** Backup → Create backup, with files and settings
      included. This version changes the database on first start (below), and
      a backup is the way back.
- [ ] Close the DexNest that is running, then either install
      `apps/desktop/release/DexNest Setup 0.5.0.exe` or start it with
      `pnpm dev`. Both run the same code.

### What happens once, on first start

- The database gains columns and tables for the repository scan, Projects,
  Skills and ObjectOS. This is automatic.
- Anything in the old Finder is moved into ObjectOS. A copy of the old file
  is kept in `local-data/settings/finder-items.backup-before-objectos.json`.
- The first repository scan reads each project's history (up to 5,000
  commits each). It takes longer than usual, once.

### Do these in order, once

1. [ ] Today → **Scan now**. Wait for it to finish.
2. [ ] Settings → Modules → Skills: pick your commit email(s), **Save**.
3. [ ] Skills → **Rebuild**.
4. [ ] GhostOS → Sources → sync. (Skills must be rebuilt first, or GhostOS
       shows no skills.)

## Today

- [ ] The headline names a project by the name Projects uses.
- [ ] "Changed since the last Standup" lists real new commits with their
      real times, not a wall of "first seen".
- [ ] The Changes tile and the section heading show the same number.
- [ ] A push or pull done on the command line shows up after the next scan.
- [ ] "Open TODOs" opens a list, and the entries are real comment TODOs.
- [ ] Your day (events and timetable blocks) and "Needs you" are on Today.
- [ ] The bell shows the same count as "Needs you" and opens Today.
- [ ] Earlier Standups are listed under History.

## Projects

- [ ] Long project names are readable on the cards.
- [ ] A card says how many branches there are and which is furthest ahead.
- [ ] dermassist: "vs main" matches what git says against `origin/main`.
- [ ] Branches: **Update** brings a branch that is not checked out level with
      its remote, without switching. Nothing is forced.
- [ ] Mark `develop` as the deployed branch on dermassist; the badge and the
      "vs live" column appear.
- [ ] Changes: **Ignore** on a file adds it to `.gitignore`; the toggle
      shows and hides ignored files.
- [ ] "Commit all" warns when the selection has an `.env`, a very large
      folder or an office document.
- [ ] The Terminal button no longer claims a window opened when all it
      knows is that the launch was sent.

## Skills

- [ ] Every star has a name. Stars are spread out, not piled up.
- [ ] Languages and frameworks lead "Brightest"; npm and ESLint do not.
- [ ] Something only named in a `package.json` is faint or absent.
- [ ] "Last worked in" dates are commit dates, not today's date.
- [ ] The legend explains lines, size and brightness.
- [ ] The evidence panel opens with a summary per repository.

## Reality RPG

- [ ] Turning it on is one screen: tick what you want, one button.
- [ ] After turning on there are rules, quests and achievements.
- [ ] Old commits earned nothing; a new commit earns XP after the next scan.
- [ ] A rule's "What earns it" is a list in plain words.

## GhostOS

- [ ] The empty state (if you see it) offers one button to connect.
- [ ] Skills here match Skills.
- [ ] Projects are dated by their first commit.
- [ ] An entry can be deleted from the timeline, and stays deleted after a
      sync.
- [ ] A new entry can be marked "Present / ongoing".
- [ ] Evidence and connections read as sentences, with project names.

## ObjectOS (and what was Finder)

- [ ] Your old Finder items are here, with their places.
- [ ] "Where is my…" finds a thing; "What's in…" lists a place.
- [ ] Saying or typing "where is my passport" answers from ObjectOS.
- [ ] A HEIC photo from your phone shows as an object's picture.
- [ ] Purchase → "Add warranty end to Calendar" and "Log this purchase in
      Finance" each work once, and the object then shows a chip for each.
- [ ] Files → **Send to Vault** copies a manual into the Vault; the object
      keeps its own copy.

## Calendar, Finance, Capture

- [ ] Calendar's day view shows Timetable blocks.
- [ ] A recurring bill in Finance can be sent to Calendar.
- [ ] A capture sent to Finance, Calendar or Journal appears under "Sent on"
      in Capture, and the other record shows "From Capture".
- [ ] Clicking a chip opens the other module.

## Tools and photos

- [ ] Images to PDF, Convert, Resize, Compress and Clean scan each take a
      `.heic` photo from your phone.
- [ ] OCR accepts a `.heic` photo.

## Search and voice

- [ ] Searching finds an object, a skill, a Reality RPG quest, a Timetable
      block and a GhostOS entry.
- [ ] Each result has **Open**, which goes to its module.
- [ ] "Open skills", "open reality rpg", "open my things" each open that
      screen.
- [ ] "What needs me" opens Today. "What's my level" opens Reality RPG.
- [ ] "What is my passport number" still goes to the private lookup, as
      before.

## Settings and the sidebar

- [ ] Point at a sidebar entry: move up, move down, hide. The order survives
      a restart.
- [ ] A hidden module is under "Hidden" and still opens. Settings cannot be
      hidden.
- [ ] Settings → Modules has Skills, the repository scan, Reality RPG and
      ObjectOS.
- [ ] The activity log shows every module under one name each, with a
      filter.
- [ ] Data Management can clear the repository scan, Skills and Reality RPG.

## Outside AI (optional, off unless you turn it on)

Nothing here is needed for DexNest to work. **This part has not been tried
against the real service**: only against a stand-in. You are the first real
test, so go in this order.

- [ ] Settings → Outside AI says "Off. Nothing is sent anywhere."
- [ ] Paste your OpenRouter key, **Save key**. The box empties.
- [ ] **Test**. It should say it works. If it does not, stop here and tell me
      what it said: the service's shape may have changed.
- [ ] Turn on "Use Outside AI" and "For commands you type into Ask DexNest".
- [ ] In Ask DexNest, type something the rules will not understand, such as
      "show me what I am good at". You should get "Outside AI suggests: …"
      with Confirm and Cancel. Nothing happens until you confirm.
- [ ] Type "what is my passport number". It must go to the local lookup.
- [ ] Activity log → filter to Settings: each request is there, with no text.
- [ ] Optional: turn on Capture, then **Suggest** on a note in the inbox.
- [ ] Try your own usual phrases and note which it gets right and wrong.
      That is what decides whether it is worth building on.

## Added after the first fifteen phases

### Dates

- [ ] Something done late in the evening shows that day's date in Skills,
      Reality RPG, GhostOS and ObjectOS, not tomorrow's.
- [ ] A day you picked in a form (a GhostOS entry, an ObjectOS job) still
      shows as the day you picked.
- [ ] A warranty that ends today reads "ending", not "expired", all day.

### Links

- [ ] Clicking a chip ("Sent to Finance: …") opens that exact entry, object,
      document or event, not just the screen.
- [ ] Calendar events you sent from another module before these fixes now
      show a "From …" chip.

### Photos

- [ ] A phone photo saved under a `.jpg` name opens in Tools and as an
      object's photo.
- [ ] Drop and Capture show a small preview for a file that is a picture,
      once its row is on screen. In Performance Mode they show icons.

### Projects

- [ ] Branches: every branch you are not on has "Bring up to …". A branch
      with commits of its own is refused, with the reason.
- [ ] Changes: if git is tracking a file like `.env`, a warning names it and
      shows what to run. DexNest does not run it.
- [ ] Import projects: tick **Watch** on a folder, create a new repository in
      it, open Projects: it is added and a notice says so.
- [ ] Remove that project: it is not added back.

### Search and voice

- [ ] Searching finds a line of today's Standup, under Today.
- [ ] "What needs me" opens Today and says a count. "What's my level" says
      your level. "What are my top skills" names them.

### Sidebar and Clear data

- [ ] Drag a sidebar entry onto another: it takes that place and stays there
      after a restart.
- [ ] Settings → Data Management lists GhostOS, ObjectOS and Projects, each
      saying what goes and what stays. **Do not clear these on your real
      data to test them**; they were checked on scratch data.

### Heatmap

- [ ] Below the window heatmap there is "Done in DexNest · last 28 days",
      with cells lit for the hours you used DexNest.

### Stream Deck

- [ ] Your existing Deck buttons still work. (The endpoint now refuses
      actions that are not meant for the Deck; every button DexNest exports
      is unaffected. If a button you made by hand stopped working, tell me
      which.)

## Things that are known and not done

- No Deck button opens Today, Skills, Reality RPG, GhostOS or ObjectOS.
  Those modules were built not to be offered to the Deck.
- A link chip opens the other module's screen; it does not jump to the
  record.
- A HEIC file renamed to `.jpg` is not recognised.
- Dates in Skills, Reality RPG, GhostOS and ObjectOS use the UTC day, so
  late in the evening something can show tomorrow's date.
- The Stream Deck endpoint and "delete data" are limited to what they are
  meant to run. Voice, hotkeys and routines are not yet limited the same way.
- Reality RPG does not count journal, finance or vault entries.
