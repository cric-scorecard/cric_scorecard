# Cricket Scorecard Calculator

A responsive cricket scorecard app for creating a match, adding players, scoring ball by ball, and viewing live scorecards.

The app saves progress on the user device with `localStorage`. It also supports shared live scorecard editing with a 4-digit PIN using Firebase Firestore.

## What It Does

- Create T10, T20, ODI, Test, or custom-over matches
- Add up to 11 players per team
- Select striker, non-striker, and bowler
- Score runs, wickets, wides, no-balls, byes, leg byes, and overthrows
- Use popups to choose extra runs
- Require a new bowler after each completed over
- Undo the last scoring action
- Calculate score, wickets, overs, run rate, target, and required run rate
- Show batting and bowling scorecards
- Show ball-by-ball timeline
- Save locally and continue after refresh
- Share and edit a live scorecard with a PIN

## Project Files

- `index.html` - app markup
- `styles.css` - styling and responsive layout
- `script.js` - scoring logic, local save, and live PIN sync
- `DEPLOYMENT.md` - hosting, Firebase Auth, and Firestore setup notes
- `firestore.rules` - Firestore security rules for PIN sharing

## Run Locally

Open `index.html` in a browser.

For Firebase module imports, a local server is more reliable:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.
