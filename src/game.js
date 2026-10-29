/**
 * MKJ Chess — Game Controller
 * -----------------------------------------------------------------------------
 * Owns the game state for every mode, drives move play, the computer opponent,
 * chess clocks, undo/redo, draw offers, resignation, and notifies the UI.
 */

import {
  WHITE,
  BLACK,
  EMPTY,
  PAWN,
  KNIGHT,
  BISHOP,
  ROOK,
  QUEEN,
  KING,
  colorOf,
  FLAG,
  STATUS,
  createGame,
  applyMove,
  undoMove,
  legalMoves,
  findKing,
  inCheck,
  positionToFen,
  gameStatus,
  materialInfo,
  repetitionCount,
  fiftyMoveClaimable,
  validateFen,
} from './chess-rules.js';
import { chooseMove, analyzePosition, getDifficulty, DIFFICULTY_IDS } from './chess-engine.js';
import { Clock, resolveTimeControl } from './clock.js';

const TAB = { HISTORY: 'history', INFO: 'info', HINT: 'hint' };

/** Piece SVG symbol ids (colour-aware), reused by the panel UI. */
export const PIECE_SYMBOL = {
  [PAWN]: { w: 'mkj-piece-wpawn', b: 'mkj-piece-bpawn' },
  [KNIGHT]: { w: 'mkj-piece-wknight', b: 'mkj-piece-bknight' },
  [BISHOP]: { w: 'mkj-piece-wbishop', b: 'mkj-piece-bbishop' },
  [ROOK]: { w: 'mkj-piece-wrook', b: 'mkj-piece-brook' },
  [QUEEN]: { w: 'mkj-piece-wqueen', b: 'mkj-piece-bqueen' },
  [KING]: { w: 'mkj-piece-wking', b: 'mkj-piece-bking' },
};

export class GameController {
  /**
   * @param {object} deps
   * @param {BoardView} deps.board
   * @param {SoundEngine} deps.sound
   * @param {Function} deps.onStatus
   * @param {Function} deps.onMove
   * @param {Function} deps.onSelect
   * @param {Function} deps.onComputerState
   */
  constructor(deps) {
    this.board = deps.board;
    this.sound = deps.sound;
    this.settings = deps.settings || {};
    this.hooks = {
      onStatus: deps.onStatus || (() => {}),
      onMove: deps.onMove || (() => {}),
      onSelect: deps.onSelect || (() => {}),
      onComputerState: deps.onComputerState || (() => {}),
      onPromotion: deps.onPromotion || (() => {}),
      onNewGame: deps.onNewGame || (() => {}),
      onOver: deps.onOver || (() => {}),
      onToast: deps.onToast || (() => {}),
      onHistory: deps.onHistory || (() => {}),
      onInfo: deps.onInfo || (() => {}),
      onHint: deps.onHint || (() => {}),
      onMoveHistoryEdit: deps.onMoveHistoryEdit || (() => {}),
    };

    this.game = null;
    this.mode = 'local';
    this.scope = 'local';
    this.difficulty = 'medium';
    this.humanSide = WHITE;
    this.whiteName = 'White';
    this.blackName = 'Black';
    this.controls = null;
    this.clock = null;
    this.over = false;
    this.result = '*';
    this.thinking = false;
    this.gameOverReason = null;
    this._undone = [];
    this.historyEl = null;
    this.startedAt = Date.now();
    this.elapsedSeconds = 0;
    this._promotionResolver = null;
    this._residualTimer = null;
    this._serverSeen = null;
    this.premove = null;
    this.puzzle = null;
    this.practiceMode = false;
    this.hinted = false;
    this.lastHintMove = null;
    this._hintedFrom = null;
  }

  /* ==================== Game lifecycle ==================== */

