# Deployment

This app is a static frontend and uses GitHub Pages for hosting.

## GitHub Pages

1. Push these files to the repository root:
   - `index.html`
   - `styles.css`
   - `script.js`
   - `README.md`
   - `DEPLOYMENT.md`
2. In GitHub, open **Settings** > **Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select the `main` branch and `/ (root)` folder.
5. Click **Save**.
6. Open the Pages URL after deployment finishes.

## Firebase Firestore

Firestore is used for the 4-digit PIN live scorecard sharing with **multi-player collaborative editing**.

The Firebase config is already added in `script.js`.
Anonymous Firebase Auth is used to track which players are editing. The device that creates a PIN is the owner and can enable/disable editor mode. Other devices can join the PIN and edit together in real-time.

To enable sharing:

1. Open Firebase Console.
2. Select the `cric-scorecard-917c8` project.
3. Create or enable **Firestore Database**.
4. Enable **Authentication** > **Sign-in method** > **Anonymous**.
5. Copy the contents of `firestore.rules` into **Firestore Database** > **Rules** and publish them.
6. Deploy the site with GitHub Pages.
7. In the app, use **Create PIN** or **Join PIN**.

### Multi-Player Editing Features

- **Create PIN**: The creator becomes the match owner and can edit. Displays player list showing who's connected.
- **Join PIN**: Other players can join with the 4-digit PIN and will see the same live scorecard. All joined players can edit by default.
- **Connected Players**: Real-time display shows which players are actively connected (with owner/viewer status).
- **Live Sync**: Changes are synced every 2.5 seconds, so all players see updates in real-time.
- **Owner Controls**: The owner can lock editing (view-only mode for others) by enabling `editorsLocked` in the database.

The included rules allow:

- Reading `/matches/{pin}` when `{pin}` is exactly 4 digits
- Creating a match only when signed in anonymously
- Updating a match from any authenticated player in the `players` list (not locked)
- Creating/updating includes: `pin`, `ownerUid`, `updatedAt`, `state`, `players`, `editorsLocked`
- No listing all matches
- No deletes
