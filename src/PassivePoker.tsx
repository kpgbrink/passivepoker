import { motion } from "framer-motion";
import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Passive Poker — React Canvas
 * - Animated deal + burn + flop/turn/river
 * - Auto rounds (pause/resume)
 * - Proper Hold’em evaluator (best 5 of 7)
 * - Scoring: each winner +1 (ties don’t split)
 * - Optional match target (Play to N). Ties ≥N keep playing until broken.
 * - Champion overlay with final hand preview
 * - Sounds (WebAudio) with mute/volume
 * - Highlights: orange = leaders on flop/turn, green = winners on river
 */

// ───────────────────────────────────────────────────────────────────────────────
// Cards & helpers
// ───────────────────────────────────────────────────────────────────────────────

type Suit = "♠" | "♥" | "♦" | "♣";
const SUITS: Suit[] = ["♠", "♥", "♦", "♣"];
const RANKS = [
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
  "A",
] as const;
type Rank = (typeof RANKS)[number];
export type Card = { rank: Rank; suit: Suit };

function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ rank: r, suit: s });
  return deck;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ───────────────────────────────────────────────────────────────────────────────
// Evaluator
// ───────────────────────────────────────────────────────────────────────────────

const RV: Record<Rank, number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

type RankVec = number[]; // [category, ...kickers]
function cmpVec(a: RankVec, b: RankVec) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? 0,
      bv = b[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function combos<T>(arr: T[], k: number): T[][] {
  const res: T[][] = [];
  const n = arr.length;
  if (k > n) return res;
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    res.push(idx.map((i) => arr[i]));
    let i = k - 1;
    while (i >= 0 && idx[i] === i + n - k) i--;
    if (i < 0) break;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
  return res;
}

function labelRank(v: number) {
  return (
    Object.entries(RV).find(([, val]) => val === v)?.[0] || ""
  ).toString();
}
function labelSuit(s: Suit) {
  return s === "♠"
    ? "Spade"
    : s === "♥"
    ? "Heart"
    : s === "♦"
    ? "Diamond"
    : "Club";
}

function eval5(cs: Card[]): { vec: RankVec; name: string } {
  const ranks = cs.map((c) => RV[c.rank]).sort((a, b) => b - a);
  const byRank: Record<number, number> = {};
  const bySuit: Record<Suit, Card[]> = { "♠": [], "♥": [], "♦": [], "♣": [] };
  for (const c of cs) {
    const v = RV[c.rank];
    byRank[v] = (byRank[v] || 0) + 1;
    bySuit[c.suit].push(c);
  }

  let flush: Suit | null = null;
  for (const s of SUITS)
    if (bySuit[s].length >= 5) {
      flush = s;
      break;
    }

  function straightTop(vals: number[]): number | null {
    const set = Array.from(new Set(vals));
    if (set.includes(14)) set.push(1); // wheel
    set.sort((a, b) => b - a);
    let run = 1;
    for (let i = 0; i < set.length - 1; i++) {
      if (set[i] - 1 === set[i + 1]) {
        run++;
        if (run >= 5) return set[i + 1] + 4;
      } else if (set[i] !== set[i + 1]) run = 1;
    }
    return null;
  }

  // Straight flush
  if (flush) {
    const f = bySuit[flush];
    const top = straightTop(f.map((c) => RV[c.rank]));
    if (top)
      return {
        vec: [8, top],
        name:
          top === 14 ? "Royal Flush" : "Straight Flush to " + labelRank(top),
      };
  }

  const groups = Object.entries(byRank)
    .map(([rv, cnt]) => ({ rv: +rv, cnt }))
    .sort((a, b) => b.cnt - a.cnt || b.rv - a.rv);

  if (groups[0]?.cnt === 4)
    return {
      vec: [
        7,
        groups[0].rv,
        groups.find((g) => g.rv !== groups[0].rv)?.rv ?? 0,
      ],
      name: "Four of a Kind",
    };
  if (groups[0]?.cnt === 3 && (groups[1]?.cnt ?? 0) >= 2)
    return { vec: [6, groups[0].rv, groups[1].rv], name: "Full House" };
  if (flush)
    return {
      vec: [
        5,
        ...bySuit[flush]
          .map((c) => RV[c.rank])
          .sort((a, b) => b - a)
          .slice(0, 5),
      ],
      name: labelSuit(flush) + " Flush",
    };
  const st = straightTop(ranks);
  if (st) return { vec: [4, st], name: "Straight to " + labelRank(st) };
  if (groups[0]?.cnt === 3)
    return {
      vec: [
        3,
        groups[0].rv,
        ...groups
          .filter((g) => g.rv !== groups[0].rv)
          .map((g) => g.rv)
          .sort((a, b) => b - a)
          .slice(0, 2),
      ],
      name: "Three of a Kind",
    };
  if (groups[0]?.cnt === 2 && groups[1]?.cnt === 2) {
    const hi = Math.max(groups[0].rv, groups[1].rv);
    const lo = Math.min(groups[0].rv, groups[1].rv);
    const kicker = groups.find((g) => g.rv !== hi && g.rv !== lo)?.rv ?? 0;
    return { vec: [2, hi, lo, kicker], name: "Two Pair" };
  }
  if (groups[0]?.cnt === 2)
    return {
      vec: [
        1,
        groups[0].rv,
        ...groups
          .filter((g) => g.rv !== groups[0].rv)
          .map((g) => g.rv)
          .sort((a, b) => b - a)
          .slice(0, 3),
      ],
      name: "One Pair",
    };
  return {
    vec: [0, ...ranks.slice(0, 5)],
    name: "High Card " + labelRank(ranks[0]),
  };
}

function best5of7(seven: Card[]): {
  vec: RankVec;
  name: string;
  cards: Card[];
} {
  let best = { vec: [-1] as RankVec, name: "" };
  let bestCards: Card[] = [];
  for (const five of combos(seven, 5)) {
    const r = eval5(five);
    if (cmpVec(r.vec, best.vec) > 0) {
      best = r;
      bestCards = five;
    }
  }
  return { ...best, cards: bestCards };
}

function best5Any(cards: Card[]) {
  if (cards.length < 5) return { vec: [-1] as RankVec, name: "Incomplete" };
  if (cards.length === 5) return eval5(cards);
  let best = { vec: [-1] as RankVec, name: "" };
  for (const five of combos(cards, 5)) {
    const r = eval5(five);
    if (cmpVec(r.vec, best.vec) > 0) best = r;
  }
  return best;
}

function best5AnyDetailed(cards: Card[]): { vec: RankVec; cards: Card[] } {
  if (cards.length < 5) return { vec: [-1] as RankVec, cards: [] };
  let best = { vec: [-1] as RankVec };
  let bestCards: Card[] = [];
  for (const five of combos(cards, 5)) {
    const r = eval5(five);
    if (cmpVec(r.vec, best.vec) > 0) {
      best = r as any;
      bestCards = five;
    }
  }
  return { vec: best.vec, cards: bestCards };
}

// ───────────────────────────────────────────────────────────────────────────────
// Sound
// ───────────────────────────────────────────────────────────────────────────────

class SoundEngine {
  ctx: AudioContext | null = null;
  gain: GainNode | null = null;
  comp: DynamicsCompressorNode | null = null;
  on = true;
  vol = 0.6;
  ensure() {
    if (typeof window === "undefined") return;
    if (!this.ctx) {
      const C =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      this.ctx = C ? new C() : null;
      if (this.ctx) {
        this.gain = this.ctx.createGain();
        this.gain.gain.value = this.vol;
        // Light compression to add snap and control peaks
        this.comp = this.ctx.createDynamicsCompressor();
        try {
          this.comp.threshold.setValueAtTime(-28, this.ctx.currentTime);
          this.comp.knee.setValueAtTime(24, this.ctx.currentTime);
          this.comp.ratio.setValueAtTime(12, this.ctx.currentTime);
          this.comp.attack.setValueAtTime(0.003, this.ctx.currentTime);
          this.comp.release.setValueAtTime(0.12, this.ctx.currentTime);
        } catch {}
        this.comp.connect(this.gain);
        this.gain.connect(this.ctx.destination);
      }
    }
  }
  out() {
    return (
      (this.comp as unknown as AudioNode) || (this.gain as unknown as AudioNode)
    );
  }
  async resume() {
    this.ensure();
    if (this.ctx && this.ctx.state === "suspended") await this.ctx.resume();
  }
  set(on: boolean) {
    this.on = on;
  }
  setVol(v: number) {
    this.vol = v;
    if (this.gain) this.gain.gain.value = v;
  }
  tone(
    f: number,
    d = 0.1,
    type: OscillatorType = "triangle",
    a = 0.005,
    r = 0.08
  ) {
    if (!this.on) return;
    this.ensure();
    if (!this.ctx || !this.gain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + a);
    g.gain.exponentialRampToValueAtTime(0.001, t + d + r);
    osc.connect(g).connect(this.out());
    osc.start(t);
    osc.stop(t + d + r + 0.02);
  }
  // scale + note memory
  private _scaleHz: number[] = [220, 247, 294, 330, 392]; // A minor pentatonic
  private _noteIndex = 0;
  private _lastNoteHz = this._scaleHz[0];

  private _nextNoteHz(): number {
    // biased random walk so notes feel related
    const step = [-1, 0, 1][Math.floor(Math.random() * 3)];
    this._noteIndex = Math.max(
      0,
      Math.min(this._scaleHz.length - 1, this._noteIndex + step)
    );
    this._lastNoteHz = this._scaleHz[this._noteIndex];
    return this._lastNoteHz;
  }

  deal() {
    this.ensure();
    if (!this.on || !this.ctx || !this.gain) return;

    const t = this.ctx.currentTime;
    const panVal = Math.random() * 0.8 - 0.4;

    // Optional Stereo Panner
    // @ts-ignore
    const pan: StereoPannerNode | null = (this.ctx as any).createStereoPanner
      ? (this.ctx as any).createStereoPanner()
      : null;
    if (pan) pan.pan.setValueAtTime(panVal, t);

    // --- Master gain for this whole deal sound ---
    const gMaster = this.ctx.createGain();
    gMaster.gain.value = 0.1; // 🔉 adjust here to make louder/quieter
    if (pan) pan.connect(gMaster).connect(this.out());
    else gMaster.connect(this.out());

    // --- Swish noise ---
    const sr = this.ctx.sampleRate;
    const durNoise = 0.1;
    const buffer = this.ctx.createBuffer(1, Math.floor(sr * durNoise), sr);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const env = 1 - i / data.length;
      data[i] = (Math.random() * 2 - 1) * env;
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2000 + Math.random() * 1000;

    const gNoise = this.ctx.createGain();
    gNoise.gain.setValueAtTime(0.001, t);
    gNoise.gain.exponentialRampToValueAtTime(0.2, t + 0.01);
    gNoise.gain.exponentialRampToValueAtTime(0.001, t + durNoise);

    noise
      .connect(bp)
      .connect(gNoise)
      .connect(pan ?? gMaster);
    noise.start(t);
    noise.stop(t + durNoise + 0.02);

    // --- Musical pluck ---
    const noteHz = this._nextNoteHz();
    const pluck = this.ctx.createOscillator();
    pluck.type = "triangle";
    pluck.frequency.setValueAtTime(noteHz * 1.5, t);
    pluck.frequency.exponentialRampToValueAtTime(noteHz, t + 0.1);

    const gPluck = this.ctx.createGain();
    gPluck.gain.setValueAtTime(0.001, t);
    gPluck.gain.exponentialRampToValueAtTime(0.15, t + 0.01);
    gPluck.gain.exponentialRampToValueAtTime(0.001, t + 0.3);

    pluck.connect(gPluck).connect(pan ?? gMaster);
    pluck.start(t);
    pluck.stop(t + 0.1);

    // --- Soft thump ---
    const th = this.ctx.createOscillator();
    th.type = "sine";
    th.frequency.setValueAtTime(120, t);
    th.frequency.exponentialRampToValueAtTime(80, t + 0.08);

    const gTh = this.ctx.createGain();
    gTh.gain.setValueAtTime(0.001, t);
    gTh.gain.exponentialRampToValueAtTime(0.07, t + 0.01);
    gTh.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

    th.connect(gTh).connect(pan ?? gMaster);
    th.start(t);
    th.stop(t + 0.12);
  }

  flip() {
    this.tone(660, 0.08, "sawtooth", 0.004, 0.06);
  }
  river() {
    this.tone(520, 0.1, "sawtooth", 0.004, 0.08);
  }
  click() {
    this.tone(300, 0.04, "square", 0.002, 0.03);
  }
  win() {
    this.tone(784, 0.12, "triangle", 0.01, 0.08);
    setTimeout(() => this.tone(988, 0.14, "triangle", 0.01, 0.1), 120);
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// Types / Game state
// ───────────────────────────────────────────────────────────────────────────────

type Player = {
  id: string;
  name: string;
  cards: Card[];
  points: number;
  lastWin?: boolean;
  lastHandName?: string;
  lastBestCards?: Card[];
};

type Phase = "idle" | "deal" | "flop" | "turn" | "river" | "showdown";

const cardFlip = {
  hidden: { rotateY: 180, opacity: 0, y: -8 },
  visible: (i: number) => ({
    rotateY: 0,
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.05 },
  }),
};

function PlayingCard({
  card,
  faceUp = true,
  i = 0,
  ghost = false,
  scale = 1,
  hl,
}: {
  card: Card;
  faceUp?: boolean;
  i?: number;
  ghost?: boolean;
  scale?: number;
  hl?: "win" | "lead";
}) {
  const isRed = card.suit === "♥" || card.suit === "♦";
  const cardW = Math.round(80 * scale);
  const cardH = Math.round(112 * scale);
  const fontPx = Math.round(28 * scale);
  const ringClass =
    hl === "win"
      ? "ring-4 ring-emerald-500"
      : hl === "lead"
      ? "ring-4 ring-orange-500"
      : "";
  return (
    <motion.div
      variants={cardFlip}
      initial="hidden"
      animate="visible"
      custom={i}
      className={`bg-white rounded-2xl shadow-md border border-gray-200 flex items-center justify-center font-semibold relative ${ringClass} ${
        ghost ? "invisible" : ""
      }`}
      style={{ width: cardW, height: cardH, fontSize: fontPx }}>
      <div
        className={`absolute inset-0 flex items-center justify-center ${
          isRed ? "text-rose-600" : "text-gray-900"
        }`}>
        {faceUp ? (
          <span>
            {card.rank}
            {card.suit}
          </span>
        ) : (
          <div className="w-full h-full rounded-xl bg-gradient-to-br from-indigo-600 to-fuchsia-500" />
        )}
      </div>
    </motion.div>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Main component
// ───────────────────────────────────────────────────────────────────────────────

export default function PassivePoker() {
  const [namesText, setNamesText] = useState("Alice, Bob, Carol, Dave");
  const [players, setPlayers] = useState<Player[]>([]);
  const [community, setCommunity] = useState<Card[]>([]);
  const [deck, setDeck] = useState<Card[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [running, setRunning] = useState(false);
  const [round, setRound] = useState(0);
  const [speedMult, setSpeedMult] = useState(1);
  const baseDelayMs = 700;
  const speedMsRef = useRef(baseDelayMs);
  useEffect(() => {
    // higher multiplier = faster = smaller delay
    speedMsRef.current = Math.max(50, Math.round(baseDelayMs / speedMult));
  }, [speedMult]);
  const [cardScale, setCardScale] = useState(1);
  const timeoutsRef = useRef<number[]>([]);
  const [lastWinners, setLastWinners] = useState<string[]>([]);
  const [winCommSet, setWinCommSet] = useState<Set<Card>>(new Set());
  const deckIdxRef = useRef(0);
  const [soundOn, setSoundOn] = useState(true);
  const [volume, setVolume] = useState(0.6);
  const [showWinnerHL, setShowWinnerHL] = useState(true);
  const [showLeaderHL, setShowLeaderHL] = useState(true);
  const [useScoreTarget, setUseScoreTarget] = useState(true);
  const [scoreTarget, setScoreTarget] = useState(10);
  const [championId, setChampionId] = useState<string | null>(null);
  const [championRevealAt, setChampionRevealAt] = useState<number | null>(null);
  const [championRevealDuration, setChampionRevealDuration] = useState<
    number | null
  >(null);
  const sfx = useRef(new SoundEngine());
  useEffect(() => {
    sfx.current.set(soundOn);
    sfx.current.setVol(volume);
  }, [soundOn, volume]);

  // ───────────────────────────────────────────────────────────────────────────────
  // Queue Runner
  // ───────────────────────────────────────────────────────────────────────────────
  type Step = { fn: () => void; mult: number };

  const stepQueueRef = useRef<Step[]>([]);
  const queueTimerRef = useRef<number | null>(null);
  const queueRunningRef = useRef(false);

  function clearQueueTimer() {
    if (queueTimerRef.current != null) {
      window.clearTimeout(queueTimerRef.current);
      queueTimerRef.current = null;
    }
  }

  function runNextStep() {
    const step = stepQueueRef.current.shift();
    if (!step) {
      queueRunningRef.current = false;
      return;
    }

    queueRunningRef.current = true;

    // Execute this step immediately…
    step.fn();

    // …then schedule the NEXT step using the *current* speed and this step's multiplier
    const delay = Math.max(1, speedMsRef.current) * (step.mult || 1);
    queueTimerRef.current = window.setTimeout(
      runNextStep,
      delay
    ) as unknown as number;
  }

  function enqueue(fn: () => void, mult = 1) {
    stepQueueRef.current.push({ fn, mult });
    // If the queue was idle, start by running the first step immediately
    if (!queueRunningRef.current) runNextStep();
  }

  function clearAll() {
    for (const id of timeoutsRef.current) {
      try {
        window.clearTimeout(id);
        window.clearInterval(id);
      } catch {}
    }
    timeoutsRef.current = [];
    clearQueueTimer();
    stepQueueRef.current = [];
    queueRunningRef.current = false;
  }

  //-------------------------------------------------------------------------------

  // Countdown state for automatic progress UI
  const [nextRoundAt, setNextRoundAt] = useState<number | null>(null);
  const [nextRoundDuration, setNextRoundDuration] = useState<number | null>(
    null
  );
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    if (nextRoundAt == null) return;
    const id = window.setInterval(
      () => setNowTick((t) => t + 1),
      200
    ) as unknown as number;
    timeoutsRef.current.push(id);
  }, [nextRoundAt]);

  // Watchdog to auto-start if timers were cleared
  useEffect(() => {
    if (!running) return;
    if (phase !== "showdown") return;
    if (nextRoundAt == null) return;
    if (Date.now() >= nextRoundAt) {
      setNextRoundAt(null);
      setNextRoundDuration(null);
      startRound();
    }
  }, [running, phase, nextRoundAt, nowTick]);

  // Refs to avoid stale closures
  const playersRef = useRef(players);
  const communityRef = useRef(community);
  const deckRef = useRef<Card[]>(deck);
  useEffect(() => {
    playersRef.current = players;
  }, [players]);
  useEffect(() => {
    communityRef.current = community;
  }, [community]);
  useEffect(() => {
    deckRef.current = deck;
  }, [deck]);

  useEffect(
    () => () => {
      clearAll();
    },
    []
  );

  function parseNames(input: string) {
    return Array.from(
      new Set(
        input
          .split(/\s*,\s*|\r?\n/g)
          .map((s) => s.trim())
          .filter(Boolean)
      )
    ).slice(0, 9);
  }
  function initPlayers(list: string[]): Player[] {
    return list.map((n, i) => ({ id: `p${i}`, name: n, cards: [], points: 0 }));
  }
  function draw(
    n: number,
    src: Card[],
    idxRef: React.MutableRefObject<number>
  ) {
    const start = idxRef.current;
    const slice = src.slice(start, start + n);
    idxRef.current += n;
    return slice;
  }
  async function armAudio() {
    await sfx.current.resume();
  }

  function startGame() {
    clearAll();
    const list = parseNames(namesText);
    const ps = initPlayers(list.length ? list : ["Player 1", "Player 2"]);
    setPlayers(ps);
    setRunning(true);
    setRound(0);
    setLastWinners([]);
    setChampionId(null);
    setChampionRevealAt(null);
    setChampionRevealDuration(null);

    const id = window.setTimeout(startRound, 0) as unknown as number;
    timeoutsRef.current.push(id);
  }

  function startRound() {
    clearAll();
    setRound((r) => r + 1);
    const d = shuffle(buildDeck());
    setDeck(d);
    deckRef.current = d;
    deckIdxRef.current = 0;
    setCommunity([]);
    setPhase("deal");
    setNextRoundAt(null);
    setNextRoundDuration(null);
    setChampionRevealAt(null);
    setChampionRevealDuration(null);
    setWinCommSet(new Set());

    setPlayers((prev) =>
      prev.map((p) => ({
        ...p,
        cards: [],
        lastWin: false,
        lastHandName: undefined,
        lastBestCards: undefined,
      }))
    );
    const current = playersRef.current.length
      ? playersRef.current
      : initPlayers(parseNames(namesText));

    // Deal reveal in descending rank (A→2) across both hole cards
    const suitRank: Record<Suit, number> = { "♠": 4, "♥": 3, "♦": 2, "♣": 1 };
    type DealStep = { pi: number; card: Card; round: 0 | 1 };
    const steps: DealStep[] = [];
    for (let pi = 0; pi < current.length; pi++)
      steps.push({ pi, card: draw(1, d, deckIdxRef)[0], round: 0 });
    for (let pi = 0; pi < current.length; pi++)
      steps.push({ pi, card: draw(1, d, deckIdxRef)[0], round: 1 });
    steps.sort(
      (a, b) =>
        RV[b.card.rank] - RV[a.card.rank] ||
        suitRank[b.card.suit] - suitRank[a.card.suit]
    );

    for (const step of steps) {
      enqueue(() => {
        setPlayers((prev) => {
          const cp = prev.map((p) => ({ ...p }));
          cp[step.pi].cards = [...(cp[step.pi].cards || []), step.card];
          return cp;
        });
        sfx.current.deal();
      });
    }

    enqueue(() => revealFlop(), 2);
  }

  function revealFlop() {
    setPhase("flop");
    draw(1, deckRef.current, deckIdxRef);
    const flop = draw(3, deckRef.current, deckIdxRef);
    setCommunity(flop);
    sfx.current.flip();
    enqueue(() => revealTurn(), 2);
  }
  function revealTurn() {
    setPhase("turn");
    draw(1, deckRef.current, deckIdxRef);
    const t = draw(1, deckRef.current, deckIdxRef)[0];
    setCommunity((p) => [...p, t]);
    sfx.current.flip();
    enqueue(() => revealRiver(), 2);
  }
  function revealRiver() {
    setPhase("river");
    draw(1, deckRef.current, deckIdxRef);
    const r = draw(1, deckRef.current, deckIdxRef)[0];
    setCommunity((p) => [...p, r]);
    sfx.current.river();
    enqueue(() => showdown(), 2);
  }
  function showdown() {
    setPhase("showdown");
    const ps = playersRef.current;
    const board = communityRef.current;
    const infos = ps.map((p) => {
      const res = best5of7([...(p.cards || []), ...board]);
      return { id: p.id, vec: res.vec, name: res.name, cards: res.cards };
    });
    if (!infos.length) return;
    let best = infos[0];
    for (let i = 1; i < infos.length; i++)
      if (cmpVec(infos[i].vec, best.vec) > 0) best = infos[i];
    const winners = infos.filter((x) => cmpVec(x.vec, best.vec) === 0);

    const updated = ps.map((p) => ({
      ...p,
      points: p.points + (winners.some((w) => w.id === p.id) ? 1 : 0),
      lastWin: winners.some((w) => w.id === p.id),
      lastHandName: infos.find((i) => i.id === p.id)?.name,
      lastBestCards: winners.some((w) => w.id === p.id)
        ? (infos.find((i) => i.id === p.id) as any)?.cards
        : undefined,
    }));
    setPlayers(updated);

    setLastWinners(
      winners.map((w) => ps.find((p) => p.id === w.id)?.name || "")
    );
    const cset = new Set<Card>();
    for (const w of winners as any) {
      const used = (w.cards as Card[] | undefined) ?? [];
      for (const c of used) if (communityRef.current.includes(c)) cset.add(c);
    }
    setWinCommSet(cset);
    if (winners.length) sfx.current.win();

    // Match end condition (optional)
    if (useScoreTarget) {
      const max = Math.max(...updated.map((p) => p.points));
      const leaders = updated.filter((p) => p.points === max);
      if (max >= scoreTarget && leaders.length === 1) {
        const cid = leaders[0].id;
        setRunning(false);
        setNextRoundAt(null);
        setNextRoundDuration(null);
        clearAll();

        // show the final hand briefly; use live delay
        const delayChamp = Math.max(2000, speedMsRef.current * 4);
        setChampionRevealAt(Date.now() + delayChamp);
        setChampionRevealDuration(delayChamp);

        const id = window.setTimeout(() => {
          setChampionId(cid);
          setChampionRevealAt(null);
          setChampionRevealDuration(null);
        }, delayChamp) as unknown as number;
        timeoutsRef.current.push(id);

        return;
      }
    }

    // Otherwise continue
    const delayNext = speedMsRef.current * 15;
    setNextRoundAt(Date.now() + delayNext);
    setNextRoundDuration(delayNext);

    if (running) {
      const id = window.setTimeout(() => {
        setNextRoundAt(null);
        setNextRoundDuration(null);
        startRound();
      }, delayNext) as unknown as number;
      timeoutsRef.current.push(id);
    }
  }

  async function onStart() {
    await armAudio();
    sfx.current.click();
    startGame();
  }
  async function onPause() {
    await armAudio();
    sfx.current.click();
    pauseResume();
  }
  async function onReset() {
    await armAudio();
    sfx.current.click();
    resetPoints();
  }

  function startNewMatch() {
    resetPoints();
    setChampionId(null);
    setChampionRevealAt(null);
    setChampionRevealDuration(null);
    setRunning(true);

    // Kick off immediately
    startRound();
  }

  function continueFreePlay() {
    setUseScoreTarget(false);
    setChampionId(null);
    setChampionRevealAt(null);
    setChampionRevealDuration(null);
    setRunning(true);

    // Kick off immediately
    startRound();
  }

  function pauseResume() {
    if (running) {
      setRunning(false);
      setNextRoundAt(null);
      setNextRoundDuration(null);
      clearAll();
    } else {
      setRunning(true);
      if (phase === "idle" || playersRef.current.length === 0) {
        startGame();
      } else {
        // If you want to yield one tick to let state flush:
        const id = window.setTimeout(
          () => revealNext(),
          0
        ) as unknown as number;
        timeoutsRef.current.push(id);
        // Or just call directly:
        // revealNext();
      }
    }
  }

  function revealNext() {
    if (phase === "deal") revealFlop();
    else if (phase === "flop") revealTurn();
    else if (phase === "turn") revealRiver();
    else if (phase === "river") showdown();
    else startRound();
  }
  function resetPoints() {
    setPlayers((prev) =>
      prev.map((p) => ({ ...p, points: 0, lastWin: false }))
    );
  }

  const boardSorted = useMemo(
    () =>
      [...players].sort(
        (a, b) => b.points - a.points || a.name.localeCompare(b.name)
      ),
    [players]
  );
  const championPlayer = useMemo(
    () => players.find((p) => p.id === championId) || null,
    [players, championId]
  );

  // Leaders on flop/turn
  const phaseLeaders = useMemo(() => {
    if (phase !== "flop" && phase !== "turn") return new Set<string>();
    const board = community;
    if (board.length < 3) return new Set<string>();
    const infos = players.map((p) => ({
      id: p.id,
      vec: best5Any([...(p.cards || []), ...board]).vec,
    }));
    if (!infos.length) return new Set<string>();
    let best = infos[0];
    for (let i = 1; i < infos.length; i++)
      if (cmpVec(infos[i].vec, best.vec) > 0) best = infos[i];
    const ids = infos
      .filter((i) => cmpVec(i.vec, best.vec) === 0)
      .map((i) => i.id);
    return new Set(ids);
  }, [phase, community, players]);

  const { leadCardSets, leadCommSet } = useMemo(() => {
    const empty = {
      leadCardSets: new Map<string, Set<Card>>(),
      leadCommSet: new Set<Card>(),
    };
    if (phase !== "flop" && phase !== "turn") return empty;
    const board = community;
    if (board.length < 3) return empty;
    const map = new Map<string, Set<Card>>();
    const comm = new Set<Card>();
    for (const p of players) {
      if (!phaseLeaders.has(p.id)) continue;
      const res = best5AnyDetailed([...(p.cards || []), ...board]);
      const set = new Set<Card>(res.cards);
      map.set(p.id, set);
      for (const c of res.cards) if (board.includes(c)) comm.add(c);
    }
    return { leadCardSets: map, leadCommSet: comm };
  }, [phase, community, players, phaseLeaders]);

  return (
    <div className="min-h-screen w-full bg-gray-50 text-gray-900 p-4 sm:p-8">
      <div className="max-w-6xl mx-auto grid gap-6 lg:grid-cols-[2fr,1fr]">
        {/* Left: Table */}
        <div className="bg-white rounded-2xl shadow-sm p-4 sm:p-6">
          <header className="flex items-center justify-between mb-4">
            <h1 className="text-2xl sm:text-3xl font-bold">Passive Poker</h1>
            <div className="flex items-center gap-3">
              <button
                onClick={onPause}
                className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-semibold shadow hover:brightness-110">
                {running ? "Pause" : phase === "idle" ? "Start" : "Resume"}
              </button>
              <button
                onClick={onStart}
                className="px-3 py-2 rounded-xl bg-gray-200 font-semibold hover:bg-gray-300">
                Restart
              </button>
            </div>
          </header>

          {/* Community */}
          <div className="mb-3 flex items-center gap-3">
            <span className="text-sm font-medium text-gray-500">
              Round {round}
            </span>
            <span className="text-xs px-2 py-1 rounded-full bg-gray-100 border">
              {phase.toUpperCase()}
            </span>
            <div className="flex-1" />
            <label className="text-sm flex items-center gap-2">
              Speed
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.05}
                value={speedMult}
                onChange={(e) => setSpeedMult(parseFloat(e.target.value))}
              />
              <span className="text-xs text-gray-500">
                {speedMult.toFixed(2)}×
              </span>
            </label>
            <label className="text-sm flex items-center gap-2">
              Card size
              <input
                type="range"
                min={0.7}
                max={1.8}
                step={0.05}
                value={cardScale}
                onChange={(e) => setCardScale(parseFloat(e.target.value))}
              />
            </label>
          </div>

          <div className="relative rounded-2xl border bg-gradient-to-br from-emerald-50 to-teal-50 p-4 sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{
                opacity:
                  phase === "showdown" && nextRoundAt && nextRoundDuration
                    ? 1
                    : 0,
              }}
              transition={{
                delay: 0, // wait 2s before starting
                duration: 5, // fade in/out over 5s
                ease: "easeInOut",
              }}
              style={{
                visibility:
                  phase === "showdown" && nextRoundAt && nextRoundDuration
                    ? "visible"
                    : "hidden",
              }}
              className="mt-3">
              {(() => {
                const timeRemaining = Math.max(
                  0,
                  (nextRoundAt ?? 0) - Date.now()
                );
                const total = Math.max(1, nextRoundDuration ?? 1); // avoid divide-by-0
                const progress = Math.min(
                  100,
                  Math.max(0, (1 - timeRemaining / total) * 100)
                );
                // Only animate width while counting down; snap instantly when it hits 0.
                const shouldAnimateWidth = timeRemaining > 0 && progress > 0;

                return (
                  <>
                    <div
                      className="w-full h-2 rounded-full bg-gray-200 overflow-hidden"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}>
                      <div
                        className={`h-full bg-emerald-500 ${
                          shouldAnimateWidth
                            ? "transition-[width] duration-200 ease-linear"
                            : ""
                        }`}
                        style={{ width: `${progress}%` }}
                        aria-valuenow={Math.round(progress)}
                      />
                    </div>
                  </>
                );
              })()}
            </motion.div>

            <div className="mb-3 text-sm text-gray-600">Community</div>
            <div className="flex gap-2 sm:gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <React.Fragment key={i}>
                  {community[i] ? (
                    <PlayingCard
                      card={community[i]!}
                      faceUp
                      i={i}
                      scale={cardScale}
                      hl={
                        showWinnerHL &&
                        phase === "showdown" &&
                        winCommSet.has(community[i]!)
                          ? "win"
                          : showLeaderHL &&
                            (phase === "flop" || phase === "turn") &&
                            leadCommSet.has(community[i]!)
                          ? "lead"
                          : undefined
                      }
                    />
                  ) : (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="rounded-2xl bg-white/60 border border-dashed flex items-center justify-center text-gray-400"
                      style={{
                        width: Math.round(80 * cardScale),
                        height: Math.round(112 * cardScale),
                        fontSize: Math.max(12, Math.round(12 * cardScale)),
                      }}>
                      {i < 3 ? "Flop" : i === 3 ? "Turn" : "River"}
                    </motion.div>
                  )}
                </React.Fragment>
              ))}
            </div>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: lastWinners.length > 0 ? 1 : 0, y: 0 }}
              style={{
                visibility: lastWinners.length > 0 ? "visible" : "hidden",
              }}
              className="mt-4 text-sm">
              <span className="font-semibold">
                Winner{lastWinners.length > 1 ? "s" : ""}:
              </span>{" "}
              {lastWinners.join(", ")}
            </motion.div>

            {phase === "showdown" &&
              !championId &&
              championRevealAt &&
              championRevealDuration && (
                <div className="mt-3">
                  <div
                    className="w-full h-2 rounded-full bg-purple-200 overflow-hidden"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}>
                    <div
                      className="h-full bg-purple-500 transition-[width] duration-200 ease-linear"
                      style={{
                        width:
                          (1 -
                            Math.max(0, championRevealAt - Date.now()) /
                              championRevealDuration) *
                            100 +
                          "%",
                      }}
                      aria-valuenow={Math.max(
                        0,
                        Math.min(
                          100,
                          (1 -
                            Math.max(0, championRevealAt - Date.now()) /
                              championRevealDuration) *
                            100
                        )
                      )}
                    />
                  </div>
                  <div className="mt-1 text-xs text-gray-500 text-right">
                    Crowning champion in{" "}
                    {(
                      Math.max(0, championRevealAt - Date.now()) / 1000
                    ).toFixed(1)}
                    s
                  </div>
                </div>
              )}
          </div>

          {/* Players */}
          <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {players.map((p, idx) => (
              <motion.div
                key={p.id}
                layout
                className={`rounded-2xl border bg-white p-3 shadow-sm ${
                  showWinnerHL && p.lastWin
                    ? "ring-2 ring-emerald-500"
                    : showLeaderHL && phaseLeaders.has(p.id)
                    ? "ring-2 ring-orange-500"
                    : ""
                }`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold truncate">{p.name}</div>
                  {p.lastHandName && (
                    <div className="mt-2 text-xs text-gray-600">
                      {p.lastHandName}
                    </div>
                  )}
                  <div className="text-xs text-gray-500">
                    Pts: <span className="font-semibold">{p.points}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {(p.cards.length ? p.cards : [null, null]).map((c, i) => (
                    <PlayingCard
                      key={i}
                      card={c ?? { rank: "A" as Rank, suit: "♠" as Suit }}
                      faceUp
                      i={i + idx}
                      ghost={c == null}
                      scale={cardScale}
                      hl={
                        showWinnerHL &&
                        phase === "showdown" &&
                        c &&
                        p.lastWin &&
                        p.lastBestCards &&
                        p.lastBestCards.includes(c as any)
                          ? "win"
                          : showLeaderHL &&
                            (phase === "flop" || phase === "turn") &&
                            c &&
                            leadCardSets.get(p.id)?.has(c as any)
                          ? "lead"
                          : undefined
                      }
                    />
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Right: Controls & Scoreboard */}
        <aside className="space-y-6">
          <div className="bg-white rounded-2xl shadow-sm p-4 sm:p-6">
            <h2 className="text-lg font-semibold mb-3">Players</h2>
            <textarea
              className="w-full h-28 rounded-xl border p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              value={namesText}
              onChange={(e) => setNamesText(e.target.value)}
              placeholder="Enter names, separated by commas or new lines"
            />
            <div className="mt-3 flex gap-2">
              <button
                onClick={onStart}
                className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-semibold shadow hover:brightness-110">
                Start
              </button>
              <button
                onClick={onPause}
                className="px-3 py-2 rounded-xl bg-gray-200 font-semibold hover:bg-gray-300">
                {running ? "Pause" : "Resume"}
              </button>
              <button
                onClick={onReset}
                className="px-3 py-2 rounded-xl bg-white border font-semibold hover:bg-gray-50">
                Reset points
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              {useScoreTarget
                ? `Playing to ${scoreTarget} points. Game stops when there’s a single leader at or above target; ties continue.`
                : `Rounds are unlimited. The game will keep dealing new hands automatically until you pause.`}
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-sm p-4 sm:p-6">
            <h2 className="text-lg font-semibold mb-3">Match</h2>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={useScoreTarget}
                onChange={(e) => setUseScoreTarget(e.target.checked)}
              />
              Play to
              <input
                type="number"
                min={1}
                max={999}
                value={scoreTarget}
                onChange={(e) =>
                  setScoreTarget(
                    Math.max(1, Math.min(999, +e.target.value || 1))
                  )
                }
                className="w-20 rounded border px-2 py-1"
              />
              points
            </label>
            <p className="mt-2 text-xs text-gray-500">
              {useScoreTarget
                ? "Game stops when a single player reaches the target. Ties at or above continue until broken."
                : "Disabled: the game runs forever."}
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-sm p-4 sm:p-6">
            <h2 className="text-lg font-semibold mb-3">Audio</h2>
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={soundOn}
                  onChange={(e) => setSoundOn(e.target.checked)}
                />{" "}
                Enable sounds
              </label>
              <label className="text-sm flex items-center gap-2">
                Volume
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={volume}
                  onChange={(e) => setVolume(parseFloat(e.target.value))}
                />
              </label>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Audio starts after your first button click due to browser autoplay
              rules.
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-sm p-4 sm:p-6">
            <h2 className="text-lg font-semibold mb-3">Highlights & Legend</h2>
            <div className="flex flex-col gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={showWinnerHL}
                  onChange={(e) => setShowWinnerHL(e.target.checked)}
                />{" "}
                Winner cards{" "}
                <span className="inline-flex items-center ml-1">
                  <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" />
                </span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={showLeaderHL}
                  onChange={(e) => setShowLeaderHL(e.target.checked)}
                />{" "}
                Leader cards on flop/turn{" "}
                <span className="inline-flex items-center ml-1">
                  <span className="w-3 h-3 rounded-full bg-orange-500 inline-block" />
                </span>
              </label>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Legend:{" "}
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />{" "}
                winner’s used cards (river)
              </span>
              ;{" "}
              <span className="inline-flex items-center gap-1 ml-3">
                <span className="w-2.5 h-2.5 rounded-full bg-orange-500 inline-block" />{" "}
                current leaders’ used cards (flop/turn)
              </span>
              .
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-sm p-4 sm:p-6">
            <h2 className="text-lg font-semibold mb-3">Rules / Notes</h2>
            <ul className="list-disc pl-5 space-y-2 text-sm text-gray-700">
              <li>
                Texas Hold’em style. Two hole cards per player, five community
                cards.
              </li>
              <li>
                Flop (3), Turn (1), River (1) reveal with animations and proper
                burn cards.
              </li>
              <li>
                <strong>Scoring:</strong> every winner in a tie gets 1 point (no
                splits).
              </li>
              <li>Auto-advance runs forever until you pause or restart.</li>
              <li>
                Cap of 9 players for layout sanity. Add/remove in the Players
                box.
              </li>
            </ul>
          </div>
        </aside>
      </div>

      <footer className="max-w-6xl mx-auto mt-6 text-center text-xs text-gray-500">
        Built for your concept — tweak speed, names, or restart any time.
      </footer>

      {championId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="relative z-10 bg-white rounded-3xl shadow-2xl p-8 sm:p-12 text-center">
            <div className="text-6xl mb-4">🏆</div>
            <div className="text-2xl sm:text-3xl font-extrabold">
              Champion: {players.find((p) => p.id === championId)?.name}
            </div>
            <div className="mt-2 text-sm text-gray-500">
              Reached {scoreTarget}+ points with no tie
            </div>
            {championPlayer?.lastBestCards?.length ? (
              <div className="mt-5">
                <div className="text-sm font-medium mb-2">
                  Final hand: {championPlayer?.lastHandName}
                </div>
                <div className="flex justify-center gap-2">
                  {championPlayer!.lastBestCards!.map((c, i) => (
                    <PlayingCard
                      key={i}
                      card={c}
                      faceUp
                      i={i}
                      scale={1.2}
                      hl="win"
                    />
                  ))}
                </div>
              </div>
            ) : null}
            <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={() => startNewMatch()}
                className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-semibold shadow hover:brightness-110">
                Start new match
              </button>
              <button
                onClick={() => continueFreePlay()}
                className="px-4 py-2 rounded-xl bg-white border font-semibold hover:bg-gray-50">
                Continue free play
              </button>
            </div>
          </motion.div>
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {Array.from({ length: 120 }).map((_, i) => {
              const left = Math.random() * 100;
              const delay = Math.random() * 0.6;
              const duration = 2.6 + Math.random() * 1.8;
              const size = 6 + Math.random() * 8;
              return (
                <motion.span
                  key={i}
                  initial={{ y: -20, opacity: 0, rotate: 0 }}
                  animate={{ y: 1000, opacity: 1, rotate: 360 }}
                  transition={{
                    delay,
                    duration,
                    repeat: Infinity,
                    repeatDelay: 0.2,
                  }}
                  className="absolute block bg-emerald-400/80"
                  style={{ left: `${left}%`, width: size, height: size }}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
