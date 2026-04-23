/**
 * Text-mode mindmap renderer — in-session UX.
 *
 * Produces a deterministic numbered ASCII tree for stdout. Numbering matches
 * the `n_NNN` DFS pre-order ids assigned in `tree/builder.ts`, so when the
 * user picks "7" the CLI looks up node `n_007` directly.
 *
 * Features:
 *   - Wide-char-aware column alignment (Korean / CJK / emoji count as 2 cells).
 *   - Consecutive-file grouping (`cli.ts ×7 (#85-#91, T+21h-22h)`) for system-
 *     driven runs that lack distinct user intent.
 *   - Optional case-insensitive `--filter <kw>` to narrow long sessions.
 *   - Optional ANSI colorization on TTY stdout.
 */

import type { MindMap, MindMapNode } from '../types.js';

export interface TextRenderOptions {
  /** Maximum display width of the description column (auto-detect from TTY). */
  maxWidth?: number;
  /** Include the `events N–M` annotation per node. */
  showRange?: boolean;
  /** Case-insensitive substring; rows whose label doesn't match are hidden. */
  filter?: string;
  /** Collapse consecutive rows with the same file/tool label into one entry. */
  groupConsecutive?: boolean;
  /** ANSI colors on stdout (TTY-detection should happen at the caller). */
  color?: boolean;
  /**
   * node_id → set of modes the user has already picked. Marks visited nodes
   * with ⭐ (binary, GitHub-style — single emoji regardless of mode) so users
   * can see where they've been. Mode-level detail lives in the picks log.
   */
  picks?: Map<string, Set<'continue' | 'fork'>>;
  /**
   * Skip rendering nodes deeper than this. depth 0 = root only, 1 = phases,
   * 2 = phases + sub-actions (default behavior). Long sessions: pass 1 to
   * see only the user-prompt headers.
   */
  maxDepth?: number;
}

export interface NumberedNode {
  number: number;
  id: string;
  depth: number;
}

export interface TextRenderResult {
  text: string;
  nodes: NumberedNode[];
  numberToId: Map<number, string>;
  idToNumber: Map<string, number>;
}

const DEFAULT_MAX_WIDTH = 90;

function detectTerminalWidth(): number {
  const cols = process.stdout?.columns;
  if (typeof cols !== 'number' || !Number.isFinite(cols) || cols <= 0) {
    return DEFAULT_MAX_WIDTH;
  }
  return Math.max(60, Math.min(cols, 200));
}

// ---------------------------------------------------------------------------
// Wide-character display width (ASCII = 1, CJK / emoji ≈ 2)
// ---------------------------------------------------------------------------

/**
 * Compute the display width (in terminal cells) of a string. Heuristic:
 *   - U+1100–U+115F (Hangul Jamo)               → 2
 *   - U+2E80–U+303E, U+3041–U+33FF              → 2 (CJK punctuation, Hiragana/Katakana)
 *   - U+3400–U+4DBF, U+4E00–U+9FFF              → 2 (CJK Unified Ideographs)
 *   - U+A000–U+A4CF (Yi)                         → 2
 *   - U+AC00–U+D7A3 (Hangul Syllables)           → 2
 *   - U+F900–U+FAFF, U+FE30–U+FE4F, U+FF00–U+FF60 → 2 (CJK compat / fullwidth)
 *   - U+FFE0–U+FFE6                              → 2
 *   - Astral plane chars (surrogate pairs)        → 2 (most emoji)
 *   - Combining marks (M* category)               → 0 (treated as 1 here for simplicity — combining marks are rare in our labels)
 *   - Everything else                             → 1
 */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x1100 && cp <= 0x115f) w += 2;
    else if (cp >= 0x2e80 && cp <= 0x303e) w += 2;
    else if (cp >= 0x3041 && cp <= 0x33ff) w += 2;
    else if (cp >= 0x3400 && cp <= 0x4dbf) w += 2;
    else if (cp >= 0x4e00 && cp <= 0x9fff) w += 2;
    else if (cp >= 0xa000 && cp <= 0xa4cf) w += 2;
    else if (cp >= 0xac00 && cp <= 0xd7a3) w += 2;
    else if (cp >= 0xf900 && cp <= 0xfaff) w += 2;
    else if (cp >= 0xfe30 && cp <= 0xfe4f) w += 2;
    else if (cp >= 0xff00 && cp <= 0xff60) w += 2;
    else if (cp >= 0xffe0 && cp <= 0xffe6) w += 2;
    // Zero-width joiner + variation selectors (U+FE00–FE0F, U+E0100–E01EF)
    // contribute 0 cells — they modify the previous glyph in-place. Without
    // this, ZWJ-emoji sequences (👨‍💻 etc.) over-count width by 2-4 and
    // throw off column alignment.
    else if (cp === 0x200d) w += 0;
    else if (cp >= 0xfe00 && cp <= 0xfe0f) w += 0;
    else if (cp >= 0xe0100 && cp <= 0xe01ef) w += 0;
    else if (cp >= 0x10000) w += 2; // emoji + most astral chars
    else w += 1;
  }
  return w;
}

