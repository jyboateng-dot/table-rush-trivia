# Table Rush Trivia Host Runbook

Use this when running a live pub/lounge trivia session.

## 1. Before Guests Arrive

1. Open the admin dashboard.
2. Create a new event.
3. Set the event name, difficulty, timer, number of questions, table limit, and prize.
4. Open the TV link on the venue screens.
5. Confirm the TV screen shows the QR code and the public join URL.
6. Keep the secure admin link private. Do not show it on the TV.
7. Check Venue Status in admin:
   - Database should say `postgres`.
   - Socket should say `live`.
   - Cache should become `Ready` after voting is locked.

## 2. Guest Join and Category Vote

1. Ask tables to scan the QR code.
2. Each table enters a leaderboard name.
3. Tables vote for the category.
4. Watch table count and suspicious activity in admin.
5. When ready, click Lock voting.

## 3. Running Questions

1. Click Start question.
2. Let tables answer on their phones.
3. If there is an interruption, click Pause.
4. Click Resume when ready.
5. Click Close to end a question early.
6. Click Reveal to show the answer.
7. Click Start question again for the next round.

## 4. Anti-Cheat Handling

Use the Anti-Cheat Watch panel during play.

- Focus flags mean the phone left the game tab during an active question.
- Reconnects can be normal, but repeated reconnects during questions are suspicious.
- Use DQ for a table that should stop competing.
- Use Restore if the DQ was accidental.
- Use score adjustment buttons only for host corrections.

## 5. Prize and Final Results

1. When the game is done, click Finish.
2. Confirm or choose the winning table in Prize & Results.
3. Click Export to open the final leaderboard JSON.
4. Click Archive after results are recorded.

## 6. Backup Plan

If the internet fails:

1. Pause the game.
2. Keep the TV screen on the current question if it is still visible.
3. If the app cannot reconnect within 2 minutes, switch to manual trivia.
4. Use the last visible leaderboard or the exported result if already available.