  start(config) {
    this.stopComputer();
    this.closeClock();
    this.mode = config.mode || 'local';
    this.scope = config.scope || (this.mode === 'computer' ? 'computer' : 'local');
    this.difficulty = config.difficulty || getDifficulty(this.settings.defaultDifficulty || 'medium').id;
    this.humanSide = config.humanSide || (this.settings.defaultSide || 'white');
    this.practiceMode = Boolean(config.practice);
    this.puzzle = config.puzzle || null;

    const startFen = config.fen || (config.random ? null : null);
    this.game = startFen ? createGame(startFen) : createGame();
    if (config.fen && !validateFen(config.fen).ok) {
      const err = new Error('Invalid FEN for a new game');
      err.validation = true;
      throw err;
    }
    this._undone = [];
    this.over = false;
    this.result = '*';
    this.gameOverReason = null;
    this.startedAt = Date.now();
    this.elapsedSeconds = 0;
    this.premove = null;
    this.hinted = false;
    this.lastHintMove = null;

    const names = config.names || {};
    this.whiteName = names.white || this.whiteName || 'White';
    this.blackName = names.black || this.blackName || 'Black';
    if (this.mode === 'computer') {
      if (this.humanSide === WHITE) { this.whiteName = names.white || 'You'; this.blackName = names.black || 'MKJ Computer'; }
      else { this.whiteName = names.white || 'MKJ Computer'; this.blackName = names.black || 'You'; }
    } else if (this.mode === 'passplay') {
      this.whiteName = names.white || 'Player 1';
      this.blackName = names.black || 'Player 2';
    }

    this.controls = resolveTimeControl(
      config.timeControl,
      this.settings.customTimeControl || '10-0',
    ) || null;

    this._openClock();
    this.board.setBoard(this.game.position.board);
    this.board.applyOptions({
      showCoordinates: this.settings.showCoordinates !== false,
      showLegalMoves: this.settings.showLegalMoves !== false,
      pieceAnimations: this.settings.pieceAnimations !== false,
      interactive: true,
    });
    this.applyFlip();
    this.renderStatus();
    this.renderMoveList();
    this.renderInfo();
    this.renderHint();

    if (this.controls) {
      this._startClock();
    }
    if (this.game.position.turn === (this.mode === 'computer' && this.humanSide === BLACK ? BLACK : WHITE)) {
      if (this.mode === 'computer' && this.game.position.turn === BLACK) this._computerMove();
    } else if (this.mode === 'computer' && this.game.position.turn !== this.humanSide) {
      this._computerMove();
    }
  }

  applyFlip() {
    const wantFlip =
      this.settings.flipBoard === true ||
      (this.mode === 'computer' && this.humanSide === BLACK);
    this.board.setFlip(Boolean(wantFlip));
    this.board.applyCoordinates();
  }

  toggleFlip() {
    this.settings = { ...this.settings, flipBoard: !this.settings.flipBoard };
    this.applyFlip();
  }

  /* ==================== Clock ==================== */

  _openClock() {
    this.closeClock();
    if (!this.controls) return;
    this.clock = new Clock({
      controls: {
        [WHITE]: { initial: this.controls.initial, increment: this.controls.increment },
        [BLACK]: { initial: this.controls.initial, increment: this.controls.increment },
      },
      onTick: () => this.renderInfo(),
      onTimeout: (color) => this._onTimeout(color),
    });
  }

  closeClock() {
    if (this.clock) this.clock.destroy();
    this.clock = null;
  }

  _startClock() {
    if (!this.clock) return;
    this._stopClockTimer();
    this.clock.start();
    this.clock.setTurn(this.game.position.turn);
    this._clockTimer = window.setInterval(() => this._tickClock(), 200);
  }

  _stopClockTimer() {
    if (this._clockTimer) {
      window.clearInterval(this._clockTimer);
      this._clockTimer = null;
    }
  }

  _tickClock() {
    if (!this.clock || this.over) return;
    this.clock.tick();
    this.renderInfo();
  }

  /** Resume the clock for the side to move (used after undo or a pause). */
  _resumeClock() {
    if (!this.clock || this.over) return;
    this.clock.setTurn(this.game.position.turn);
  }

  _onTimeout(color) {
    this.stopComputer();
    this.clock.stop();
    this.over = true;
    this.result = color === WHITE ? '0-1' : '1-0';
    this.gameOverReason = {
      label: `${color === WHITE ? this.whiteName : this.blackName} ran out of time.`,
      status: STATUS.TIMEOUT,
      winner: color === WHITE ? BLACK : WHITE,
    };
    this.sound.timeout();
    this.hooks.onStatus(this.getStatusPayload());
    this.hooks.onOver(this.gameOverReason);
  }

  /* ==================== Interaction ==================== */

