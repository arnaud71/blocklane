import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { Snapshot, Tx } from '../../shared/model';
import './StreetScene.css';

export interface StreetSceneProps {
  snapshot: Snapshot;
  paused: boolean;
  speed: number;
  reducedMotion: boolean;
  onSelect: (tx: Tx) => void;
  selectedId?: string;
  theme?: 'heg' | 'neutral';
}

function stableHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function Tree({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <ellipse cx="3" cy="12" rx="23" ry="8" fill="#031817" opacity=".45" />
      <path d="M-3 8V-35H3V8" fill="#a89770" />
      <path d="m0-14-10-13M0-25l9-11" stroke="#a89770" strokeWidth="3" />
      <path
        d="M-23-26C-32-37-23-54-12-53c-2-14 17-24 27-12 16 0 23 17 14 26 8 15-11 27-25 20-12 8-26 3-27-7Z"
        fill="#285f46"
      />
      <path
        d="M-18-42c5-13 23-18 32-11 7 5 10 13 7 20-4-12-19-15-30-8-3 2-6 2-9-1Z"
        fill="#4b8462"
      />
      <circle cx="-9" cy="-50" r="5" fill="#75a179" opacity=".65" />
    </g>
  );
}

function Lamp({ x, y, glow }: { x: number; y: number; glow: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cy="2" rx="12" ry="4" fill="#061c1b" opacity=".6" />
      <path d="M0 0v-90q0-10 10-10h9" fill="none" stroke="#678a80" strokeWidth="3" />
      <path d="M11-99h20l-3 6H14Z" fill="#e6dc9e" />
      <circle cx="21" cy="-94" r="43" fill={`url(#${glow})`} />
    </g>
  );
}

function CampusBuilding({ neutral }: { neutral: boolean }) {
  return (
    <g>
      <path d="m60 357 194 1 60-34-198-2Z" fill="#163d37" />
      <path d="m60 357 194 1v13L60 370Z" fill="#0c2926" />
      <path d="m254 358 60-34v13l-60 34Z" fill="#092422" />
      <path d="M86 200h157v143H86Z" fill="#d6d4bd" />
      <path d="m243 200 49-28v143l-49 28Z" fill="#79998a" />
      <path d="m86 200 49-28h157l-49 28Z" fill="#eff0d9" />
      <path d="M86 212h157v9H86ZM86 267h157v7H86Z" fill="#8baa97" />
      {[0, 1, 2, 3, 4].map((column) => (
        <g key={column}>
          <rect x={101 + column * 27} y="228" width="16" height="26" rx="1" fill="#254e47" />
          <rect x={101 + column * 27} y="283" width="16" height="29" rx="1" fill="#284e45" />
          <path
            d={`M${109 + column * 27} 229v24M${109 + column * 27} 284v27`}
            stroke="#7faaa0"
            strokeWidth="1"
          />
          <rect
            x={103 + column * 27}
            y="230"
            width="5"
            height="8"
            fill="#b5d4bc"
            opacity={column === 1 || column === 4 ? '.8' : '.25'}
          />
        </g>
      ))}
      <path
        d="m253 218 13-7v27l-13 7ZM274 206l11-6v26l-11 7ZM253 272l13-7v29l-13 7ZM274 260l11-6v29l-11 7Z"
        fill="#234941"
      />
      <rect x="145" y="315" width="35" height="28" fill="#1a3c35" />
      <path d="M161 316v26" stroke="#7faaa0" />
      <path d="m137 343 49 0 9 7h-67Z" fill="#babba5" />
      <path d="m128 350 67 0 9 7h-85Z" fill="#8b9b84" />
      <path d="m124 183 86 0 12-7h-86Z" fill="#48736b" />
      <path
        d="m126 183 84 0M144 177l-10 6m29-6-10 6m29-6-10 6m29-6-10 6"
        stroke="#9dc3b4"
        strokeWidth="1"
      />
      <path d="m218 190 21 0 19-11h-21Z" fill="#315f44" />
      <path d="m217 190 22 0v4l-22-1Z" fill="#5a7356" />
      <path d="m222 184 2-9 4 6 4-9 3 7 6-3 2 9Z" fill="#619564" />
      <rect x="85" y="256" width={neutral ? 106 : 69} height="20" rx="2" fill="#1a4e43" />
      <text
        x="95"
        y="271"
        fill="#e4ecd7"
        fontSize={neutral ? 13 : 16}
        fontWeight="750"
        letterSpacing="2"
      >
        {neutral ? 'CAMPUS' : 'HEG'}
      </text>
      <text x="191" y="332" fill="#456359" fontSize="7" letterSpacing="1.2">
        {neutral ? 'OPEN CAMPUS' : 'CAMPUS · GENÈVE'}
      </text>
    </g>
  );
}

