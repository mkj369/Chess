/**
 * MKJ Chess — Board View
 * -----------------------------------------------------------------------------
 * Renders the board and pieces, shows legal-move indicators, the last move,
 * check, selection, the engine's hint arrow, and handles all pointer input.
 *
 * Layout model
 *   The board is an 8x8 grid of square divs. Every piece is a direct child of
 *   the board, absolutely positioned by percentage, so it can animate smoothly
 *   between squares by simply transitioning `left`/`top`.
 *
 *   visualPos(boardSq) tells where a board index is drawn. Flipping the board
 *   only recomputes these positions, which animates every piece naturally.
 */

import {
  EMPTY,
  PAWN,
  KNIGHT,
  BISHOP,
  ROOK,
  QUEEN,
  KING,
  PIECE_NAMES,
  absPiece,
  squareName,
} from './chess-rules.js';

const FILES = 'abcdefgh';

/** Symbol id for a piece, e.g. "mkj-piece-wpawn". */
function pieceSymbol(piece) {
  const color = piece > 0 ? 'w' : 'b';
  return `mkj-piece-${color}${PIECE_NAMES[absPiece(piece)].toLowerCase()}`;
}

/** Visual position (0..63, top-left to bottom-right) for a board square. */
export function visualPos(boardSq, flipped) {
  if (flipped) return boardSq;
  const r = (boardSq >> 3);
  return (7 - r) * 8 + (boardSq & 7);
}

/** Inverse of visualPos: which board square sits at visual position k. */
export function boardSqAt(k, flipped) {
  if (flipped) return k;
  const f = k & 7;
  const r = 7 - (k >> 3);
  return r * 8 + f;
}

/** Is the square at visual position k light-coloured? */
function isLight(k) {
  return ((k & 7) + (7 - (k >> 3))) % 2 === 1;
}

export class BoardView {
  /**
   * @param {HTMLElement} boardEl the .mkj-board element
   * @param {object} options { onSquareClick(boardSq), flipped }
   */
  constructor(boardEl, options = {}) {
    this.el = boardEl;
    this.options = options;
    this.flipped = Boolean(options.flipped);
    this.showCoordinates = true;
    this.showLegalMoves = true;
    this.pieceAnimations = true;
    this.orientation = 'white'; // 'white' | 'black'
    this.squares = [];
    this.pieces = {}; // boardSq -> element
    this.selected = -1;
    this.legalTargets = [];
    this.lastMove = null;
    this.checkSq = -1;
    this.hintArrow = null;
    this.board = new Int8Array(64);
    this.interactive = true;
    this._lastPlayed = null;
    this._drag = null; // active pointer drag state
    this._brandEl = null; // board branding overlay
  }

  /* ==================== Build ==================== */

  build() {
    this.el.innerHTML = '';
    this.squares = [];
    this.pieces = {};

    for (let k = 0; k < 64; k++) {
      const sq = boardSqAt(k, this.flipped);
      const div = document.createElement('div');
      div.className = 'mkj-sq' + (isLight(k) ? '' : ' mkj-sq--dark');
      div.dataset.sq = String(sq);
      div.style.left = `${(k % 8) * 12.5}%`;
      div.style.top = `${Math.floor(k / 8) * 12.5}%`;
      div.style.width = '12.5%';
      div.style.height = '12.5%';

      div.setAttribute('role', 'gridcell');
      div.setAttribute('aria-label', squareName(sq));
      div.setAttribute('tabindex', '-1');

      div.addEventListener('click', () => {
        if (this.interactive) this.options.onSquareClick?.(sq);
      });

      this.el.appendChild(div);
      this.squares.push(div);
    }

    // MKJ board branding: a corner monogram and a subtle watermark.
    const brand = document.createElement('div');
    brand.className = 'mkj-boardbrand';
    brand.innerHTML =
      '<span class="mkj-boardbrand__logo">MKJ</span>' +
      '<span class="mkj-boardbrand__watermark">MKJ</span>';
    this.el.appendChild(brand);
    this._brandEl = brand;
  }

