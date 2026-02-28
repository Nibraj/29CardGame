# 29 Card Game Web App

A browser-based multiplayer implementation of the 29 card game for 4 online players.

## Stack
- Node.js + Express
- Socket.IO for real-time multiplayer
- Vanilla HTML/CSS/JS frontend

## Run
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start server:
   ```bash
   npm start
   ```
3. Open:
   `http://localhost:3000`

## Multiplayer Flow
- One player creates a room and gets a 5-character code.
- Other players join using the code.
- Host starts the match when 4 players are seated.

## Game Logic Implemented
- 32-card deck: `J, 9, A, 10, K, Q, 8, 7` in each suit.
- Teams: seat 1 + seat 3 vs seat 2 + seat 4 (opposite seats).
- Bidding:
  - Minimum bid: 16, maximum: 29.
  - Players bid in turn or pass.
  - If everyone passes with no bid, dealer is forced to 16.
- Trump:
  - Bid winner selects trump suit.
- Play:
  - Follow-suit enforced.
  - 8 tricks total.
  - Trick winner determined by trump/lead suit and rank order.
- Points:
  - Card points: `J=3, 9=2, A=1, 10=1`.
  - Last trick bonus: `+1` point.
- Round result:
  - Bidding team must reach bid value from captured points.
  - Success/failure gives 1 game point.
- Match winner:
  - First team to 6 game points.

## Notes
- Server is authoritative for all moves/validation.
- Hidden information is preserved (players only receive their own hand).
- If a player disconnects mid-match, the match resets to lobby.
