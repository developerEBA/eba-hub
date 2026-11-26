
/* eslint-disable @typescript-eslint/no-require-imports*/
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const originalLoad = Module._load;
Module._load = function (name, ...args) { return name === 'server-only' ? {} : originalLoad.call(this, name, ...args); };
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
require.extensions['.tsx'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename);
const base = path.resolve(__dirname, '../src/app/dashboard/games');
const { freshState, applyBoardMove, checkersMoves, ludoSquare } = require(base + '/rules.ts');
const sudoku = require(base + '/puzzles.ts');
const { applyTrivia } = require(base + '/trivia-rules.ts');
const { triviaQuestions } = require(base + '/trivia-bank.ts');
const { publicMatch } = require(base + '/server.ts');
const { chessAvailable, chessMove, chessLegal } = require(base + '/chess-server.ts');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { SquareBoard, LudoBoard } = require(base + '/boards.tsx');
const { GameEffects } = require(base + '/game-effects.tsx');
const { summarizeRecord } = require(base + '/record.ts');

test('Personal record: counts wins, losses, draws, current streak and best winning run', () => {
  const rounds = [0, 0, 1, 0, 0, 0, undefined].map((winner, index) => ({ room_id: 'room', round: index + 1, completed_at: `2026-11-${String(16-index).padStart(2,'0')}T12:00:00Z`, result: { message: 'Finished', winner, participants: [{ userId: 'me', seat: 0 }, { userId: 'other', seat: 1 }] } }));
  const record = summarizeRecord('me', rounds, []);
  assert.deepEqual([record.wins, record.losses, record.draws, record.streak, record.streakKind, record.bestWinStreak], [5,1,1,2,'win',3]);
  assert.equal(summarizeRecord('spectator', rounds, []).played, 0);
  assert.equal(summarizeRecord('me', [...rounds, rounds[0]], []).played, 7);
});

test('Personal record: loss streaks and shared trivia wins are classified correctly', () => {
  const result = { message: 'Finished', winners: [0,1], participants: [{ userId: 'me', seat: 0 }] };
  const round = { room_id: 'room', round: 1, completed_at: '2026-11-16', result };
  assert.equal(summarizeRecord('me', [round], []).draws, 1);
  const losses = [1,2].map((value) => ({ ...round, round: value, result: { ...result, winners: [1] } }));
  assert.equal(summarizeRecord('me', losses, []).streak, 2);
  assert.equal(summarizeRecord('me', losses, []).streakKind, 'loss');
});

test('Personal record: legacy results require a matching current roster and saved name', () => {
  const round = { room_id: 'room', round: 1, completed_at: '2026-11-16', result: { winner: 0, message: 'Won', names: ['Ada','Eni'] } };
  const member = { room_id: 'room', seat: 0, display_name: 'Ada', left_at: null };
  assert.equal(summarizeRecord('me', [round], [member]).wins, 1);
  assert.equal(summarizeRecord('me', [round], [{ ...member, display_name: 'Another person' }]).played, 0);
  assert.equal(summarizeRecord('me', [round], [{ ...member, left_at: '2026-11-16' }]).played, 0);
});

test('Room invitees: streamed thenables, rejection and unmount are handled without crashing', async () => {
  const effects = [], updates = [];
  const fakeReact = { ...React, useState: (initial) => [initial, (value) => updates.push(value)], useRef: (value) => ({ current: value }), useCallback: (fn) => fn, useEffect: (fn) => effects.push(fn) };
  const savedLoad = Module._load;
  let GameRoomClient;
  try {
    Module._load = function (name, ...args) { return name === 'react' ? fakeReact : savedLoad.call(this, name, ...args); };
    ({ GameRoomClient } = require(base + '/room.tsx'));
  } finally { Module._load = savedLoad; }
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const members = [{ user_id: 'staff', display_name: 'Ada' }];

  GameRoomClient({ id: 'room', members: [], membersPromise: { then(resolve) { resolve(members); } } });
  const cleanup = effects[0]();
  await flush(); assert.deepEqual(updates, [members]); cleanup();
  effects.length = 0; updates.length = 0;
  GameRoomClient({ id: 'room', members: [], membersPromise: { then(_resolve, reject) { reject(new Error('Invitees unavailable')); } } });
  effects[0](); await flush(); assert.deepEqual(updates, []);
  effects.length = 0;
  GameRoomClient({ id: 'room', members: [], membersPromise: { then(resolve) { resolve(members); } } });
  effects[0]()(); await flush(); assert.deepEqual(updates, []);
});

