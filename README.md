<p align="center">
  <img src="icons/icon128.png" alt="xtractr logo" width="96">
</p>

<h1 align="center">xtractr</h1>

<p align="center">Export X/Twitter followers and following lists to CSV or JSON. No API key needed.</p>

xtractr is a Chrome extension that intercepts Twitter's own GraphQL API calls to capture follower/following data as you browse. Everything runs locally in your browser — no external servers, no subscriptions, no API tokens required.

## Install

Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/xtractr-export-x-follower/cpcdhfphkmickbkiagmpilcllklfdonj) — one click and you're ready to go.

## Features

- **One-click capture** — Navigate to any profile's followers or following page and xtractr starts collecting automatically
- **Cursor-based pagination** — Click "Fetch All" to paginate through entire lists with built-in rate-limit handling
- **CSV & JSON export** — Download your data in either format with timestamped filenames
- **Advanced filtering** — Filter by keywords (with stemming), follower count range, verified status, and bio presence
- **Relevance scoring** — Each user gets a 0-100 relevance score based on keyword matches across bio, name, and handle
- **Industry presets** — Quick-filter chips for IT/Tech, Cybersecurity, Data/Analytics, and Design/UX
- **Follow queue** — Send filtered users to a review queue where you can open profiles and follow one at a time
- **List comparison** — Save multiple lists and compare them to find mutuals, non-followers, and users you don't follow back
- **Keyboard shortcuts** — `F`/`Enter` to follow, `S`/`→` to skip in the queue
- **Fully local** — All data stored in `chrome.storage.local`, no network calls beyond Twitter itself

## Usage

### Capture a list

1. Go to `x.com/<username>/followers` or `x.com/<username>/following`
2. Click the xtractr popup — it auto-detects the page and starts capturing visible users
3. Click **Fetch All** to paginate through the entire list
4. Export as **CSV** or **JSON**, or **Save List** for later comparison

### Filter before exporting

1. Click **Filter before export...** in the popup
2. Choose industry presets or type custom keywords
3. Set follower range, verified-only, or has-bio toggles
4. Adjust the relevance threshold slider
5. Export the filtered set or send to the follow queue

### Compare lists

1. Save at least two lists (e.g., one followers, one following)
2. Click **Compare Lists** in the popup footer (opens the options page)
3. Select the two lists from the dropdowns and click **Compare**
4. Browse results by tab: Don't Follow Back, You Don't Follow Back, Mutuals
5. Search within results or export them

### Follow queue

1. After filtering in the popup, click **Send to Follow Queue**
2. Review each user's profile card, bio, follower count, and relevance score
3. Click **Open Profile & Follow** (opens their X profile in a new tab) or **Skip**
4. Use keyboard shortcuts: `F`/`Enter` = follow, `S`/`→` = skip

## Privacy

xtractr does not collect, transmit, or store any data outside your browser. All captured data stays in Chrome's local storage on your machine. The extension only communicates with x.com/twitter.com — the same requests your browser already makes.

## Development

### Load unpacked (for contributors)

1. Clone this repo:
   ```bash
   git clone https://github.com/JongoDB/xtractr.git
   ```

2. Open Chrome and go to `chrome://extensions`

3. Enable **Developer mode** (toggle in the top-right corner)

4. Click **Load unpacked** and select the repo root (the folder containing `manifest.json`)

### Running tests

```bash
npm install
npx playwright install chromium
npx playwright test --reporter=list
```

Tests load the extension in a real Chromium instance (headed mode required — extensions don't work headless) and cover:
- Save List — persisting capture sessions to storage
- Follow Queue — rendering users, skip/follow navigation, done state
- Compare Lists — saved list display, comparison results, search, deletion

### Project structure

```
xtractr/
├── manifest.json              # Chrome MV3 extension manifest
├── src/
│   ├── background/            # Service worker + business logic
│   │   ├── service-worker.js  # Message router, GraphQL parser, scoring engine
│   │   ├── data-store.js      # chrome.storage.local CRUD
│   │   ├── session-manager.js # Session lifecycle
│   │   ├── deduplicator.js    # User deduplication
│   │   ├── exporter.js        # CSV/JSON export
│   │   └── comparator.js      # List comparison
│   ├── content/               # Content scripts (ISOLATED world)
│   │   ├── main.js            # Pagination orchestrator + floating panel
│   │   ├── page-detector.js   # URL pattern matching
│   │   ├── auto-scroll.js     # Auto-scroll controller
│   │   └── ui/                # Floating panel components
│   ├── injected/              # Content script (MAIN world)
│   │   └── interceptor.js     # Fetch/XHR interception + active paginator
│   ├── popup/                 # Extension popup (status, filtering, export)
│   ├── options/               # Options page (list comparison, settings)
│   ├── queue/                 # Follow queue page
│   └── shared/                # Shared constants and utilities
├── icons/                     # Extension icons (16, 48, 128px)
└── tests/                     # Playwright test suite
```

## License

MIT
