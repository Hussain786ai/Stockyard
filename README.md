# STOCKYARD — Hardware Store Inventory Tracker

A mobile-first, offline-capable inventory tracking web app.
No server. No database. No login. Just open and use.

---

## Features
- Add items with name, stock count, and low-stock alert threshold
- Search 1000+ items instantly
- Tap any item to add or remove stock
- Low stock alerts panel + badge counter
- Activity log (last 20 actions)
- Export inventory to CSV
- Import inventory from CSV
- Dark / Light mode toggle
- Works fully offline (PWA — installable on phone)

---

## File Structure

```
stockyard/
├── index.html      ← Main HTML shell
├── style.css       ← All styles
├── app.js          ← All JS logic
├── sw.js           ← Service Worker (offline/PWA)
├── manifest.json   ← PWA manifest
├── icon-192.png    ← App icon (you provide)
├── icon-512.png    ← App icon (you provide)
└── README.md
```

---

## Deploy on GitHub Pages — Step by Step

### Step 1: Create a GitHub Account
Go to https://github.com and sign up (free).

### Step 2: Create a New Repository
1. Click the **+** icon → **New repository**
2. Name it: `stockyard` (or any name you want)
3. Set it to **Public**
4. Click **Create repository**

### Step 3: Upload Your Files
1. On your new repo page, click **Add file** → **Upload files**
2. Drag and drop ALL files:
   - `index.html`
   - `style.css`
   - `app.js`
   - `sw.js`
   - `manifest.json`
   - `icon-192.png` and `icon-512.png` (see below)
3. Click **Commit changes**

### Step 4: Enable GitHub Pages
1. Go to your repo → **Settings** tab
2. Scroll down to **Pages** in the left menu
3. Under **Source**, select: `Deploy from a branch`
4. Branch: `main`, Folder: `/ (root)`
5. Click **Save**

### Step 5: Get Your URL
After ~1 minute, your app will be live at:
```
https://YOUR-USERNAME.github.io/stockyard/
```

---

## Install as Mobile App (Android)

1. Open the URL in **Chrome**
2. Tap the **3-dot menu** (⋮) in the top right
3. Tap **"Add to Home screen"**
4. Tap **Add**

The app will appear on your home screen like a native app.

---

## Install as Mobile App (iPhone)

1. Open the URL in **Safari**
2. Tap the **Share button** (box with arrow)
3. Scroll down and tap **"Add to Home Screen"**
4. Tap **Add**

---

## App Icons (Required for PWA)

You need two PNG icon files:
- `icon-192.png` — 192×192 pixels
- `icon-512.png` — 512×512 pixels

**Quick option:** Use any free icon generator:
- https://realfavicongenerator.net
- https://favicon.io

Or just use a square PNG image you already have and rename it.

---

## CSV Import Format

If importing from Excel, save as CSV with these columns:
```
Name,Stock,Min Alert
Hammer,50,5
Nails,230,20
PVC Pipe,14,3
```

The first row (header) is skipped automatically.
Duplicate names are skipped automatically.

---

## Data Storage

All data is stored in your browser's **IndexedDB** — it stays saved when you close the browser.

⚠️ Clearing browser data / cache will delete your inventory. Use **Export CSV** regularly as backup.

---

## Offline Use

Once loaded, the app works completely offline thanks to the service worker.
Your data never leaves your device.
