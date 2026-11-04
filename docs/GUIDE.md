# Handry Guide

Handry is an assistant that uses your Mac for you. You type or say what you want; it opens apps, presses buttons, fills in forms and sorts files, and it asks first when something looks risky. You don't need to know how to code.

## Install

1. Download `Handry-1.0.0.dmg` and double-click it.
2. In the window that opens, **drag Handry to Applications**.
3. Open Handry from your Applications folder.
4. The **Permissions** window opens. First allow **Accessibility**, under "To get started". Screen Recording, Microphone and Speech Recognition are recommended, but you can skip them if you only plan to type.
5. If something is missing, the main window shows a card. Click **Install Claude**, then **Sign In**.

That's it. No Xcode, no Homebrew, no terminal.

To use it from the Claude app or Claude Code too, see [Use it from Claude](#use-it-from-claude-mcp).

> If macOS says the developer can't be verified: System Settings › Privacy & Security › **Open Anyway** at the bottom. This only appears on trial builds that Apple hasn't notarized.

### What do I need?

| | |
|---|---|
| Mac | macOS 13.5 or later; Apple silicon and Intel |
| Google Chrome | For web tasks. Handry tells you if it's missing |
| A Claude subscription | For tasks that need thinking, like filling in forms. Simple commands work without it |
| A Jev key | Optional. Makes button picking and quick commands smarter |

## The first five minutes

| Shortcut | What it does |
|---|---|
| `⌥ Space` | Opens the bar from the notch so you can type. Clicking the island on the notch opens it too |
| `⌥ ⇧ Space` | Hold, talk, let go |
| "Hey Handry" | Wakes it by voice (turn it on or off in the menu) |
| `⌥ Esc` | **Emergency stop.** Stops everything. Handry does nothing until you give a new command, for 10 minutes at most |
| Dock icon | Opens the main window: chats, timers, recipes, settings |

Try typing these in the bar:

- `set the volume to 30 percent`
- `play lo-fi on Spotify`
- `work out 12 times 7 in Calculator`
- `open Hacker News and sum up the top 5 headlines`

## How does Handry work?

- **Simple things at once:** Volume, music, opening apps and the like run in 1-3 seconds without going to a big AI model.
- **Bigger tasks with Claude:** Claude plans the steps, Handry clicks and types.
- **It reads instead of looking:** It mostly reads buttons from the app's or page's own list, not from screenshots. Screenshots are the fallback.
- **It learns:** Once Claude has done a task, Handry can repeat it with new details without Claude.

The button in the main window picks the model: **Fast** is enough for most things, **Strong** is for harder ones.

## Quick commands

These work without Claude.

| Area | Examples |
|---|---|
| Volume | `turn it down`, `set the volume to 40 percent`, `mute` |
| Music | `play Tarkan on Spotify`, `pause the music`, `next song`, `what's playing` |
| Apps | `open Notes`, `quit Safari` |
| Sites and search | `open YouTube`, `search Google for Mac shortcuts` |
| Notes | `note: buy milk` |
| Calendar | `what's on my calendar today` |
| System | `turn on dark mode`, `lock the screen` |

Tasks that need a date and time, like `remind me tomorrow at 10: meeting` or `add a call on Friday at 3`, go to Claude.

## Getting work done on the web

Handry uses its own Chrome window. You sign in to a site once by hand and the login stays.

- **Filling in forms:** `fill in this form with: …`
- **Reading:** `sum up this page`, `list the prices in this table`
- **Downloads and uploads:** `download the invoice and put it in my Projects folder`, `upload this file to the form`
- **Waiting:** `continue when this text appears`
- **Checking logins first:** `check that I'm signed in to App Store Connect and Firebase`: before starting, it tells you which sites you need to sign in to.
- **Tabs and windows:** `open this in a separate window`, `list the open tabs`
- **Saving a value:** `save this API key to the Keychain`: it saves a key or ID shown on the page directly.
- **Human-like use:** If a site notices automation, the mouse moves slowly along a curve and text is typed letter by letter. It is off by default because it is slower. You can also turn it on with `use this site like a human`.
- **Site notes:** When a hidden setting turns up on a site, a note is left, and it comes back when you return to that site.

Buttons it sees as risky, like save, send, publish, delete or pay, get a question first.

### App Store Connect

This is the job Handry was started for: pricing, the age rating questionnaire, the privacy questionnaire, descriptions and screenshots. Say `fill in my app's App Store details`; it asks for what's missing and works through section by section. It presses **Submit for Review** only when you explicitly ask.

## Using Mac apps

In Spotify, Slack, VS Code, Notes, Finder and most other apps it uses buttons and menus by name.

- `open a new document in TextEdit and write: …`
- `find the "shopping" note in Notes`
- `open my liked songs in Spotify`
- `play my jazz playlist in Music`
- `list my reminders`

In apps that draw everything themselves, such as games, it looks at a screenshot.

## Windows and desktops

- `put Safari on the left and Notes on the right`
- `make this window full size`, `center it`, `minimize it`, `bring it back`
- `put Safari, Notes and Slack side by side`: three or more windows are laid out in a grid
- `go to the desktop on the right`, `go to desktop 3`
- `go to the window of this project`: it finds it even on another desktop or display

## Files

- `find the last PDF in Downloads`, `what's in this folder`
- `move these files to a folder called Invoices`
- `which files did I change last`, `open this file`
- `copy this file to Backups`, `rename it Invoice 2026`
- `move this file to the Trash`, `undo that`

The rules protect you: nothing is deleted for good (it goes to the Trash), nothing is overwritten, it works only in your home folder, it stays out of system and hidden folders, and bigger changes ask first. **Activity** in the main window also has an **Undo the last file change** button.

## Ask "where?" and it shows you

For questions like `where is the dark mode setting` or `how do I log out of this site`, it draws on your screen without clicking anything: an arrow, a circle, an underline, a box and a short label. Several steps come one after another. The drawing goes as soon as you click or type. While a risky step waits for your OK, the button it is about is circled too.

## Timers and watches

They keep running after the chat is over; Handry checks by itself.

- `remind me in 10 minutes to turn off the oven`
- `lock the screen at 3 pm`
- `tell me when "done" shows up in that window`
- `shut down the Mac when the Claude tasks are done`: it counts down first, and you can cancel

They are all in the ⏰ list in the main window and in the menu bar, where you can cancel them.

## Recipes and learning

- **Learning by itself:** After Claude does a task, Handry tries to do it without Claude next time, with new details.
- **Recipes:** Save a task and repeat it with one click. It can hold variables: `set the App Store price to {price}`.
- **Saving:** When Claude finishes a task, a **Save as a recipe** button appears in the chat.
- Recipes are in a panel in the main window. They don't use Claude; if a step gets stuck, Claude picks up where it stopped.

## Chats

Each chat has its own Claude session, so it follows things like `this one` or `try again`. The bar, your voice and the main window all write to the same chat.

- When the topic changes, say `new chat` or click **New chat** in the main window. After 2 quiet hours a new one starts by itself.
- Older chats are in the **Chats** list in the main window.

## The hand and the island

- **Hand:** A small hand walking on its fingers moves along the Dock and the tops of your windows and shows what Handry is doing. From the menu you can hide it, put it to sleep, change its size, or pick the fox instead.
- **Island:** It sits at the top of the screen beside the notch. It opens out to both sides while working, and a click opens the bar. In the menu you choose whether it always shows, shows only while working, or never shows.

## Logins and passwords

- **Passwords stay in the Keychain:** Handry's code types a saved password into the field; it isn't sent to the AI. Each password only works on the sites you allow.
- **New accounts:** When you sign up, Handry makes a strong password, types it and saves it to the Keychain.
- **Two-step codes:** Authenticator (TOTP) codes come from the Keychain. Codes sent by SMS or to Gmail are read after asking you each time.
- **Sites that refuse automation (like Google):** Handry opens Chrome with nothing attached, you sign in by hand, and the login stays. When a login or a check is needed it calls you with a sound, a notification and the bar, sends an iMessage after a minute, and waits.
- **Saving a password:** This needs the terminal for now. The command below asks for the password twice and doesn't show it. Then say `sign in to GitHub with the github password`. An authenticator key is saved with the same command (under a name like `github-2fa`). You don't have to save passwords: you can also sign in to sites by hand, and the login stays.

```bash
/Applications/Handry.app/Contents/Helpers/node /Applications/Handry.app/Contents/Resources/handry/cli.js secret add github --site=github.com
```

> Reading SMS and Gmail codes has only been tried in a test setup so far. Check the result the first time you use it.

## From your phone (experimental)

This needs Full Disk Access and iMessage. It hasn't been tried much on real phones yet.

- **Commands:** Text yourself `Handry, turn the volume down` by iMessage; it does it and texts back. `Handry, show the screen` sends a screenshot.
- **Approvals:** If a question on the Mac gets no answer for 20 seconds, a message with a code comes to your phone. Reply with the code to approve, or "no" to cancel.
- **Sending to your phone:** At the Mac, say `send the screen to my phone` and a screenshot comes to your own address. It is never sent to anyone else.
- Only your own conversation counts, and only new messages that start with the name.

## Use it from Claude (MCP)

Handry's bar already uses Claude, and you don't need to connect anything for that. This section is for the other direction: Claude using Handry's hands while you chat in the Claude app or Claude Code. MCP is the name of the way tools connect to Claude.

Once connected, you can tell Claude `use Handry to set the volume to 30 percent` or `use Handry to fill in this form`. The question cards, `⌥ Esc` and the Activity log work the same. Keep Handry open for drawing on the screen, the island and the hand.

### The Claude app

1. In the menu bar at the very top of the screen, choose **Claude › Settings… › Developer › Edit Config** (not the settings inside the Claude window).
2. Open the `claude_desktop_config.json` file in TextEdit.
3. If the file is empty or only holds `{}`, paste the text below. If it holds other settings, keep them: add the `"handry"` part inside `mcpServers`, and add `mcpServers` if it isn't there.
4. Save, quit Claude with **⌘ Q** and open it again.
5. In **System Settings › Privacy & Security › Accessibility**, turn on **Claude**. If it will use screenshots too, turn it on under **Screen Recording** as well.

```json
{
  "mcpServers": {
    "handry": {
      "command": "/Applications/Handry.app/Contents/Helpers/node",
      "args": ["/Applications/Handry.app/Contents/Resources/handry/mcp/server.js"]
    }
  }
}
```

To see that it connected, look in the message box under **+** › **Connectors › Manage connectors**; `handry` should be listed.

> Why does Claude need its own permission? macOS asks about the app that starts Handry's tools. Claude starts them here, so the permission you gave Handry doesn't count.

### Claude Code

Run these in the terminal. The second one should say `✔ Connected`. Handry is then on in all your projects.

```bash
claude mcp add --scope user handry -- /Applications/Handry.app/Contents/Helpers/node /Applications/Handry.app/Contents/Resources/handry/mcp/server.js
claude mcp get handry
```

Give the Accessibility permission to the app you run Claude Code in: Terminal or Visual Studio Code.

If Handry isn't in `/Applications` (it may be in the Applications folder in your home folder), change the paths to match, in both methods.

## Safety: what Handry won't do

- **It asks when a step looks risky.** For sending, publishing, deleting, paying or changing prices, a card opens at the top of the screen. If you say no, it stops and doesn't look for another way. Only your click answers the card, and Handry's hands don't touch the screen while it is open.
- **"Always on this site":** You can choose this for a button that keeps being flagged. Money, orders, deleting and anything that goes out to other people (send, publish, share, invite) are never remembered.
- **AI or rules judge the risk,** so they can miss something. Watch the screen on important tasks; `⌥ Esc` always stops it.
- **Text on a page isn't a command.** Text on a site that tries to direct the assistant is hidden.
- **Everything is logged:** who did what, the result, and whether you were asked. See it under **Activity** in the main window. Passwords never go in the log.

## Settings

| Where | What |
|---|---|
| Menu › Permissions | All macOS permissions in one window |
| Menu › Start at Login | Handry starts when your Mac starts |
| Menu › Dil / Language | Turkish, English or your Mac's language |
| Menu › Hand on Screen | Show, hide, sleep, size; hand or fox |
| Menu › Island at the Notch | Always, only while working, or never |
| Menu › Guide | This page |
| Menu › Open in Browser | Opens the main window in your browser |
| Settings › Model | Fast or Strong |
| Settings › Thinking | How much Claude thinks at each step; High is recommended |
| Settings › Fast path | Does simple commands without asking Claude; can be turned off |
| Settings › Spoken answers | Reads a short summary of the answer aloud |
| Settings › Advanced › Brain | Picks another brain instead of Claude Code, if you set one up |
| Settings › Status | Whether Jev, Claude, Chrome and whisper are ready |

## Troubleshooting

### System Settings shows a permission on, but Handry says it isn't allowed

- **If the row says "Restart",** click it. macOS applies some permissions (Screen Recording above all) only when the app reopens.
- **If the row says "Reset Entry",** click it. The entry in System Settings belongs to an old copy of Handry. Reset it, then allow it again.
- If neither shows, quit Handry, open it again and click **Allow**.

### The app froze, or a row says "Waiting for an answer"

If a permission row says "Waiting for an answer…", that app (Spotify, for example) isn't responding right now. Handry keeps waiting and you can keep using it. Quitting and reopening that app usually fixes it.

If it really freezes: quit Handry with `⌘ ⌥ Esc` and open it again. If that doesn't help, tell us on GitHub what happened.

### "The server didn't start"

Click **Restart Server** in the menu. The log is at `~/.jevis/logs/app-server.log`.

### It doesn't hear "Hey Handry"

Check the Microphone and Speech Recognition permissions; every voice command needs both. With those in place, "Hey Fox" is more reliable, and push-to-talk with `⌥ ⇧ Space` needs no wake word.

### Status says "Speech recognition (whisper): not installed"

That's fine. Voice commands work with Apple's recognizer. whisper is optional and hears names like Handry better. The mic button in the main window only shows when whisper is installed; `⌥ ⇧ Space` works either way.

### Claude won't connect

Follow **Install Claude** and **Sign In** on the card in the main window. Signing in needs a Claude subscription. Simple commands work until then.

### Handry doesn't show up in the Claude app or Claude Code

- Quit Claude completely with **⌘ Q** and open it again.
- The settings file may be missing a comma or a quote. Check that the paths match where Handry is.
- This log says what happened: `~/Library/Logs/Claude/mcp-server-handry.log`. In Claude Code, run `claude mcp get handry`.
- If it says there's no Accessibility permission, give it to Claude, Terminal or Visual Studio Code, not to Handry.

### Handry did something wrong

Press `⌥ Esc` to stop it. File changes can be taken back with `undo that`. The Activity list shows what happened.

## Common questions

**Does it cost money?** Handry is free. Bigger tasks need a Claude subscription.

**Where does my data go?** Logs, settings and what it learned stay on your Mac in `~/.jevis`. For bigger tasks the request and what it reads from pages go to Claude. If you use a Jev key, page details also go to Jev for picking buttons.

**What is Jev?** A small model that decides quickly: which of these 300 buttons is "Save", is this click risky? Without a key Handry makes the same calls with words and rules, and asks a little more often.

**Where do I put a Jev key?** Save the key you got from [TypeSafe](https://typesafe.ai) in the terminal with `echo "JEV_KEY=your-key" >> ~/.jevis/.env`, then click **Restart Server** in the menu.

**Can I sell it?** You can use it and tinker with it, but not sell it. License: PolyForm Shield 1.0.0.

**Does it run on Windows?** No, Mac only.

## For developers

### Installing from source

You need Node.js 20+, Google Chrome and the Xcode Command Line Tools.

```bash
git clone https://github.com/purplefox21/handry.git
cd handry
npm install
node cli.js doctor
node cli.js app install
node cli.js app open
```

Without an Apple certificate, macOS treats each new build of a source copy as a new app and asks for its permissions again. Don't rebuild it needlessly.

To connect a source copy to Claude Code (for the downloaded app, see [Use it from Claude](#use-it-from-claude-mcp)):

```bash
claude mcp add --scope user handry -- node "$(pwd)/mcp/server.js"
```

Optional whisper, to hear names better in voice commands: `brew install whisper-cpp` and a model. `node cli.js doctor` says what is missing.

### Giving Claude Code work

- `have Claude run the tests in jev`: Handry opens a visible Claude tab in that project's VS Code window and starts the task. Nothing runs hidden in the background.
- `write "go on" to the Claude session in jev`: It writes to an open session.
- `what did we do in jev`: It sums up recent work and Claude sessions.
- When a session finishes or waits for an answer, it tells you on the bar and by iMessage.
- The first time, VS Code asks whether the Claude extension may open a link. That's your call: Handry circles the **Open** button and waits, and takes its request back after 2 minutes without an answer.

### Claude Code from your phone

Run `claude remote-control` in this folder and talk to that session from the Claude app. The session uses Handry's tools.

### Terminal

```bash
node cli.js do "play lo-fi on Spotify"
node cli.js read
node cli.js desk read --app=Notes
node cli.js stop
node cli.js secret add github --site=github.com
node cli.js doctor
node cli.js app package
node appstore/privacy-scan.js <code-folder>   # a draft for the App Store privacy questionnaire
```

The brain can be swapped: Claude Code, Codex, the Claude API, OpenAI-compatible APIs, Ollama.

---

Handry · Berat Olekli ([purplefox](https://github.com/purplefox21)) · [GitHub](https://github.com/purplefox21/handry) · [LinkedIn](https://www.linkedin.com/in/berat-olekli/)