  /* ==================== Pieces ==================== */

  /** Create a piece element for a board square. */
  createPiece(sq) {
    const piece = this.board[sq];
    if (piece === EMPTY) return null;

    const div = document.createElement('div');
    div.className = `mkj-piece mkj-piece--${piece > 0 ? 'w' : 'b'}`;
    div.dataset.sq = String(sq);
    div.innerHTML = `<svg viewBox="0 0 100 100"><use href="#${pieceSymbol(piece)}"/></svg>`;

    const k = visualPos(sq, this.flipped);
    div.style.left = `${(k % 8) * 12.5 + 7.5}%`;
    div.style.top = `${Math.floor(k / 8) * 12.5 + 7.5}%`;

    this._attachDrag(div, sq);
    this.el.appendChild(div);
    this.pieces[sq] = div;
    return div;
  }

  /** Rebuild all pieces from a board array. */
  /**
   * Reconcile the rendered pieces with the board state.
   * @param {object|null} move optional {from,to,captured} describing the last
   *   move, so the moving piece can slide smoothly and only genuinely captured
   *   pieces get the fall/slide animation.
   */
  syncPieces(move = null) {
    const movedFrom = move ? move.from : -1;
    const movedTo = move ? move.to : -1;
    const isCapture = Boolean(move && move.captured);

    // Animate a captured piece falling off its square.
    if (isCapture && this.pieces[movedTo]) {
      const cap = this.pieces[movedTo];
      cap.classList.add('is-captured');
      const kill = () => { if (cap.parentNode === this.el) this.el.removeChild(cap); };
      setTimeout(kill, this.pieceAnimations ? 340 : 0);
      delete this.pieces[movedTo];
    }

    // Remove any other piece that vanished (undo/redo/reload). The moving
    // piece's old square is skipped — it is handled by movePiece below.
    for (const sqStr of Object.keys(this.pieces)) {
      const sq = Number(sqStr);
      if (this.board[sq] === EMPTY && sq !== movedFrom) {
        const node = this.pieces[sq];
        if (node && node.parentNode === this.el) {
          node.classList.add('is-captured');
          const kill = () => { if (node.parentNode === this.el) this.el.removeChild(node); };
          setTimeout(kill, this.pieceAnimations ? 340 : 0);
        }
        delete this.pieces[sq];
      }
    }

    // Slide the moving piece from -> to.
    if (move && this.pieces[movedFrom]) {
      this.movePiece(movedFrom, movedTo);
    }

    // Create or reposition the rest.
    for (let sq = 0; sq < 64; sq++) {
      const piece = this.board[sq];
      if (piece === EMPTY) continue;
      if (move && sq === movedTo) continue; // already handled by movePiece
      const existing = this.pieces[sq];
      if (existing) {
        this._updatePieceVisual(existing, piece);
        this._reposition(existing, sq);
      } else {
        this.createPiece(sq);
      }
    }
  }

  /** Update a piece element's sprite reference when the piece type changed
   *  (e.g. after undo/redo of a promotion, or a piece swap). */
  _updatePieceVisual(node, piece) {
    const expected = `#${pieceSymbol(piece)}`;
    const use = node.querySelector('use');
    if (use && use.getAttribute('href') !== expected) {
      use.setAttribute('href', expected);
    }
  }

  /** Position a piece element over a board square (no move animation). */
  _reposition(node, sq) {
    const k = visualPos(sq, this.flipped);
    node.style.left = `${(k % 8) * 12.5 + 7.5}%`;
    node.style.top = `${Math.floor(k / 8) * 12.5 + 7.5}%`;
    node.style.transform = '';
    node.classList.remove('is-moving');
  }

