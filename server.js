const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const Game = require('./public/game.js');

const PORT = process.env.PORT || 3000;
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem O/0/I/1 para não confundir
const rooms = new Map();

/* ---------- Arquivos do site ---------- */
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/health') return res.end('ok');
  const [file, type] = url === '/game.js' ? ['game.js', 'text/javascript'] : ['index.html', 'text/html'];
  fs.readFile(path.join(__dirname, 'public', file), (e, d) => {
    if (e) { res.writeHead(500); return res.end('arquivo não encontrado: public/' + file); }
    res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' });
    res.end(d);
  });
});

/* ---------- Salas ---------- */
const send = (ws, m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
function bcast(R) {
  const S = R.S;
  for (const id in S.players) S.players[id].on = !!R.socks[id];
  const s = JSON.stringify({ t: 'state', s: S });
  for (const id in R.socks) if (R.socks[id].readyState === 1) R.socks[id].send(s);
}
function newCode() {
  let c;
  do { c = Array.from({ length: 4 }, () => ALPHA[Math.random() * ALPHA.length | 0]).join(''); } while (rooms.has(c));
  return c;
}
function leave(ws) { // saída de propósito: libera a vaga
  const R = ws.room; if (!R) return;
  ws.room = null;
  if (R.socks[ws.pid] === ws) delete R.socks[ws.pid];
  const S = R.S; delete S.players[ws.pid];
  for (const k of Object.keys(S.hold)) if (S.hold[k] === ws.pid) delete S.hold[k];
  if (!Object.keys(R.socks).length) rooms.delete(ws.code); else bcast(R);
}
function join(R, code, ws, m) {
  const S = R.S, pid = String(m.pid || '').slice(0, 24) || Math.random().toString(36).slice(2);
  const name = String(m.name || '').trim().slice(0, 14);
  if (!S.players[pid]) {
    const idx = Object.keys(S.players).length;
    if (idx >= 2) return send(ws, { t: 'error', m: 'Esta sala já tem 2 jogadores.' });
    S.players[pid] = { n: name || 'Jogador ' + (idx + 1), c: Game.COL[idx] };
  } else if (name) S.players[pid].n = name;
  const old = R.socks[pid];
  if (old && old !== ws) { old.room = null; old.close(); } // mesma pessoa reconectando
  clearTimeout(R.ttl);
  R.socks[pid] = ws; ws.room = R; ws.pid = pid; ws.code = code;
  send(ws, { t: 'joined', code });
  bcast(R);
}

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', ws => {
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'create') {
      leave(ws);
      const code = newCode(), R = { S: Game.adopt(m.s || {}), socks: {} };
      R.S.players = {}; rooms.set(code, R); join(R, code, ws, m);
    } else if (m.t === 'join') {
      const code = String(m.code || '').toUpperCase().trim(), R = rooms.get(code);
      if (!R) return send(ws, { t: 'error', m: 'Sala não encontrada. Confira o código.' });
      if (ws.room !== R) leave(ws);
      join(R, code, ws, m);
    } else if (m.t === 'name' && ws.room) {
      ws.room.S.players[ws.pid].n = String(m.name || '').trim().slice(0, 14) || 'Jogador'; bcast(ws.room);
    } else if (m.t === 'leave') {
      leave(ws);
    } else if (m.t === 'act' && ws.room) {
      Game.handle(ws.room.S, ws.pid, m.a); bcast(ws.room);
    }
  });
  ws.on('close', () => {
    const R = ws.room; if (!R) return;
    if (R.socks[ws.pid] === ws) delete R.socks[ws.pid];
    bcast(R);
    if (!Object.keys(R.socks).length) R.ttl = setTimeout(() => rooms.delete(ws.code), 30 * 60 * 1000); // sala vazia some em 30 min
  });
});
setInterval(() => wss.clients.forEach(ws => { if (!ws.alive) return ws.terminate(); ws.alive = false; ws.ping(); }), 25000);

server.listen(PORT, () => console.log('Quebra-cabeça rodando na porta ' + PORT));
