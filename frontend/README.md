# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

## Direct Google Sign-In setup

Direct Google Sign-In is enabled per platform only after its client configuration is supplied. Until then, the existing Emergent flow remains available, so adding credentials can be tested before removing that fallback.

1. In the Google Cloud Console, configure the OAuth consent screen with the Hostel360 name, logo, support email, homepage, privacy policy, and terms. Verify the app's public domains in Search Console and complete Google's brand verification if its consent-screen requirements apply.
2. Create OAuth clients in the same Google Cloud project:
   - **Web application:** Add the exact HTTPS origins where the web app is hosted under Authorized JavaScript origins. For local development, add the exact local origin/port used by Expo Web. The current Google Identity Services credential flow uses an ID-token callback; it does not use a guessed OAuth redirect URI.
   - **Android:** Use the Android package identifier from `app.json` and add the SHA-1 fingerprints for every build signing key used (development, release, and Play App Signing as applicable). This client ID is configured in Google Cloud; the app uses the Web client ID as its server client ID.
   - **iOS:** Use the iOS bundle identifier from `app.json`. Save both the iOS client ID and the exact reversed client ID shown by Google; the latter is the iOS URL scheme required by the Expo config plugin.
3. Copy `frontend/.env.example` to `frontend/.env` and set the Web, Android, and iOS client IDs plus the exact iOS URL scheme. For this workspace's current Expo Web origin, register `http://localhost:8081` if that is the origin actually serving your development build; register the actual production origins as HTTPS origins. The Android ID is also set in app configuration as the explicit per-platform readiness gate. These client IDs and URL scheme are public app configuration, not secrets.
4. Set backend `GOOGLE_OAUTH_CLIENT_IDS` in `backend/.env` to the comma-separated Web, Android, and iOS OAuth client IDs. Never configure a client secret in the frontend. Restart the backend and Expo. For iOS, the plugin change requires a native development/production rebuild; this native Google SDK is not available in Expo Go.
5. Keep `EXPO_PUBLIC_GOOGLE_DIRECT_SIGNIN_ENABLED=false` while entering and checking the configuration. Turn it to `true` only in a staging/test build after the server allowlist is configured. Verify new Google tenant signup, existing Google-account migration, password-account linking, role preservation, and logout on web and native builds before considering removal of the Emergent fallback.

The backend verifies the Google ID-token signature, issuer, expiry, audience, subject, and verified email. A password account is not silently merged by email: the user must first sign in with that password, after which the same verified Google email can be linked. A newly created Google account receives the existing default tenant role; client-submitted roles are ignored. with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