  /** Move a piece between squares with a little animation flourish. */
  movePiece(fromSq, toSq) {
    const node = this.pieces[fromSq];
    if (!node) return;
    delete this.pieces[fromSq];
    this.pieces[toSq] = node;
    node.dataset.sq = String(toSq);
    node.style.transform = '';
    node.classList.add('is-moving');
    const k = visualPos(toSq, this.flipped);
    node.style.left = `${(k % 8) * 12.5 + 7.5}%`;
    node.style.top = `${Math.floor(k / 8) * 12.5 + 7.5}%`;
    setTimeout(() => node.classList.remove('is-moving'), 320);
    // Promotions change the piece type (pawn -> queen/rook/bishop/knight);
    // refresh the sprite reference so the promoted piece renders correctly.
    this._updatePieceVisual(node, this.board[toSq]);
  }

  /* ==================== Drag and drop ==================== */

  /**
   * Attach pointer drag handlers to a piece element. A tap selects the piece
   * (via onSquareClick); a drag lifts it and, on release over a target square,
   * completes the move.
   */
  _attachDrag(node, sq) {
    node.addEventListener('pointerdown', (e) => {
      if (!this.interactive) return;
      if (e.button !== undefined && e.button !== 0) return; // left/touch only
      e.preventDefault();
      this._drag = {
        node,
        fromSq: sq,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        dragging: false,
      };
      this._dragMove = (ev) => this._onDragMove(ev);
      this._dragEnd = (ev) => this._onDragEnd(ev);
      window.addEventListener('pointermove', this._dragMove);
      window.addEventListener('pointerup', this._dragEnd);
      window.addEventListener('pointercancel', this._dragEnd);
    });
  }

