@AGENTS.md

## The app must look and work like the website (Fairuz, 31 Oct 2026)
The website (github.com/fairuzsoufy/zaf.play) is the source of truth for every player, owner and admin screen.
- Any UI change made on the website must be made in the app in the same piece of work, and the other way round:
  layout, wording, buttons, order of sections, colours and rules. Port the website component, don't redesign it.
  The only exception is the Profile tab, which is designed separately.
- Before changing an app screen, open the matching website file and copy its structure and copy text.
  Main pairs: Book `app/courts/[id]/book/page.tsx` + `app/components/TimePicker.tsx` -> `app/(tabs)/(play,games,bookings,profile)/book/[courtId].tsx` + `components/SlotPicker.tsx`;
  Pay `app/bookings/[id]/pay/page.tsx` -> `.../pay/[id].tsx`; Change time `app/bookings/[id]/change/page.tsx` -> `.../change/[id].tsx`.
- Business rules stay in the database: call the same Supabase RPCs, never re-implement them.
- Player screens live in the shared tab group `app/(tabs)/(play,games,bookings,profile)/` so the bottom bar shows on every page.
  Add new player screens there, not in `app/`.
