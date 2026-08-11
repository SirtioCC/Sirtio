# Getting PredictWatch running on your PC — step by step

This assumes Windows, since you said "PC." If you're actually on a
Mac, the differences are called out where they matter.

## Part 1: Install the tools you need (one-time)

**Step 1: Install Python.**
1. Go to https://www.python.org/downloads/
2. Click the big yellow "Download Python" button (get 3.11 or newer).
3. Run the installer. **Important:** on the first install screen,
   check the box at the bottom that says "Add python.exe to PATH"
   before clicking Install. This is the step people most often miss.
4. When it finishes, open Command Prompt (press the Windows key,
   type `cmd`, hit Enter) and type:
   ```
   python --version
   ```
   You should see something like `Python 3.12.x`. If you get an
   error instead, restart your computer and try again — the PATH
   change needs a restart to take effect sometimes.

**Step 2: Install Git.**
1. Go to https://git-scm.com/downloads
2. Download and run the Windows installer.
3. You can click "Next" through every screen accepting the defaults
   — nothing needs to be changed.
4. Confirm it worked: open Command Prompt and type:
   ```
   git --version
   ```
   You should see a version number.

**Step 3: Create a GitHub account (if you don't have one).**
1. Go to https://github.com and sign up. Free.

**Step 4: Create a Supabase account and project.**
1. Go to https://supabase.com and sign up (you can use your GitHub
   account to sign in, which is easiest).
2. Click "New Project."
3. Give it a name (e.g. "predictwatch"), set a database password
   (write this down somewhere safe — you'll need it), and pick a
   region close to you.
4. Wait 1-2 minutes for it to finish setting up.
5. Once it's ready, click on **Project Settings** (gear icon,
   bottom left) → **Database**.
6. Look for **Connection string** and select the **Transaction
   pooler** option (not "Session" or "Direct connection"). Copy that
   whole string — it looks like:
   ```
   postgresql://postgres.xxxxxxxxxxxx:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
   ```
7. Replace `[YOUR-PASSWORD]` in that string with the actual database
   password you set in step 3. Save this final string somewhere —
   you'll paste it in twice, in Part 2 and Part 3.

## Part 2: Get the code running locally

**Step 5: Unzip the project.**
1. Extract `predictwatch-starter.tar.gz` (right-click → Extract, or
   use 7-Zip if Windows doesn't open `.tar.gz` natively) to somewhere
   easy to find, like `C:\Users\YourName\predictwatch`.

**Step 6: Open Command Prompt in that folder.**
1. Open the extracted `predictwatch` folder in File Explorer.
2. Click in the address bar at the top, type `cmd`, and press Enter.
   This opens Command Prompt already pointed at that folder.

**Step 7: Turn it into a proper git repo.**
```
git init
git add .
git commit -m "Initial commit"
```

**Step 8: Set up a Python virtual environment.**
This keeps this project's Python packages separate from anything
else on your computer — good practice, avoids version conflicts.
```
cd pipeline
python -m venv venv
venv\Scripts\activate
```
(Mac/Linux equivalent: `source venv/bin/activate`)

You'll know it worked because your Command Prompt line will now
start with `(venv)`.

**Step 9: Install the Python packages.**
```
pip install -r requirements.txt
```

**Step 10: Set your database connection for this session.**
```
set DATABASE_URL=postgresql://postgres.xxxx:yourpassword@aws-0-...pooler.supabase.com:6543/postgres
```
(Mac/Linux equivalent: `export DATABASE_URL="..."`)

Paste in your actual connection string from Step 4. Note: this only
lasts for the current Command Prompt window — you'll need to run
this `set` command again next time you open a new window to test
things locally.

**Step 11: Test each piece individually before running the whole thing.**
This matters — some of these endpoints haven't been tested against
live data from my end, so confirm each works before trusting the
combined pipeline.
```
python fetch_kalshi.py
python fetch_polymarket.py
python fetch_polymarket_leaderboard.py
python fetch_polymarket_positions.py
```
Each should print real market/trader data to the screen. If any of
them errors out, that's useful — send me the error and I'll fix it.

**Step 12: Run the full pipeline.**
```
python run_pipeline.py
```
This fetches everything and writes it into Supabase. You should see
print statements confirming rows saved for each data source.

**Step 13: Confirm the data actually landed in Supabase.**
1. Go back to your Supabase project in the browser.
2. Click **Table Editor** in the left sidebar.
3. You should see `market_snapshots`, `trader_leaderboard_snapshots`,
   and `trader_positions_snapshots` listed, each with rows in them.

## Part 3: Automate it for free with GitHub Actions

**Step 14: Create a GitHub repository.**
1. Go to https://github.com/new
2. Name it (e.g. `predictwatch`), leave it **Public** (this keeps
   GitHub Actions free), don't check any of the initialize options,
   click **Create repository**.
3. GitHub will show you a page with commands — ignore those, use the
   ones below instead since your folder is already a git repo.

**Step 15: Push your code to GitHub.**
Back in your Command Prompt, in the main `predictwatch` folder
(not the `pipeline` subfolder — `cd ..` if you're still in there):
```
git remote add origin https://github.com/YOUR-USERNAME/predictwatch.git
git branch -M main
git push -u origin main
```
Replace `YOUR-USERNAME` with your actual GitHub username. It'll ask
you to sign in the first time — follow the prompts.

**Step 16: Add your database connection as a GitHub secret.**
1. On your new repo's GitHub page, click **Settings** (top right of
   the repo, not your account settings).
2. In the left sidebar: **Secrets and variables** → **Actions**.
3. Click **New repository secret**.
4. Name: `DATABASE_URL`
5. Value: paste your full Supabase connection string (same one from
   Step 4/10).
6. Click **Add secret**.

**Step 17: Confirm the automation works.**
1. On your repo's GitHub page, click the **Actions** tab.
2. You should see "Fetch market data" listed as a workflow.
3. Click on it, then click **Run workflow** (this lets you trigger it
   manually instead of waiting for the schedule) → **Run workflow**.
4. Refresh after a minute — you should see a run appear with a green
   checkmark if it succeeded. Click into it to see the same print
   statements you saw locally.
5. If it succeeded, you're done — it'll now run automatically every
   4 hours forever, for free, with no computer of yours needing to
   be on.

## If something breaks

Paste me the exact error text and which step you were on — that's
enough for me to fix it. Don't worry about diagnosing it yourself
first.
