# Handry ✋

**A Mac assistant that uses your apps and Chrome for you.**
*By Berat Olekli ([purplefox](https://github.com/purplefox21)).*
You talk or type. Claude plans the steps, TypeSafe Jev picks the right button in about a third of a second, and Handry's own code clicks, types and checks the result. It asks you before anything risky.

<!-- Demo GIF / video goes here -->

Handry started as a way to stop filling in App Store Connect by hand (pricing, the age rating questionnaire, the privacy questionnaire, descriptions, screenshots). It now runs my Mac every day: music, windows, files, forms, logins, timers, and other Claude Code sessions.

---

## What it can do

**In Chrome** (its own profile, so your logins stay there)
- Reads a page as a numbered list of what you can use (`#12 [button] Save — Pricing`) plus its text.
- Clicks, types, selects, ticks, uploads, presses keys, scrolls; fills a whole form in one call.
- Reads tables as rows, downloads files straight into the right project folder, waits for things to appear.

**In any Mac app** (through the accessibility tree, not screenshots)
- Reads the front window's buttons, menus and texts and uses them by name, also in Electron apps like Spotify, Slack and VS Code. Menu items work without opening menus.
- Arranges windows (halves, grids, minimize and back), switches between an app's windows, and moves between desktops (Spaces): "go to the window of project X" finds it even on another desktop or display.
- Falls back to a screenshot only when an app draws everything itself (canvas, games).

**Fast and learning**
- Simple commands (volume, music, open an app or a site, a web search, a note, a reminder, today's calendar) run in 1–3 s with no LLM at all: Jev decides, code does.
- After Claude has done a task once, Handry can repeat it with new details ("the same, but for app X") without Claude. Recipes can also be recorded and replayed.

**Later and when**
- "In 10 minutes remind me…", "lock the screen at 3", "when the Claude Code sessions are done, shut down the Mac", "when this text shows up in that window, tell me". Checked by Handry itself, even after the chat is over.

**Claude Code where you can watch it**
- "Have Claude run the tests in jev": Handry opens the project's VS Code window, a new Claude Code tab with the task in its message box, checks the box really holds it and presses Send. Nothing runs hidden in the background; you can watch every step and step in.
- It can also write to a session already open there (an answer to its question, the next task), and it tells you when a session is done or waits for you: on the Handry bar, and by iMessage with Claude's last answer if you don't come.
- The first time, VS Code asks whether the Claude extension may open Handry's link. That answer is yours: Handry circles the Open button, tells you, and waits.

**Files**
- Search, read, open, move, rename, copy and trash files in your home folder. Nothing is deleted for good (it goes to the Trash), nothing is overwritten, bigger changes ask first, and the last change can be undone.

**Logins**
- Passwords are filled from the macOS Keychain. The LLM never sees them.
- Two-step codes: authenticator (TOTP) codes from the Keychain; one-time codes from SMS (Messages on the Mac) or the Gmail inbox, after asking you each time.
- A "login window" for sites that refuse automated browsers (Google's "This browser may not be secure"): the same Chrome profile opens with nothing attached, you sign in by hand once, and the login stays.
- New strong passwords for sign-ups, saved to the Keychain for that site only.

**Voice and presence**
- Speaks English or Turkish: the window, the bar, the menu, spoken answers, confirmations and phone messages. It follows your Mac's language; Settings › Language or the menu bar menu › Language switches it.
- "Hey Handry", push-to-talk, spoken answers.
- A bar that grows out of the camera notch (⌥Space, or a click on the notch) and a frosted-glass chat window.
- A small pixel-art hand that walks on its fingers along the Dock and the tops of your windows, and shows what Handry is doing.

**Shows instead of doing, when you ask "where?" or "how?"**
- Lines appear on your screen without clicking anything: an arrow out of the camera notch, a circle, an underline, a box, with a short label. The color is picked to stand out from what is under it. Several places come one after another ("1. first here", "2. then here"), and they go as soon as you click or type.
- While a risky step waits for your OK, the button it is about is circled.

**From your phone**
- Text yourself "Handry, turn the volume down" by iMessage: Handry does it and texts back the answer. "Handry, ekranı göster" sends a screenshot. Only your own conversation counts, only messages that start with the name, only new ones; risky steps still ask you (on the phone, with a code).

**Works with Claude Code**
- Every tool is served over MCP, so any Claude Code session (and the Claude desktop app) can use Handry.
- With Claude Code's Remote Control you can drive your Mac from your phone: start a session on the Mac, talk to it from the Claude app, and it uses Handry's tools.

## How it works

```
You (voice or text)
   │
🧠 Brain: Claude Code on your Claude subscription (swappable: Codex, Claude API, OpenAI-compatible APIs, Ollama)
   │   "what to do"
   ▼
🔌 Handry MCP server (local, stdio; no network port)
   ├─ ⚡ Jev: "which element?" · "is this risky?" · "is the page in the expected state?"   (0.3–0.5 s)
   ├─ 🌐 Chrome hands: Playwright over a local-only DevTools port, separate profile
   ├─ 🖥️ Mac hands: a small Swift helper (accessibility tree, mouse, keyboard, screenshots)
   ├─ 🍎 Shortcuts: volume, music, apps, Notes, Reminders, Calendar, Spotify
   └─ 🔐 Guards: confirmation dialog · Keychain vault · prompt-injection filter · action log · emergency stop
```

**Jev picks, it doesn't write.** [TypeSafe Jev](https://typesafe.ai) is a "System 1" model: it takes a state and typed questions (pick one of these options, yes/no, a score) and answers with a calibrated probability. Handry uses it as a smart `if`/`switch`: which of these 300 elements is "Save", is this click risky, did the page change the way we wanted, is this command simple enough to skip the LLM. The brain decides *what* to do; Jev answers *where*; code does it.

**No Jev key? It still works.** Without a key Handry makes the same calls with words and rules (`core/nojev.js`): an element is found by its words (Turkish and English words for the same button count as one; when two elements fit, the candidates go back to Claude, which picks one by `#id`), "is it risky?" is a word list (so it asks you a little more often), the fast path knows the common commands by rules and hands everything else to Claude, and the page guard catches well-known prompt-injection phrases and login, code and CAPTCHA pages by their words. Clicks are as fast or faster (no network call); what you lose is Jev's judgment on vague descriptions, the fast path for unusual phrasings, and learning tasks for later. With a key, Handry switches to Jev by itself.

## Safety

- **Risky actions ask you first.** Sending, publishing, deleting, paying, buying, changing prices: a question card opens at the top of the screen, shown by a separate process (AppleScript's dialog if the card can't be built). It doesn't take the keyboard from the app you're in, and nothing on a web page or in an LLM reply can answer it: the answer is the button you click. If you say no, Handry stops and doesn't look for another way. Away from the Mac? If the dialog gets no answer for 20 seconds, the question comes to your phone as an iMessage with a 4-digit code: text back the code to approve, "hayır" to refuse. Only the bare code from your own number counts, and while the question is open the hands can't touch the screen, so nothing can type the code for you.
- **"Always on this site"** can be chosen for a button that keeps getting flagged, but never for money, orders, deleting, or anything that goes out to other people (send, publish, post, share, invite, submit for review).
- **Secrets stay in the Keychain.** Code types them into the field; the LLM never sees them and the logs never contain them. Each secret only works on the sites you allowed.
- **Page content is data, not instructions.** Text that tries to direct the assistant is hidden from the brain.
- **Everything is logged:** who (the app, the terminal, which Claude session), which tool, on what, the result, and whether you were asked (`~/.jevis/logs`).
- **Emergency stop:** ⌥Esc, the bar's stop button, or `node cli.js stop`. Every tool refuses to act for 10 minutes or until you resume.

## Requirements

- macOS 13 or later (developed on Apple silicon)
- Node.js 20 or later (developed on 26)
- Google Chrome
- Xcode Command Line Tools (`xcode-select --install`), for the Swift helper and the app
- [Claude Code](https://claude.com/claude-code) signed in with a Claude subscription (the default brain)
- Optional: a TypeSafe Jev API key (smarter element picking, risk checks and fast path; Handry works without one)
- Optional: [whisper.cpp](https://github.com/ggml-org/whisper.cpp) and a model for voice input

## Install

```bash
git clone https://github.com/purplefox21/handry.git
cd handry
npm install
echo "JEV_KEY=your-typesafe-key" > .env   # optional: without it Handry works without Jev

node cli.js doctor          # checks every part and says what is missing

node cli.js app build       # the menu bar app (bar, window, voice, the hand)
node cli.js app install
node cli.js app open

# Handry's tools in every Claude Code session:
claude mcp add --scope user handry -- node "$(pwd)/mcp/server.js"
```

On first launch the app opens a permissions window (menu › Permissions…): Accessibility, Screen Recording, Microphone, Speech Recognition and Automation. macOS asks for each once; you decide.

## Use it

- **Bar:** ⌥Space and type; ⌥⇧Space to talk; or say "Hey Handry". ⌥Esc stops everything.
- **Window:** the Dock icon, or `npm start` and http://localhost:4263. Chats, a Fast (Sonnet 5.5) / Strong (Opus 5.5) switch, timers, recipes, settings.
- **Terminal:**
  ```bash
  node cli.js do "play lo-fi on Spotify"
  node cli.js open appstoreconnect.apple.com
  node cli.js read
  node cli.js desk read --app=Notes
  node cli.js stop
  ```
- **Claude Code:** ask any session to use Handry; its tools show up as `mcp__handry__*`.
- **Your phone:** run `claude remote-control` in this folder and talk to that session from the Claude app.

## Numbers

Measured on my Mac:

| | |
|---|---|
| Jev picking an element on an App Store Connect–like page (60 elements, 9 commands) | 9/9 correct, 264–465 ms |
| Simple command on the fast path (no LLM) | 1–3 s |
| Browser: read a page / type / click (local test page) | ~0.3 s / ~0.3 s / ~0.8 s |
| Same form task, lean brain mode vs. full Claude Code mode | 2–6× cheaper |

## Tests

`tests/` has 32 end-to-end scripts that run against real Chrome, real Mac apps and the real Jev. Most use a throwaway Handry folder and their own Chrome profile, so your setup isn't touched; the comment at the top of each file says what it opens or changes. Most spend a few Jev calls, and `app-e2e` uses a little of your Claude subscription.

```bash
node tests/mcp-smoke.mjs              # the MCP server and a form, end to end (uses the Handry Chrome window)
node tests/desktop-e2e.mjs            # Calculator and TextEdit, incl. the "delete?" confirmation
node tests/site-permissions-e2e.mjs   # confirmations, "always on this site", new passwords, windows
node tests/jev-resilience-e2e.mjs     # Jev busy or offline: retries, then Claude takes over
node tests/nojev-e2e.mjs              # without Jev: fast-path rules on unseen commands, element picking, risk, page guard
node tests/remote-approve-e2e.mjs     # approving from the phone (stand-in Messages database, nothing is sent)
node tests/phone-e2e.mjs              # commands from the phone by iMessage, screenshots to the phone (nothing is sent)
node tests/spaces-e2e.mjs             # desktops (Spaces) on the real screen; puts everything back
node tests/overlay-e2e.mjs            # drawing on the screen: places checked against the accessibility tree and by pixels
node tests/vscode-claude-e2e.mjs      # Claude Code in VS Code: finding sessions, "done" reports (--live opens a real Claude tab)
```

## Status and limits

- Built as a personal tool and used every day. macOS only.
- English and Turkish. With English voices "Hey Handry" isn't always heard yet (tried with macOS's synthetic voices, not a real one); push-to-talk (⌥⇧Space) always works.
- Works without a TypeSafe Jev key (see "No Jev key?" above); with one, it is smarter. The same tests without Jev (`JEVIS_JEV=off`): fast path 75/75 known commands and 50/50 unseen ones (none of the "ask Claude" ones taken), hard forms 9/9, the App Store-like page 26/27 even with Turkish descriptions of English buttons (the one left is a real tie, so it asks instead of guessing).
- Approving and commanding from the phone need Full Disk Access for Handry.app (to read your messages to yourself from Messages); `node cli.js doctor` says whether they are on.
- Not yet tried for real: the login window with an actual Google sign-in, reading codes from the real Gmail inbox and Messages database, and approving, commanding and getting screenshots on the phone with real iMessages (all covered by tests with stand-ins).

## Project layout

```
core/      Jev client, tools, router (fast path), learning, recipes, chats, timers
hands/     Chrome, Mac apps (+ Swift accessibility helper), files, system shortcuts
guard/     confirmation, Keychain vault, page guard, log, emergency stop
brain/     adapters: Claude Code, Codex (experimental), Claude API, OpenAI-compatible APIs and Ollama
mcp/       the MCP server
app/       chat server, web UI, and the macOS app (Swift)
voice/     whisper.cpp speech-to-text, spoken answers
tests/     end-to-end tests and test pages
PLAN.md    the project log (Turkish): goals, decisions, phases, measurements
CLAUDE.md  notes for Claude when it works on this repo
```

## Support

Handry is free to use. If it helps you:

- ⭐ Star [the repo](https://github.com/purplefox21/handry): it helps other people find it.
- Share it and tag me (**@purplefox**): a post, a video of the hand walking around your screen, anything.
- Follow me on [LinkedIn](https://www.linkedin.com/in/berat-olekli/) and on GitHub ([purplefox21](https://github.com/purplefox21)).

## License

[PolyForm Shield 1.0.0](LICENSE.md). You can use Handry, change it and share it, also at work. You can't sell it or offer a product that competes with it (a copy, a fork, or a substitute, even a free one). Keep the `Required Notice` line, the [NOTICE](NOTICE) file and the copyright lines when you share it. For anything else, [ask me](https://github.com/purplefox21).

## Credits

Handry is made by **Berat Olekli** ([purplefox](https://github.com/purplefox21)): the idea, the design, the walking hand and Foxie, and the code. © 2026 Berat Olekli (purplefox). Copies and work based on Handry keep the [NOTICE](NOTICE) file and the copyright lines at the top of the source files.

Built with [Claude Code](https://claude.com/claude-code). Uses [TypeSafe Jev](https://typesafe.ai) for fast decisions and [Playwright](https://playwright.dev) to drive Chrome.
