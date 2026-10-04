__HEADER__
// Phase 1 of the Enigma codebreaker on the GPU: bit-identical to the CPU stages in search.ts
// (screenStage / refineStage). Layouts: gpu/layout.ts. __NMAX__ is replaced by the host with the
// largest message length the workgroup memory is sized for.
//
// Hill climbs keep the CPU's first-improvement order: the cable pairs are scanned in rounds of
// WG; every thread tests one pair against the same state, the earliest improving pair of the
// round is applied, and the scan continues right after it — exactly what the sequential loop does.

const WG: u32 = __WG__u;
// SG: climbs run in one 32-lane subgroup with private state (see the SG climb); else the
// workgroup-memory climb. The host keeps only the matching climb block (//#SG / //#BARRIER).
const SG: bool = __SG__;
// HIST (with SG and ONFLY): per candidate, a histogram row per (cipher letter z, plugboard-side
// input x) holds the 26 output-letter counts as bytes (7 words, padded). A cable move's count
// change is then a sum of row differences, independent of the message length.
const HIST: bool = __HIST__;
const HW: u32 = select(1u, 4732u, HIST);
const NONE: u32 = 0xffffffffu;
const NMAX: u32 = __NMAX__u;
// ONFLY: class-table entries are computed from the rotor tables when needed instead of being
// stored per workgroup (less workgroup memory → more workgroups in flight).
const ONFLY: bool = __ONFLY__;
const TABW: u32 = select((NMAX * 26u + 3u) / 4u, 1u, ONFLY);
// RSHARED: copy the right rotor's forward / backward tables into workgroup memory (ONFLY only).
const RSHARED: bool = __RSHARED__;
const RW: u32 = select(1u, 169u, ONFLY && RSHARED);
const MAX_CAND: u32 = 96u;
const SCREEN_STRIDE: u32 = 8u;
const FINAL_STRIDE: u32 = 12u;
const JOB_STRIDE: u32 = 8u;

// Word offsets in `tables` (layout.ts TABLES).
const T_INNER: u32 = 0u;
const T_RF: u32 = 4394u;
const T_RB: u32 = 4563u;
const T_NOTCH_M: u32 = 4732u;
const T_NOTCH_R: u32 = 4739u;
const T_BIGRAM: u32 = 4746u;