function ticView(board, winner) {
  const result = winner === undefined ? null : { winner, message: 'Three in a row!' };
  return { room: { game: 'tic-tac-toe', round: 1, status: result ? 'finished' : 'active', result }, state: { ...freshState('tic-tac-toe', 2), board, result }, self: 'me', players: [{ user_id: 'me', seat: 0, display_name: 'Ada' }, { user_id: 'other', seat: 1, display_name: 'Eni' }] };
}

test('HD Chess: all pieces have readable labels and black sees the board from their side', () => {
  const view = ticView([]); view.room.game = 'chess'; view.state = freshState('chess', 2);
  const html = renderToStaticMarkup(React.createElement(SquareBoard, { view, disabled: false, send() {} }));
  assert.equal((html.match(/hd-piece--chess/g) ?? []).length, 32);
  assert(html.includes('a8, black rook')); assert(html.includes('e1, white king'));
  view.self = 'other';
  const reversed = renderToStaticMarkup(React.createElement(SquareBoard, { view, disabled: false, send() {} }));
  assert.equal(reversed.match(/aria-label="([a-h][1-8]),/)[1], 'h1');
});

test('HD Checkers: crowned pieces use king artwork and retain accessible piece names', () => {
  const view = ticView([]); view.room.game = 'checkers'; view.state = freshState('checkers', 2);
  view.state.board[1] = 2; view.state.board[56] = -2;
  const html = renderToStaticMarkup(React.createElement(SquareBoard, { view, disabled: false, send() {} }));
  assert.equal((html.match(/hd-piece--checker/g) ?? []).length, 24);
  assert(html.includes('b8, coral king')); assert(html.includes('a1, emerald king'));
  assert(!html.includes('♛'));
});

test('HD Ludo: clickable pawns respect legal moves, turns and the actual dice value', () => {
  const view = ticView([]); view.room.game = 'ludo'; view.room.capacity = 4; view.state = freshState('ludo', 4); view.state.dice = 6;
  const html = renderToStaticMarkup(React.createElement(LudoBoard, { view, disabled: false, send() {} }));
  assert.equal((html.match(/class="premium-ludo-pawn"/g) ?? []).length, 16);
  assert.equal((html.match(/at base, movable/g) ?? []).length, 4);
  assert.equal((html.match(/data-pip="true"/g) ?? []).length, 6);
  view.state.turn = 1;
  const waiting = renderToStaticMarkup(React.createElement(LudoBoard, { view, disabled: false, send() {} }));
  assert(!waiting.includes('at base, movable'));
});

test('Tic-Tac-Toe: winning line spans the correct cells for X and O in all eight directions', () => {
  for (const line of [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]]) for (const mark of [1,2]) {
    const board = Array(9).fill(0); line.forEach((index) => { board[index] = mark; });
    const html = renderToStaticMarkup(React.createElement(SquareBoard, { view: ticView(board, mark - 1), disabled: true, send() {} }));
    const expected = `<line x1="${line[0] % 3 * 100 + 50}" y1="${Math.floor(line[0] / 3) * 100 + 50}" x2="${line[2] % 3 * 100 + 50}" y2="${Math.floor(line[2] / 3) * 100 + 50}"`;
    assert(html.includes(expected));
  }
});

test('Tic-Tac-Toe: no winning line appears for an unconfirmed result or draw', () => {
  for (const board of [[1,1,1,0,0,0,0,0,0], [1,2,1,1,2,2,2,1,1]]) {
    const html = renderToStaticMarkup(React.createElement(SquareBoard, { view: ticView(board), disabled: true, send() {} }));
    assert(!html.includes('lounge-tic-line'));
  }
});

test('Tic-Tac-Toe: victory announcement identifies the local winner and opponent correctly', () => {
  const board = [1,1,1,0,0,0,0,0,0];
  const win = renderToStaticMarkup(React.createElement(GameEffects, { view: ticView(board, 0) }));
  const loss = renderToStaticMarkup(React.createElement(GameEffects, { view: ticView(board, 1) }));
  const active = renderToStaticMarkup(React.createElement(GameEffects, { view: ticView(Array(9).fill(0)) }));
  assert(win.includes('You win!')); assert(loss.includes('Eni wins!'));
  assert(!active.includes('lounge-celebration')); assert(active.includes('aria-pressed="true"'));
});

test('Sudoku: all existing puzzles, clues, solutions and completion checks', () => {
  assert.equal(sudoku.puzzles.length, 3);
  for (const puzzle of sudoku.puzzles) {
    assert.equal(puzzle.clues.length, 81); assert.equal(puzzle.solution.length, 81);
    for (let i = 0; i < 81; i++) if (puzzle.clues[i] !== '0') assert.equal(puzzle.clues[i], puzzle.solution[i]);
    const entries = [...puzzle.solution]; assert(sudoku.isSolved(puzzle.clues, entries, puzzle.solution));
    entries[puzzle.clues.indexOf('0')] = ''; assert(!sudoku.isSolved(puzzle.clues, entries, puzzle.solution));
    for (let i = 0; i < 9; i++) {
      assert.equal(new Set([...puzzle.solution.slice(i*9,i*9+9)]).size, 9);
      assert.equal(new Set(Array.from({length:9},(_,r) => puzzle.solution[r*9+i])).size, 9);
      assert.equal(new Set(Array.from({length:9},(_,j) => puzzle.solution[(Math.floor(i/3)*3+Math.floor(j/3))*9+(i%3)*3+j%3])).size, 9);
    }
  }
});
test('Sudoku: per-account key remains and restoration rejects corrupt/fixed entries', () => {
  assert.match(fs.readFileSync(base+'/sudoku.tsx','utf8'), /eba-hub:sudoku:v1:.*userId/);
  const restored = sudoku.restoreProgress(JSON.stringify({puzzleId:'sudoku-01',entries:Array(81).fill('1')}));
  assert.equal(restored.entries[0], ''); assert.equal(restored.entries[2], '1');
  assert.deepEqual(sudoku.restoreProgress('not-json'), sudoku.initialProgress());
  assert.deepEqual(sudoku.restoreProgress(JSON.stringify({puzzleId:'bad',entries:[]})), sudoku.initialProgress());
});
const ttt = (s, seat, to) => applyBoardMove('tic-tac-toe',s,seat,2,{type:'place',to});
test('Tic-Tac-Toe: all eight win lines', () => {
  for (const [a,b,c] of [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]]) {
    const s=freshState('tic-tac-toe',2); s.board[a]=1;s.board[b]=1;
    assert.equal(ttt(s,0,c).result.winner,0); assert.equal(s.board[c],0);
  }
});
test('Tic-Tac-Toe: legal draw, occupied cell, out-of-turn and finished-state rejection', () => {
  let s=freshState('tic-tac-toe',2);
  assert.throws(()=>ttt(s,1,0),/turn/); s=ttt(s,0,0);assert.throws(()=>ttt(s,1,0),/empty/);
  s=freshState('tic-tac-toe',2); [0,1,2,4,3,5,7,6,8].forEach((to,i)=>{s=ttt(s,i%2,to);});
  assert(s.result);assert.equal(s.result.winner,undefined);assert.throws(()=>ttt(s,1,0),/finished/);
});
test('Tic-Tac-Toe: rematch alternates first player while X still opens', () => {const s=ttt(freshState('tic-tac-toe',2,1),1,4);assert.equal(s.board[4],1);assert.equal(s.turn,0);});
const check = (s,from,to) => applyBoardMove('checkers',s,s.turn,2,{type:'move',from,to});
function emptyCheck() {const s=freshState('checkers',2);s.board.fill(0);return s;}
test('Checkers: initial setup and compulsory captures', () => {
  const initial=freshState('checkers',2);assert.equal(initial.board.filter(v=>v===1).length,12);assert.equal(checkersMoves(initial).length,7);
  const s=emptyCheck();s.board[17]=1;s.board[26]=-1;s.board[8]=1;
  assert.deepEqual(checkersMoves(s),[{from:17,to:35,captured:26}]);assert.throws(()=>check(s,8,16),/legal/);
});
test('Checkers: multiple jumps lock the piece until the sequence completes', () => {
  let s=emptyCheck();s.board[17]=1;s.board[26]=-1;s.board[44]=-1;s.board[62]=-1;
  s=check(s,17,35);assert.equal(s.turn,0);assert.equal(s.forced,35);assert.equal(s.board[26],0);
  assert.throws(()=>check(s,35,42),/legal/);s=check(s,35,53);assert.equal(s.turn,1);assert.equal(s.forced,null);assert.equal(s.board[44],0);
});
test('Checkers: kings capture backward; men cannot; crowning ends the turn', () => {
  let s=emptyCheck();s.board[42]=2;s.board[33]=-1;s.board[55]=-1;assert.equal(check(s,42,24).board[33],0);
  s.board[42]=1;assert.throws(()=>check(s,42,24),/legal/);
  s=emptyCheck();s.board[42]=1;s.board[51]=-1;s.board[53]=-1;s=check(s,42,60);assert.equal(s.board[60],2);assert.equal(s.turn,1);assert.equal(s.forced,null);
});
test('Checkers: no pieces, no legal moves and quiet draw', () => {
  let s=emptyCheck();s.board[17]=1;s.board[26]=-1;assert.equal(check(s,17,35).result.winner,0);
  s=emptyCheck();s.board[8]=1;s.board[1]=-1;assert.equal(check(s,8,17).result.winner,0);
  s=emptyCheck();s.board[8]=1;s.board[55]=-1;s.quiet=79;assert.match(check(s,8,17).result.message,/80/);
});
const roll=(s,value,count=2)=>applyBoardMove('ludo',s,s.turn,count,{type:'roll'},value);
const token=(s,index,count=2)=>applyBoardMove('ludo',s,s.turn,count,{type:'token',token:index});
test('Ludo: 2–4 seats, six releases, retained turn and no-move pass', () => {
  for(const count of [2,3,4])assert.equal(freshState('ludo',count).tokens.length,count);
  let s=roll(freshState('ludo',2),6);s=token(s,0);assert.equal(s.tokens[0][0],0);assert.equal(s.turn,0);assert.equal(s.dice,null);
  s=roll(freshState('ludo',2),3);assert.equal(s.turn,1);assert.equal(s.dice,null);
  assert.throws(()=>roll(freshState('ludo',2),7),/roll/);assert.throws(()=>token(freshState('ludo',2),0),/Roll/);
});
test('Ludo: third consecutive six forfeits without a move', () => {
  let s=freshState('ludo',2);s=token(roll(s,6),0);s=token(roll(s,6),1);const before=structuredClone(s.tokens);s=roll(s,6);assert.equal(s.turn,1);assert.equal(s.sixes,0);assert.deepEqual(s.tokens,before);
});
test('Ludo: capture, safe squares and private home lane', () => {
  let s=freshState('ludo',2);s.tokens[0][0]=4;s.tokens[1][0]=44;assert.equal(ludoSquare(1,44),5);s=token(roll(s,1),0);assert.equal(s.tokens[1][0],-1);
  s=freshState('ludo',2);s.tokens[0][0]=7;s.tokens[1][0]=47;s=token(roll(s,1),0);assert.equal(s.tokens[1][0],47);
  s=freshState('ludo',2);s.tokens[0][0]=51;s.tokens[1][0]=39;s=token(roll(s,1),0);assert.equal(s.tokens[1][0],39);assert.equal(s.tokens[0][0],52);
});
test('Ludo: exact finish, overshoot passes, all four home wins', () => {
  let s=freshState('ludo',2);s.tokens[0]=[57,57,57,56];assert.equal(roll(s,2).turn,1);s=token(roll(s,1),3);assert.equal(s.result.winner,0);assert.equal(s.tokens[0][3],57);
});
const answers=triviaQuestions.map(q=>q.correct);
test('Trivia: host-only start, immutable answers, strict deadline and server scoring', () => {
  let s=freshState('trivia',2);assert.throws(()=>applyTrivia(s,1,0,{type:'next'},0,answers),/host/);
  s=applyTrivia(s,0,0,{type:'next'},1000,answers);assert.equal(s.deadline,21000);
  s=applyTrivia(s,1,0,{type:'answer',answer:answers[0]},1001,answers);assert.equal(s.scores[1],0);
  assert.throws(()=>applyTrivia(s,1,0,{type:'answer',answer:0},1002,answers),/already/);
  assert.throws(()=>applyTrivia(s,0,0,{type:'answer',answer:0},21000,answers),/closed/);
  assert.throws(()=>applyTrivia(s,1,0,{type:'close'},20999,answers),/open/);
  s=applyTrivia(s,1,0,{type:'close'},21000,answers);assert.equal(s.scores[1],100);assert.throws(()=>applyTrivia(s,1,0,{type:'close'},21001,answers),/open/);
});
test('Trivia: response projection hides every answer and answer key before close', () => {
  let s=applyTrivia(freshState('trivia',2),0,0,{type:'next'},1000,answers);s=applyTrivia(s,0,0,{type:'answer',answer:answers[0]},1001,answers);
  const room={id:'test',game:'trivia',status:'active',result:null};const match={state:s,players:[{user_id:'a',seat:0},{user_id:'b',seat:1}],history:[]};
  const v=publicMatch(room,match,'a');assert.deepEqual(v.state.answers,{});assert.equal(v.question.correct,undefined);assert(v.question.answered);assert.equal(publicMatch(room,match,'stranger').state,null);
  s=applyTrivia(s,1,0,{type:'close'},21000,answers);match.state=s;assert.equal(publicMatch(room,match,'b').question.correct,answers[0]);
});
test('Trivia: all questions end with scores, ties and final result', () => {
  let s=freshState('trivia',2);for(let i=0;i<answers.length;i++){s=applyTrivia(s,0,0,{type:'next'},i*30000,answers);for(let p=0;p<2;p++)s=applyTrivia(s,p,0,{type:'answer',answer:answers[i]},i*30000+1,answers);s=applyTrivia(s,1,0,{type:'close'},i*30000+20000,answers);}assert.deepEqual(s.result.scores,[800,800]);assert.deepEqual(s.result.winners,[0,1]);assert.throws(()=>applyTrivia(s,0,0,{type:'next'},999999,answers),/finished/);
});
test('All social board games: resignation out of turn and reducer input immutability', () => {for(const game of ['ludo','checkers','tic-tac-toe']){const s=freshState(game,2),before=structuredClone(s);assert.equal(applyBoardMove(game,s,0,2,{type:'resign'}).result.winner,1);assert.equal(applyBoardMove(game,s,1,2,{type:'resign'}).result.winner,0);assert.deepEqual(s,before);}});

