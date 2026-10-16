import { describe, expect, it, vi } from 'vitest';
import type { Tx } from '../../shared/model';
import type { PassengerPose } from '../../src/lib/passengerMotion';
import { passengerDescription } from '../../src/lib/passengerPresentation';
import {
  isHistoricalPassenger,
  passengerStatus,
  type PassengerStatusObservation,
} from '../../src/lib/passengerStatus';

const OBSERVED_AT = Date.parse('2026-10-15T12:00:00Z');
const transaction: Tx = {
  id: `0x${'a'.repeat(64)}`,
  chain: 'ethereum',
  status: 'pending',
  feeRate: 2,
  size: 21_000,
  kind: 'transfer',
  value: 'Non mesurée',
};

function observation(
  overrides: Partial<PassengerStatusObservation> = {},
): PassengerStatusObservation {
  return { tx: transaction, sourceObserved: false, ...overrides };
}

function pose(overrides: Partial<PassengerPose> = {}): PassengerPose {
  return {
    ...observation(),
    x: 420,
    y: 300,
    queueX: 420,
    queueY: 300,
    phase: 'parked',
    destination: 'queue',
    reason: 'accepted',
    selectedForCandidate: false,
    inWagon: false,
    wagon: null,
    inHandoff: false,
    headScale: 1,
    resourceUnits: 1,
    opacity: 1,
    progress: 1,
    facing: 1,
    movementAngle: 0,
    walkPhase: 0,
    ...overrides,
  };
}

describe('Central passenger presence and inclusion status', () => {
  it.each(['pending', 'queued', 'absent', 'replaced', 'unknown'] as const)(
    'keeps a verified inclusion ahead of conflicting or older pool state %s',
    (poolState) => {
      const confirmed = observation({
        tx: { ...transaction, status: 'confirmed', blockHash: `0x${'b'.repeat(64)}` },
        sourceObserved: false,
        poolState,
        poolObservedAt: OBSERVED_AT,
      });
      expect(passengerStatus(confirmed)).toEqual({
        kind: 'confirmed',
        group: 'confirmed',
        label: 'incluse dans un bloc observé',
        description: 'incluse dans un bloc observé',
      });
      expect(isHistoricalPassenger(confirmed)).toBe(false);
    },
  );

  it.each(['absent', 'replaced'] as const)(
    'keeps explicit %s evidence ahead of an old pending row still in the detail sample',
    (poolState) => {
      const source = observation({ sourceObserved: true, poolState });
      const status = passengerStatus(source);
      expect(status.kind).toBe(poolState);
      expect(status.group).toBe('history');
      expect(isHistoricalPassenger(source)).toBe(true);
      expect(status.description).toContain('sans preuve de confirmation');
      expect(status.description).not.toContain('en attente dans la source');
      expect(source.tx.status).toBe('pending');
    },
  );

  it('keeps old individual details in the current group when the complete inventory still finds the ID pending', () => {
    const source = observation({ poolState: 'pending', poolObservedAt: OBSERVED_AT });
    const status = passengerStatus(source);
    expect(status).toMatchObject({ kind: 'pending', group: 'current' });
    expect(status.description).toContain(
      'en attente dans le dernier relevé complet du fournisseur',
    );
    expect(status.description).toContain('détails individuels conservés');
    expect(status.description).toContain(new Date(OBSERVED_AT).toLocaleTimeString('fr-CH'));
    expect(status.description).not.toContain('statut actuel inconnu');
    expect(isHistoricalPassenger(source)).toBe(false);
  });

  it('distinguishes a current queued presence from unknown history and does not imply readiness to board', () => {
    const source = observation({ poolState: 'queued', poolObservedAt: OBSERVED_AT });
    expect(passengerStatus(source)).toMatchObject({ kind: 'queued', group: 'queued' });
    expect(passengerStatus(source).description).toContain('différée (queued)');
    expect(isHistoricalPassenger(source)).toBe(false);
    expect(source.tx.status).toBe('pending');
  });

  it.each([undefined, 'unknown'] as const)(
    'keeps sampled pending details current without fabricating full-inventory proof (%s)',
    (poolState) => {
      const source = observation({ sourceObserved: true, poolState });
      expect(passengerStatus(source)).toEqual({
        kind: 'observed',
        group: 'current',
        label: 'en attente dans la source',
        description: 'en attente dans la source',
      });
      expect(isHistoricalPassenger(source)).toBe(false);
    },
  );

  it('preserves the exact existing unknown label and never turns sample absence into a pool removal', () => {
    const source = observation({ poolState: 'unknown' });
    expect(passengerStatus(source)).toEqual({
      kind: 'unknown',
      group: 'history',
      label: 'dernière observation · statut actuel inconnu',
      description:
        'dernière observation conservée, absente de l’échantillon actuel ; statut actuel inconnu',
    });
    expect(passengerStatus(observation())).toEqual(passengerStatus(source));
    expect(isHistoricalPassenger(source)).toBe(true);
    expect(passengerStatus(source).description).not.toContain('dernier relevé complet');
  });

  it('classifies without reading a clock or changing the supplied evidence', () => {
    const source = Object.freeze(
      observation({
        tx: Object.freeze({ ...transaction }),
        poolState: 'pending',
        poolObservedAt: OBSERVED_AT,
      }),
    );
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Classification must use supplied evidence only');
    });
    try {
      expect(passengerStatus(source).group).toBe('current');
      expect(isHistoricalPassenger(source)).toBe(false);
      expect(source.poolObservedAt).toBe(OBSERVED_AT);
      expect(source.tx.status).toBe('pending');
    } finally {
      clock.mockRestore();
    }
  });

  it.each([NaN, -1, Number.MAX_SAFE_INTEGER, Infinity])(
    'does not render an invalid observation date (%s)',
    (poolObservedAt) => {
      const status = passengerStatus(observation({ poolState: 'pending', poolObservedAt }));
      expect(status.group).toBe('current');
      expect(status.description).not.toContain('Invalid Date');
      expect(status.description).not.toContain('relevé à');
    },
  );

  it('reuses presence status in descriptions while preserving the age of individual fee details', () => {
    const pending = pose({ poolState: 'pending', poolObservedAt: OBSERVED_AT });
    expect(passengerDescription(pending)).toContain(passengerStatus(pending).description);
    expect(passengerDescription(pending)).toContain('frais de la dernière observation');
    expect(passengerDescription(pending)).not.toContain('statut actuel inconnu');
    const absent = pose({ sourceObserved: true, poolState: 'absent', poolObservedAt: OBSERVED_AT });
    expect(passengerDescription(absent)).toContain(passengerStatus(absent).description);
    expect(passengerDescription(absent)).not.toContain('en attente dans la source');
  });
});
