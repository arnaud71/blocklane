import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useI18n, type Locale } from '../i18n';
import type { ChainId, Snapshot, Tx } from '../../shared/model';
import {
  canvasPassengerAnchor,
  createPassengerCanvasRenderer,
  hitTestCanvasPassenger,
  type CanvasPassenger,
  type CanvasPassengerFrame,
  type CanvasViewport,
} from '../lib/passengerCanvas';
import { passengerDescription } from '../lib/passengerPresentation';
import { passengerStatus, type PassengerStatusGroup } from '../lib/passengerStatus';
import {
  filterTransactionOptions,
  TRANSACTION_BROWSER_FILTERS,
  type TransactionBrowserFilter,
} from '../lib/transactionBrowser';
import { number } from '../lib/format';
import { TOKEN_CONTRACTS } from '../../shared/tokenContracts';
import {
  ACTIVITY_HOUSES,
  HOUSE_IDS,
  transactionHouseIds,
  type HouseId,
} from '../../shared/activityHouses';
import { protocolActivityLabel, tokenActivityLabel } from '../lib/tokenDisplay';
import { TokenHouseSummary } from './TokenHouse';
import './PassengerCanvas.css';

interface PassengerCanvasProps {
  frame: CanvasPassengerFrame;
  browseTarget?: HTMLElement | null;
  selectedId?: string;
  onSelect: (transaction: Tx) => void;
  chain: ChainId;
  tokenSnapshot?: Snapshot;
  houseBrowseRequest?: { sequence: number; houseId: HouseId };
  houseBrowseReturnRefs?: Record<HouseId, { current: SVGGElement | null }>;
  onHouseFilterChange?: (active: HouseId | null) => void;
}

interface TransactionOption {
  id: string;
  label: string;
  group: PassengerStatusGroup;
  houses: readonly HouseId[];
}

const MAX_BACKING_PIXELS = 4_000_000;
const MAX_BACKING_DIMENSION = 8_192;
const CONTROL_SELECTOR =
  'button, a, input, select, textarea, label, [role="button"], [role="dialog"], [data-passenger-controls]';

function feeText(passenger: CanvasPassenger, locale: Locale): string {
  return (
    passenger.feeLabel ??
    `${number(passenger.pose.tx.feeRate, 2, locale)} ${passenger.pose.tx.chain === 'bitcoin' ? 'sat/vB' : 'Gwei'}`
  );
}

const TransactionOptions = memo(function TransactionOptions({
  options,
}: {
  options: readonly TransactionOption[];
}) {
  return options.map((option) => (
    <option key={option.id} value={option.id} title={option.id}>
      {option.label}
    </option>
  ));
});

function viewportFor(element: HTMLElement): CanvasViewport {
  const bounds = element.getBoundingClientRect();
  const width = Number.isFinite(bounds.width) ? Math.max(0, bounds.width) : 0;
  const height = Number.isFinite(bounds.height) ? Math.max(0, bounds.height) : 0;
  const deviceRatio = window.devicePixelRatio;
  const preferredRatio =
    Number.isFinite(deviceRatio) && deviceRatio > 0 ? Math.min(2, deviceRatio) : 1;
  const ratio =
    width > 0 && height > 0
      ? Math.min(
          preferredRatio,
          MAX_BACKING_DIMENSION / width,
          MAX_BACKING_DIMENSION / height,
          Math.sqrt(MAX_BACKING_PIXELS / (width * height)),
        )
      : 1;
  return { width, height, ratio };
}