const chessReady=chessAvailable();
const idx=s=>(8-Number(s[1]))*8+'abcdefgh'.indexOf(s[0]);
function chessSequence(moves,state=freshState('chess',2)){for(const move of moves)state=chessMove(state,state.turn,state.first,{type:'move',from:idx(move.slice(0,2)),to:idx(move.slice(2,4)),promotion:move[4]});return state;}
test('Chess: illegal move and out-of-turn rejection', {skip:!chessReady}, () => {const s=freshState('chess',2);assert.equal(chessLegal(s).length,20);assert.throws(()=>chessMove(s,0,0,{type:'move',from:idx('e2'),to:idx('e5')}));assert.throws(()=>chessMove(s,1,0,{type:'move',from:idx('e2'),to:idx('e4')}));});
test('Chess: checkmate and preserved PGN history', {skip:!chessReady}, () => {const s=chessSequence(['f2f3','e7e5','g2g4','d8h4']);assert.equal(s.result.winner,1);assert.match(s.moves[0],/Qh4#/);});
test('Chess: castling moves both king and rook', {skip:!chessReady}, () => {const s=chessSequence(['e2e4','e7e5','g1f3','b8c6','f1c4','g8f6','e1g1']);assert.match(s.fen,/RNBQ1RK1/);});
test('Chess: en passant removes the passed pawn', {skip:!chessReady}, () => {const s=chessSequence(['e2e4','e7e6','e4e5','d7d5','e5d6']);assert.match(s.fen.split(' ')[0],/3Pp3/);});
function fenState(fen){const s=freshState('chess',2);s.moves=[`[SetUp "1"]\n[FEN "${fen}"]\n\n*`];return s;}
test('Chess: underpromotion', {skip:!chessReady}, () => {const s=chessSequence(['a7a8n'],fenState('7k/P7/8/8/8/8/8/7K w - - 0 1'));assert.match(s.fen,/^N6k/);});
test('Chess: stalemate', {skip:!chessReady}, () => {const s=chessSequence(['c7b6'],fenState('k7/2Q5/2K5/8/8/8/8/8 w - - 0 1'));assert.match(s.result.message,/stalemate/);});
test('Chess: threefold repetition across state reloads', {skip:!chessReady}, () => {const s=chessSequence(['g1f3','g8f6','f3g1','f6g8','g1f3','g8f6','f3g1','f6g8']);assert.match(s.result.message,/Draw/);});
test('Chess: fifty-move draw', {skip:!chessReady}, () => {const s=chessSequence(['a1a2'],fenState('7k/8/8/8/8/8/8/R6K w - - 99 1'));assert.match(s.result.message,/Draw/);});



if (process.argv.includes('--production')) test('Production Chess: compiled engine loads, generates moves and completes checkmate', () => {
  const server = path.resolve(__dirname, '../.next/server');
  assert(fs.existsSync(path.join(server, 'webpack-runtime.js')), 'Create a Webpack production build before running --production.');
  require(path.join(server, 'app/dashboard/games/api/route.js'));
  const runtime = require(path.join(server, 'webpack-runtime.js'));
  const entry = Object.entries(runtime.m).find(([, factory]) => factory.toString().includes('That move is not legal.'));
  assert(entry, 'Compiled chess rules must be present in the production route.');
  const exports = Object.values(runtime(entry[0]));
  const available = exports.find((value) => typeof value === 'function' && value.length === 0);
  const move = exports.find((value) => typeof value === 'function' && value.length === 4);
  assert(available && available(), 'Chess must be available in the compiled server, not just in source tests.');
  assert(move);
  let state = freshState('chess', 2);
  const legal = exports.filter((value) => typeof value === 'function' && value.length === 1).map((fn) => fn(state)).find(Array.isArray);
  assert.equal(legal.length, 20);
  for (const notation of ['f2f3','e7e5','g2g4','d8h4']) state = move(state, state.turn, state.first, { type: 'move', from: idx(notation.slice(0,2)), to: idx(notation.slice(2,4)) });
  assert.equal(state.result.winner, 1); assert.match(state.result.message, /Checkmate/);
});
