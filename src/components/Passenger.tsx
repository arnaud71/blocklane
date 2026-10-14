import { memo, useMemo, type KeyboardEvent } from 'react';
import type { Tx } from '../../shared/model';
import type { PassengerPose } from '../lib/passengerMotion';

function stableHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

const phaseLabels = {
  arriving: 'arrivée depuis le bord extérieur du quai',
  queue: 'sur le quai',
  reordering: 'rejoint sa place réservée dans la file',
  parked: 'en attente visuelle sur le quai, statut actuel non suivi',
  walking: 'en marche',
  boarding: 'embarquement illustré',
  preparing: 'embarquement rapide avant le départ',
  boarded: 'à bord du wagon illustratif',
  exiting: 'sortie illustrée',
  returning: 'retour en file illustré',
  retiring: 'dernière observation quittant le quai',
  confirmed: 'inclusion observée',
};
const skinPalette = ['#ebcba6', '#bf8f65', '#966746', '#d2ad84'];

interface PassengerProps {
  pose: PassengerPose;
  selected: boolean;
  feeColor: string;
  feeLabel?: string;
  onSelect: (tx: Tx) => void;
  originX?: number;
  originY?: number;
  interactive?: boolean;
  mirrored?: boolean;
}

function isMoving(pose: PassengerPose): boolean {
  return (
    !pose.inWagon &&
    !pose.inHandoff &&
    (pose.phase === 'arriving' ||
      pose.phase === 'reordering' ||
      pose.phase === 'walking' ||
      pose.phase === 'boarding' ||
      pose.phase === 'preparing' ||
      pose.phase === 'exiting' ||
      pose.phase === 'returning' ||
      pose.phase === 'retiring')
  );
}

function hasDirectionArrow(pose: PassengerPose): boolean {
  return pose.phase === 'exiting' || pose.phase === 'returning';
}

function sameTransaction(previous: Tx, next: Tx): boolean {
  return (
    previous === next ||
    (previous.id === next.id &&
      previous.chain === next.chain &&
      previous.feeRate === next.feeRate &&
      previous.size === next.size &&
      previous.status === next.status &&
      previous.blockHash === next.blockHash &&
      previous.kind === next.kind &&
      previous.value === next.value)
  );
}

function samePassenger(previous: PassengerProps, next: PassengerProps): boolean {
  const before = previous.pose;
  const after = next.pose;
  return (
    previous.selected === next.selected &&
    previous.feeColor === next.feeColor &&
    previous.feeLabel === next.feeLabel &&
    previous.onSelect === next.onSelect &&
    (previous.originX ?? 0) === (next.originX ?? 0) &&
    (previous.originY ?? 0) === (next.originY ?? 0) &&
    (previous.interactive ?? true) === (next.interactive ?? true) &&
    (previous.mirrored ?? false) === (next.mirrored ?? false) &&
    sameTransaction(before.tx, after.tx) &&
    before.x === after.x &&
    before.y === after.y &&
    before.phase === after.phase &&
    before.sourceObserved === after.sourceObserved &&
    before.headScale === after.headScale &&
    before.opacity === after.opacity &&
    before.facing === after.facing &&
    before.wagon === after.wagon &&
    before.inHandoff === after.inHandoff &&
    isMoving(before) === isMoving(after) &&
    (!isMoving(after) || before.walkPhase === after.walkPhase) &&
    (!hasDirectionArrow(after) || before.movementAngle === after.movementAngle)
  );
}