  _onDragMove(e) {
    const d = this._drag;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.dragging && Math.hypot(dx, dy) > 6) {
      // Select the piece on the first real drag movement. If it cannot be
      // selected (computer's turn, no legal moves), cancel the drag.
      this.options.onSquareClick?.(d.fromSq);
      if (this.selected !== d.fromSq) {
        this._cancelDrag();
        return;
      }
      d.dragging = true;
      d.node.classList.add('is-dragging');
    }
    if (d.dragging) {
      d.node.style.transform = `translate(${dx}px, ${dy}px) scale(1.12)`;
    }
  }

  _onDragEnd(e) {
    const d = this._drag;
    if (!d || d.pointerId !== e.pointerId) return;
    this._drag = null;
    window.removeEventListener('pointermove', this._dragMove);
    window.removeEventListener('pointerup', this._dragEnd);
    window.removeEventListener('pointercancel', this._dragEnd);
    this._dragMove = null;
    this._dragEnd = null;
    if (d.dragging) {
      d.node.classList.remove('is-dragging');
      d.node.style.transform = '';
      const toSq = this._squareAtPointer(e.clientX, e.clientY);
      if (toSq >= 0 && toSq !== d.fromSq) {
        this.options.onSquareClick?.(toSq);
      }
    } else {
      // A tap (no drag): select/deselect the piece, same as a click.
      this.options.onSquareClick?.(d.fromSq);
    }
  }

  _cancelDrag() {
    const d = this._drag;
    if (!d) return;
    this._drag = null;
    window.removeEventListener('pointermove', this._dragMove);
    window.removeEventListener('pointerup', this._dragEnd);
    window.removeEventListener('pointercancel', this._dragEnd);
    this._dragMove = null;
    this._dragEnd = null;
    d.node.classList.remove('is-dragging');
    d.node.style.transform = '';
  }

  /** Board square under a client-space point, or -1 if outside the board. */
  _squareAtPointer(clientX, clientY) {
    const r = this.el.getBoundingClientRect();
    if (
      clientX < r.left || clientX > r.right ||
      clientY < r.top || clientY > r.bottom
    ) {
      return -1;
    }
    const size = r.width / 8;
    const file = Math.floor((clientX - r.left) / size);
    const row = Math.floor((clientY - r.top) / size);
    if (file < 0 || file > 7 || row < 0 || row > 7) return -1;
    return boardSqAt(file + row * 8, this.flipped);
  }

  /** Show a "shake" animation on a square, used to reject an illegal move. */
  shake(sq) {
    const node = this.pieces[sq];
    if (!node) return;
    node.classList.remove('is-shake');
    void node.offsetWidth; // force reflow so the animation restarts
    node.classList.add('is-shake');
    setTimeout(() => node.classList.remove('is-shake'), 340);
  }

  /* ==================== Highlights ==================== */

  setBoard(board, move = null) {
    this.board = board instanceof Int8Array ? board : Int8Array.from(board);
    this.syncPieces(move);
  }

  /** Clear every marker overlay. */
  clearMarkers() {
    for (const sqStr of Object.keys(this.pieces)) {
      // markers are stored as children of squares
    }
    const frag = document.createDocumentFragment();
    for (const div of this.squares) {
      div.querySelectorAll('.mkj-dot, .mkj-arrow').forEach((n) => n.remove());
    }
    void frag;
  }

  clearHighlights() {
    for (const div of this.squares) {
      div.classList.remove('is-selected', 'is-last', 'mkj-sq--check');
    }
    this.selected = -1;
    this.legalTargets = [];
    this.lastMove = null;
    this.checkSq = -1;
    this.hintArrow = null;
    this.clearMarkers();
  }

  setLastMove(from, to) {
    this.clearHighlights();
    this.lastMove = { from, to };
    this.renderHighlights();
  }

  setCheck(sq) {
    this.checkSq = sq;
    this.renderHighlights();
  }

  setSelected(sq, targets) {
    this.selected = sq;
    this.legalTargets = targets || [];
    this.renderHighlights();
  }

  clearSelection() {
    if (this.selected !== -1) {
      this.selected = -1;
      this.legalTargets = [];
      this.renderHighlights();
    }
  }

  setHintArrow(from, to) {
    this.hintArrow = { from, to };
    this.clearMarkers();
    this.renderHighlights();
  }

  clearHintArrow() {
    if (this.hintArrow) {
      this.hintArrow = null;
      this.clearMarkers();
      this.renderHighlights();
    }
  }

  /** Repaint every marker from the current state. */
  renderHighlights() {
    for (const div of this.squares) {
      div.classList.remove('is-selected', 'is-last', 'mkj-sq--check');
      div.querySelectorAll('.mkj-dot, .mkj-arrow').forEach((n) => n.remove());
    }

    if (this.lastMove && this.lastMove.from >= 0) {
      const a = this.squares[visualPos(this.lastMove.from, this.flipped)];
      const b = this.squares[visualPos(this.lastMove.to, this.flipped)];
      if (a) a.classList.add('is-last');
      if (b) b.classList.add('is-last');
    }

    if (this.checkSq >= 0) {
      const node = this.squares[visualPos(this.checkSq, this.flipped)];
      if (node) node.classList.add('mkj-sq--check');
    }

    if (this.selected >= 0) {
      const node = this.squares[visualPos(this.selected, this.flipped)];
      if (node) node.classList.add('is-selected');
    }

    if (this.selected >= 0 && this.showLegalMoves && this.legalTargets.length) {
      for (const target of this.legalTargets) {
        const node = this.squares[visualPos(target, this.flipped)];
        if (!node) continue;
        const occupied = this.board[target] !== EMPTY;
        if (occupied) {
          const ring = document.createElement('div');
          ring.className = 'mkj-ring';
          ring.style.cssText = 'position:absolute;inset:8%;border-radius:50%;border:3px solid rgba(255,255,255,0.85);box-shadow:0 0 0 2px rgba(0,0,0,0.35);';
          node.appendChild(ring);
        } else {
          const dot = document.createElement('div');
          dot.className = 'mkj-dot';
          node.appendChild(dot);
        }
      }
    }

    if (this.hintArrow) {
      const fromK = visualPos(this.hintArrow.from, this.flipped);
      const toK = visualPos(this.hintArrow.to, this.flipped);
      const arrow = this._hintArrowPath(fromK, toK);
      if (arrow) this.el.appendChild(arrow);
    }
  }

  _hintArrowPath(fromK, toK) {
    const from = this._rect(fromK);
    const to = this._rect(toK);
    const ax = from.left + from.width / 2;
    const ay = from.top + from.height / 2;
    const bx = to.left + to.width / 2;
    const by = to.top + to.height / 2;

    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const u = { x: dx / len, y: dy / len };
    // Stop the arrow short of the target centre so the piece is still visible.
    const ex = bx - u.x * from.width * 0.5;
    const ey = by - u.y * from.width * 0.5;
    const pad = 10;
    const f = { x: ax + u.x * pad, y: ay + u.y * pad };

    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'mkj-arrow');
    svg.setAttribute('viewBox', `0 0 ${this.el.clientWidth} ${this.el.clientHeight}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.style.position = 'absolute';
    svg.style.left = '0';
    svg.style.top = '0';
    svg.style.pointerEvents = 'none';
    svg.style.zIndex = '6';

    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', `M ${f.x} ${f.y} L ${ex} ${ey}`);
    path.setAttribute('stroke', '#ffd98a');
    path.setAttribute('stroke-width', '5');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('fill', 'none');
    svg.appendChild(path);

    const head = document.createElementNS(ns, 'path');
    const size = 11;
    head.setAttribute(
      'd',
      `M ${ex} ${ey} l ${-u.x * size} ${-u.y * size * 1.5} l ${-u.y * size} ${u.x * size} l ${-u.x * size} ${u.y * size * 1.5} Z`,
    );
    head.setAttribute('fill', '#ffd98a');
    svg.appendChild(head);

    return svg;
  }

  _rect(k) {
    const r = this.el.getBoundingClientRect();
    const size = r.width / 8;
    const file = k % 8;
    const row = Math.floor(k / 8);
    return {
      left: r.left + file * size,
      top: r.top + row * size,
      width: size,
      height: size,
    };
  }

  /* ==================== Flipping ==================== */

  setFlip(flipped) {
    this.flipped = Boolean(flipped);
    for (const k in this.squares) {
      // squares are stored positionally; rebuild so labels and squares map correctly
    }
    this.build();
    this.syncPieces();
    this.renderHighlights();
  }

  /** Notify the view that coordinates/markers toggled. */
  applyOptions(options = {}) {
    if (options.showCoordinates !== undefined) this.showCoordinates = options.showCoordinates;
    if (options.showLegalMoves !== undefined) this.showLegalMoves = options.showLegalMoves;
    if (options.pieceAnimations !== undefined) this.pieceAnimations = options.pieceAnimations;
    if (options.interactive !== undefined) this.interactive = options.interactive;
    this.applyCoordinates();
    this.renderHighlights();
  }

  applyCoordinates() {
    for (let k = 0; k < 64; k++) {
      const div = this.squares[k];
      if (!div) continue;
      const existing = div.querySelectorAll('.mkj-rank, .mkj-file');
      existing.forEach((n) => n.remove());
      if (!this.showCoordinates) continue;

      const rowFromBottom = 7 - Math.floor(k / 8);
      const fileLetter = FILES[k % 8];

      // Rank labels on the left edge of the first file.
      if (k % 8 === 0) {
        const rankEl = document.createElement('span');
        rankEl.className = 'mkj-rank';
        rankEl.textContent = String(rowFromBottom + 1);
        div.appendChild(rankEl);
      }
      // File letters along the bottom edge.
      if (Math.floor(k / 8) === 7) {
        const fileEl = document.createElement('span');
        fileEl.className = 'mkj-file';
        fileEl.textContent = fileLetter;
        div.appendChild(fileEl);
      }
    }
  }

  /** Move a piece so it animates to a specific board square. */
  animateTo(sq) {
    const node = this.pieces[sq];
    if (!node) return;
    const k = visualPos(sq, this.flipped);
    node.style.left = `${(k % 8) * 12.5 + 7.5}%`;
    node.style.top = `${Math.floor(k / 8) * 12.5 + 7.5}%`;
  }

  destroy() {
    if (this._dragMove) window.removeEventListener('pointermove', this._dragMove);
    if (this._dragEnd) {
      window.removeEventListener('pointerup', this._dragEnd);
      window.removeEventListener('pointercancel', this._dragEnd);
    }
    this._drag = null;
    this.el.innerHTML = '';
    this.pieces = {};
  }
}