function LabBuilding() {
  return (
    <g>
      <path d="m397 274 143 0 44-25-143 0Z" fill="#1b403a" />
      <path d="M405 170h124v96H405Z" fill="#40776a" />
      <path d="m529 170 40-23v96l-40 23Z" fill="#225349" />
      <path d="m405 170 40-23h124l-40 23Z" fill="#87a99a" />
      <path d="m421 163 43-10h75l-25 10Z" fill="#426960" />
      <rect x="419" y="185" width="94" height="34" fill="#163e38" />
      <path d="M431 186v31m16-31v31m17-31v31m16-31v31m17-31v31" stroke="#79ada0" strokeWidth="2" />
      <path d="M420 205h93" stroke="#79ada0" />
      <rect x="419" y="232" width="68" height="18" rx="2" fill="#d8dabd" />
      <text x="428" y="244" fill="#27584d" fontSize="8" fontWeight="700" letterSpacing="1">
        LAB · DONNÉES
      </text>
      <path d="m540 183 19-11v32l-19 11ZM540 228l19-11v21l-19 11Z" fill="#163e37" />
      <path d="M504 234h13v32h-13Z" fill="#173c35" />
      <path d="m450 150 0-12 26-7 21 8v11" fill="#bad0bc" />
      <path d="m450 138 26-7 21 8-28 8Z" fill="#d5dfcb" />
      <path d="m477 131 0-20" stroke="#719689" strokeWidth="2" />
      <circle cx="477" cy="109" r="3" fill="#f4b36e" />
    </g>
  );
}

function Shelter({ x, y, name, accent }: { x: number; y: number; name: string; accent: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx="91" cy="89" rx="102" ry="13" fill="#061c1b" opacity=".5" />
      <path d="M11 17h151v63H11Z" fill="#28504a" opacity=".45" />
      <path d="m162 17 20-11v64l-20 10Z" fill="#619286" opacity=".2" />
      <path d="M17 22h138v47H17Z" fill="#bad5c2" opacity=".07" />
      <path d="M14 16v64m75-64v64m73-64v64" stroke="#779b8e" strokeWidth="3" />
      <path d="M14 47h148" stroke="#779b8e" strokeWidth="1" />
      <path d="m0 17 165 0 25-14H25Z" fill={accent} />
      <path d="M0 17h165v8H0Z" fill="#31554a" />
      <path d="m165 17 25-14v8l-25 14Z" fill="#243f36" />
      <path d="M44 67h73v5H44ZM50 71v10m61-10v10" fill="#b49e75" stroke="#b49e75" strokeWidth="3" />
      <rect x="17" y="29" width="35" height="20" rx="2" fill="#14372f" />
      <text x="22" y="42" fill="#c7ddcd" fontSize="6.5" fontWeight="700" letterSpacing=".6">
        {name}
      </text>
      <path d="M174 76v-47" stroke="#739787" strokeWidth="3" />
      <rect x="165" y="25" width="19" height="26" rx="3" fill="#d7dfc2" />
      <path d="M170 32h9m-9 5h9m-9 5h6" stroke="#315a4c" strokeWidth="1.5" />
    </g>
  );
}

