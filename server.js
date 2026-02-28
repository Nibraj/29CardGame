const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const rooms = new Map();

const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['J', '9', 'A', '10', 'K', 'Q', '8', '7'];
const CARD_POINTS = { J: 3, '9': 2, A: 1, '10': 1, K: 0, Q: 0, '8': 0, '7': 0 };
const RANK_POWER = { J: 8, '9': 7, A: 6, '10': 5, K: 4, Q: 3, '8': 2, '7': 1 };

app.use(express.static('public'));

function makeDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(`${suit}${rank}`);
    }
  }
  return deck;
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function parseCard(card) {
  if (card.startsWith('S') || card.startsWith('H') || card.startsWith('D') || card.startsWith('C')) {
    return { suit: card[0], rank: card.slice(1) };
  }
  throw new Error(`Invalid card: ${card}`);
}

function nextSeat(seat) {
  return (seat + 1) % 4;
}

function teamOf(seat) {
  return seat % 2;
}

function playerBySeat(room, seat) {
  return room.players.find((p) => p.seat === seat) || null;
}

function cardStrength(card, leadSuit, trumpSuit) {
  const { suit, rank } = parseCard(card);
  const base = RANK_POWER[rank];
  if (suit === trumpSuit) return 200 + base;
  if (suit === leadSuit) return 100 + base;
  return base;
}

function trickWinner(trickCards, trumpSuit) {
  const leadSuit = parseCard(trickCards[0].card).suit;
  let best = trickCards[0];
  for (let i = 1; i < trickCards.length; i += 1) {
    const current = trickCards[i];
    if (cardStrength(current.card, leadSuit, trumpSuit) > cardStrength(best.card, leadSuit, trumpSuit)) {
      best = current;
    }
  }
  return best.seat;
}