struct Params {
  n: u32,
  maxPlugs: u32,
  jobBase: u32,
  jobCount: u32,
  screenPasses: u32,
  refinePasses: u32,
  finalPasses: u32,
  refineKeep: u32,
  screenBigram: u32,
  rankBigram: u32,
  variantsPerPos: u32,
  nScreenRings: u32,
  pairsScreenOff: u32,
  pairsScreenCount: u32,
  pairsRefineOff: u32,
  pairsRefineCount: u32,
  pairsFinalOff: u32,
  pairsFinalCount: u32,
  planScreenStride: u32,
  planAllOff: u32,
  planAllStride: u32,
  planScreenRingsOff: u32,
  planSweepOff: u32,
  classStartOff: u32,
  classRankOff: u32,
  tabMapOff: u32,
  classPosOff: u32,
  pad1: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> cipher: array<u32>;
@group(0) @binding(2) var<storage, read> tables: array<u32>;
@group(0) @binding(3) var<storage, read> pairs: array<u32>;
@group(0) @binding(4) var<storage, read> plan: array<u32>;
@group(0) @binding(5) var<storage, read> jobs: array<u32>;
@group(0) @binding(6) var<storage, read_write> results: array<u32>;

var<workgroup> tab: array<u32, TABW>;
var<workgroup> sched: array<u32, NMAX>;
var<workgroup> rfS: array<u32, RW>;
var<workgroup> rbS: array<u32, RW>;
var<workgroup> Hp: array<u32, HW>;
var<workgroup> cs: array<u32, 27>;
var<workgroup> P: array<u32, 26>;
var<workgroup> startP: array<u32, 26>;
var<workgroup> T: array<i32, 26>;
var<workgroup> wSum: i32;
var<workgroup> wPlugs: u32;
var<workgroup> wCursor: u32;
var<workgroup> wImproved: u32;
var<workgroup> wPass: u32;
var<workgroup> wValue: u32;
// Earliest improving thread of a round; two slots used alternately so one can be reset while
// the other is read without an extra barrier.
var<workgroup> wFound: array<atomic<u32>, 2>;
// The last applied move (incremental re-scoring): its count changes, the letters whose plugboard
// partner changed, and whether the previous round applied one.
var<workgroup> Dwin: array<i32, 26>;
var<workgroup> wChanged: array<u32, 4>;
var<workgroup> wWin: u32;

var<workgroup> wAcc: atomic<u32>;
var<workgroup> candV: array<u32, MAX_CAND>;
var<workgroup> candR: array<u32, MAX_CAND>;
var<workgroup> candRm: array<u32, MAX_CAND>;
var<workgroup> wCandN: u32;
var<workgroup> finR: array<u32, 4>;
var<workgroup> finRm: array<u32, 4>;
var<workgroup> wFinN: u32;

fn tbyte(off: u32, i: u32) -> u32 {
  return (tables[off + (i >> 2u)] >> ((i & 3u) * 8u)) & 0xffu;
}

fn tabByte(i: u32) -> u32 {
  return (tab[i >> 2u] >> ((i & 3u) * 8u)) & 0xffu;
}

fn sbyte(words: ptr<workgroup, array<u32, RW>>, i: u32) -> u32 {
  return ((*words)[i >> 2u] >> ((i & 3u) * 8u)) & 0xffu;
}

// Scrambler output at message position i for plugboard-side input v (needs `sched`).
fn scr(i: u32, v: u32) -> u32 {
  let sc = sched[i];
  let rr = sc & 0xffffu;
  if (RSHARED) {
    return sbyte(&rbS, rr + tbyte(T_INNER, (sc >> 16u) + sbyte(&rfS, rr + v)));
  }
  return tbyte(T_RB, rr + tbyte(T_INNER, (sc >> 16u) + tbyte(T_RF, rr + v)));
}

// Class-table entry: row v, rank j of the class starting at s with cnt positions.
fn entry(s: u32, cnt: u32, v: u32, j: u32) -> u32 {
  if (ONFLY) {
    return scr(cipher[params.classPosOff + s + j], v);
  }
  return tabByte(s * 26u + v * cnt + j);
}

fn inc26(x: u32) -> u32 {
  return select(x + 1u, 0u, x == 25u);
}

// fillScheduleRaw (thread 0) + buildClassTable (all threads) for one candidate.
fn buildTab(lid: u32, pL: u32, oM: u32, oR: u32, rm: u32, r: u32) {
  let n = params.n;
  if (lid == 0u) {
    var pl = pL;
    var pm = (oM + rm) % 26u;
    var pr = (oR + r) % 26u;
    for (var i = 0u; i < n; i++) {
      if (tbyte(T_NOTCH_M, pm) == 1u) {
        pl = inc26(pl);
        pm = inc26(pm);
      } else if (tbyte(T_NOTCH_R, pr) == 1u) {
        pm = inc26(pm);
      }
      pr = inc26(pr);
      let orr = (pr + 26u - r) % 26u;
      let omm = (pm + 26u - rm) % 26u;
      sched[i] = (orr * 26u) | (((pl * 26u + omm) * 26u) << 16u);
    }
  }
  workgroupBarrier();
  if (HIST) {
    // Each lane builds whole rows (no shared words between lanes, no atomics).
    for (var row = lid; row < 676u; row += WG) {
      let z = row / 26u;
      let x = row % 26u;
      let s = cs[z];
      let cnt = cs[z + 1u] - s;
      var counts: array<u32, 26>;
      for (var j = 0u; j < cnt; j++) {
        let y = scr(cipher[params.classPosOff + s + j], x);
        counts[y] = counts[y] + 1u;
      }
      for (var w = 0u; w < 7u; w++) {
        var packed = 0u;
        for (var k = 0u; k < 4u; k++) {
          let y = w * 4u + k;
          if (y < 26u) {
            packed |= counts[y] << (k * 8u);
          }
        }
        Hp[row * 7u + w] = packed;
      }
    }
    workgroupBarrier();
    return;
  }
  if (ONFLY) {
    return;
  }
  let bytes = n * 26u;
  let words = (bytes + 3u) / 4u;
  for (var w = lid; w < words; w += WG) {
    var packed = 0u;
    for (var k = 0u; k < 4u; k++) {
      let o = w * 4u + k;
      if (o < bytes) {
        let m = cipher[params.tabMapOff + o];
        let sc = sched[m & 0xffffu];
        let rr = sc & 0xffffu;
        let ib = sc >> 16u;
        let x = m >> 16u;
        packed |= tbyte(T_RB, rr + tbyte(T_INNER, ib + tbyte(T_RF, rr + x))) << (k * 8u);
      }
    }
    tab[w] = packed;
  }
  workgroupBarrier();
}

// Counts of the scrambler outputs for the plugboard P (thread 0), Σcount², number of cables.
fn initCounts(lid: u32) {
  if (SG) {
    // The subgroup climb counts in its lanes.
    workgroupBarrier();
    return;
  }
  if (lid == 0u) {
    for (var v = 0u; v < 26u; v++) {
      T[v] = 0;
    }
    for (var z = 0u; z < 26u; z++) {
      let s = cs[z];
      let cnt = cs[z + 1u] - s;
      let v = P[z];
      for (var j = 0u; j < cnt; j++) {
        let y = entry(s, cnt, v, j);
        T[y] = T[y] + 1;
      }
    }
    var sum = 0;
    for (var v = 0u; v < 26u; v++) {
      sum += T[v] * T[v];
    }
    wSum = sum;
    var plugs = 0u;
    for (var a = 0u; a < 26u; a++) {
      if (P[a] > a) {
        plugs++;
      }
    }
    wPlugs = plugs;
  }
  workgroupBarrier();
}

// Adds histogram row (z, x) — the output counts of cipher letter z with plugboard input x.
fn addRow(D: ptr<function, array<i32, 26>>, z: u32, x: u32) {
  let r0 = (z * 26u + x) * 7u;
  for (var w = 0u; w < 7u; w++) {
    let r = Hp[r0 + w];
    for (var k = 0u; k < 4u; k++) {
      let y = w * 4u + k;
      if (y < 26u) {
        (*D)[y] = (*D)[y] + i32((r >> (k * 8u)) & 0xffu);
      }
    }
  }
}

fn moveRow(D: ptr<function, array<i32, 26>>, z: u32, src: u32, dst: u32) {
  if (HIST) {
    let a0 = (z * 26u + src) * 7u;
    let b0 = (z * 26u + dst) * 7u;
    for (var w = 0u; w < 7u; w++) {
      let a = Hp[a0 + w];
      let b = Hp[b0 + w];
      for (var k = 0u; k < 4u; k++) {
        let y = w * 4u + k;
        if (y < 26u) {
          (*D)[y] = (*D)[y] + i32((b >> (k * 8u)) & 0xffu) - i32((a >> (k * 8u)) & 0xffu);
        }
      }
    }
    return;
  }
  let s = cs[z];
  let cnt = cs[z + 1u] - s;
  if (cnt == 0u) {
    return;
  }
  for (var j = 0u; j < cnt; j++) {
    let a = entry(s, cnt, src, j);
    let b = entry(s, cnt, dst, j);
    (*D)[a] = (*D)[a] - 1;
    (*D)[b] = (*D)[b] + 1;
  }
}

// Count changes of swapping the cables of a and b (climb.ts `moves`).
fn pairMoves(D: ptr<function, array<i32, 26>>, a: u32, b: u32, x: u32, y: u32) {
  if (x == b) {
    moveRow(D, a, b, a);
    moveRow(D, b, a, b);
  } else {
    moveRow(D, a, x, b);
    moveRow(D, b, y, a);
    if (x != a) {
      moveRow(D, x, a, select(x, y, y != b));
    }
    if (y != b) {
      moveRow(D, y, b, select(y, x, x != a));
    }
  }
}

// Σcount² change of the pair move; the count changes are left in D (zeroed first).
fn pairDelta(D: ptr<function, array<i32, 26>>, a: u32, b: u32) -> i32 {
  for (var v = 0u; v < 26u; v++) {
    (*D)[v] = 0;
  }
  let x = P[a];
  let y = P[b];
  pairMoves(D, a, b, x, y);
  var delta = 0;
  for (var v = 0u; v < 26u; v++) {
    let d = (*D)[v];
    delta += d * (2 * T[v] + d);
  }
  return delta;
}

// Applies the move of pair (a, b) with count changes D and Σcount² change `delta` (the winning
// thread, which computed them).
fn applyPair(D: ptr<function, array<i32, 26>>, delta: i32, a: u32, b: u32) {
  let x = P[a];
  let y = P[b];
  for (var v = 0u; v < 26u; v++) {
    T[v] = T[v] + (*D)[v];
  }
  wSum = wSum + delta;
  if (x == b) {
    P[a] = a;
    P[b] = b;
    wPlugs = wPlugs - 1u;
  } else {
    if (x == a && y == b) {
      wPlugs = wPlugs + 1u;
    }
    if (x != a) {
      P[x] = select(x, y, y != b);
    }
    if (y != b) {
      P[y] = select(y, x, x != a);
    }
    P[a] = b;
    P[b] = a;
  }
}

//#BARRIER-BEGIN
// climbIoc: first-improvement hill climb over `count` pairs starting at `off`.
//
// Pair p is always tested by thread p mod WG, over a window of WG pairs starting at the cursor,
// so a thread keeps its pair until the cursor passes it. Its count changes D depend only on the
// pair's letters and their current partners, so after another pair's move (count changes Dw) the
// Σcount² change is updated exactly as delta += 2·Σ D·Dw — unless the move changed the partner of
// one of its letters, then it is recomputed. wCursor packs the cursor (low 16 bits) and the round
// parity (bit 16).
fn climb(lid: u32, passes: u32, off: u32, count: u32) {
  var myPair = NONE;
  var myD: array<i32, 26>;
  var myDelta = 0;
  var myA = 0u;
  var myB = 0u;
  if (lid == 0u) {
    wPass = 0u;
  }
  loop {
    let current = workgroupUniformLoad(&wPass);
    if (current >= passes) {
      break;
    }
    if (lid == 0u) {
      wCursor = 0u;
      wImproved = 0u;
      wWin = 0u;
      atomicStore(&wFound[0], NONE);
      atomicStore(&wFound[1], NONE);
    }
    myPair = NONE;
    loop {
      let packed = workgroupUniformLoad(&wCursor);
      let k = packed & 0xffffu;
      let par = packed >> 16u;
      if (k >= count) {
        break;
      }
      // Bring the cached result up to date with the move applied in the previous round.
      if (wWin == 1u && myPair != NONE) {
        if (myA == wChanged[0] || myA == wChanged[1] || myA == wChanged[2] || myA == wChanged[3] ||
            myB == wChanged[0] || myB == wChanged[1] || myB == wChanged[2] || myB == wChanged[3]) {
          myPair = NONE;
        } else {
          var dot = 0;
          for (var v = 0u; v < 26u; v++) {
            dot += myD[v] * Dwin[v];
          }
          myDelta += 2 * dot;
        }
      }
      // This thread's pair in the window [k, k + WG).
      let p = k + (lid + WG - (k % WG)) % WG;
      let inWindow = p < count;
      if (inWindow) {
        if (p != myPair) {
          let pr = pairs[off + p];
          myA = pr & 0xffu;
          myB = pr >> 8u;
          myDelta = pairDelta(&myD, myA, myB);
          myPair = p;
        }
        let blocked = P[myA] == myA && P[myB] == myB && wPlugs >= params.maxPlugs;
        if (!blocked && myDelta > 0) {
          atomicMin(&wFound[par], p - k);
        }
      }
      workgroupBarrier();
      let f = atomicLoad(&wFound[par]);
      if (lid == 0u) {
        atomicStore(&wFound[1u - par], NONE);
      }
      if (f == NONE) {
        if (lid == 0u) {
          wCursor = (k + WG) | ((1u - par) << 16u);
          wWin = 0u;
        }
      } else if (inWindow && p - k == f) {
        let x = P[myA];
        let y = P[myB];
        wChanged[0] = myA;
        wChanged[1] = myB;
        wChanged[2] = x;
        wChanged[3] = y;
        for (var v = 0u; v < 26u; v++) {
          Dwin[v] = myD[v];
        }
        applyPair(&myD, myDelta, myA, myB);
        wCursor = (k + f + 1u) | ((1u - par) << 16u);
        wImproved = 1u;
        wWin = 1u;
      }
    }
    let improved = workgroupUniformLoad(&wImproved);
    if (lid == 0u) {
      wPass = current + 1u;
    }
    if (improved == 0u) {
      break;
    }
  }
  workgroupBarrier();
}

//#BARRIER-END
//#SG-BEGIN
// climbIoc in one subgroup of 32 lanes, without workgroup memory or barriers: every lane keeps an
// identical private copy of the plugboard, the output counts, Σcount² and the cable count and
// applies each accepted move itself. Pair p is tested by lane p mod 32 (cached across rounds and
// updated incrementally, as in the barrier version); one ballot finds the earliest improving
// pair of the window and shuffles hand its count changes to every lane. Reads P (workgroup) on
// entry and leaves P, T, wSum and wPlugs there on exit.
fn climb(lid: u32, passes: u32, off: u32, count: u32) {
  var pv: array<u32, 26>;
  for (var a = 0u; a < 26u; a++) {
    pv[a] = P[a];
  }
  var tv: array<i32, 26>;
  var sum = 0;
  if (HIST) {
    // T = Σ_z row(z, P[z]) — identical in every lane, no reduction needed.
    for (var z = 0u; z < 26u; z++) {
      addRow(&tv, z, pv[z]);
    }
    for (var v = 0u; v < 26u; v++) {
      sum += tv[v] * tv[v];
    }
  } else {
    var mine: array<i32, 26>;
    for (var z = 0u; z < 26u; z++) {
      let s = cs[z];
      let cnt = cs[z + 1u] - s;
      let v = pv[z];
      for (var j = lid; j < cnt; j += WG) {
        let y = entry(s, cnt, v, j);
        mine[y] = mine[y] + 1;
      }
    }
    for (var v = 0u; v < 26u; v++) {
      tv[v] = subgroupAdd(mine[v]);
      sum += tv[v] * tv[v];
    }
  }
  var plugs = 0u;
  for (var a = 0u; a < 26u; a++) {
    if (pv[a] > a) {
      plugs++;
    }
  }
  var myPair = NONE;
  var myD: array<i32, 26>;
  var myDelta = 0;
  var myA = 0u;
  var myB = 0u;
  for (var ps = 0u; ps < passes; ps++) {
    var cursor = 0u;
    var improved = false;
    myPair = NONE;
    loop {
      if (cursor >= count) {
        break;
      }
      let p = cursor + (lid + WG - (cursor % WG)) % WG;
      var improving = false;
      if (p < count) {
        if (p != myPair) {
          let pr = pairs[off + p];
          myA = pr & 0xffu;
          myB = pr >> 8u;
          for (var v = 0u; v < 26u; v++) {
            myD[v] = 0;
          }
          pairMoves(&myD, myA, myB, pv[myA], pv[myB]);
          var delta = 0;
          for (var v = 0u; v < 26u; v++) {
            delta += myD[v] * (2 * tv[v] + myD[v]);
          }
          myDelta = delta;
          myPair = p;
        }
        let blocked = pv[myA] == myA && pv[myB] == myB && plugs >= params.maxPlugs;
        improving = !blocked && myDelta > 0;
      }
      let ballot = subgroupBallot(improving).x;
      if (ballot == 0u) {
        cursor += WG;
        continue;
      }
      // Earliest improving pair in window order: rotate so the cursor's lane is bit 0.
      let sh = cursor % WG;
      var rot = ballot;
      if (sh != 0u) {
        rot = (ballot >> sh) | (ballot << (WG - sh));
      }
      let f = countTrailingZeros(rot);
      let w = (f + sh) % WG;
      let a = subgroupShuffle(myA, w);
      let b = subgroupShuffle(myB, w);
      let wd = subgroupShuffle(myDelta, w);
      var dw: array<i32, 26>;
      for (var v = 0u; v < 26u; v++) {
        dw[v] = subgroupShuffle(myD[v], w);
      }
      let x = pv[a];
      let y = pv[b];
      if (lid != w && myPair != NONE) {
        if (myA == a || myA == b || myA == x || myA == y || myB == a || myB == b || myB == x || myB == y) {
          myPair = NONE;
        } else {
          var dot = 0;
          for (var v = 0u; v < 26u; v++) {
            dot += myD[v] * dw[v];
          }
          myDelta += 2 * dot;
        }
      }
      for (var v = 0u; v < 26u; v++) {
        tv[v] = tv[v] + dw[v];
      }
      sum += wd;
      if (x == b) {
        pv[a] = a;
        pv[b] = b;
        plugs = plugs - 1u;
      } else {
        if (x == a && y == b) {
          plugs = plugs + 1u;
        }
        if (x != a) {
          pv[x] = select(x, y, y != b);
        }
        if (y != b) {
          pv[y] = select(y, x, x != a);
        }
        pv[a] = b;
        pv[b] = a;
      }
      cursor = cursor + f + 1u;
      improved = true;
    }
    if (!improved) {
      break;
    }
  }
  workgroupBarrier();
  if (lid == 0u) {
    for (var a = 0u; a < 26u; a++) {
      P[a] = pv[a];
    }
    for (var v = 0u; v < 26u; v++) {
      T[v] = tv[v];
    }
    wSum = sum;
    wPlugs = plugs;
  }
  workgroupBarrier();
}

//#SG-END
// Bigram sum of the decrypt (decodeClassTable + ngramSum order 2).
fn bigramSum(lid: u32) -> u32 {
  let n = params.n;
  if (lid == 0u) {
    atomicStore(&wAcc, 0u);
  }
  workgroupBarrier();
  var local = 0u;
  for (var i = lid; i + 1u < n; i += WG) {
    let a = decodeAt(i);
    let b = decodeAt(i + 1u);
    local += tbyte(T_BIGRAM, a * 26u + b);
  }
  atomicAdd(&wAcc, local);
  workgroupBarrier();
  return atomicLoad(&wAcc);
}

fn decodeAt(i: u32) -> u32 {
  let z = cipher[i];
  let s = cs[z];
  let cnt = cs[z + 1u] - s;
  if (ONFLY) {
    return P[scr(i, P[z])];
  }
  return P[tabByte(s * 26u + P[z] * cnt + cipher[params.classRankOff + i])];
}

fn loadClassStart(lid: u32) {
  for (var z = lid; z < 27u; z += WG) {
    cs[z] = cipher[params.classStartOff + z];
  }
  if (ONFLY && RSHARED) {
    for (var w = lid; w < 169u; w += WG) {
      rfS[w] = tables[T_RF + w];
      rbS[w] = tables[T_RB + w];
    }
  }
  workgroupBarrier();
}

// ---------------------------------------------------------------- stage A

@compute @workgroup_size(__WG__)
fn screen(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_index) lid: u32) {
  let job = params.jobBase + wid.x;
  if (job >= params.jobCount) {
    return;
  }
  let V = params.variantsPerPos;
  let idx = job / V;
  let v = job % V;
  let oR = idx % 26u;
  let oM = (idx / 26u) % 26u;
  let pL = idx / 676u;
  let nR = params.nScreenRings;
  let rmCount = plan[oM * params.planScreenStride];
  if (v >= rmCount * nR) {
    if (lid == 0u) {
      results[job * SCREEN_STRIDE] = NONE;
    }
    return;
  }
  let rm = plan[oM * params.planScreenStride + 1u + v / nR];
  let r = plan[params.planScreenRingsOff + 1u + v % nR];
  loadClassStart(lid);
  buildTab(lid, pL, oM, oR, rm, r);
  if (lid < 26u) {
    P[lid] = lid;
  }
  workgroupBarrier();
  initCounts(lid);
  climb(lid, params.screenPasses, params.pairsScreenOff, params.pairsScreenCount);
  var value = 0u;
  if (params.screenBigram == 1u) {
    value = bigramSum(lid);
  }
  if (lid == 0u) {
    if (params.screenBigram == 0u) {
      value = u32(wSum);
    }
    results[job * SCREEN_STRIDE] = value;
    for (var w = 0u; w < 7u; w++) {
      var packed = 0u;
      for (var k = 0u; k < 4u; k++) {
        let a = w * 4u + k;
        if (a < 26u) {
          packed |= P[a] << (k * 8u);
        }
      }
      results[job * SCREEN_STRIDE + 1u + w] = packed;
    }
  }
}

