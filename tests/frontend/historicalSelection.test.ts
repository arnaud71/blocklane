import { describe, expect, it } from 'vitest';
import { snapshotSchema, type Snapshot, type Tx } from '../../shared/model';
import {
  canvasPassengerAnchor,
  hitTestCanvasPassenger,
  type CanvasPassenger,
  type CanvasPassengerFrame,
  type CanvasViewport,
} from '../../src/lib/passengerCanvas';
import {
  advancePassengerMotion,
  createPassengerMotion,
  passengerFrame,
  reconcilePassengerMotion,
  type PassengerMotionState,
  type PassengerPose,
} from '../../src/lib/passengerMotion';
import { passengerDescription } from '../../src/lib/passengerPresentation';
import { feeColorForRate, HIGH_FEE_COLOR } from '../../src/lib/feeColors';

const OBSERVED_AT = Date.parse('2026-10-15T12:00:00Z');
const transaction: Tx = {
  id: `0x${'1'.padStart(64, '0')}`,
  chain: 'ethereum',
  status: 'pending',
  feeRate: 0.5,
  size: 21_000,
  kind: 'transfer',
  value: '0.01 ETH',
};

/** A valid partial live observation; missing IDs carry no removal or inclusion evidence. */
function snapshot(transactions: Tx[] = [transaction], observedAt = OBSERVED_AT): Snapshot {
  return snapshotSchema.parse({
    chain: 'ethereum',
    mode: 'live',
    status: 'ok',
    source: 'Fournisseur contrôlé pour la sélection historique',
    observedAt,
    coverage: 'Échantillon partiel ; une absence ne prouve aucun changement de statut.',
    pendingCount: null,
    feeRate: 1,
    feeUnit: 'Gwei',
    transactions,
    blocks: [
      {
        hash: `0x${'a'.repeat(64)}`,
        height: 23_000_000,
        timestamp: OBSERVED_AT / 1_000,
        txCount: 100,
        used: 30_000_000,
        capacity: 60_000_000,
      },
    ],
  });
}

function settled(state: PassengerMotionState): PassengerMotionState {
  return advancePassengerMotion(state, 0, { reducedMotion: true });
}

function pose(state: PassengerMotionState): PassengerPose {
  const passenger = passengerFrame(state).passengers.find(({ tx }) => tx.id === transaction.id);
  if (!passenger) throw new Error('Voyageur de test absent');
  return passenger;
}

function canvasPassenger(overrides: Partial<PassengerPose> = {}): CanvasPassenger {
  return {
    pose: {
      ...pose(settled(createPassengerMotion(snapshot()))),
      x: 318,
      y: 320,
      phase: 'parked',
      sourceObserved: false,
      opacity: 1,
      ...overrides,
    },
    interactive: true,
    color: HIGH_FEE_COLOR,
  };
}

const viewport: CanvasViewport = { width: 600, height: 1_480, ratio: 2 };

function frame(passenger: CanvasPassenger, mirrored = false): CanvasPassengerFrame {
  return {
    view: { startX: 172, width: 300, height: 740, mirrored },
    passengers: [passenger],
  };
}

function hitAtHead(scene: CanvasPassengerFrame, passenger: CanvasPassenger) {
  const anchor = canvasPassengerAnchor(scene, viewport, passenger);
  return hitTestCanvasPassenger(scene, viewport, anchor.x, anchor.y - 30);
}