function trickPoints(trickCards) {
  return trickCards.reduce((sum, entry) => {
    const { rank } = parseCard(entry.card);
    return sum + CARD_POINTS[rank];
  }, 0);
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function uniqueCode() {
  let code = generateCode();
  while (rooms.has(code)) {
    code = generateCode();
  }
  return code;
}

function initialGameState() {
  return {
    phase: 'lobby',
    dealer: -1,
    round: 0,
    hands: [[], [], [], []],
    deck: [],
    currentTurn: 0,
    bidding: {
      currentBid: null,
      bidderSeat: null,
      consecutivePasses: 0,
      actedCount: 0,
      history: []
    },
    trumpSuit: null,
    trick: [],
    trickNumber: 1,
    teamPoints: [0, 0],
    tricksWon: [0, 0],
    gamePoints: [0, 0],
    messages: [],
    matchWinner: null,
    roundResult: null,
    autoRoundTimer: null
  };
}

function logMessage(room, text) {
  room.game.messages.push(text);
  if (room.game.messages.length > 12) {
    room.game.messages.shift();
  }
}

function clearAutoRound(room) {
  if (room.game.autoRoundTimer) {
    clearTimeout(room.game.autoRoundTimer);
    room.game.autoRoundTimer = null;
  }
}

function dealCards(game, count, dealer) {
  const start = nextSeat(dealer);
  for (let n = 0; n < count; n += 1) {
    for (let offset = 0; offset < 4; offset += 1) {
      const seat = (start + offset) % 4;
      game.hands[seat].push(game.deck.pop());
    }
  }
}

function startRound(room) {
  const game = room.game;
  clearAutoRound(room);

  game.round += 1;
  game.phase = 'bidding';
  game.dealer = game.dealer === -1 ? 0 : nextSeat(game.dealer);
  game.hands = [[], [], [], []];
  game.deck = shuffle(makeDeck());
  game.trumpSuit = null;
  game.currentTurn = nextSeat(game.dealer);
  game.trick = [];
  game.trickNumber = 1;
  game.teamPoints = [0, 0];
  game.tricksWon = [0, 0];
  game.roundResult = null;
  game.bidding = {
    currentBid: null,
    bidderSeat: null,
    consecutivePasses: 0,
    actedCount: 0,
    history: []
  };

  dealCards(game, 4, game.dealer); // first 4 cards each

  const dealerPlayer = playerBySeat(room, game.dealer);
  logMessage(room, `Round ${game.round} started. Dealer: ${dealerPlayer ? dealerPlayer.name : `Seat ${game.dealer + 1}`}.`);
}

function legalCardsForSeat(game, seat) {
  const hand = game.hands[seat];
  if (game.trick.length === 0) return [...hand];

  const leadSuit = parseCard(game.trick[0].card).suit;
  const hasLeadSuit = hand.some((c) => parseCard(c).suit === leadSuit);
  if (!hasLeadSuit) return [...hand];
  return hand.filter((c) => parseCard(c).suit === leadSuit);
}

function endRound(room) {
  const game = room.game;
  const bidderTeam = teamOf(game.bidding.bidderSeat);
  const defendingTeam = bidderTeam === 0 ? 1 : 0;
  const bidderSucceeded = game.teamPoints[bidderTeam] >= game.bidding.currentBid;

  if (bidderSucceeded) {
    game.gamePoints[bidderTeam] += 1;
    game.roundResult = `${room.players[game.bidding.bidderSeat].name}'s team made ${game.teamPoints[bidderTeam]} and won the bid ${game.bidding.currentBid}.`;
  } else {
    game.gamePoints[defendingTeam] += 1;
    game.roundResult = `${room.players[game.bidding.bidderSeat].name}'s team made ${game.teamPoints[bidderTeam]} and failed the bid ${game.bidding.currentBid}.`;
  }

  logMessage(room, game.roundResult);

  const winnerTeam = game.gamePoints[0] >= 6 ? 0 : (game.gamePoints[1] >= 6 ? 1 : null);
  if (winnerTeam !== null) {
    game.phase = 'matchOver';
    game.matchWinner = winnerTeam;
    logMessage(room, `Team ${winnerTeam + 1} won the match.`);
    return;
  }

  game.phase = 'roundOver';
  game.autoRoundTimer = setTimeout(() => {
    if (!rooms.has(room.code)) return;
    if (room.players.length < 4) return;
    startRound(room);
    emitRoom(room);
  }, 6000);
}

function serializeForPlayer(room, socketId) {
  const player = room.players.find((p) => p.id === socketId);
  const seat = player ? player.seat : null;
  const game = room.game;

  return {
    roomCode: room.code,
    hostId: room.hostId,
    you: player ? { id: player.id, name: player.name, seat: player.seat, team: teamOf(player.seat) } : null,
    players: room.players
      .slice()
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({
        id: p.id,
        name: p.name,
        seat: p.seat,
        team: teamOf(p.seat),
        cardCount: game.hands[p.seat] ? game.hands[p.seat].length : 0
      })),
    game: {
      phase: game.phase,
      dealer: game.dealer,
      round: game.round,
      currentTurn: game.currentTurn,
      bidding: game.bidding,
      trumpSuit: game.trumpSuit,
      trick: game.trick,
      trickNumber: game.trickNumber,
      teamPoints: game.teamPoints,
      tricksWon: game.tricksWon,
      gamePoints: game.gamePoints,
      roundResult: game.roundResult,
      matchWinner: game.matchWinner,
      messages: game.messages,
      hand: seat !== null ? game.hands[seat] : [],
      legalCards: seat !== null && game.phase === 'play' && game.currentTurn === seat ? legalCardsForSeat(game, seat) : []
    }
  };
}

function emitRoom(room) {
  room.players.forEach((p) => {
    io.to(p.id).emit('state', serializeForPlayer(room, p.id));
  });
}

function roomBySocket(socketId) {
  for (const room of rooms.values()) {
    if (room.players.some((p) => p.id === socketId)) return room;
  }
  return null;
}

function normalizeName(name) {
  const cleaned = (name || '').trim().replace(/\s+/g, ' ');
  return cleaned.slice(0, 20);
}

function canStart(room) {
  return room.players.length === 4;
}