// ---------------------------------------------------------------- stage B

// One ring variant warm-started from the screen plugboard: climb, then rate (bigrams or Σcount²).
// The value is left in wValue and appended to the candidate list (thread 0).
fn tryVariant(lid: u32, pL: u32, oM: u32, oR: u32, rm: u32, r: u32) -> u32 {
  buildTab(lid, pL, oM, oR, rm, r);
  if (lid < 26u) {
    P[lid] = startP[lid];
  }
  workgroupBarrier();
  initCounts(lid);
  climb(lid, params.refinePasses, params.pairsRefineOff, params.pairsRefineCount);
  var value = 0u;
  if (params.rankBigram == 1u) {
    value = bigramSum(lid);
  }
  if (lid == 0u) {
    if (params.rankBigram == 0u) {
      value = u32(wSum);
    }
    wValue = value;
    let c = wCandN;
    candV[c] = value;
    candR[c] = r;
    candRm[c] = rm;
    wCandN = c + 1u;
  }
  return workgroupUniformLoad(&wValue);
}

// The right ring with the best value for middle ring rm (first best in ring order) and that value.
fn sweepRight(lid: u32, pL: u32, oM: u32, oR: u32, rm: u32) -> vec2i {
  let count = plan[params.planSweepOff];
  var bestR = 0u;
  var best = -1;
  for (var k = 0u; k < count; k++) {
    let r = plan[params.planSweepOff + 1u + k];
    let value = i32(tryVariant(lid, pL, oM, oR, rm, r));
    if (value > best) {
      best = value;
      bestR = r;
    }
  }
  return vec2i(i32(bestR), best);
}

