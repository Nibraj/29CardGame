const socket = io();

const entry = document.getElementById('entry');
const gameView = document.getElementById('game');

const nameInput = document.getElementById('nameInput');
const codeInput = document.getElementById('codeInput');
const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const entryError = document.getElementById('entryError');

const roomCodeEl = document.getElementById('roomCode');
const youNameEl = document.getElementById('youName');
const gp0 = document.getElementById('gp0');
const gp1 = document.getElementById('gp1');
const statusEl = document.getElementById('status');
const roundResultEl = document.getElementById('roundResult');
const startBtn = document.getElementById('startBtn');
const newMatchBtn = document.getElementById('newMatchBtn');
const actionError = document.getElementById('actionError');
const actions = document.getElementById('actions');
const handEl = document.getElementById('hand');
const logEl = document.getElementById('log');
const trickArea = document.getElementById('trickArea');
const infoDealer = document.getElementById('infoDealer');
const infoBidder = document.getElementById('infoBidder');
const infoBid = document.getElementById('infoBid');
const infoTrump = document.getElementById('infoTrump');
const infoTarget = document.getElementById('infoTarget');
const infoTeam0 = document.getElementById('infoTeam0');
const infoTeam1 = document.getElementById('infoTeam1');
const infoTricks = document.getElementById('infoTricks');

let state = null;

const suitLabel = { S: '♠', H: '♥', D: '♦', C: '♣' };
const seatDirection = { 0: 'SOUTH', 1: 'WEST', 2: 'NORTH', 3: 'EAST' };

function cardText(card) {
  const suit = card[0];
  const rank = card.slice(1);
  return `${rank}${suitLabel[suit] || suit}`;
}

function isRed(card) {
  const suit = card[0];
  return suit === 'H' || suit === 'D';
}

function api(event, payload = {}) {
  return new Promise((resolve) => {
    socket.emit(event, payload, (res) => resolve(res));
  });
}

function playerBySeat(seat) {
  return state?.players?.find((p) => p.seat === seat);
}

function renderSeats() {
  for (let seat = 0; seat < 4; seat += 1) {
    const slot = document.getElementById(`seat${seat}`);
    const player = playerBySeat(seat);
    const cardBacks = (count) => {
      let html = '<div class="seat-cards">';
      for (let i = 0; i < count; i += 1) {
        html += '<span class="mini-back"></span>';
      }
      html += '</div>';
      return html;
    };

    if (!player) {
      slot.innerHTML = `
        <div class="seat-avatar"></div>
        <div class="seat-info">
          <div class="seat-dir">${seatDirection[seat]}</div>
          <div class="seat-name">Waiting...</div>
          <div class="seat-meta">Seat ${seat + 1}</div>
        </div>
      `;
      continue;
    }

    const turnMark = state.game.currentTurn === seat ? ' • Turn' : '';
    const youMark = state.you?.seat === seat ? ' (You)' : '';
    slot.innerHTML = `
      <div class="seat-avatar"></div>
      <div class="seat-info">
        <div class="seat-dir">${seatDirection[seat]}</div>
        <div class="seat-name">${player.name}${youMark}</div>
        <div class="seat-meta">Team ${player.team + 1}${turnMark}</div>
        <div class="seat-meta">Cards: ${player.cardCount}</div>
        ${cardBacks(player.cardCount)}
      </div>
    `;
  }
}

function renderTrick() {
  if (!state.game.trick.length) {
    trickArea.innerHTML = `<strong>Trick ${Math.min(state.game.trickNumber, 8)}</strong><br/>No cards yet`;
    return;
  }

  let cardsHtml = '<div class="trick-cards">';
  state.game.trick.forEach((entry) => {
    const name = playerBySeat(entry.seat)?.name || `Seat ${entry.seat + 1}`;
    cardsHtml += `
      <div class="trick-card-wrap">
        <div class="table-card ${isRed(entry.card) ? 'red' : ''}">${cardText(entry.card)}</div>
        <span>${name}</span>
      </div>
    `;
  });
  cardsHtml += '</div>';
  trickArea.innerHTML = `<strong>Trick ${Math.min(state.game.trickNumber, 8)}</strong>${cardsHtml}`;
}

