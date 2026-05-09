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

Firestore is used for the 4-digit PIN live scorecard sharing.

The Firebase config is already added in `script.js`.
Anonymous Firebase Auth is used so the device that creates a PIN is the only device allowed to edit that shared scorecard. Other devices can join the PIN in view-only mode.

To enable sharing:

1. Open Firebase Console.
2. Select the `cric-scorecard-917c8` project.
3. Create or enable **Firestore Database**.
4. Enable **Authentication** > **Sign-in method** > **Anonymous**.
5. Copy the contents of `firestore.rules` into **Firestore Database** > **Rules** and publish them.
6. Deploy the site with GitHub Pages.
7. In the app, use **Create PIN** or **Join PIN**.

The included rules allow:

- Reading `/matches/{pin}` when `{pin}` is exactly 4 digits
- Creating a match only when signed in anonymously
- Updating a match only from the anonymous user/device that created it
- No listing all matches
- No deletes
