import { MAX_TRANSACTIONS, snapshotSchema, type ChainId, type Snapshot } from '../shared/model.js';

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/** Repeatable synthetic data, explicitly separated from every live-provider path. */
export function generateDemoSnapshot(chain: ChainId, now = Date.now(), seed = 2026): Snapshot {
  const bitcoin = chain === 'bitcoin';
  const random = seededRandom(seed + (bitcoin ? 0 : 1_000));
  const hex = () =>
    Array.from({ length: 64 }, () => Math.floor(random() * 16).toString(16)).join('');
  const capacity = bitcoin ? 1_000_000 : 60_000_000;
  const txCount = bitcoin ? 86 : 94;
  return snapshotSchema.parse({
    chain,
    mode: 'demo',
    status: 'ok',
    source: 'Simulation pédagogique · données fictives',
    observedAt: Math.max(0, Math.floor(now)),
    coverage:
      'Simulation déterministe : transactions, montants, frais, blocs et comptages fictifs. Aucune donnée de réseau réel et aucune transaction envoyée.',
    pendingCount: bitcoin ? 4_320 : 780,
    feeRate: bitcoin ? 8 : 1.6,
    feeUnit: bitcoin ? 'sat/vB' : 'Gwei',
    transactions: Array.from({ length: Math.min(txCount, MAX_TRANSACTIONS) }, (_, index) => ({
      id: `demo-${bitcoin ? 'btc' : 'eth'}-${hex()}`,
      chain,
      feeRate: Number((bitcoin ? 2 + random() * 35 : 0.6 + random() * 5).toFixed(3)),
      size: bitcoin ? Math.round(140 + random() * 1_000) : Math.round(21_000 + random() * 220_000),
      status: index < 12 ? 'confirmed' : 'pending',
      kind: !bitcoin && random() > 0.6 ? 'contract' : 'transfer',
      value: `${(random() * (bitcoin ? 0.8 : 4)).toFixed(4)} ${bitcoin ? 'BTC' : 'ETH'}`,
    })),
    blocks: Array.from({ length: 3 }, (_, index) => ({
      height: (bitcoin ? 900_000 : 23_000_000) - index,
      hash: `demo-${hex()}`,
      timestamp: Math.max(0, Math.floor(now / 1_000) - index * (bitcoin ? 600 : 12)),
      txCount: bitcoin ? Math.round(1_500 + random() * 2_000) : Math.round(90 + random() * 140),
      used: Math.round(capacity * (0.45 + random() * 0.5)),
      capacity,
    })),
    message:
      'Mode démonstration clairement identifié. Les identifiants demo ne correspondent à aucune transaction réelle.',
  });
}