describe('Historical passenger selection', () => {
  it.each([false, true])(
    'keeps a visible historical passenger selectable on a mirrored=%s scene',
    (mirrored) => {
      const passenger = canvasPassenger();
      const scene = frame(passenger, mirrored);
      expect(hitAtHead(scene, passenger)).toBe(passenger);
    },
  );

  it('respects wagon clips and offsets while selecting retained passengers', () => {
    const passenger = {
      ...canvasPassenger(),
      offsetY: 40,
      clips: [{ x: 305, y: 285, width: 30, height: 45 }],
    };
    const scene = frame(passenger);
    expect(hitAtHead(scene, passenger)).toBe(passenger);
    expect(
      hitAtHead(
        frame({ ...passenger, clips: [{ x: 180, y: 200, width: 20, height: 20 }] }),
        passenger,
      ),
    ).toBeUndefined();
  });

  it('does not activate invisible passengers or departure illustrations', () => {
    const passenger = canvasPassenger();
    expect(hitAtHead(frame({ ...passenger, interactive: false }), passenger)).toBeUndefined();
    expect(hitAtHead(frame(canvasPassenger({ opacity: 0 })), passenger)).toBeUndefined();
    const departure: CanvasPassengerFrame = {
      ...frame(passenger),
      passengers: [],
      departure: {
        passengers: [passenger],
        clips: [{ x: 300, y: 280, width: 40, height: 60 }],
        offsetY: 0,
      },
    };
    expect(hitAtHead(departure, passenger)).toBeUndefined();
  });

  it('describes a historical observation without asserting its current pending status', () => {
    const description = passengerDescription(canvasPassenger().pose);
    expect(description).toMatch(/dernière observation conservée/i);
    expect(description).toMatch(/statut actuel inconnu/i);
    expect(description).toMatch(/frais de la dernière observation/i);
    expect(description).toContain('Afficher les détails.');
    expect(description).not.toContain('en attente dans la source');
    expect(passengerDescription(canvasPassenger().pose, undefined, false)).not.toContain(
      'Afficher les détails.',
    );
  });

  it('explains base-fee and native-capacity waits independently of shirt color', () => {
    const waiting = canvasPassenger({ sourceObserved: true, phase: 'queue', reason: 'fee' });
    expect(passengerDescription(waiting.pose)).toMatch(/frais inférieurs à la base fee Ethereum/i);
    expect(passengerDescription({ ...waiting.pose, reason: 'capacity' })).toMatch(
      /capacité insuffisante ou inconnue/i,
    );
    expect(passengerDescription({ ...waiting.pose, phase: 'boarded', inWagon: true })).not.toMatch(
      /embarquement non prévu/i,
    );
  });

  it('keeps a relatively red Ethereum waiter inspectable after absence and boards only after eligible reobservation', () => {
    const cheaper = Array.from({ length: 10 }, (_, index) => ({
      ...transaction,
      id: `0x${(index + 2).toString(16).padStart(64, '0')}`,
      feeRate: 0.01,
    }));
    const mean = (transaction.feeRate + 10 * 0.01) / 11;
    expect(feeColorForRate(transaction.feeRate, mean)).toBe(HIGH_FEE_COLOR);
    let state = settled(createPassengerMotion(snapshot([transaction, ...cheaper])));
    expect(pose(state)).toMatchObject({
      sourceObserved: true,
      phase: 'queue',
      reason: 'fee',
      inWagon: false,
    });

    state = settled(reconcilePassengerMotion(state, snapshot(cheaper, OBSERVED_AT + 3_000)));
    const historical = pose(state);
    expect(historical).toMatchObject({
      sourceObserved: false,
      phase: 'parked',
      inWagon: false,
      tx: { status: 'pending' },
    });
    expect(state.passengers.find(({ tx }) => tx.id === transaction.id)?.lastObservedAt).toBe(
      OBSERVED_AT,
    );
    const selectable = { ...canvasPassenger(), pose: historical };
    expect(hitAtHead(frame(selectable), selectable)).toBe(selectable);

    state = settled(reconcilePassengerMotion(state, snapshot(cheaper, OBSERVED_AT + 6_000)));
    expect(state.passengers.find(({ tx }) => tx.id === transaction.id)?.lastObservedAt).toBe(
      OBSERVED_AT,
    );
    state = settled(
      reconcilePassengerMotion(
        state,
        snapshot([{ ...transaction, feeRate: 2 }, ...cheaper], OBSERVED_AT + 9_000),
      ),
    );
    expect(pose(state)).toMatchObject({
      sourceObserved: true,
      phase: 'boarded',
      inWagon: true,
      reason: 'accepted',
      tx: { feeRate: 2, status: 'pending' },
    });
    expect(passengerFrame(state).projectionCount.next).toBe(1);
  });
});