function Tram({
  x,
  y,
  accent,
  label,
  capacity,
  variant,
  observedDeparture = false,
  onDepartureComplete,
}: {
  x: number;
  y: number;
  accent: string;
  label: string;
  capacity: string;
  variant: 'a' | 'b';
  observedDeparture?: boolean;
  onDepartureComplete?: () => void;
}) {
  return (
    <g
      className={`street-tram street-tram--${variant}${observedDeparture ? ' street-tram--observed-departure' : ''}`}
      transform={`translate(${x} ${y})`}
      onAnimationEnd={onDepartureComplete}
    >
      <ellipse cx="145" cy="101" rx="155" ry="16" fill="#031a19" opacity=".75" />
      <path d="m3 18 268 0 24-17H27Z" fill="#d9e3cc" />
      <path d="m7 18 264 0v64q0 12-12 12H19Q7 94 7 82Z" fill={accent} />
      <path d="m271 18 24-17v68q0 10-24 25Z" fill={variant === 'a' ? '#3a9989' : '#bb7946'} />
      <path d="M8 75h262v10H8Z" fill="#deead0" />
      <path d="m271 75 24-17v11l-24 17Z" fill="#b8c8ac" />
      <rect x="21" y="28" width="232" height="35" rx="5" fill="#103a36" />
      <path d="M34 30h30v16H34Zm45 0h29v16H79Zm44 0h30v16h-30Zm44 0h29v16h-29Z" fill="#346558" />
      <path d="M64 28v35m44-35v35m45-35v35m43-35v35" stroke={accent} strokeWidth="5" />
      <path d="m278 27 11-8v30l-11 8Z" fill="#173f37" />
      <path d="M207 28h40v60h-40Z" fill="#143e36" />
      <path d="M210 31h15v36h-15Zm19 0h15v36h-15Z" fill="#5c9380" />
      <path d="M227 29v58" stroke={accent} strokeWidth="2" />
      <path d="M213 77h5m16 0h5" stroke="#c8ddc2" strokeWidth="2" />
      <path d="M25 67h165" stroke="#e5f1d8" strokeWidth="1" opacity=".35" />
      <rect x="80" y="68" width="104" height="15" rx="3" fill="#103e35" />
      <text x="88" y="79" fill="#d7e4ce" fontSize="7.6" fontWeight="700">
        {label}
      </text>
      <text x="32" y="80" fill="#12433a" fontSize="9" fontWeight="800" letterSpacing="1">
        {variant === 'a' ? '01' : '02'}
      </text>
      <circle cx="53" cy="92" r="15" fill="#0c2523" />
      <circle cx="53" cy="92" r="8" fill="#789888" />
      <circle cx="53" cy="92" r="3" fill="#d4dcc0" />
      <circle cx="180" cy="92" r="15" fill="#0c2523" />
      <circle cx="180" cy="92" r="8" fill="#789888" />
      <circle cx="180" cy="92" r="3" fill="#d4dcc0" />
      <path d="m277 68 11-7v7l-11 7Z" fill="#fde2a0" />
      <path d="M10 66h7v8h-7Z" fill="#efbb83" />
      <path d="m57 6 42 0 14-5H71Z" fill="#688575" />
      <path d="m132 6 42 0 14-5h-42Z" fill="#688575" />
      <rect x="158" y="8" width="81" height="14" rx="3" fill="#133d34" />
      <text x="165" y="18" fill="#e3edca" fontSize="7.5" fontWeight="650" letterSpacing=".3">
        {capacity}
      </text>
    </g>
  );
}