export function PassengerCanvas({
  frame,
  browseTarget,
  selectedId,
  onSelect,
  chain,
  tokenSnapshot,
  houseBrowseRequest,
  houseBrowseReturnRefs,
  onHouseFilterChange,
}: PassengerCanvasProps) {
  const { locale, t } = useI18n();
  const n = (value: number | null, digits = 0) => number(value, digits, locale);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<ReturnType<typeof createPassengerCanvasRenderer> | null>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const sceneRef = useRef<HTMLElement | null>(null);
  const latest = useRef({ frame, onSelect });
  latest.current = { frame, onSelect };
  const viewportRef = useRef<CanvasViewport>({ width: 0, height: 0, ratio: 1 });
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const [viewport, setViewport] = useState(viewportRef.current);
  const [drawingAvailable, setDrawingAvailable] = useState(true);
  const [highlightedId, setHighlightedId] = useState<string>();
  const [browserOpen, setBrowserOpen] = useState(false);
  const [selectedHouse, setSelectedHouse] = useState<HouseId | null>(null);
  const [lastHouse, setLastHouse] = useState<HouseId>('usdt');
  const returnFocusRef = useRef<HTMLElement | SVGElement | null>(null);
  const openedFromHouseRef = useRef(false);
  const browserRef = useRef<HTMLElement>(null);
  const [browseId, setBrowseId] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<TransactionBrowserFilter>('all');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const houseTriggerRefs = useRef<Record<HouseId, HTMLButtonElement | null>>({
    usdt: null,
    usdc: null,
    uniswap: null,
    aave: null,
  });
  const selectRef = useRef<HTMLSelectElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionCache = useRef<readonly TransactionOption[]>([]);
  const controlsId = useId();
  const chainName = chain === 'bitcoin' ? 'Bitcoin' : 'Ethereum';

  const closeBrowser = useCallback(() => {
    setBrowserOpen(false);
    (returnFocusRef.current ?? triggerRef.current)?.focus();
  }, []);

  useEffect(() => {
    if (!houseBrowseRequest) return;
    const houseId = houseBrowseRequest.houseId;
    returnFocusRef.current = houseBrowseReturnRefs?.[houseId].current ?? null;
    openedFromHouseRef.current = true;
    setSelectedHouse(houseId);
    setLastHouse(houseId);
    setQuery('');
    setFilter('all');
    setBrowserOpen(true);
  }, [houseBrowseRequest, houseBrowseReturnRefs]);

  useEffect(() => {
    onHouseFilterChange?.(browserOpen ? selectedHouse : null);
  }, [browserOpen, selectedHouse, onHouseFilterChange]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const scene = canvas?.parentElement;
    if (!canvas || !scene) return;
    sceneRef.current = scene;
    let context: CanvasRenderingContext2D | null = null;
    try {
      context = canvas.getContext('2d');
    } catch {
      // Data controls remain available if the browser cannot allocate a canvas.
    }
    contextRef.current = context;
    setDrawingAvailable(context !== null);
    const renderer = context ? createPassengerCanvasRenderer() : null;
    rendererRef.current = renderer;
    const measure = () => {
      const next = viewportFor(scene);
      viewportRef.current = next;
      setViewport((previous) =>
        previous.width === next.width &&
        previous.height === next.height &&
        previous.ratio === next.ratio
          ? previous
          : next,
      );
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(scene);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      renderer?.dispose();
      rendererRef.current = null;
      contextRef.current = null;
      sceneRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const locate = (event: PointerEvent | MouseEvent) => {
      if (!contextRef.current) return;
      if (event.target instanceof Element && event.target.closest(CONTROL_SELECTOR)) return;
      const bounds = scene.getBoundingClientRect();
      const point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      return {
        point,
        passenger: hitTestCanvasPassenger(
          latest.current.frame,
          viewportRef.current,
          point.x,
          point.y,
        ),
      };
    };
    const move = (event: PointerEvent) => {
      const hit = locate(event);
      pointerRef.current = hit?.point ?? null;
      const id = hit?.passenger?.pose.tx.id;
      setHighlightedId((previous) => (previous === id ? previous : id));
      scene.classList.toggle('street-scene--passenger-hovered', id !== undefined);
    };
    const leave = () => {
      pointerRef.current = null;
      setHighlightedId(undefined);
      scene.classList.remove('street-scene--passenger-hovered');
    };
    const click = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const passenger = locate(event)?.passenger;
      if (passenger?.interactive) {
        latest.current.onSelect(passenger.pose.tx);
      }
    };
    scene.addEventListener('pointermove', move);
    scene.addEventListener('pointerleave', leave);
    scene.addEventListener('click', click);
    return () => {
      scene.removeEventListener('pointermove', move);
      scene.removeEventListener('pointerleave', leave);
      scene.removeEventListener('click', click);
      scene.classList.remove('street-scene--passenger-hovered');
    };
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const context = contextRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !context || !renderer || viewport.width <= 0 || viewport.height <= 0) return;
    const backingWidth = Math.max(1, Math.floor(viewport.width * viewport.ratio));
    const backingHeight = Math.max(1, Math.floor(viewport.height * viewport.ratio));
    if (canvas.width !== backingWidth) canvas.width = backingWidth;
    if (canvas.height !== backingHeight) canvas.height = backingHeight;
    const pointer = pointerRef.current;
    const hit = pointer ? hitTestCanvasPassenger(frame, viewport, pointer.x, pointer.y) : undefined;
    const id = hit?.pose.tx.id;
    if (id !== highlightedId) setHighlightedId(id);
    sceneRef.current?.classList.toggle('street-scene--passenger-hovered', id !== undefined);
    renderer.draw(context, frame, viewport, selectedId, id);
  }, [frame, viewport, selectedId, highlightedId]);

  const allOptions = useMemo(() => {
    if (!browserOpen) return [];
    const observed = new Map<string, CanvasPassenger>();
    for (const passenger of frame.passengers) {
      if (passenger.interactive) {
        observed.set(passenger.pose.tx.id, passenger);
      }
    }
    const next = [...observed.values()]
      .sort((left, right) => left.pose.tx.id.localeCompare(right.pose.tx.id))
      .map((passenger) => {
        const tx = passenger.pose.tx;
        const status = passengerStatus(passenger.pose, locale);
        return {
          id: tx.id,
          label: `${tx.id.slice(0, 12)}…${tx.id.slice(-6)} · ${feeText(passenger, locale)} · ${status.label}${(tx.tokens ?? []).map((activity) => ` · ${TOKEN_CONTRACTS[activity.tokenId].symbol} · ${tokenActivityLabel(activity, locale)}`).join('')}${(tx.protocols ?? []).map((activity) => ` · ${ACTIVITY_HOUSES[activity.protocolId].label} · ${protocolActivityLabel(activity, locale)}`).join('')}`,
          group: status.group,
          houses: transactionHouseIds(tx),
        };
      });
    const previous = optionCache.current;
    if (
      previous.length === next.length &&
      previous.every((option, index) => {
        const replacement = next[index];
        return (
          replacement?.id === option.id &&
          replacement.label === option.label &&
          replacement.group === option.group &&
          replacement.houses.join(',') === option.houses.join(',')
        );
      })
    ) {
      return previous;
    }
    optionCache.current = next;
    return next;
  }, [browserOpen, frame, locale]);
  const options = useMemo(
    () =>
      filterTransactionOptions(
        selectedHouse
          ? allOptions.filter((option) => option.houses.includes(selectedHouse))
          : allOptions,
        query,
        filter,
      ),
    [allOptions, query, filter, selectedHouse],
  );
  const activeBrowseId = options.some((option) => option.id === browseId)
    ? browseId
    : (options[0]?.id ?? '');
  const browsedPassenger = browserOpen
    ? frame.passengers.find(
        (passenger) => passenger.pose.tx.id === activeBrowseId && passenger.interactive,
      )
    : undefined;

  useEffect(() => {
    if (browserOpen && activeBrowseId !== browseId) setBrowseId(activeBrowseId);
  }, [activeBrowseId, browseId, browserOpen]);

  useEffect(() => {
    if (!browserOpen) return;
    if (openedFromHouseRef.current) {
      browserRef.current?.focus();
      if (browserRef.current) browserRef.current.scrollTop = 0;
    } else if (selectRef.current && !selectRef.current.disabled) selectRef.current.focus();
    else searchRef.current?.focus();
  }, [browserOpen, houseBrowseRequest]);

  const highlightedPassenger = highlightedId
    ? frame.passengers.find(
        (passenger) => passenger.pose.tx.id === highlightedId && passenger.interactive,
      )
    : undefined;
  const anchor = highlightedPassenger
    ? canvasPassengerAnchor(frame, viewport, highlightedPassenger)
    : undefined;
  const tooltipWidth = Math.min(280, Math.max(0, viewport.width - 16));
  const tooltipLeft = anchor
    ? Math.max(tooltipWidth / 2 + 8, Math.min(viewport.width - tooltipWidth / 2 - 8, anchor.x))
    : 0;
  const tooltipBelow = (anchor?.y ?? 0) < 190;

  const browseButton = (
    <button
      ref={triggerRef}
      type="button"
      className={`passenger-canvas-browse${browseTarget ? ' passenger-canvas-browse--docked' : ''}`}
      aria-label={t(`Parcourir les transactions ${chainName}`, `Browse ${chainName} transactions`)}
      aria-expanded={browserOpen}
      aria-controls={browserOpen ? controlsId : undefined}
      onClick={() => {
        if (browserOpen) closeBrowser();
        else {
          returnFocusRef.current = triggerRef.current;
          openedFromHouseRef.current = false;
          setSelectedHouse(null);
          setBrowserOpen(true);
        }
      }}
    >
      <span className="passenger-canvas-browse-full">{t('Transactions', 'Transactions')}</span>
      <span className="passenger-canvas-browse-compact" aria-hidden="true">
        Tx
      </span>
    </button>
  );

  const browseControls = (
    <div className="passenger-canvas-browse-actions">
      {browseButton}
      {chain === 'ethereum' &&
        HOUSE_IDS.map((houseId) => {
          const house = ACTIVITY_HOUSES[houseId];
          return (
            <button
              key={houseId}
              ref={(element) => {
                houseTriggerRefs.current[houseId] = element;
              }}
              type="button"
              className={`passenger-canvas-browse passenger-canvas-browse--token${browseTarget ? ' passenger-canvas-browse--docked' : ''}`}
              style={{ borderColor: house.color }}
              aria-label={t(
                `Parcourir les transactions ${house.label} sur Ethereum`,
                `Browse ${house.label} transactions on Ethereum`,
              )}
              aria-expanded={browserOpen && selectedHouse === houseId}
              aria-controls={browserOpen ? controlsId : undefined}
              onClick={() => {
                if (browserOpen && selectedHouse === houseId) {
                  closeBrowser();
                  return;
                }
                returnFocusRef.current = houseTriggerRefs.current[houseId];
                openedFromHouseRef.current = true;
                setQuery('');
                setFilter('all');
                setSelectedHouse(houseId);
                setLastHouse(houseId);
                setBrowserOpen(true);
                browserRef.current?.focus();
                if (browserRef.current) browserRef.current.scrollTop = 0;
              }}
            >
              {house.label}
            </button>
          );
        })}
    </div>
  );

  return (
    <>
      <canvas
        ref={canvasRef}
        className="passenger-canvas"
        aria-hidden="true"
        data-renderer="canvas-2d"
      />
      {!drawingAvailable && (
        <p className="passenger-canvas-unavailable">
          {t(
            'Le dessin des voyageurs est indisponible dans ce navigateur. Le bouton « Transactions » permet toujours de consulter les données observées.',
            'Passenger drawing is unavailable in this browser. The Transactions button still provides access to the observed data.',
          )}
        </p>
      )}
      {drawingAvailable && !browserOpen && highlightedPassenger && anchor && (
        <div
          className={`passenger-canvas-tooltip${tooltipBelow ? ' passenger-canvas-tooltip--below' : ''}`}
          aria-hidden="true"
          style={{
            left: tooltipLeft,
            top: tooltipBelow
              ? Math.max(12, anchor.y + 12)
              : Math.min(viewport.height - 12, anchor.y - 28),
            width: tooltipWidth,
          }}
        >
          <strong>{highlightedPassenger.pose.tx.id}</strong>
          <span>{feeText(highlightedPassenger, locale)}</span>
          <p>
            {passengerDescription(
              highlightedPassenger.pose,
              highlightedPassenger.feeLabel,
              highlightedPassenger.interactive,
              locale,
            )}
          </p>
        </div>
      )}
      <div
        className={`passenger-canvas-controls passenger-canvas-controls--${chain}`}
        data-passenger-controls="true"
        onKeyDown={(event) => {
          if (browserOpen && event.key === 'Escape') {
            event.preventDefault();
            closeBrowser();
          }
        }}
      >
        {browseTarget ? createPortal(browseControls, browseTarget) : browseControls}
        {browserOpen && (
          <section
            ref={browserRef}
            tabIndex={-1}
            id={controlsId}
            className="passenger-canvas-browser"
            role="dialog"
            aria-label={t(
              `Transactions observées ${chainName}`,
              `Observed ${chainName} transactions`,
            )}
          >
            <div className="passenger-canvas-browser-heading">
              <strong>{t(`Transactions ${chainName}`, `${chainName} transactions`)}</strong>
              <button
                type="button"
                onClick={closeBrowser}
                aria-label={t('Fermer les transactions', 'Close transactions')}
              >
                {t('Fermer', 'Close')}
              </button>
            </div>
            {selectedHouse && tokenSnapshot && (
              <TokenHouseSummary snapshot={tokenSnapshot} houseId={selectedHouse} />
            )}
            {chain === 'ethereum' && (
              <>
                <label htmlFor={`${controlsId}-house`}>{t('Maison', 'House')}</label>
                <select
                  id={`${controlsId}-house`}
                  value={selectedHouse ?? 'all'}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value === 'all') setSelectedHouse(null);
                    else {
                      const houseId = value as HouseId;
                      setSelectedHouse(houseId);
                      setLastHouse(houseId);
                    }
                  }}
                >
                  <option value="all">{t('Toutes les maisons', 'All houses')}</option>
                  {HOUSE_IDS.map((houseId) => (
                    <option key={houseId} value={houseId}>
                      {ACTIVITY_HOUSES[houseId].label}
                    </option>
                  ))}
                </select>
                <label className="passenger-canvas-token-filter">
                  <input
                    type="checkbox"
                    checked={selectedHouse !== null}
                    onChange={(event) => setSelectedHouse(event.target.checked ? lastHouse : null)}
                  />
                  <span>
                    {t(
                      `${ACTIVITY_HOUSES[lastHouse].label} uniquement · voyageurs mis en évidence`,
                      `${ACTIVITY_HOUSES[lastHouse].label} only · highlighted passengers`,
                    )}
                  </span>
                </label>
              </>
            )}
            <label htmlFor={`${controlsId}-search`}>
              {t('Rechercher une transaction', 'Search for a transaction')}
            </label>
            <input
              ref={searchRef}
              id={`${controlsId}-search`}
              type="search"
              value={query}
              maxLength={128}
              placeholder={t('Hash complet ou fragment', 'Full hash or fragment')}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setQuery(event.target.value)}
            />
            <fieldset className="passenger-canvas-filters">
              <legend>{t('Filtrer les transactions', 'Filter transactions')}</legend>
              <div>
                {TRANSACTION_BROWSER_FILTERS.map((choice) => (
                  <label key={choice.value}>
                    <input
                      type="radio"
                      name={`${controlsId}-filter`}
                      value={choice.value}
                      checked={filter === choice.value}
                      onChange={() => setFilter(choice.value)}
                    />
                    <span>
                      {t(
                        choice.label,
                        {
                          all: 'All',
                          current: 'Present',
                          queued: 'Queued',
                          history: 'Historical',
                          confirmed: 'Included',
                        }[choice.value],
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <p
              className="passenger-canvas-result-count"
              role="status"
              aria-label={t('Résultats de recherche', 'Search results')}
            >
              {n(options.length)}{' '}
              {options.length === 1 ? t('résultat', 'result') : t('résultats', 'results')}{' '}
              {t('sur', 'of')} {n(allOptions.length)}{' '}
              {t('transactions représentées', 'represented transactions')}
            </p>
            <label htmlFor={`${controlsId}-select`}>
              {t('Transaction représentée dans la scène', 'Transaction shown in the scene')}
            </label>
            <select
              ref={selectRef}
              id={`${controlsId}-select`}
              aria-describedby={`${controlsId}-help${browsedPassenger ? ` ${controlsId}-description` : ''}`}
              value={activeBrowseId}
              disabled={options.length === 0}
              onChange={(event) => setBrowseId(event.target.value)}
            >
              {options.length === 0 ? (
                <option value="">
                  {allOptions.length
                    ? t('Aucune transaction ne correspond', 'No matching transaction')
                    : t(
                        'Aucune transaction observée disponible',
                        'No observed transaction available',
                      )}
                </option>
              ) : (
                <TransactionOptions options={options} />
              )}
            </select>
            {options.length === 0 && allOptions.length > 0 && (
              <button
                type="button"
                className="passenger-canvas-reset"
                onClick={() => {
                  setQuery('');
                  setFilter('all');
                }}
              >
                {t('Réinitialiser la recherche et les filtres', 'Reset search and filters')}
              </button>
            )}
            <p id={`${controlsId}-help`}>
              {t(
                'Liste des voyageurs représentés, classée par identifiant. Les détails anciens et la présence dans le dernier inventaire sont distingués. Une absence d’inventaire ne prouve aucune confirmation. Un embarquement animé ne prouve aucune inclusion.',
                'Represented passengers, sorted by identifier. Historical details and presence in the latest inventory are distinguished. Absence from an inventory does not prove confirmation. Animated boarding does not prove inclusion.',
              )}
            </p>
            {browsedPassenger && (
              <p id={`${controlsId}-description`} className="passenger-canvas-browser-description">
                {passengerDescription(
                  browsedPassenger.pose,
                  browsedPassenger.feeLabel,
                  browsedPassenger.interactive,
                  locale,
                )}
              </p>
            )}
            <button
              type="button"
              className="passenger-canvas-details"
              disabled={!activeBrowseId}
              onClick={() => {
                const current = latest.current.frame.passengers.find(
                  (passenger) => passenger.pose.tx.id === activeBrowseId && passenger.interactive,
                );
                if (current) latest.current.onSelect(current.pose.tx);
              }}
            >
              {t('Afficher les détails', 'View details')}
            </button>
          </section>
        )}
      </div>
    </>
  );
}
