# From this zip to a submitted entry

## What you need on your computer

- Windows 10 or 11 (macOS also works).
- Node.js 20 or newer, Git, and Google Chrome.
- Claude Code installed and signed in.
- A microphone, ideally a headset.

## 1. Create the project

1. Unzip this kit into a new folder, for example `Documents\baton`.
2. On GitHub, create a new public repository called `baton`. Leave it empty.
3. Open a terminal in the folder and run:
   ```
   git init
   git add .
   git commit -m "Starter kit: spec, plan, film script"
   git branch -M main
   git remote add origin https://github.com/gloria2807/baton.git
   git push -u origin main
   ```

## 2. Put in your key

Baton needs only one key: your Baseten key from the hackathon email.

1. Copy `.env.example` to a new file called `.env` in the same folder.
2. Paste your key after `BASETEN_API_KEY=`.
3. Save. The `.env` file is ignored by Git, so it never goes to GitHub.

There is no Supabase and no database. The desktop app runs on your computer and talks to Muse Spark Open on Baseten. The only hosted part is Baton Live (Stage 7), the no-install version for judges, which needs a free Vercel account. When Claude Code reaches Stage 7 it will ask you to add `BASETEN_API_KEY` as an environment variable in the Vercel project settings, so the key stays on the server.

## 3. Start the build

1. In the terminal, in the project folder, type `claude` and press Enter.
2. Open `docs/BUILD_PLAN.md`, copy the master prompt and paste it into Claude Code.
3. Stay nearby. Claude Code will ask you to approve commands, and some gates need you to do something by hand. Expect these moments:
   - **Loading the extension** (Stage 1). In Chrome, go to `chrome://extensions`, turn on Developer mode, click "Load unpacked" and choose `apps/extension/dist`. Then open the extension's options and paste the pairing token the Baton app shows you.
   - **Allowing the debugger.** Chrome shows a bar saying an extension is debugging the browser. That is expected; it is how Baton's hands work.
   - **Microphone permission** the first time you hold the talk key.
   - **Watching lanes** and telling Claude Code whether what you saw matched the gate.
   - **Signing in** to any real sites you want lanes to use, in your normal Chrome.
4. At each gate, read the results. If something says it passed but you saw it fail, say so.

If the run stops, start it again with: "Continue the build from the first stage whose gate has not passed."

## 4. When the build is finished

1. **Try it with real people.** Ask three to five people who live in their browser for work to try it for ten minutes. Note what confuses them and have Claude Code fix it. Record one sentence from someone, with permission.
2. **Rehearse the film.** Run `npm run demo:reset` and perform `docs/DEMO_SCRIPT.md` from start to finish several times.
3. **Shoot it.** Screen at 1920×1080, plus a few phone shots of Ama.
4. **Motion graphics.** Ask Claude Code to build them with Remotion using the prompt in `docs/DEMO_SCRIPT.md`.
5. **Edit** to three minutes or less, with captions. Upload to YouTube as unlisted.

## 5. Submit

Check every rule before you press submit:

- [ ] Repository is public, and every commit is dated within the building period.
- [ ] The README has a "Built during the hackathon" section, and the film ends with the same statement. The rules disqualify entries whose new work isn't clearly identifiable.
- [ ] Baton Live opens in a private window and works without installing anything.
- [ ] The video is three minutes or less and shows only work built during the hackathon.
- [ ] Muse Spark Open is named in the video and README, served through Baseten. This makes the entry eligible for Best Build on Meta Open Weight Models.
- [ ] Your submission is entered in the Startup track. Check on the Cerebral Valley submission page whether the Startup track asks for company details, such as a company name or website, and fill them in.

Then:

1. Make sure the README has install steps, the architecture and the "Built during the hackathon" section.
2. Submit on the Cerebral Valley platform with the repository link and the video link. Open both in a private browser window to check they work.
3. Submit before **3:00 AM Thursday November 5, Lagos time** (9:00 PM Eastern on November 4). Aim to finish hours earlier.
4. Post the film on X and submit that link too, for the Most Viral prize.