// ---------------------------------------------------------------------------
// ANSI color (TTY only)
// ---------------------------------------------------------------------------

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  brightBlack: '\x1b[90m',
};

const wrap = (on: boolean, code: string, s: string): string =>
  on ? `${code}${s}${ANSI.reset}` : s;

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

interface Row {
  number: number;
  id: string;
  prefix: string;
  label: string;
  time: string;
  range: string;
  isUserText: boolean;
  fileToolKey: string | null; // for grouping: "filename" derived from label
  color: 'green' | 'yellow' | 'red' | undefined;
  pickedContinue: boolean;
  pickedFork: boolean;
}

export function renderTextTree(
  mindmap: MindMap,
  opts: TextRenderOptions = {},
): TextRenderResult {
  const maxWidth = opts.maxWidth ?? detectTerminalWidth();
  const showRange = opts.showRange !== false;
  const filterKw = opts.filter?.toLowerCase().trim();
  const groupConsecutive = opts.groupConsecutive ?? true;
  const color = opts.color === true;

  const numbered: NumberedNode[] = [];
  const allRows: Row[] = [];

  walk(mindmap.root, 0, [], true);

  const padWidth = String(numbered.length || 1).length;
  const numberToId = new Map<number, string>();
  const idToNumber = new Map<string, number>();
  for (const n of numbered) {
    numberToId.set(n.number, n.id);
    idToNumber.set(n.id, n.number);
  }

  // Step 1: filter (keep rows whose label, time, or range matches)
  let visibleRows = allRows;
  if (filterKw) {
    visibleRows = allRows.filter((r) => {
      const haystack = `${r.label} ${r.time} ${r.range} ${r.id}`.toLowerCase();
      return haystack.includes(filterKw);
    });
  }

  // Step 2: collapse consecutive rows with same file/tool label (heuristic
  // grouping). Only applies when 3+ rows in a run share the same fileToolKey
  // and have no distinguishing user text.
  if (groupConsecutive) {
    visibleRows = collapseRuns(visibleRows);
  }

  // Step 3: compute target column for time/range alignment
  // (cap the alignment column so very long labels don't push everything off
  // the right edge — anything wider than `labelCol` keeps its own width and
  // the time column starts after it on the same line).
  const labelCol = Math.min(maxWidth, 70);
  let maxLabelWidth = 0;
  for (const r of visibleRows) {
    const w = displayWidth(r.label);
    if (w > maxLabelWidth) maxLabelWidth = w;
  }
  const targetCol = Math.min(maxLabelWidth, labelCol);

  // Step 4: emit
  const lines: string[] = [];
  const stats = mindmap.stats;
  const headerParts = [
    `agent-tree`,
    `session ${shortId(mindmap.session_id)}`,
    `${stats.total_events} events`,
    `${stats.total_turns} turns`,
    `${stats.total_nodes} nodes`,
  ];
  if (stats.duration_minutes > 0) headerParts.push(`${stats.duration_minutes} min`);
  if (stats.sidechain_count > 0)
    headerParts.push(`${stats.sidechain_count} sidechain`);
  lines.push(wrap(color, ANSI.dim, headerParts.join(' · ')));
  if (filterKw) {
    lines.push(
      wrap(
        color,
        ANSI.dim,
        `(filter: "${filterKw}" — ${visibleRows.length}/${allRows.length} rows)`,
      ),
    );
  }
  lines.push('');

  for (const row of visibleRows) {
    const numStr = wrap(
      color,
      ANSI.brightBlack,
      String(row.number).padStart(padWidth, ' '),
    );
    const prefix = wrap(color, ANSI.brightBlack, row.prefix);
    const pickMark = pickMarker(row);
    const labelColored = colorizeLabel(row, color);
    // Pad to targetCol using DISPLAY width — the label part may contain ANSI
    // sequences which take 0 cells; we have to compute padding from the
    // un-colored text width.
    const rawWidth = displayWidth(pickMark + row.label);
    const padding =
      rawWidth < targetCol ? ' '.repeat(targetCol - rawWidth) : ' ';
    const time = wrap(color, ANSI.brightBlack, row.time);
    const range = wrap(color, ANSI.brightBlack, row.range);
    const trailing = [time, range].filter((s) => s.length > 0).join('  ');
    lines.push(`${numStr}. ${prefix}${pickMark}${labelColored}${padding}${trailing}`);
  }

  return {
    text: lines.join('\n'),
    nodes: numbered,
    numberToId,
    idToNumber,
  };

  function walk(
    node: MindMapNode,
    depth: number,
    ancestorLastFlags: boolean[],
    isLast: boolean,
  ): void {
    if (typeof opts.maxDepth === 'number' && depth > opts.maxDepth) return;

    const number = numbered.length + 1;
    numbered.push({ number, id: node.id, depth });

    let prefix = '';
    for (const ancestorLast of ancestorLastFlags) {
      prefix += ancestorLast ? '   ' : '│  ';
    }
    if (depth > 0) prefix += isLast ? '└─ ' : '├─ ';

    // Compose label: optional sidechain marker + raw label + optional phase
    // metadata. Keep emoji-free per the file-tree style; differentiation comes
    // from the label format itself ("..." = user phase, file (Tool) = action).
    const sidechainTag =
      node.is_sidechain && node.type !== 'root' ? '[sidechain] ' : '';
    const meta = node.phase_meta ? `  (${node.phase_meta})` : '';
    const label = `${sidechainTag}${node.label}${meta}`;
    const time =
      typeof node.time_offset_ms === 'number'
        ? formatRelative(node.time_offset_ms)
        : '';
    const range = showRange
      ? `events ${node.index_range[0]}–${node.index_range[1]}`
      : '';

    const isUserText = label.startsWith('"');
    const fileToolKey = isUserText ? null : extractFileKey(label);

    const modes = opts.picks?.get(node.id);
    allRows.push({
      number,
      id: node.id,
      prefix,
      label,
      time,
      range,
      isUserText,
      fileToolKey,
      color: node.color,
      pickedContinue: !!modes?.has('continue'),
      pickedFork: !!modes?.has('fork'),
    });

    const nextAncestors = depth === 0 ? [] : [...ancestorLastFlags, isLast];
    node.children.forEach((c, i) => {
      walk(c, depth + 1, nextAncestors, i === node.children.length - 1);
    });
  }
}

