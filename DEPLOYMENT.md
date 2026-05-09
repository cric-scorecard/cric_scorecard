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

To enable sharing:

1. Open Firebase Console.
2. Select the `cric-scorecard-917c8` project.
3. Create or enable **Firestore Database**.
4. Start in test mode only for early testing.
5. Deploy the site with GitHub Pages.
6. In the app, use **Create PIN** or **Join PIN**.

Before public use, tighten Firestore security rules so only the intended match documents can be read and written.
