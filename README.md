# Cricket Scorecard Calculator

A responsive frontend cricket scorecard app for creating a match, adding players, scoring ball by ball, and viewing live batting, bowling, timeline, and match summary updates.

The app runs as a static website with no paid server required. Match data is saved locally with `localStorage`, and optional PIN sharing uses Firebase Firestore so multiple devices can view and edit the same scorecard live.

## Features

- Create T10, T20, ODI, Test, or custom-over matches
- Add up to 11 players per team
- Select striker, non-striker, and bowler
- Score runs, wides, no-balls, byes, leg byes, overthrows, wickets, and undo
- Popup run selection for extras
- New bowler required after every completed over
- Automatic totals, wickets, overs, run rate, target, and required run rate
- Batting and bowling scorecards
- Ball-by-ball timeline
- Match result after completion
- Local save and refresh recovery
- Optional shared live scorecard editing with a 4-digit PIN

## Files

- `index.html` - page markup
- `styles.css` - responsive dashboard styling
- `script.js` - scoring logic, localStorage, and Firestore sync

## Firebase Firestore Setup

The Firebase config is already added in `script.js`.

To enable online PIN sharing:

1. Open Firebase Console.
2. Select the `cric-scorecard-917c8` project.
3. Create or enable **Firestore Database**.
4. Start in test mode for quick testing, then tighten rules before sharing publicly.
5. Deploy the site and use **Create PIN** or **Join PIN** in the app.

For early testing only, Firestore rules can be permissive. Replace them with safer rules before public use.

## GitHub Pages Deployment

1. Push `index.html`, `styles.css`, `script.js`, and `README.md` to GitHub.
2. In GitHub, open **Settings** > **Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select the `main` branch and `/ (root)` folder.
5. Click **Save**.
6. Open the Pages URL GitHub shows after deployment.

## Netlify Deployment

1. Go to Netlify and choose **Add new site**.
2. Use **Deploy manually** for the quickest option.
3. Drag the project folder containing `index.html`, `styles.css`, and `script.js` into the upload area.
4. Netlify will publish the site and provide a free public URL.

For Git-based Netlify deploys, connect the GitHub repository, leave the build command blank, and set the publish directory to the repository root.