function removePlayerFromRoom(socketId, reasonText) {
  const room = roomBySocket(socketId);
  if (!room) return null;

  const idx = room.players.findIndex((p) => p.id === socketId);
  if (idx === -1) return null;

  const [leaver] = room.players.splice(idx, 1);
  clearAutoRound(room);

  if (room.players.length === 0) {
    rooms.delete(room.code);
    return { room: null, leaver };
  }

  if (room.hostId === socketId) {
    room.hostId = room.players[0].id;
  }

  if (room.game.phase !== 'lobby') {
    room.game = initialGameState();
    logMessage(room, `${leaver.name} ${reasonText}. Match reset to lobby.`);
  } else {
    logMessage(room, `${leaver.name} ${reasonText}.`);
  }

  emitRoom(room);
  return { room, leaver };
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name }, ack = () => {}) => {
    const playerName = normalizeName(name);
    if (!playerName) {
      ack({ ok: false, error: 'Name is required.' });
      return;
    }

    const code = uniqueCode();
    const room = {
      code,
      hostId: socket.id,
      players: [{ id: socket.id, name: playerName, seat: 0 }],
      game: initialGameState()
    };

    rooms.set(code, room);
    socket.join(code);
    logMessage(room, `${playerName} created room ${code}.`);
    emitRoom(room);
    ack({ ok: true, roomCode: code });
  });

  socket.on('joinRoom', ({ name, code }, ack = () => {}) => {
    const playerName = normalizeName(name);
    const roomCode = (code || '').trim().toUpperCase();
    if (!playerName) {
      ack({ ok: false, error: 'Name is required.' });
      return;
    }

    if (!rooms.has(roomCode)) {
      ack({ ok: false, error: 'Room not found.' });
      return;
    }

    const room = rooms.get(roomCode);
    if (room.players.length >= 4) {
      ack({ ok: false, error: 'Room is full.' });
      return;
    }

    if (room.game.phase !== 'lobby') {
      ack({ ok: false, error: 'Match already started.' });
      return;
    }

    const seatSet = new Set(room.players.map((p) => p.seat));
    let seat = 0;
    while (seatSet.has(seat)) seat += 1;

    room.players.push({ id: socket.id, name: playerName, seat });
    socket.join(roomCode);
    logMessage(room, `${playerName} joined room.`);
    emitRoom(room);
    ack({ ok: true, roomCode });
  });

  socket.on('startGame', (_, ack = () => {}) => {
    const room = roomBySocket(socket.id);
    if (!room) {
      ack({ ok: false, error: 'Not in a room.' });
      return;
    }

    if (room.hostId !== socket.id) {
      ack({ ok: false, error: 'Only host can start.' });
      return;
    }

    if (!canStart(room)) {
      ack({ ok: false, error: 'Need exactly 4 players.' });
      return;
    }

    startRound(room);
    emitRoom(room);
    ack({ ok: true });
  });

  socket.on('bidAction', ({ action, value }, ack = () => {}) => {
    const room = roomBySocket(socket.id);
    if (!room) return ack({ ok: false, error: 'Not in room.' });
    const game = room.game;
    if (game.phase !== 'bidding') return ack({ ok: false, error: 'Not bidding phase.' });

    const player = room.players.find((p) => p.id === socket.id);
    if (!player || player.seat !== game.currentTurn) return ack({ ok: false, error: 'Not your turn.' });

    if (action === 'pass') {
      game.bidding.history.push({ seat: player.seat, action: 'pass' });
      game.bidding.consecutivePasses += 1;
      game.bidding.actedCount += 1;
      logMessage(room, `${player.name} passed.`);
    } else if (action === 'bid') {
      const bid = Number(value);
      if (!Number.isInteger(bid) || bid < 16 || bid > 29) {
        return ack({ ok: false, error: 'Bid must be between 16 and 29.' });
      }
      const min = game.bidding.currentBid === null ? 16 : game.bidding.currentBid + 1;
      if (bid < min) {
        return ack({ ok: false, error: `Bid must be at least ${min}.` });
      }

      game.bidding.currentBid = bid;
      game.bidding.bidderSeat = player.seat;
      game.bidding.consecutivePasses = 0;
      game.bidding.actedCount += 1;
      game.bidding.history.push({ seat: player.seat, action: 'bid', value: bid });
      logMessage(room, `${player.name} bid ${bid}.`);
    } else {
      return ack({ ok: false, error: 'Invalid action.' });
    }

    const allPassedNoBid = game.bidding.currentBid === null && game.bidding.actedCount >= 4;
    const biddingEnded = game.bidding.currentBid !== null && game.bidding.consecutivePasses >= 3;

    if (allPassedNoBid) {
    game.bidding.currentBid = 16;
    game.bidding.bidderSeat = game.dealer;
    game.phase = 'trump';
    game.currentTurn = game.dealer;
    const dealerPlayer = playerBySeat(room, game.dealer);
    logMessage(room, `All players passed. Dealer ${dealerPlayer ? dealerPlayer.name : `Seat ${game.dealer + 1}`} is forced to bid 16.`);
    emitRoom(room);
    return ack({ ok: true });
  }

    if (biddingEnded) {
      game.phase = 'trump';
      game.currentTurn = game.bidding.bidderSeat;
      const bidder = playerBySeat(room, game.bidding.bidderSeat);
      logMessage(room, `${bidder ? bidder.name : `Seat ${game.bidding.bidderSeat + 1}`} won the bid and must choose trump.`);
      emitRoom(room);
      return ack({ ok: true });
    }

    game.currentTurn = nextSeat(game.currentTurn);
    emitRoom(room);
    ack({ ok: true });
  });

  socket.on('selectTrump', ({ suit }, ack = () => {}) => {
    const room = roomBySocket(socket.id);
    if (!room) return ack({ ok: false, error: 'Not in room.' });
    const game = room.game;

    if (game.phase !== 'trump') return ack({ ok: false, error: 'Not trump phase.' });
    const bidder = room.players.find((p) => p.seat === game.bidding.bidderSeat);
    if (!bidder || bidder.id !== socket.id) return ack({ ok: false, error: 'Only bidder can choose trump.' });
    if (!SUITS.includes(suit)) return ack({ ok: false, error: 'Invalid suit.' });

    game.trumpSuit = suit;

    dealCards(game, 4, game.dealer); // remaining 4 cards each

    game.phase = 'play';
    game.currentTurn = game.bidding.bidderSeat;

    logMessage(room, `${bidder.name} selected ${suit} as trump.`);
    emitRoom(room);
    ack({ ok: true });
  });

  socket.on('playCard', ({ card }, ack = () => {}) => {
    const room = roomBySocket(socket.id);
    if (!room) return ack({ ok: false, error: 'Not in room.' });
    const game = room.game;
    if (game.phase !== 'play') return ack({ ok: false, error: 'Not play phase.' });

    const player = room.players.find((p) => p.id === socket.id);
    if (!player || player.seat !== game.currentTurn) return ack({ ok: false, error: 'Not your turn.' });

    const hand = game.hands[player.seat];
    const inHand = hand.includes(card);
    if (!inHand) return ack({ ok: false, error: 'Card not in hand.' });

    const legal = legalCardsForSeat(game, player.seat);
    if (!legal.includes(card)) return ack({ ok: false, error: 'Must follow suit.' });

    hand.splice(hand.indexOf(card), 1);
    game.trick.push({ seat: player.seat, card });

    if (game.trick.length < 4) {
      game.currentTurn = nextSeat(game.currentTurn);
      emitRoom(room);
      return ack({ ok: true });
    }

    const winnerSeat = trickWinner(game.trick, game.trumpSuit);
    const points = trickPoints(game.trick) + (game.trickNumber === 8 ? 1 : 0);
    const winnerTeam = teamOf(winnerSeat);
    game.teamPoints[winnerTeam] += points;
    game.tricksWon[winnerTeam] += 1;

    const winnerPlayer = playerBySeat(room, winnerSeat);
    logMessage(room, `${winnerPlayer ? winnerPlayer.name : `Seat ${winnerSeat + 1}`} won trick ${game.trickNumber} for ${points} points.`);

    game.trick = [];
    game.trickNumber += 1;
    game.currentTurn = winnerSeat;

    const roundDone = game.hands.every((h) => h.length === 0);
    if (roundDone) {
      endRound(room);
    }

    emitRoom(room);
    ack({ ok: true });
  });

  socket.on('newMatch', (_, ack = () => {}) => {
    const room = roomBySocket(socket.id);
    if (!room) return ack({ ok: false, error: 'Not in room.' });
    if (room.hostId !== socket.id) return ack({ ok: false, error: 'Only host can reset.' });

    room.game = initialGameState();
    logMessage(room, 'Host reset the match.');
    emitRoom(room);
    ack({ ok: true });
  });

  socket.on('leaveRoom', (_, ack = () => {}) => {
    const left = removePlayerFromRoom(socket.id, 'left the room');
    if (!left) return ack({ ok: false, error: 'Not in room.' });

    if (left.room) {
      socket.leave(left.room.code);
    }

    ack({ ok: true });
  });

  socket.on('disconnect', () => {
    removePlayerFromRoom(socket.id, 'disconnected');
  });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`29 game server running on http://localhost:${PORT}`);
});
