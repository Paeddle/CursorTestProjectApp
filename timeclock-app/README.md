# Time Clock

Personal clock-in / clock-out page. Punches are saved on the device first, then synced to Supabase when the phone has a connection.

This app is hosted at its own path and is **not** linked from the home login page.

```
https://shswebapp.site/timeclock/
```

## One-time database setup

Run `supabase/add-time-punches.sql` in the Supabase SQL Editor.

If the table already exists, also run `supabase/add-time-punches-job.sql` so job names and holiday / sick-day entries can sync.

## Local dev

```bash
cd timeclock-app
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:5182/`.

## Phone

Open the URL above in Chrome on Android, then use **Add to Home screen**. The page works with no cellular data. New punches stay on the phone and upload the next time the app is online.

## Android APK

The same app can be wrapped as an installable APK with Capacitor:

```bash
cd timeclock-app
npm install
npm run build:android
npx cap add android
npx cap sync android
```

Open the `android` folder in Android Studio and use **Build > Build APK**. The APK is offline-capable; it still syncs through Supabase when the phone is online.