  /** Called by the board when a square is clicked. */
  handleSquareClick(sq) {
    if (this.over) return;
    if (this.thinking) return;

    const color = this.game.position.turn;
    if (this.mode === 'computer' && color !== this.humanSide) return;

    this.sound.ensureContext();

    if (this.board.selected >= 0) {
      // A piece is already selected: try to move onto this square.
      if (this.board.selected === sq) {
        this.board.clearSelection();
        this.sound.select();
        this.hooks.onSelect(null);
        return;
      }
      const targets = this.board.legalTargets;
      if (targets.includes(sq)) {
        const candidates = legalMoves(this.game).filter((m) => m.from === this.board.selected && m.to === sq);
        if (!candidates.length) return;
        if (candidates.length === 1) {
          this.playMove(candidates[0]);
          return;
        }
        // Promotion: ask the player which piece to promote to, then play.
        this._playPromotion(candidates);
        return;
      }
      // Clicked another piece — reselect it instead.
    }

    const piece = this.game.position.board[sq];
    if (piece === EMPTY) return;
    if (colorOf(piece) !== color) return;

    const targets = legalMoves(this.game).filter((m) => m.from === sq).map((m) => m.to);
    if (!targets.length) {
      this.sound.click();
      this.board.shake(sq);
      this.hooks.onToast('That piece has no legal moves here.', 'warn');
      return;
    }

    this.board.setSelected(sq, targets);
    this.sound.select();
    this.hooks.onSelect({ sq, targets, piece });
  }

  /**
   * Ask the UI for the promotion piece, then play the chosen move.
   * The UI resolves the promise with { promotion }.
   */
  async _playPromotion(candidates) {
    const color = this.game.position.turn;
    let choice = null;
    try {
      choice = await this.hooks.onPromotion(color);
    } catch {
      choice = null;
    }
    const move = candidates.find((m) => m.promotion === choice?.promotion) || candidates[0];
    this.playMove(move);
  }

  /** Play a move object (already validated by the rules engine). */
  playMove(move) {
    try {
      // Remember the clock so undo can restore it exactly.
      const snapshot = this.clock ? this.clock.snapshot() : null;
      const entry = applyMove(this.game, move);
      if (snapshot) entry.clockSnapshot = snapshot;
      this.sound.ensureContext();
      this.playSound(entry.move, entry.san);
      this.board.setBoard(this.game.position.board, entry.move);
      this.board.setLastMove(entry.move.from, entry.move.to);
      // The side to move *after* the move is the one that may be in check
      // (entry.undo.turn is the mover, captured before the turn flipped).
      const sideToMove = this.game.position.turn;
      this.board.setCheck(inCheck(this.game.position, sideToMove) ? this.kingSqOf(sideToMove) : -1);
      this.board.clearHintArrow();
      this.redoStack = [];
      this.hinted = false;
      this.lastHintMove = null;
      this.hooks.onMove(entry);
      this.renderMoveList();
      this.renderInfo();
      this.renderHint();

      // Clock bookkeeping.
      if (this.clock) {
        this.clock.stop();
        this.clock.awardIncrement(entry.undo.turn);
        this.clock.setTurn(this.game.position.turn);
      }

      const status = this.checkStatus();
      if (status.over) {
        this.finish(status);
        return;
      }

      // Computer turn.
      if (this.mode === 'computer' && this.game.position.turn !== this.humanSide && !this.over) {
        this._computerMove();
      }
    } catch (err) {
      this.board.shake(move.from);
      this.hooks.onToast(err.message, 'error');
    }
  }

  kingSqOf(color) {
    return findKing(this.game.position, color);
  }

  playSound(move, san) {
    if (move.flags & (FLAG.CASTLE_KS | FLAG.CASTLE_QS)) { this.sound.castling(); return; }
    if (move.flags & FLAG.EP_CAPTURE) { this.sound.capture(); return; }
    if (move.flags & FLAG.CAPTURE) { this.sound.capture(); return; }
    if (move.flags & FLAG.PROMOTION) { this.sound.promotion(); return; }
    this.sound.move();
    if (san && san.endsWith('+') && !san.endsWith('#')) this.sound.check();
    if (san && san.endsWith('#')) this.sound.check();
  }

  /* ==================== Status ==================== */

  checkStatus() {
    const status = gameStatus(this.game, { autoFifty: this.settings.autoFifty !== false });
    if (status.over) {
      this.over = true;
      this.result = status.winner ? (status.winner === WHITE ? '1-0' : '0-1') : '1/2-1/2';
      this.gameOverReason = {
        label: status.description,
        status: status.status,
        winner: status.winner,
      };
    }
    return status;
  }

  getStatusPayload() {
    const status = gameStatus(this.game, { autoFifty: this.settings.autoFifty !== false });
    return {
      ...status,
      moveCount: this.game.history.length,
      result: this.result,
      difficulty: this.difficulty,
      mode: this.mode,
      scope: this.scope,
      humanSide: this.humanSide,
    };
  }

  finish(status) {
    this.stopComputer();
    this.closeClock();
    this.board.clearSelection();

    const winner = status.winner;
    const humanWon = this.humanSide === winner;
    if (winner) this.sound[humanWon ? 'win' : 'loss']();
    else this.sound.draw();

    this.hooks.onStatus(this.getStatusPayload());
    this.hooks.onOver({
      label: status.description,
      status: status.status,
      winner,
    });
  }

