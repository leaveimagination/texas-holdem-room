(function () {
  const storageKey = 'logic-duel-session';
  const notesKey = 'logic-duel-notes';
  const state = {
    socket: null,
    connected: false,
    reconnecting: false,
    roomCode: '',
    playerId: '',
    token: '',
    view: null,
    error: '',
    pending: false,
    name: '',
    joinCode: '',
    notes: localStorage.getItem(notesKey) || '',
    requestCounter: 1
  };

  const app = document.getElementById('app');
  const saved = readSession();
  if (saved) {
    state.roomCode = saved.roomCode || '';
    state.playerId = saved.playerId || '';
    state.token = saved.token || '';
    state.name = saved.name || '';
    state.joinCode = saved.roomCode || '';
  }

  connect();
  render();

  function connect() {
    if (state.socket && [WebSocket.CONNECTING, WebSocket.OPEN].includes(state.socket.readyState)) {
      return;
    }

    state.socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    state.socket.addEventListener('open', () => {
      state.connected = true;
      state.error = '';
      render();
      if (state.roomCode && state.playerId && state.token) {
        send('reconnect', {
          roomCode: state.roomCode,
          playerId: state.playerId,
          token: state.token
        });
      }
    });
    state.socket.addEventListener('message', (event) => {
      handleMessage(JSON.parse(event.data));
    });
    state.socket.addEventListener('close', () => {
      state.connected = false;
      render();
      setTimeout(connect, 1600);
    });
    state.socket.addEventListener('error', () => {
      state.error = 'Connection problem. Retrying...';
      render();
    });
  }

  function handleMessage(message) {
    state.pending = false;
    if (message.type === 'error') {
      state.error = message.payload?.message || message.payload?.code || 'Something went wrong.';
      render();
      return;
    }

    const payload = message.payload || {};
    if (payload.roomCode) {
      state.roomCode = payload.roomCode;
      state.joinCode = payload.roomCode;
    }
    if (payload.playerId) {
      state.playerId = payload.playerId;
    }
    if (payload.token) {
      state.token = payload.token;
    }
    if (payload.view) {
      state.view = payload.view;
    }
    if (state.roomCode && state.playerId && state.token) {
      writeSession();
    }
    state.error = '';
    render();
  }

  function send(type, payload) {
    connect();
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
      state.error = 'Still connecting. Try again in a moment.';
      render();
      return;
    }
    state.pending = true;
    state.socket.send(JSON.stringify({
      type,
      requestId: `ui-${state.requestCounter++}`,
      payload
    }));
    render();
  }

  function render() {
    replaceChildren(app, [
      topbar(),
      el('div', { className: 'grid' }, [
        roomPanel(),
        el('section', { className: 'game-column', 'aria-label': 'Game table' }, [
          turnPanel(),
          el('div', { className: 'boards' }, [
            handPanel('Your tiles', getSelf()?.hand || null, true),
            handPanel('Opponent tiles', getOpponentHand(), false)
          ]),
          questionPanel(),
          guessPanel(),
          historyPanel(),
          notesPanel()
        ])
      ])
    ]);
  }

  function topbar() {
    const view = state.view || {};
    const status = state.connected ? 'Connected' : 'Reconnecting';
    return el('header', { className: 'topbar' }, [
      el('div', { className: 'brand' }, [
        el('h1', {}, ['Logic Duel']),
        el('p', {}, [view.state === 'finished' ? winnerText() : 'Deduce the hidden hand before your opponent does.'])
      ]),
      el('div', { className: `status-pill ${state.connected ? 'ok' : 'warn'}` }, [status])
    ]);
  }

  function roomPanel() {
    const view = state.view || {};
    const canStart = Boolean(view.isOwner && view.state === 'waiting' && getPlayers().length === 2 && !state.pending);
    return el('aside', { className: 'panel room-panel', 'aria-label': 'Room controls' }, [
      el('h2', {}, ['Room']),
      state.error ? errorBox() : null,
      field('Name', textInput('Player name', state.name, (value) => {
        state.name = value;
        writeSession();
      })),
      field('Room code', textInput('Room code', state.joinCode, (value) => {
        state.joinCode = value.toUpperCase();
      })),
      el('div', { className: 'actions' }, [
        button('Create', () => send('createRoom', { name: state.name.trim() }), {
          disabled: !state.connected || !state.name.trim() || state.pending
        }),
        button('Join', () => send('joinRoom', { name: state.name.trim(), roomCode: state.joinCode.trim() }), {
          disabled: !state.connected || !state.name.trim() || !state.joinCode.trim() || state.pending,
          className: 'secondary'
        })
      ]),
      state.roomCode ? roomCodeBox() : null,
      seatsPanel(),
      el('div', { className: 'actions' }, [
        button('Start', () => send('startGame', { roomCode: state.roomCode }), { disabled: !canStart }),
        button('Reconnect', reconnect, {
          disabled: !state.connected || !state.roomCode || !state.playerId || !state.token || state.pending,
          className: 'secondary'
        }),
        button('Leave', leaveRoom, {
          disabled: !state.connected || !state.roomCode || !state.playerId || state.pending,
          className: 'danger'
        })
      ])
    ]);
  }

  function roomCodeBox() {
    return el('div', { className: 'room-code' }, [
      el('span', {}, ['Code']),
      el('strong', {}, [state.roomCode]),
      button('Copy', () => navigator.clipboard?.writeText(state.roomCode), { className: 'secondary' })
    ]);
  }

  function seatsPanel() {
    const seats = getPlayers();
    const items = seats.length
      ? seats.map((player) => el('div', { className: 'seat' }, [
          el('span', {}, [player.name || 'Player']),
          el('small', {}, [`${player.connected ? 'online' : 'offline'}${player.id === state.playerId ? ' - you' : ''}`])
        ]))
      : [el('p', { className: 'empty' }, ['No room joined.'])];
    return el('div', { className: 'seats' }, items);
  }

  function turnPanel() {
    const view = state.view || {};
    const title = view.state === 'finished' ? winnerText() : (view.activePlayerName ? `${view.activePlayerName}'s turn` : 'Waiting for players');
    const sub = view.state === 'playing'
      ? (view.isActivePlayer ? 'Your move' : 'Opponent is thinking')
      : readableState(view.state);
    return el('section', { className: 'turn-strip', 'aria-label': 'Turn status' }, [
      el('div', {}, [el('strong', {}, [title]), el('span', {}, [sub])]),
      el('span', {}, [state.roomCode ? `Room ${state.roomCode}` : 'No room'])
    ]);
  }

  function questionPanel() {
    const cards = getQuestions();
    const disabled = !canAct();
    return el('section', { className: 'panel' }, [
      el('h2', {}, ['Questions']),
      cards.length ? el('div', { className: 'questions' }, cards.map((card) => (
        button(card.text || card.prompt || card.id, () => send('askQuestion', {
          roomCode: state.roomCode,
          cardId: card.id
        }), {
          className: 'question-card',
          disabled
        })
      ))) : el('p', { className: 'empty' }, ['Question cards appear after the game starts.'])
    ]);
  }

  function handPanel(title, hand, isSelf) {
    const tiles = Array.isArray(hand)
      ? hand.map((tile) => tileView(tile))
      : placeholderTiles(getOpponent()?.tileCount || 5);
    return el('section', { className: 'panel' }, [
      el('h2', {}, [title]),
      el('div', { className: 'tiles' }, tiles),
      !isSelf && state.view?.state !== 'finished' ? el('p', { className: 'hint' }, ['Colors stay hidden until the game ends.']) : null
    ]);
  }

  function tileView(tile) {
    const color = tile.color || 'hidden';
    return el('div', { className: `tile ${tile.color || ''}` }, [
      el('span', { className: 'number' }, [String(tile.number ?? '?')]),
      el('span', { className: 'color' }, [color])
    ]);
  }

  function placeholderTiles(count) {
    return Array.from({ length: count || 5 }, () => (
      el('div', { className: 'tile' }, [
        el('span', { className: 'number' }, ['?']),
        el('span', { className: 'color' }, ['hidden'])
      ])
    ));
  }

  function guessPanel() {
    const disabled = !canAct();
    return el('section', { className: 'panel' }, [
      el('h2', {}, ['Guess']),
      el('form', {
        className: 'stack',
        onsubmit: (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const tiles = Array.from({ length: 5 }, (_, index) => ({
            number: Number(data.get(`number-${index}`)),
            color: data.get(`color-${index}`)
          }));
          send('submitGuess', { roomCode: state.roomCode, tiles });
        }
      }, [
        el('div', { className: 'guess-grid' }, Array.from({ length: 5 }, (_, index) => guessTile(index, disabled))),
        button('Submit Guess', null, { type: 'submit', disabled })
      ])
    ]);
  }

  function guessTile(index, disabled) {
    return el('div', { className: 'stack' }, [
      field(`Tile ${index + 1} number`, numberSelect(`number-${index}`, disabled)),
      field(`Tile ${index + 1} color`, colorSelect(`color-${index}`, disabled))
    ]);
  }

  function numberSelect(name, disabled) {
    return el('select', { name, 'aria-label': name, disabled }, Array.from({ length: 10 }, (_, number) => (
      el('option', { value: String(number) }, [String(number)])
    )));
  }

  function colorSelect(name, disabled) {
    return el('select', { name, 'aria-label': name, disabled }, [
      el('option', { value: 'red' }, ['red']),
      el('option', { value: 'blue' }, ['blue'])
    ]);
  }

  function historyPanel() {
    const history = state.view?.history || [];
    const items = history.length ? history.map((item) => (
      el('div', { className: `history-item ${item.type || ''}` }, [
        el('strong', {}, [item.type || 'event']),
        el('div', {}, [item.text || ''])
      ])
    )) : [el('p', { className: 'empty' }, ['Moves will appear here.'])];
    return el('section', { className: 'panel' }, [
      el('h2', {}, ['History']),
      el('div', { className: 'history' }, items)
    ]);
  }

  function notesPanel() {
    return el('section', { className: 'panel notes' }, [
      el('h2', {}, ['Notes']),
      el('textarea', {
        'aria-label': 'Local notes',
        value: state.notes,
        oninput: (event) => {
          state.notes = event.target.value;
          localStorage.setItem(notesKey, state.notes);
        }
      })
    ]);
  }

  function errorBox() {
    return el('div', { className: 'error', role: 'alert' }, [
      el('span', {}, [state.error]),
      button('Dismiss', () => {
        state.error = '';
        render();
      }, { className: 'secondary' })
    ]);
  }

  function field(label, control) {
    return el('label', { className: 'field' }, [el('span', {}, [label]), control]);
  }

  function textInput(label, value, onChange) {
    return el('input', {
      type: 'text',
      value,
      'aria-label': label,
      autocomplete: 'off',
      oninput: (event) => onChange(event.target.value)
    });
  }

  function button(label, onclick, options = {}) {
    return el('button', {
      type: options.type || 'button',
      className: options.className || '',
      disabled: options.disabled === true,
      onclick
    }, [label]);
  }

  function reconnect() {
    send('reconnect', {
      roomCode: state.roomCode,
      playerId: state.playerId,
      token: state.token
    });
  }

  function leaveRoom() {
    send('leaveRoom', { roomCode: state.roomCode });
    state.view = null;
    state.roomCode = '';
    state.playerId = '';
    state.token = '';
    localStorage.removeItem(storageKey);
    render();
  }

  function canAct() {
    return Boolean(state.connected && state.view?.state === 'playing' && state.view?.isActivePlayer && !state.pending);
  }

  function getSelf() {
    return state.view?.self || state.view?.players?.find((player) => player.id === state.playerId) || null;
  }

  function getOpponent() {
    return state.view?.opponent || state.view?.players?.find((player) => player.id !== state.playerId) || null;
  }

  function getOpponentHand() {
    const opponent = getOpponent();
    return opponent?.hand || null;
  }

  function getPlayers() {
    if (Array.isArray(state.view?.players)) {
      return state.view.players;
    }
    return [state.view?.self, state.view?.opponent].filter(Boolean);
  }

  function getQuestions() {
    return state.view?.questionMarket || state.view?.availableQuestions || [];
  }

  function readableState(value) {
    if (!value) {
      return 'Create or join a room';
    }
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function winnerText() {
    return state.view?.winnerName ? `${state.view.winnerName} wins` : 'Game finished';
  }

  function readSession() {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || 'null');
    } catch {
      return null;
    }
  }

  function writeSession() {
    localStorage.setItem(storageKey, JSON.stringify({
      roomCode: state.roomCode,
      playerId: state.playerId,
      token: state.token,
      name: state.name
    }));
  }

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) {
        continue;
      }
      if (key === 'className') {
        node.className = value;
      } else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2), value);
      } else if (key === 'disabled') {
        node.disabled = value === true;
      } else if (key === 'value') {
        node.value = value;
      } else {
        node.setAttribute(key, value);
      }
    }
    replaceChildren(node, children);
    return node;
  }

  function replaceChildren(node, children) {
    node.replaceChildren(...children.filter(Boolean).map((child) => (
      child instanceof Node ? child : document.createTextNode(String(child))
    )));
  }
}());