function PassengerView({
  pose,
  selected,
  feeColor,
  feeLabel,
  onSelect,
  originX = 0,
  originY = 0,
  interactive = true,
  mirrored = false,
}: PassengerProps) {
  const tx = pose.tx;
  const selectable = interactive && pose.sourceObserved;
  const hash = useMemo(() => stableHash(tx.id), [tx.id]);
  const skin = skinPalette[hash % skinPalette.length];
  const moving = isMoving(pose);
  const step = moving ? Math.sin(pose.walkPhase) * 3.5 : 0;
  const facing = mirrored ? -pose.facing : pose.facing;
  const canonicalAngle = pose.movementAngle ?? (pose.facing === -1 ? 180 : 0);
  const movementAngle = mirrored ? 180 - canonicalAngle : canonicalAngle;
  // Keep the static glyphs intact while only the limbs and position animate.
  const characterDetails = useMemo(
    () => (
      <>
        <g
          className="street-person-head"
          transform={'translate(0 -22) scale(' + pose.headScale.toFixed(3) + ')'}
        >
          <circle r="4.6" fill={skin} />
          <path
            d={hash % 3 === 0 ? 'M-5 0q0-7 6-6 6 1 4 7l-4-3Z' : 'M-4-2q4-6 8 0Z'}
            fill={hash % 2 === 0 ? '#344d39' : '#634d38'}
          />
          <circle cx={facing * 2.1} cy=".1" r=".65" fill="#34504a" />
        </g>
        {tx.kind === 'contract' && (
          <rect x="5" y="-12" width="5" height="7" rx="1" fill="#e4c780" />
        )}
        {(pose.sourceObserved || !interactive) && tx.status === 'confirmed' && (
          <circle cx="10" cy="-27" r="2.5" fill="#9ad6a0" />
        )}
        {interactive && !pose.sourceObserved && (
          <g>
            <circle cx="10" cy="-27" r="3.2" fill="#365048" stroke="#c7d3c5" />
            <path d="M10-29v2l1.5 1" fill="none" stroke="#c7d3c5" strokeWidth=".8" />
          </g>
        )}
      </>
    ),
    [hash, skin, pose.headScale, facing, tx.kind, tx.status, pose.sourceObserved, interactive],
  );
  const label = useMemo(
    () =>
      'Transaction ' +
      tx.id.slice(0, 12) +
      ', ' +
      (feeLabel ?? `${tx.feeRate.toFixed(2)} ${tx.chain === 'bitcoin' ? 'sat/vB' : 'Gwei'}`) +
      ', ' +
      (pose.sourceObserved
        ? tx.status === 'confirmed'
          ? 'incluse dans un bloc observé'
          : 'en attente dans la source'
        : 'dernière observation conservée, absente de l’échantillon actuel') +
      '. ' +
      (pose.inHandoff ? 'à bord pendant le transfert' : phaseLabels[pose.phase]) +
      (selectable ? '. Afficher les détails.' : '.'),
    [
      tx.id,
      tx.feeRate,
      tx.chain,
      tx.status,
      feeLabel,
      pose.sourceObserved,
      pose.inHandoff,
      pose.phase,
      selectable,
    ],
  );
  const handleKeyDown = (event: KeyboardEvent<SVGGElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(tx);
    }
  };
  return (
    <g
      className={
        'street-person street-person--' + pose.phase + (selected ? ' street-person--selected' : '')
      }
      transform={
        'translate(' + (pose.x - originX).toFixed(2) + ' ' + (pose.y - originY).toFixed(2) + ')'
      }
      data-tx-id={tx.id}
      data-motion-state={pose.phase}
      data-resource-size={tx.size}
      data-head-scale={pose.headScale.toFixed(3)}
      data-source-status={tx.status}
      data-source-observed={pose.sourceObserved}
      data-fee-rate={tx.feeRate}
      data-wagon={pose.wagon ?? undefined}
      data-in-handoff={pose.inHandoff}
      role={selectable ? 'button' : interactive ? 'img' : undefined}
      tabIndex={selectable ? 0 : undefined}
      aria-hidden={interactive ? undefined : true}
      aria-label={label}
      aria-pressed={selectable ? selected : undefined}
      onClick={selectable ? () => onSelect(tx) : undefined}
      onKeyDown={selectable ? handleKeyDown : undefined}
      style={interactive ? undefined : { pointerEvents: 'none' }}
      opacity={pose.opacity}
    >
      <title>{label}</title>
      <rect
        className="street-person-hit"
        x="-12"
        y="-33"
        width="25"
        height="40"
        rx="5"
        fill="transparent"
      />
      <ellipse
        className="street-person-ring"
        cy="2"
        rx="11"
        ry="5"
        fill="none"
        stroke="#f5d589"
        strokeWidth="2"
      />
      <g transform={mirrored ? 'scale(-1 1)' : undefined}>
        <g className="street-person-body" aria-hidden="true">
          <ellipse cy="1" rx="7" ry="3" fill="#0b2925" opacity=".55" />
          <path
            d={'M-3-7L' + (-4 + step).toFixed(2) + ' 0M3-7L' + (4 - step).toFixed(2) + ' 0'}
            stroke="#183d36"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path className="street-person-shirt" d="M-4-17Q0-19 4-17L6-7H-6Z" fill={feeColor} />
          <path
            d={'M-5-15L-7 ' + (-8 - step).toFixed(2) + 'M5-15L7 ' + (-9 + step).toFixed(2)}
            stroke={skin}
            strokeWidth="2"
            strokeLinecap="round"
          />
          {characterDetails}
          {hasDirectionArrow(pose) && (
            <path
              d="M-6-36H6M2-40L6-36 2-32"
              transform={`rotate(${movementAngle} 0 -36)`}
              fill="none"
              stroke="#f0bd7b"
              strokeWidth="1.5"
            />
          )}
        </g>
      </g>
    </g>
  );
}

// Animation frames recreate poses; stationary passengers need no React update.
export const Passenger = memo(PassengerView, samePassenger);