function renderHand() {
  handEl.innerHTML = '';
  const legal = new Set(state.game.legalCards || []);

  state.game.hand.forEach((card) => {
    const div = document.createElement('div');
    div.className = 'card';
    if (isRed(card)) div.classList.add('red');
    div.textContent = cardText(card);

    if (legal.has(card)) {
      div.classList.add('playable');
      div.onclick = async () => {
        actionError.textContent = '';
        const res = await api('playCard', { card });
        if (!res.ok) actionError.textContent = res.error || 'Failed to play card.';
      };
    }

    handEl.appendChild(div);
  });
}

function renderLog() {
  logEl.innerHTML = '';
  (state.game.messages || []).slice().reverse().forEach((msg) => {
    const li = document.createElement('li');
    li.textContent = msg;
    logEl.appendChild(li);
  });
}

function renderActions() {
  actions.innerHTML = '';
  actionError.textContent = '';

  const isHost = state.hostId === socket.id;
  const inLobby = state.game.phase === 'lobby';

  startBtn.style.display = inLobby && isHost ? 'inline-block' : 'none';
  newMatchBtn.style.display = isHost ? 'inline-block' : 'none';

  if (state.game.phase === 'bidding' && state.you?.seat === state.game.currentTurn) {
    const minBid = state.game.bidding.currentBid === null ? 16 : state.game.bidding.currentBid + 1;

    const bidSelect = document.createElement('select');
    for (let b = minBid; b <= 29; b += 1) {
      const opt = document.createElement('option');
      opt.value = String(b);
      opt.textContent = String(b);
      bidSelect.appendChild(opt);
    }

    const bidBtn = document.createElement('button');
    bidBtn.textContent = 'Bid';
    bidBtn.onclick = async () => {
      const res = await api('bidAction', { action: 'bid', value: Number(bidSelect.value) });
      if (!res.ok) actionError.textContent = res.error || 'Bid failed.';
    };

    const passBtn = document.createElement('button');
    passBtn.textContent = 'Pass';
    passBtn.onclick = async () => {
      const res = await api('bidAction', { action: 'pass' });
      if (!res.ok) actionError.textContent = res.error || 'Pass failed.';
    };

    actions.append(bidSelect, bidBtn, passBtn);
  }

  if (state.game.phase === 'trump' && state.you?.seat === state.game.bidding.bidderSeat) {
    const label = document.createElement('p');
    label.textContent = 'Select trump suit:';
    actions.appendChild(label);

    ['S', 'H', 'D', 'C'].forEach((suit) => {
      const btn = document.createElement('button');
      btn.textContent = suitLabel[suit];
      btn.onclick = async () => {
        const res = await api('selectTrump', { suit });
        if (!res.ok) actionError.textContent = res.error || 'Could not select trump.';
      };
      actions.appendChild(btn);
    });
  }

  if (state.game.phase === 'play' && state.you?.seat === state.game.currentTurn) {
    const p = document.createElement('p');
    p.textContent = 'Play one highlighted card.';
    actions.appendChild(p);

    const revealBtn = document.createElement('button');
    revealBtn.textContent = state.game.trumpRevealed ? 'Trump Revealed' : 'Reveal Trump';
    revealBtn.disabled = !state.game.canRevealTrump || state.game.trumpRevealed;
    revealBtn.title = state.game.canRevealTrump
      ? 'Reveal trump now'
      : 'Available only if you cannot follow the current lead suit';
    revealBtn.onclick = async () => {
      const res = await api('revealTrump');
      if (!res.ok) actionError.textContent = res.error || 'Could not reveal trump.';
    };
    actions.appendChild(revealBtn);
  }

  if (!actions.childElementCount) {
    const p = document.createElement('p');
    p.textContent = 'No action required right now.';
    actions.appendChild(p);
  }
}