@compute @workgroup_size(__WG__)
fn refine(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_index) lid: u32) {
  let job = params.jobBase + wid.x;
  if (job >= params.jobCount) {
    return;
  }
  let idx = jobs[job * JOB_STRIDE];
  let oR = idx % 26u;
  let oM = (idx / 26u) % 26u;
  let pL = idx / 676u;
  loadClassStart(lid);
  if (lid < 26u) {
    startP[lid] = (jobs[job * JOB_STRIDE + 1u + lid / 4u] >> ((lid % 4u) * 8u)) & 0xffu;
  }
  if (lid == 0u) {
    wCandN = 0u;
  }
  workgroupBarrier();

  let allBase = params.planAllOff + oM * params.planAllStride;
  let rmCount = plan[allBase];
  let rm0 = plan[allBase + 1u];
  // The CPU looks up the value of variant (rm0, r1) in its list: that is the sweep's maximum.
  let first = sweepRight(lid, pL, oM, oR, rm0);
  let r1 = u32(first.x);
  var bestRm = rm0;
  var best = first.y;
  for (var j = 1u; j < rmCount; j++) {
    let rm = plan[allBase + 1u + j];
    let value = i32(tryVariant(lid, pL, oM, oR, rm, r1));
    if (value > best) {
      best = value;
      bestRm = rm;
    }
  }
  if (bestRm != rm0) {
    _ = sweepRight(lid, pL, oM, oR, bestRm);
  }

  // The best refineKeep variants, ties in insertion order (stable sort, descending).
  if (lid == 0u) {
    let total = wCandN;
    let keep = min(max(params.refineKeep, 1u), min(total, 4u));
    var taken: array<u32, 4>;
    for (var f = 0u; f < keep; f++) {
      var pick = NONE;
      var pickV = 0u;
      for (var c = 0u; c < total; c++) {
        var used = false;
        for (var t = 0u; t < f; t++) {
          if (taken[t] == c) {
            used = true;
          }
        }
        if (!used && (pick == NONE || candV[c] > pickV)) {
          pick = c;
          pickV = candV[c];
        }
      }
      taken[f] = pick;
      finR[f] = candR[pick];
      finRm[f] = candRm[pick];
    }
    wFinN = keep;
  }
  let finals = workgroupUniformLoad(&wFinN);
  let outBase = job * params.refineKeep * FINAL_STRIDE;
  for (var f = 0u; f < finals; f++) {
    let r = workgroupUniformLoad(&finR[f]);
    let rm = workgroupUniformLoad(&finRm[f]);
    buildTab(lid, pL, oM, oR, rm, r);
    if (lid < 26u) {
      P[lid] = startP[lid];
    }
    workgroupBarrier();
    initCounts(lid);
    climb(lid, params.finalPasses, params.pairsFinalOff, params.pairsFinalCount);
    var bsum = 0u;
    if (params.rankBigram == 1u) {
      bsum = bigramSum(lid);
    }
    if (lid == 0u) {
      let o = outBase + f * FINAL_STRIDE;
      results[o] = r;
      results[o + 1u] = rm;
      results[o + 2u] = u32(wSum);
      results[o + 3u] = bsum;
      for (var w = 0u; w < 7u; w++) {
        var packed = 0u;
        for (var k = 0u; k < 4u; k++) {
          let a = w * 4u + k;
          if (a < 26u) {
            packed |= P[a] << (k * 8u);
          }
        }
        results[o + 4u + w] = packed;
      }
      results[o + 11u] = 1u;
    }
    workgroupBarrier();
  }
  if (lid == 0u) {
    for (var f = finals; f < params.refineKeep; f++) {
      results[outBase + f * FINAL_STRIDE + 11u] = 0u;
    }
  }
}
