import { TOKEN_CONTRACTS, type TokenActivity } from './tokenContracts.js';
import { PROTOCOL_CONTRACTS, type ProtocolActivity } from './protocolContracts.js';

export const HOUSE_IDS = ['usdt', 'usdc', 'uniswap', 'aave'] as const;
export type HouseId = (typeof HOUSE_IDS)[number];
export const ACTIVITY_HOUSES = {
  usdt: { id: 'usdt', label: 'USDT', color: TOKEN_CONTRACTS.usdt.color, kind: 'token' },
  usdc: { id: 'usdc', label: 'USDC', color: TOKEN_CONTRACTS.usdc.color, kind: 'token' },
  uniswap: {
    id: 'uniswap',
    label: 'Uniswap',
    color: PROTOCOL_CONTRACTS.uniswap.color,
    kind: 'protocol',
  },
  aave: { id: 'aave', label: 'Aave', color: PROTOCOL_CONTRACTS.aave.color, kind: 'protocol' },
} as const;

type CategorizedTransaction = {
  tokens?: readonly TokenActivity[];
  protocols?: readonly ProtocolActivity[];
};
export function hasHouseActivity(tx: CategorizedTransaction, id: HouseId): boolean {
  return id === 'usdt' || id === 'usdc'
    ? (tx.tokens?.some((activity) => activity.tokenId === id) ?? false)
    : (tx.protocols?.some((activity) => activity.protocolId === id) ?? false);
}
export function transactionHouseIds(tx: CategorizedTransaction): HouseId[] {
  return HOUSE_IDS.filter((id) => hasHouseActivity(tx, id));
}
/** Capture this origin once at admission. Later classification never replays a journey. */
export function primaryHouseId(tx: CategorizedTransaction): HouseId | undefined {
  return (['uniswap', 'aave', 'usdt', 'usdc'] as const).find((id) => hasHouseActivity(tx, id));
}
