# Zaf Play app

Native iOS + Android app for players (Expo / React Native, TypeScript). It uses the **same Supabase project as the website** (`zaf.play` repo), so accounts, prices, rules and refunds are identical — all business rules live in the database.

## Run it on your phone
1. Install **Node.js (LTS)** on the laptop, and the **Expo Go** app on your phone.
2. In this folder: `npm install`
3. Copy `.env.example` to `.env` (same values, nothing to change).
4. `npx expo start` → scan the QR code with Expo Go (iPhone: Camera app; Android: inside Expo Go).

## What works now
- Log in with email **or** username (same lockout and same generic wrong-password message as the website)
- Forgot password (email or username)
- Courts list with sport + area filters, court page (photos, rating, sports and prices)
- My bookings (list) and Profile (credit, log out)

## Next
Booking calendar → pay screen → change/cancel → waiting list → open games → push notifications → sign-up.

## Checks
`npm run typecheck`
