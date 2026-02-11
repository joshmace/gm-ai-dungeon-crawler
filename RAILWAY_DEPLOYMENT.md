# Deploy GM-AI to Railway — Step-by-Step Guide

This guide walks you through deploying the AI Dungeon Crawler to Railway so others can test it online.

---

## Part 1: Prepare Your Project (Do This First)

### Step 1.1: Save Your API Key Somewhere Safe

Your Anthropic API key was previously in `server.js`. You'll need it for Railway.

1. Open [Anthropic Console](https://console.anthropic.com/) and copy your API key if you don't have it.
2. Store it in a secure place (e.g., password manager). You'll paste it into Railway in Part 3.

---

## Part 2: Push Your Code to GitHub

### Step 2.1: Initialize Git (if not already done)

Open Terminal (or your terminal app) and navigate to your project folder:

```bash
cd /Users/joshmace/Dev/GM-AI
```

Check if git is already set up:

```bash
git status
```

- If you see "not a git repository": run `git init`
- If you see file listings: Git is already initialized

### Step 2.2: Create a GitHub Repository

1. Go to [github.com](https://github.com) and log in.
2. Click the **+** in the top-right → **New repository**.
3. Name it something like `gm-ai-dungeon-crawler` (or any name you like).
4. Choose **Public**.
5. **Do not** check "Add a README" or other options — leave it empty.
6. Click **Create repository**.

### Step 2.3: Push Your Code to GitHub

GitHub will show you commands. Use these (replace `YOUR_USERNAME` and `YOUR_REPO_NAME` with your actual GitHub username and repo name):

```bash
cd /Users/joshmace/Dev/GM-AI

# Add all files
git add .

# Commit
git commit -m "Initial commit - ready for Railway deployment"

# Add GitHub as remote (replace with your repo URL)
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git

# Push
git branch -M main
git push -u origin main
```

If Git asks for credentials, use a **Personal Access Token** instead of your password:

1. GitHub → Settings → Developer settings → Personal access tokens.
2. Create a token with `repo` scope.
3. Use the token as the password when Git prompts.

---

## Part 3: Deploy on Railway

### Step 3.1: Sign Up / Log In

1. Go to [railway.app](https://railway.app).
2. Click **Login**.
3. Choose **Login with GitHub** and authorize Railway.

### Step 3.2: Create a New Project

1. Click **New Project**.
2. Select **Deploy from GitHub repo**.
3. Choose your `gm-ai-dungeon-crawler` (or whatever you named it) repository.
4. Click **Deploy Now**.

Railway will detect that it's a Node.js app using `package.json`.

### Step 3.3: Add Your API Key

1. In your Railway project, click your service (the deployment).
2. Go to the **Variables** tab.
3. Click **+ New Variable**.
4. Add:
   - **Variable:** `ANTHROPIC_API_KEY`
   - **Value:** Your Anthropic API key (paste it).
5. Click **Add**.

Railway will redeploy automatically once the variable is saved.

### Step 3.4: Generate a Public URL

1. Click the **Settings** tab.
2. Find **Networking** → **Public Networking**.
3. Click **Generate Domain**.
4. Railway will assign a URL like `gm-ai-dungeon-crawler-production.up.railway.app`.

### Step 3.5: Share the Link

Copy the generated URL and share it with your testers. They can open it in a browser and play.

---

## Part 4: Verify It Works

1. Open the Railway URL in your browser.
2. You should see the game load.
3. Try typing an action and pressing Enter — the AI should respond.

If something fails:

- Check the **Deployments** tab for build/run errors.
- Confirm `ANTHROPIC_API_KEY` is set under **Variables**.
- Look at the **Logs** tab for runtime errors.

---

## Part 5: Updating the App Later

When you change the code:

```bash
cd /Users/joshmace/Dev/GM-AI
git add .
git commit -m "Description of your changes"
git push
```

Railway will detect the push and redeploy automatically.

---

## Summary Checklist

- [ ] API key saved somewhere safe
- [ ] Git initialized and code pushed to GitHub
- [ ] Railway project created from GitHub repo
- [ ] `ANTHROPIC_API_KEY` variable added in Railway
- [ ] Public domain generated
- [ ] Tested the live URL

---

## Troubleshooting

**"Application failed to respond"**  
- Check the **Logs** tab in Railway for errors.
- Ensure `ANTHROPIC_API_KEY` is set correctly.

**"API error" or no AI response**  
- Verify your Anthropic API key is valid and has credits.
- Check Railway logs for API-related errors.

**Build fails**  
- Ensure `package.json` exists in the repo.
- Confirm `main` is `server.js` in `package.json`.