function collapseRuns(rows: Row[]): Row[] {
  const out: Row[] = [];
  let i = 0;
  while (i < rows.length) {
    const head = rows[i];
    if (!head.fileToolKey) {
      out.push(head);
      i += 1;
      continue;
    }
    let j = i + 1;
    while (
      j < rows.length &&
      rows[j].fileToolKey === head.fileToolKey &&
      rows[j].prefix === head.prefix // same depth / same ancestor lineage
    ) {
      j += 1;
    }
    const runLen = j - i;
    if (runLen >= 3) {
      const last = rows[j - 1];
      const collapsed: Row = {
        ...head,
        label: `${head.fileToolKey} ×${runLen}`,
        time:
          head.time && last.time
            ? `${head.time} → ${last.time}`
            : head.time || last.time,
        range:
          head.range && last.range
            ? `events ${head.range.replace(/^events\s/, '').split('–')[0]}–${last.range.replace(/^events\s/, '').split('–')[1]} (#${head.number}-#${last.number})`
            : head.range,
      };
      out.push(collapsed);
    } else {
      for (let k = i; k < j; k += 1) out.push(rows[k]);
    }
    i = j;
  }
  return out;
}

function extractFileKey(label: string): string | null {
  // Matches "<file>.ext (<Tool>)" and returns "<file>.ext".
  // Tightened to require a real extension dot — the previous `[^\s]+` would
  // group any "foo (Bar)" formatted user prompt as if it were a file row.
  const m = label.match(/^([\w.\-/]+\.[A-Za-z0-9]+)\s+\(/);
  return m ? m[1] : null;
}

/**
 * Produce a short visited-marker for a row that the user has already picked.
 * Following GitHub-style "starred" semantics — a single ★ regardless of mode
 * (continue vs fork). Mode-level detail is in the picks log on disk; visual
 * stays uncluttered.
 */
function pickMarker(row: Row): string {
  return row.pickedContinue || row.pickedFork ? '⭐ ' : '';
}

function colorizeLabel(row: Row, color: boolean): string {
  if (!color) return row.label;
  // Compute the natural color FIRST. Then apply bold if starred so picks
  // emphasize without erasing severity (a starred red dead-end still reads
  // as red — earlier we lost that signal by force-yellowing every pick).
  let base: string;
  if (row.isUserText) base = wrap(true, ANSI.cyan, row.label);
  else if (row.color === 'red') base = wrap(true, ANSI.red, row.label);
  else if (row.color === 'yellow') base = wrap(true, ANSI.yellow, row.label);
  else if (row.color === 'green') base = wrap(true, ANSI.green, row.label);
  else base = wrap(true, ANSI.dim, row.label);

  if (row.pickedContinue || row.pickedFork) {
    // Bold + keep underlying color. ⭐ marker carries the yellow accent.
    return `\x1b[1m${base}\x1b[22m`;
  }
  return base;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function formatRelative(deltaMs: number): string {
  if (deltaMs < 1000) return 'T0';
  const totalSec = Math.floor(deltaMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `T+${h}h ${m}m`;
  if (m > 0) return `T+${m}m`;
  return `T+${s}s`;
}

// ---------------------------------------------------------------------------
// Selection parsing — used by both --tui interactive and --snapshot lookup
// ---------------------------------------------------------------------------

export interface ParsedSelection {
  ok: boolean;
  numberOrId?: string;
  mode: 'continue' | 'fork';
  reason?: string;
}

export function parseSelection(input: string): ParsedSelection {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, mode: 'continue', reason: 'empty input' };
  if (/^q(uit)?$/i.test(trimmed)) {
    return { ok: false, mode: 'continue', reason: 'user quit' };
  }
  const tokens = trimmed.split(/\s+/);
  const head = tokens[0];
  const tail = tokens.slice(1).join(' ').toLowerCase();
  let mode: 'continue' | 'fork' = 'continue';
  if (tail === 'fork' || tail === 'f') mode = 'fork';
  else if (tail === 'continue' || tail === 'c' || tail === '') mode = 'continue';
  else
    return {
      ok: false,
      mode,
      reason: `unknown mode "${tail}" — expected continue|fork (or omit)`,
    };
  return { ok: true, numberOrId: head, mode };
}

export function lookupSnapshot(
  mindmap: MindMap,
  numberOrId: string,
  result: TextRenderResult,
): MindMapNode | null {
  const asNumber = Number(numberOrId);
  if (Number.isInteger(asNumber) && asNumber > 0) {
    const id = result.numberToId.get(asNumber);
    if (id) return findNodeById(mindmap.root, id);
  }
  const idCandidate = numberOrId.startsWith('n_')
    ? numberOrId
    : `n_${String(numberOrId).padStart(3, '0')}`;
  return findNodeById(mindmap.root, idCandidate);
}

function findNodeById(node: MindMapNode, id: string): MindMapNode | null {
  if (node.id === id) return node;
  for (const c of node.children) {
    const hit = findNodeById(c, id);
    if (hit) return hit;
  }
  return null;
}