  /* ==================== Undo / Redo ==================== */

  canUndo() {
    return !this.over && Boolean(this.game) && this.game.history.length > 0 && !this.thinking;
  }

  /**
   * Undo. In computer mode one undo steps back both the player's move and the
   * engine's reply, so the player lands on their own move again.
   */
  undo() {
    if (this.thinking) return;
    if (!this.game.history.length) return;
    if (this.over) {
      this.hooks.onToast('The game is over. Start a new game to play again.', 'warn');
      return;
    }

    const plies = this.mode === 'computer' ? 2 : 1;
    const undone = [];
    for (let i = 0; i < plies && this.game.history.length; i++) {
      const entry = undoMove(this.game);
      if (!entry) break;
      undone.push(entry);
    }
    if (!undone.length) return;

    this._undone.push(...undone);

    // Restore the clock to the state before the earliest undone ply.
    const target = undone[undone.length - 1].clockSnapshot;
    if (target && this.clock) this.clock.restore(target);

    this.board.setBoard(this.game.position.board);
    this.board.clearHighlights();
    const last = this.game.history[this.game.history.length - 1];
    if (last) this.board.setLastMove(last.move.from, last.move.to);
    this.board.setCheck(this._checkSquare());
    this.hinted = false;
    this.lastHintMove = null;
    this.board.clearHintArrow();
    this.renderMoveList();
    this.renderInfo();
    this.renderHint();
    this.hooks.onMoveHistoryEdit('undo');
    this.sound.click();
    this._resumeClock();
  }

  canRedo() {
    return !this.thinking && this._undone.length > 0;
  }

  /** Re-apply the most recently undone move. */
  redo() {
    if (this.thinking) return;
    if (!this._undone.length) return;

    const next = this._undone.pop();
    try {
      const entry = applyMove(this.game, next.move);
      this.board.setBoard(this.game.position.board, entry.move);
      this.board.setLastMove(entry.move.from, entry.move.to);
      this.board.setCheck(this._checkSquare());
      this.board.clearHintArrow();
      this.hinted = false;
      this.lastHintMove = null;
      this.renderMoveList();
      this.renderInfo();
      this.renderHint();

      if (this.clock) {
        this.clock.stop();
        this.clock.awardIncrement(entry.undo.turn);
        this.clock.setTurn(this.game.position.turn);
      }
      this.hooks.onMoveHistoryEdit('redo');
      this.sound.click();
      this._resumeClock();

      if (this.mode === 'computer' && this.game.position.turn !== this.humanSide && !this.over) {
        this._computerMove();
      }
    } catch (err) {
      this.hooks.onToast(err.message, 'error');
    }
  }

  _checkSquare() {
    const king = findKing(this.game.position, this.game.position.turn);
    return king >= 0 && inCheck(this.game.position, this.game.position.turn) ? king : -1;
  }

  lastMove() {
    const h = this.game.history;
    if (!h.length) return null;
    return h[h.length - 1].move;
  }

  /* ==================== Computer ==================== */

  _computerMove() {
    if (this.over) return;
    this.thinking = true;
    this.hooks.onComputerState({ thinking: true, status: this.thinking });

    // Yield first so the UI updates before the (synchronous) search blocks.
    window.setTimeout(() => {
      try {
        const cfg = getDifficulty(this.difficulty);
        const res = chooseMove(this.game.position, this.difficulty, {
          resetHistory: true,
          onInfo: (info) => this.hooks.onStatus({ ...this.getStatusPayload(), engineDepth: info.depth, engineNodes: info.nodes }),
        });

        // The engine may return a promotion; resolve the choice for the computer.
        let move = res.move;
        if (move && move.flags & FLAG.PROMOTION) {
          move = move.promotion === QUEEN ? move : { ...move, promotion: QUEEN };
        }
        if (move) {
          this.thinking = false;
          this.playMove(move);
        } else {
          this.thinking = false;
          this.hooks.onComputerState({ thinking: false, reason: 'no-moves' });
        }
      } catch (err) {
        this.thinking = false;
        this.hooks.onComputerState({ thinking: false, error: err.message });
        this.hooks.onToast('The computer could not move: ' + err.message, 'error');
      }
    }, 120);
  }

  stopComputer() {
    this.thinking = false;
    this.hooks.onComputerState({ thinking: false });
  }

  setDifficulty(level) {
    if (!DIFFICULTY_IDS.includes(level)) return;
    this.difficulty = level;
  }

  /* ==================== Player actions ==================== */