function Person({
  tx,
  index,
  selected,
  demo,
  arrival,
  feeColor,
  resourceScale,
  onSelect,
  onArrivalComplete,
}: {
  tx: Tx;
  index: number;
  selected: boolean;
  demo: boolean;
  arrival: boolean;
  feeColor: string;
  resourceScale: number;
  onSelect: (tx: Tx) => void;
  onArrivalComplete: (id: string) => void;
}) {
  const hash = stableHash(tx.id);
  const skin = ['#ebcba6', '#bf8f65', '#966746', '#d2ad84'][hash % 4];
  const localIndex = index % 40;
  const group = index >= 40 ? 1 : 0;
  const column = localIndex % 10;
  const row = Math.floor(localIndex / 10);
  const x = (group === 0 ? 323 : 775) + column * 23 + row * 4;
  const y = 293 + row * 24;
  const label = `Transaction ${tx.id.slice(0, 12)}, ${tx.feeRate.toFixed(2)} ${tx.chain === 'bitcoin' ? 'sat/vB' : 'Gwei'}, ${tx.status === 'confirmed' ? 'incluse dans un bloc observé' : 'en attente'}. Afficher les détails.`;
  const handleKeyDown = (event: KeyboardEvent<SVGGElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(tx);
    }
  };

  return (
    <g
      className={`street-person${selected ? ' street-person--selected' : ''}${demo ? ' street-person--demo' : ''}${arrival && !demo ? ' street-person--arrival' : ''}`}
      transform={`translate(${x} ${y})`}
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={selected}
      onClick={() => onSelect(tx)}
      onKeyDown={handleKeyDown}
      style={{ '--person-delay': `${(hash % 30) / -10}s` } as CSSProperties}
    >
      <title>{label}</title>
      <rect
        className="street-person-hit"
        x="-11"
        y="-27"
        width="23"
        height="33"
        rx="5"
        fill="transparent"
      />
      <ellipse
        className="street-person-ring"
        cy="2"
        rx="10"
        ry="5"
        fill="none"
        stroke="#f5d589"
        strokeWidth="2"
      />
      <g
        className="street-person-body"
        transform={`scale(${resourceScale})`}
        aria-hidden="true"
        onAnimationEnd={() => {
          if (arrival && !demo) onArrivalComplete(tx.id);
        }}
      >
        <ellipse cy="1" rx="7" ry="3" fill="#0b2925" opacity=".55" />
        <path d="M-3-7-4 0M3-7 4 0" stroke="#183d36" strokeWidth="3" strokeLinecap="round" />
        <path d="M-4-17Q0-19 4-17L6-7H-6Z" fill={feeColor} />
        <path d="M-5-15-7-8M5-15 7-9" stroke={skin} strokeWidth="2" strokeLinecap="round" />
        <circle cy="-22" r="4.6" fill={skin} />
        <path
          d={hash % 3 === 0 ? 'M-5-22q0-7 6-6 6 1 4 7l-4-3Z' : 'M-4-24q4-6 8 0Z'}
          fill={hash % 2 === 0 ? '#344d39' : '#634d38'}
        />
        {tx.kind === 'contract' && (
          <rect x="5" y="-12" width="5" height="7" rx="1" fill="#e4c780" />
        )}
        {tx.status === 'confirmed' && <circle cx="8" cy="-24" r="2.5" fill="#9ad6a0" />}
      </g>
    </g>
  );
}

