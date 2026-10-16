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
import type { ChainId, Tx } from '../../shared/model';
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
import './PassengerCanvas.css';

interface PassengerCanvasProps {
  frame: CanvasPassengerFrame;
  browseTarget?: HTMLElement | null;
  selectedId?: string;
  onSelect: (transaction: Tx) => void;
  chain: ChainId;
}

interface TransactionOption {
  id: string;
  label: string;
  group: PassengerStatusGroup;
}

const MAX_BACKING_PIXELS = 4_000_000;
const MAX_BACKING_DIMENSION = 8_192;
const CONTROL_SELECTOR =
  'button, a, input, select, textarea, label, [role="button"], [role="dialog"], [data-passenger-controls]';

function feeText(passenger: CanvasPassenger): string {
  return (
    passenger.feeLabel ??
    `${passenger.pose.tx.feeRate.toFixed(2)} ${passenger.pose.tx.chain === 'bitcoin' ? 'sat/vB' : 'Gwei'}`
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
}: PassengerCanvasProps) {
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
  const [browseId, setBrowseId] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<TransactionBrowserFilter>('all');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionCache = useRef<readonly TransactionOption[]>([]);
  const controlsId = useId();
  const chainName = chain === 'bitcoin' ? 'Bitcoin' : 'Ethereum';

  const closeBrowser = useCallback(() => {
    setBrowserOpen(false);
    triggerRef.current?.focus();
  }, []);

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
        const status = passengerStatus(passenger.pose);
        return {
          id: tx.id,
          label: `${tx.id.slice(0, 12)}…${tx.id.slice(-6)} · ${feeText(passenger)} · ${status.label}`,
          group: status.group,
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
          replacement.group === option.group
        );
      })
    ) {
      return previous;
    }
    optionCache.current = next;
    return next;
  }, [browserOpen, frame]);
  const options = useMemo(
    () => filterTransactionOptions(allOptions, query, filter),
    [allOptions, query, filter],
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
    if (selectRef.current && !selectRef.current.disabled) selectRef.current.focus();
    else searchRef.current?.focus();
  }, [browserOpen]);

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
      aria-label={`Parcourir les transactions ${chainName}`}
      aria-expanded={browserOpen}
      aria-controls={browserOpen ? controlsId : undefined}
      onClick={() => {
        if (browserOpen) closeBrowser();
        else setBrowserOpen(true);
      }}
    >
      <span className="passenger-canvas-browse-full">Transactions</span>
      <span className="passenger-canvas-browse-compact" aria-hidden="true">
        Tx
      </span>
    </button>
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
          Le dessin des voyageurs est indisponible dans ce navigateur. Le bouton « Transactions »
          permet toujours de consulter les données observées.
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
          <span>{feeText(highlightedPassenger)}</span>
          <p>
            {passengerDescription(
              highlightedPassenger.pose,
              highlightedPassenger.feeLabel,
              highlightedPassenger.interactive,
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
        {browseTarget ? createPortal(browseButton, browseTarget) : browseButton}
        {browserOpen && (
          <section
            id={controlsId}
            className="passenger-canvas-browser"
            role="dialog"
            aria-label={`Transactions observées ${chainName}`}
          >
            <div className="passenger-canvas-browser-heading">
              <strong>Transactions {chainName}</strong>
              <button type="button" onClick={closeBrowser} aria-label="Fermer les transactions">
                Fermer
              </button>
            </div>
            <label htmlFor={`${controlsId}-search`}>Rechercher une transaction</label>
            <input
              ref={searchRef}
              id={`${controlsId}-search`}
              type="search"
              value={query}
              maxLength={128}
              placeholder="Hash complet ou fragment"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setQuery(event.target.value)}
            />
            <fieldset className="passenger-canvas-filters">
              <legend>Filtrer les transactions</legend>
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
                    <span>{choice.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <p
              className="passenger-canvas-result-count"
              role="status"
              aria-label="Résultats de recherche"
            >
              {number(options.length)} {options.length === 1 ? 'résultat' : 'résultats'} sur{' '}
              {number(allOptions.length)} transactions représentées
            </p>
            <label htmlFor={`${controlsId}-select`}>Transaction représentée dans la scène</label>
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
                    ? 'Aucune transaction ne correspond'
                    : 'Aucune transaction observée disponible'}
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
                Réinitialiser la recherche et les filtres
              </button>
            )}
            <p id={`${controlsId}-help`}>
              Liste des voyageurs représentés, classée par identifiant. Les détails anciens et la
              présence dans le dernier inventaire sont distingués. Une absence d’inventaire ne
              prouve aucune confirmation. Un embarquement animé ne prouve aucune inclusion.
            </p>
            {browsedPassenger && (
              <p id={`${controlsId}-description`} className="passenger-canvas-browser-description">
                {passengerDescription(
                  browsedPassenger.pose,
                  browsedPassenger.feeLabel,
                  browsedPassenger.interactive,
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
              Afficher les détails
            </button>
          </section>
        )}
      </div>
    </>
  );
}