  resign() {
    if (this.over) return;
    const loser = this.game.position.turn;
    const winner = loser === WHITE ? BLACK : WHITE;
    this.stopComputer();
    this.closeClock();
    this.over = true;
    this.result = winner === WHITE ? '1-0' : '0-1';
    this.gameOverReason = {
      label: `${this.mode === 'computer' ? 'You resigned.' : `${this.colorName(loser)} resigned.`}`,
      status: STATUS.RESIGNATION,
      winner,
    };
    this.sound.resign();
    this.hooks.onStatus(this.getStatusPayload());
    this.hooks.onOver(this.gameOverReason);
  }

  offerDraw() {
    if (this.over) return;
    this.hooks.onDrawOffer(this.game.position.turn);
  }

  acceptDraw() {
    this.finish({
      over: true,
      status: STATUS.AGREED_DRAW,
      winner: null,
      description: 'Draw agreed.',
    });
  }

  declineDraw() {
    this.hooks.onToast('Draw offer declined.', 'warn');
  }

  claimDraw() {
    if (!fiftyMoveClaimable(this.game)) {
      this.hooks.onToast('Neither player has claimed the 50-move rule yet.', 'warn');
      return;
    }
    const halfmoveCount = Math.floor(this.game.position.halfmove);
    this.finish({
      over: true,
      status: STATUS.FIFTY_MOVE,
      winner: null,
      description: `Draw claimed — ${halfmoveCount} half-moves without a capture or pawn move.`,
    });
  }

  colorName(color) {
    return color === WHITE ? this.whiteName : this.blackName;
  }

  /* ==================== Hints & analysis ==================== */

  requestHint() {
    if (this.over || this.thinking) return null;
    this.sound.ensureContext();
    const analysis = analyzePosition(this.game.position, {
      depth: 6,
      timeMs: Math.min(1200, this.controls ? 800 : 1200),
    });
    if (!analysis) {
      this.hooks.onToast('There are no moves to analyse.', 'warn');
      return null;
    }
    this.lastHintMove = analysis;
    this.board.setHintArrow(analysis.move.from, analysis.move.to);
    this.hinted = true;
    this.hooks.onHint(analysis);
    return analysis;
  }

  /* ==================== Rendering helpers ==================== */

  renderStatus() {
    this.hooks.onStatus(this.getStatusPayload());
  }

  /**
   * Build the display rows for the move list.
   * Rows are paired by full move number; a game that starts with Black gets
   * a leading "…" row.
   */
  renderMoveList() {
    const h = this.game.history;
    const startTurn = this.game.startTurn || WHITE;
    const startFullmove = this.game.startFullmove || 1;

    let expectWhite = startTurn === WHITE;
    let moveNumber = startFullmove;
    const rows = [];

    for (let i = 0; i < h.length; i++) {
      if (expectWhite) {
        rows.push({ number: moveNumber, white: h[i].san, black: '', index: i });
      } else {
        const existing = rows[rows.length - 1];
        if (existing && existing.number === moveNumber) {
          existing.black = h[i].san;
        } else {
          rows.push({ number: moveNumber, white: '', black: h[i].san, index: i });
        }
      }
      if (!expectWhite) moveNumber += 1;
      expectWhite = !expectWhite;
    }

    this.hooks.onHistory(rows);
    this.hooks.onInfo(this.buildInfoPayload());
  }

  buildInfoPayload() {
    const { capturedWhite, capturedBlack, balance } = materialInfo(this.game);
    return {
      mode: this.mode,
      difficulty: this.difficulty,
      whiteName: this.whiteName,
      blackName: this.blackName,
      turn: this.game.position.turn,
      fen: positionToFen(this.game.position),
      moves: this.game.history.length,
      capturedWhite,
      capturedBlack,
      balance,
      advantage: balance > 0 ? 'White' : balance < 0 ? 'Black' : null,
      advantagePawns: Math.abs(balance) / 100,
      clock: this.clock ? {
        enabled: true,
        white: this.clock.remaining[WHITE],
        black: this.clock.remaining[BLACK],
      } : { enabled: false },
      repetition: repetitionCount(this.game),
      halfmove: this.game.position.halfmove,
      fiftyClaimable: fiftyMoveClaimable(this.game),
      check: this._checkSquare() >= 0,
      over: this.over,
      result: this.result,
      timeElapsed: Math.floor((Date.now() - this.startedAt) / 1000),
    };
  }

  renderInfo() {
    this.hooks.onInfo(this.buildInfoPayload());
  }

  renderHint() {
    if (this.lastHintMove) {
      this.hooks.onHint(this.lastHintMove);
    } else {
      this.hooks.onHint(null);
    }
  }
}