function renderStatus() {
  const game = state.game;
  const turnPlayer = playerBySeat(game.currentTurn);
  const turnName = turnPlayer ? turnPlayer.name : `Seat ${game.currentTurn + 1}`;

  let line = `Phase: ${game.phase}`;

  if (game.phase === 'bidding') {
    line += ` | Current bid: ${game.bidding.currentBid ?? '-'} | Turn: ${turnName}`;
  } else if (game.phase === 'trump') {
    const bidder = playerBySeat(game.bidding.bidderSeat);
    line += ` | Bid: ${game.bidding.currentBid} by ${bidder?.name || '-'} (choose trump)`;
  } else if (game.phase === 'play') {
    const trumpText = game.trumpRevealed ? (suitLabel[game.trumpSuit] || '-') : 'Hidden';
    line += ` | Trump: ${trumpText} | Trick: ${Math.min(game.trickNumber, 8)} | Turn: ${turnName}`;
    line += ` | Team points: ${game.teamPoints[0]}-${game.teamPoints[1]}`;
  } else if (game.phase === 'roundOver') {
    line += ' | Next round starts shortly.';
  } else if (game.phase === 'matchOver') {
    line += ` | Team ${game.matchWinner + 1} wins the match.`;
  }

  statusEl.textContent = line;
}

function renderBoardInfo() {
  const dealer = playerBySeat(state.game.dealer);
  const bidder = playerBySeat(state.game.bidding.bidderSeat);
  infoDealer.textContent = dealer?.name || '-';
  infoBidder.textContent = bidder?.name || '-';
  infoBid.textContent = state.game.bidding.currentBid ?? '-';
  infoTrump.textContent = state.game.trumpRevealed
    ? (suitLabel[state.game.trumpSuit] || '-')
    : (state.you?.seat === state.game.bidding.bidderSeat && state.game.trumpSuit
      ? `${suitLabel[state.game.trumpSuit]} (Hidden)`
      : 'Hidden');
  infoTarget.textContent = state.game.bidding.currentBid ?? '-';
  infoTeam0.textContent = String(state.game.teamPoints[0]);
  infoTeam1.textContent = String(state.game.teamPoints[1]);
  infoTricks.textContent = `${state.game.tricksWon[0]} - ${state.game.tricksWon[1]}`;
}

function render() {
  if (!state) return;

  entry.classList.add('hidden');
  gameView.classList.remove('hidden');

  roomCodeEl.textContent = state.roomCode;
  youNameEl.textContent = `${state.you?.name || '-'} (Seat ${state.you ? state.you.seat + 1 : '-'})`;
  gp0.textContent = String(state.game.gamePoints[0]);
  gp1.textContent = String(state.game.gamePoints[1]);
  roundResultEl.textContent = state.game.roundResult || '';

  renderStatus();
  renderBoardInfo();
  renderSeats();
  renderTrick();
  renderHand();
  renderActions();
  renderLog();
}

function goToMainMenu() {
  state = null;
  gameView.classList.add('hidden');
  entry.classList.remove('hidden');
  codeInput.value = '';
  actionError.textContent = '';
}

socket.on('state', (next) => {
  state = next;
  render();
});

createBtn.onclick = async () => {
  entryError.textContent = '';
  const name = nameInput.value.trim();
  const res = await api('createRoom', { name });
  if (!res.ok) entryError.textContent = res.error || 'Could not create room.';
};

joinBtn.onclick = async () => {
  entryError.textContent = '';
  const name = nameInput.value.trim();
  const code = codeInput.value.trim().toUpperCase();
  const res = await api('joinRoom', { name, code });
  if (!res.ok) entryError.textContent = res.error || 'Could not join room.';
};

startBtn.onclick = async () => {
  const res = await api('startGame');
  if (!res.ok) actionError.textContent = res.error || 'Could not start.';
};

newMatchBtn.onclick = async () => {
  actionError.textContent = '';
  const res = await api('leaveRoom');
  if (!res.ok) {
    actionError.textContent = res.error || 'Could not leave room.';
    return;
  }
  goToMainMenu();
};