export function StreetScene({
  snapshot,
  paused,
  speed,
  reducedMotion,
  onSelect,
  selectedId,
  theme = 'heg',
}: StreetSceneProps) {
  const id = useId().replace(/:/g, '');
  const demo = snapshot.mode === 'demo';
  const previousObservation = useRef<{
    context: string;
    blockHash?: string;
    ids: Set<string>;
  } | null>(null);
  const [liveMotion, setLiveMotion] = useState<{
    arrivals: Set<string>;
    departureHash: string | null;
  }>({ arrivals: new Set(), departureHash: null });

  useEffect(() => {
    const context = `${snapshot.chain}:${snapshot.mode}`;
    const blockHash = snapshot.blocks[0]?.hash;
    const ids = new Set(snapshot.transactions.slice(0, 80).map((tx) => tx.id));
    const previous = previousObservation.current;
    previousObservation.current = { context, blockHash, ids };

    // Establish a baseline first; only later source observations may animate.
    if (snapshot.mode !== 'live' || !previous || previous.context !== context || reducedMotion) {
      setLiveMotion({ arrivals: new Set(), departureHash: null });
      return;
    }

    const arrivals = [...ids].filter((transactionId) => !previous.ids.has(transactionId));
    const departureHash =
      blockHash && previous.blockHash && blockHash !== previous.blockHash ? blockHash : null;
    setLiveMotion((current) => ({
      arrivals: new Set(
        [...current.arrivals].filter((transactionId) => ids.has(transactionId)).concat(arrivals),
      ),
      departureHash: departureHash ?? current.departureHash,
    }));
  }, [snapshot, reducedMotion]);

  function completeArrival(transactionId: string) {
    setLiveMotion((current) => {
      const arrivals = new Set(current.arrivals);
      arrivals.delete(transactionId);
      return { ...current, arrivals };
    });
  }

  const visibleTransactions = snapshot.transactions
    .slice(0, 80)
    .sort((left, right) => right.feeRate - left.feeRate || left.id.localeCompare(right.id));
  const queueLabel =
    !demo &&
    snapshot.chain === 'ethereum' &&
    visibleTransactions.length > 0 &&
    visibleTransactions.every((tx) => tx.status === 'confirmed')
      ? 'TRANSACTIONS OBSERVÉES'
      : 'FILE D’ATTENTE';
  const maxFee = visibleTransactions.reduce((maximum, tx) => Math.max(maximum, tx.feeRate), 0);
  const minFee = visibleTransactions.reduce((minimum, tx) => Math.min(minimum, tx.feeRate), maxFee);
  const maxSize = visibleTransactions.reduce((maximum, tx) => Math.max(maximum, tx.size), 0);
  const minSize = visibleTransactions.reduce((minimum, tx) => Math.min(minimum, tx.size), maxSize);
  const block = snapshot.blocks[0];
  const observedLabel = block ? `#${block.height.toLocaleString('fr-CH')}` : 'EN ATTENTE';
  const blockLabel = demo ? 'BLOC SIMULÉ' : block ? 'BLOC OBSERVÉ' : 'CANDIDAT ILLUSTRATIF';
  const secondLabel = demo ? 'PROCHAIN DÉPART' : 'CANDIDAT ILLUSTRATIF';
  const capacity =
    demo && block && block.capacity > 0
      ? `${Math.min(100, Math.round((block.used / block.capacity) * 100))} % DE CAPACITÉ`
      : 'SANS PRÉDICTION';
  const animationSpeed = Math.max(0.25, Math.min(4, speed));
  const styles = {
    '--scene-duration': `${18 / animationSpeed}s`,
    '--traveler-duration': `${4.8 / animationSpeed}s`,
    '--observed-duration': `${4 / animationSpeed}s`,
  } as CSSProperties;

  return (
    <div
      className={`street-scene${paused ? ' street-scene--paused' : ''}${reducedMotion ? ' street-scene--reduced-motion' : ''}${demo ? ' street-scene--demo' : ''}`}
      style={styles}
    >
      <svg
        className="street-scene-svg"
        viewBox="0 0 1200 600"
        role="group"
        aria-labelledby={`${id}-title ${id}-desc`}
      >
        <title id={`${id}-title`}>
          La rue de {snapshot.chain === 'bitcoin' ? 'Bitcoin' : 'Ethereum'}
        </title>
        <desc id={`${id}-desc`}>
          Une ville-campus où les voyageurs représentent les transactions et les véhicules les
          blocs.{' '}
          {demo
            ? 'Les déplacements et blocs sont simulés.'
            : 'Les données sont observées ; le véhicule candidat est une illustration. Un nouveau voyageur apparaît uniquement à réception de son identifiant dans la source. Un départ se produit uniquement lorsque le hash du bloc observé change après la première observation ; aucun bloc n’est inventé par une minuterie.'}{' '}
          Les voyageurs peuvent être sélectionnés au clavier ou à la souris. L’ordre visuel par
          frais est indicatif et ne prédit pas l’inclusion dans un bloc.
        </desc>
        <defs>
          <linearGradient id={`${id}-sky`} x1="0" x2="0" y1="0" y2="1">
            <stop stopColor="#071c1c" />
            <stop offset="1" stopColor="#153c33" />
          </linearGradient>
          <linearGradient id={`${id}-ground`} x1="0" x2="1" y1="0" y2="1">
            <stop stopColor="#2d5341" />
            <stop offset="1" stopColor="#244b3e" />
          </linearGradient>
          <radialGradient id={`${id}-lamp`}>
            <stop stopColor="#e9d88e" stopOpacity=".14" />
            <stop offset="1" stopColor="#e9d88e" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${id}-fade`}>
            <stop stopColor="#071c1c" stopOpacity=".8" />
            <stop offset=".3" stopColor="#071c1c" stopOpacity="0" />
            <stop offset=".75" stopColor="#071c1c" stopOpacity="0" />
            <stop offset="1" stopColor="#071c1c" stopOpacity=".7" />
          </linearGradient>
        </defs>

        <g aria-hidden="true">
          <rect width="1200" height="600" fill={`url(#${id}-sky)`} />
          <circle cx="984" cy="84" r="31" fill="#a9c0a3" opacity=".055" />
          <circle cx="984" cy="84" r="18" fill="#cbd8b6" opacity=".07" />
          {[
            [48, 91],
            [193, 83],
            [303, 55],
            [622, 53],
            [685, 103],
            [753, 66],
            [894, 42],
            [1071, 92],
            [1138, 48],
            [394, 117],
          ].map(([x, y], index) => (
            <circle
              key={index}
              cx={x}
              cy={y}
              r={index % 3 === 0 ? 1.7 : 1}
              fill="#a4bda5"
              opacity=".45"
            />
          ))}
          <path
            d="M0 227 74 174 133 216 234 142 349 207 445 148 526 198 618 143 703 197 817 151 936 203 1014 151 1123 203 1200 176v110H0Z"
            fill="#17382f"
          />
          <path
            d="M0 252h70v-81h27v81h24v-49h36v49h19v-29h43v29h94v-95h18v-17h22v112h49v-33h29v33h43v-17h39v17h187v-57h30v57h13v-98h41v98h24v-29h33v29h51v-62h24v62h38v-44h31v44h23v-99h42v99h24v-52h39v52h44v-36h49v102H0Z"
            fill="#1b4035"
          />
          <path
            d="M332 183h8m-8 14h8m-8 14h8m397-30h7m-7 15h7m-7 15h7m306-31h9m-9 16h9m-9 16h9"
            stroke="#749578"
            strokeWidth="3"
            opacity=".22"
          />

          <path d="M0 309 1200 250v350H0Z" fill={`url(#${id}-ground)`} />
          <path d="m0 334 1200-40v22L0 361Z" fill="#597362" />
          <path d="m0 361 1200-45v201L0 560Z" fill="#193b33" />
          <path d="M0 393 1200 351v3L0 397Z" fill="#5a7a66" opacity=".4" />
          <path d="M0 507 1200 465" stroke="#bfceb3" strokeWidth="2" opacity=".52" />
          <path
            d="M-15 465 1190 424"
            stroke="#bcceb8"
            strokeWidth="3"
            strokeDasharray="30 29"
            opacity=".45"
          />
          <path d="m0 560 1200-43v19L0 580Z" fill="#71846b" />
          <path d="m0 580 1200-44v64H0Z" fill="#244536" />
          <path d="M21 584 1190 542" stroke="#476852" strokeWidth="1" />
          <path
            d="m613 345 31-1 12 178-31 1Zm43-2 15-1 12 179-15 1Z"
            fill="#bfceb1"
            opacity=".23"
          />
          <path d="m0 329 1192-40M591 280l32 49m385-70 40 48" stroke="#95af8d" opacity=".11" />

          <CampusBuilding neutral={theme === 'neutral'} />
          <LabBuilding />
          <g>
            <path d="M946 163h104v101H946Z" fill="#617e64" />
            <path d="m1050 163 34-20v101l-34 20Z" fill="#345c49" />
            <path d="m946 163 34-20h104l-34 20Z" fill="#a3b798" />
            <path d="M960 181h76v34h-76Z" fill="#274e3f" />
            <path d="M971 183v30m16-30v30m16-30v30m16-30v30" stroke="#82a78c" />
            <rect x="960" y="232" width="40" height="11" rx="2" fill="#315642" />
            <text x="966" y="240" fill="#cedbc2" fontSize="5.5" letterSpacing="1">
              ATELIER
            </text>
            <path d="M1021 227h16v37h-16Z" fill="#264d3c" />
            <path d="m963 151 62 0 13-7h-62Z" fill="#3c6657" />
          </g>

          <Tree x={48} y={323} scale={1.16} />
          <Tree x={346} y={279} scale={1.02} />
          <Tree x={604} y={252} scale={0.92} />
          <Tree x={670} y={269} scale={1.12} />
          <Tree x={1105} y={286} scale={1.3} />
          <Tree x={1148} y={302} scale={0.86} />

          <Shelter
            x={570}
            y={249}
            name={snapshot.chain === 'bitcoin' ? 'BITCOIN' : 'ETHEREUM'}
            accent="#9ebca0"
          />
          <path
            d="m292 308 271-10m-271 30 276-9m-276 32 279-10m-278 31 278-9M755 294l280-10m-278 31 277-10m-275 33 276-9m-273 31 272-10"
            stroke="#89aa8b"
            strokeWidth="1"
            opacity=".14"
          />
          <path
            d="m289 288 1 85 277-10m184-83 3 79 284-10"
            fill="none"
            stroke="#b1c6a4"
            strokeWidth="1"
            strokeDasharray="3 8"
            opacity=".35"
          />
          <rect
            x="291"
            y="267"
            width={queueLabel === 'FILE D’ATTENTE' ? 102 : 163}
            height="18"
            rx="3"
            fill="#12382f"
          />
          <text x="301" y="279" fill="#c9d6b9" fontSize="8" fontWeight="650" letterSpacing=".8">
            {queueLabel}
          </text>
          <rect x="758" y="254" width="126" height="18" rx="3" fill="#12382f" />
          <text x="768" y="266" fill="#c9d6b9" fontSize="8" fontWeight="650" letterSpacing=".6">
            FRAIS · ORDRE INDICATIF
          </text>

          <Lamp x={292} y={374} glow={`${id}-lamp`} />
          <Lamp x={1048} y={350} glow={`${id}-lamp`} />
          <g transform="translate(906 220)">
            <path d="M0 72V0" stroke="#688e77" strokeWidth="3" />
            <path d="m-2 7 70 0 10 9-10 9H-2Z" fill="#779b76" />
            <text x="7" y="19" fill="#153c2b" fontSize="8" fontWeight="800" letterSpacing="1">
              {theme === 'heg' ? 'HEG →' : 'CAMPUS →'}
            </text>
          </g>
          <g transform="translate(126 387)">
            <ellipse cx="23" cy="12" rx="45" ry="9" fill="#0b2823" opacity=".45" />
            <circle cx="0" r="12" fill="none" stroke="#90ac8c" strokeWidth="2" />
            <circle cx="40" r="12" fill="none" stroke="#90ac8c" strokeWidth="2" />
            <path
              d="m0 0 13-18 9 18H0l28-19 12 19M10-18h8m10-1 3-7h7"
              fill="none"
              stroke="#c1b481"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <path d="M54-6v19m13-19v19m13-19v19" stroke="#647f68" strokeWidth="3" />
            <path d="M53-4q7-9 14 0t14 0" fill="none" stroke="#647f68" strokeWidth="3" />
          </g>
          <g transform="translate(708 353)">
            <path d="m-8-15 23 0-3 22H-5Z" fill="#9c8c67" />
            <path
              d="M2-15q-18-14-13-22Q3-36 2-15Zm0 0Q22-33 15-37 0-37 2-15Zm0 0Q3-45-5-45q-10 8 7 30Z"
              fill="#789961"
            />
          </g>
        </g>

        {visibleTransactions.map((tx, index) => {
          const relativeFee = maxFee === minFee ? 0.5 : (tx.feeRate - minFee) / (maxFee - minFee);
          const resourceScale =
            maxSize === minSize ? 1 : 0.96 + (0.14 * (tx.size - minSize)) / (maxSize - minSize);
          return (
            <Person
              key={tx.id}
              tx={tx}
              index={index}
              selected={selectedId === tx.id}
              demo={demo}
              arrival={liveMotion.arrivals.has(tx.id)}
              feeColor={relativeFee > 0.66 ? '#efaf72' : relativeFee > 0.33 ? '#79bbb3' : '#afc3a3'}
              resourceScale={resourceScale}
              onSelect={onSelect}
              onArrivalComplete={completeArrival}
            />
          );
        })}

        <g aria-hidden="true">
          <Tram
            key={`observed-${snapshot.chain}-${demo ? 'demo' : (block?.hash ?? 'empty')}`}
            x={245}
            y={393}
            accent="#81c6b3"
            label={blockLabel}
            capacity={observedLabel}
            variant="a"
            observedDeparture={!demo && liveMotion.departureHash === block?.hash}
            onDepartureComplete={() =>
              setLiveMotion((current) =>
                current.departureHash === block?.hash
                  ? { ...current, departureHash: null }
                  : current,
              )
            }
          />
          <Tram
            x={776}
            y={371}
            accent="#e6a16c"
            label={secondLabel}
            capacity={capacity}
            variant="b"
          />

          <g transform="translate(68 531)">
            <path d="m0 0 99-4 18 13-100 4Z" fill="#729068" />
            <path d="m0 0 17 13v19L0 18Z" fill="#445f40" />
            <path d="m17 13 100-4v18l-100 5Z" fill="#35583e" />
            <path d="M16-4q7-22 22-4 10-34 25-3 15-19 27 1" fill="#71986a" />
            <path d="M26-5q6-13 12-3m24-1q8-13 14 0" fill="none" stroke="#a0b37b" strokeWidth="3" />
          </g>
          <Tree x={1120} y={559} scale={1.28} />
          <Tree x={1170} y={578} scale={1.03} />
          <g transform="translate(842 548)">
            <path d="m0-6 101-4 16 8-101 4Z" fill="#c1ae7e" />
            <path d="M15-1v14m94-18v14M9-18l99-4v9L9-9Z" stroke="#9d926b" strokeWidth="4" />
            <path d="m8-12 10 13m91-17 8 11" stroke="#60755c" strokeWidth="3" />
          </g>
          <path d="M0 598h1200" stroke="#4e6d50" strokeWidth="3" />
          <rect width="1200" height="600" fill={`url(#${id}-fade)`} pointerEvents="none" />

          <text x="36" y="39" fill="#6d9c8d" fontSize="9" fontWeight="700" letterSpacing="2.8">
            {theme === 'heg' ? 'HEG · BLOCKCHAIN CAMPUS' : 'BLOCKCHAIN · OPEN CAMPUS'}
          </text>
          <text x="36" y="69" fill="#d7e5cf" fontSize="24" fontWeight="600" letterSpacing="-.5">
            Les échanges prennent vie.
          </text>
          <text x="1164" y="40" fill="#aec5ac" fontSize="9" textAnchor="end" letterSpacing="1.7">
            VOYAGEURS = TRANSACTIONS
          </text>
          <text x="1164" y="58" fill="#668e7e" fontSize="9" textAnchor="end">
            Sélectionnez un voyageur pour l’explorer
          </text>
          <rect
            x="37"
            y="559"
            width={demo ? 196 : 266}
            height="23"
            rx="11.5"
            fill="#0a2a23"
            stroke="#52795b"
            strokeOpacity=".35"
          />
          <circle cx="50" cy="570.5" r="3" fill={demo ? '#e1b57b' : '#8cc6a5'} />
          <text x="61" y="574" fill="#bcd0b0" fontSize="8.5" letterSpacing=".5">
            {demo ? 'DÉPLACEMENTS SIMULÉS' : 'DONNÉES OBSERVÉES · SCÈNE ILLUSTRATIVE'}
          </text>
        </g>
      </svg>
      <span className="street-scene-caption">
        {snapshot.chain === 'bitcoin' ? 'Bitcoin' : 'Ethereum'} · {visibleTransactions.length}{' '}
        voyageurs visibles · Les frais donnent un ordre indicatif.
      </span>
    </div>
  );
}
