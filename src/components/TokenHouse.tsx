import { memo, type RefObject, type CSSProperties } from 'react';
import type { Snapshot } from '../../shared/model';
import { TOKEN_CONTRACTS, type TokenId } from '../../shared/tokenContracts';
import { ACTIVITY_HOUSES, hasHouseActivity, type HouseId } from '../../shared/activityHouses';
import { useI18n, languageTag } from '../i18n';
import { HOUSE_RECTS } from '../lib/streetGeometry';
import { number } from '../lib/format';
import { formatTokenAmount } from '../lib/tokenDisplay';
import './TokenHouse.css';

/** Category landmarks share the scene's animation clock and never create passengers. */
export const TokenHouse = memo(function TokenHouse({
  houseId = 'usdt',
  projectX,
  mirrored,
  doorProgress,
  active,
  expanded,
  onBrowse,
  triggerRef,
}: {
  houseId?: HouseId;
  projectX: (x: number) => number;
  mirrored: boolean;
  doorProgress: number;
  active: boolean;
  expanded: boolean;
  onBrowse: () => void;
  triggerRef: RefObject<SVGGElement | null>;
}) {
  const { t } = useI18n();
  const house = ACTIVITY_HOUSES[houseId];
  const { x, y, width, height } = HOUSE_RECTS[houseId];
  // Expand the quay, not its buildings. Keep the visual door centered on the
  // projected route while bounding the facade on wide desktop viewports.
  const center = projectX(x + width / 2);
  const displayWidth = Math.min(84, projectX(x + width) - projectX(x));
  const left = center - displayWidth / 2,
    right = center + displayWidth / 2;
  const doorWidth = displayWidth * 0.34;
  const progress = Number.isFinite(doorProgress) ? Math.min(1, Math.max(0, doorProgress)) : 0;
  const readable = mirrored ? `translate(${2 * center} 0) scale(-1 1)` : undefined;
  return (
    <g
      ref={triggerRef}
      className={`token-house token-house--${houseId}${active ? ' token-house--active' : ''}`}
      style={{ '--house-color': house.color } as CSSProperties}
      role="button"
      tabIndex={0}
      aria-label={t(
        `Maison ${house.label} : parcourir les transactions`,
        `${house.label} house: browse transactions`,
      )}
      aria-expanded={expanded}
      data-passenger-controls="true"
      data-token-house={houseId}
      data-token-house-active={active}
      onClick={onBrowse}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onBrowse();
        }
      }}
    >
      <title>
        {t(
          `${house.label} sur Ethereum : activité reconnue dans notre échantillon. Ouvrir la liste et les observations datées.`,
          `${house.label} on Ethereum: recognized activity in our sample. Open the list and dated observations.`,
        )}
      </title>
      <g aria-hidden="true">
        <rect
          className="token-house-focus"
          x={left - 2}
          y={y - 10}
          width={displayWidth + 2}
          height={height + 13}
          rx="5"
        />
        <path
          className="token-house-roof"
          d={
            houseId === 'aave'
              ? `M${left} ${y + 5}L${center} ${y - 8}L${right} ${y + 5}Z`
              : houseId === 'uniswap'
                ? `M${left} ${y + 5}V${y - 2}H${right}V${y + 5}Z`
                : `M${left} ${y + 5}L${center} ${y - 8}L${right} ${y + 5}Z`
          }
        />
        <rect
          className="token-house-body"
          x={left}
          y={y + 5}
          width={displayWidth}
          height={height - 5}
          rx="2"
        />
        <rect
          className="token-house-sign"
          x={left + 3}
          y={y + 8}
          width={displayWidth - 6}
          height="13"
          rx="2"
        />
        <text
          x={center}
          y={y + 18}
          textAnchor="middle"
          transform={readable}
          fontSize={Math.min(13, (displayWidth - 7) / Math.max(3, house.label.length * 0.62))}
          fontWeight="700"
          fill="#e4fff3"
        >
          {house.label}
        </text>
        {houseId === 'uniswap' && (
          <text
            x={center}
            y={y + 2}
            textAnchor="middle"
            transform={readable}
            fontSize="9"
            fill="#ffd9ed"
          >
            ⇄
          </text>
        )}
        {houseId === 'aave' && (
          <path
            d={`M${left + displayWidth * 0.15} ${y + 24}v${height - 27}M${right - displayWidth * 0.15} ${y + 24}v${height - 27}`}
            stroke="#e8d4ff"
            strokeWidth="2"
          />
        )}
        <circle
          className="token-house-lamp"
          cx={left + displayWidth * 0.17}
          cy={y + 31}
          r={Math.min(3, displayWidth * 0.06)}
        />
        <g data-token-house-door="true" data-token-house-door-progress={progress}>
          <rect
            x={center - doorWidth / 2}
            y={y + 25}
            width={doorWidth}
            height={height - 25}
            fill="#092d26"
          />
          <rect
            className="token-house-door-leaf"
            x={center - doorWidth / 2}
            y={y + 25}
            width={doorWidth / 2}
            height={height - 25}
            transform={`translate(${(-progress * doorWidth) / 2} 0)`}
          />
          <rect
            className="token-house-door-leaf"
            x={center}
            y={y + 25}
            width={doorWidth / 2}
            height={height - 25}
            transform={`translate(${(progress * doorWidth) / 2} 0)`}
          />
        </g>
        <path
          d={`M${center - doorWidth} ${y + height}h${doorWidth * 2}`}
          stroke="#c4dcaa"
          strokeWidth="2"
        />
      </g>
    </g>
  );
});

export function TokenHouseSummary({
  snapshot,
  houseId = 'usdt',
}: {
  snapshot: Snapshot;
  houseId?: HouseId;
}) {
  const { locale, t } = useI18n();
  const house = ACTIVITY_HOUSES[houseId];
  const tokenId: TokenId | undefined =
    houseId === 'usdt' || houseId === 'usdc' ? houseId : undefined;
  const usable = snapshot.status !== 'unavailable';
  const current = (entry: { blockHash: string; blockHeight: number; observedAt: number }) =>
    usable &&
    entry.blockHash.toLowerCase() === snapshot.blocks[0]?.hash.toLowerCase() &&
    entry.blockHeight === snapshot.blocks[0]?.height &&
    entry.observedAt <= Date.now();
  const tokenReport = tokenId
    ? snapshot.tokenTransfers?.find((entry) => entry.tokenId === tokenId && current(entry))
    : undefined;
  const protocolReport = !tokenId
    ? snapshot.protocolCalls?.find((entry) => entry.protocolId === houseId && current(entry))
    : undefined;
  const report = tokenReport ?? protocolReport;
  const stale = snapshot.mode === 'live' && snapshot.status === 'stale';
  const pending = usable
    ? snapshot.transactions.filter((tx) => tx.status === 'pending' && hasHouseActivity(tx, houseId))
        .length
    : null;
  const date = report ? new Date(report.observedAt) : null;
  const href = tokenId
    ? `https://etherscan.io/token/${TOKEN_CONTRACTS[tokenId].address}`
    : houseId === 'uniswap'
      ? 'https://developers.uniswap.org/docs/protocols/universal-router/overview'
      : 'https://aave.com/docs/aave-v3/smart-contracts/pool';
  return (
    <section
      className="token-house-summary"
      aria-label={t(`Observations ${house.label}`, `${house.label} observations`)}
      data-house-summary={houseId}
      data-token-report={
        report ? (stale ? 'stale' : snapshot.mode === 'demo' ? 'demo' : 'ok') : 'unavailable'
      }
    >
      <strong>{house.label} · Ethereum</strong>
      <p className="token-house-scope">
        {t(
          'Échantillon limité, sans total mondial du mempool.',
          'Limited sample, without a worldwide mempool total.',
        )}
      </p>
      <dl>
        <div>
          <dt>
            {t('En attente reconnues dans l’échantillon', 'Recognized pending in the sample')}
          </dt>
          <dd data-token-pending-count="true">
            {pending === null ? '—' : number(pending, 0, locale)}
          </dd>
        </div>
        <div>
          <dt>
            {tokenId
              ? t(
                  'Transactions avec transfert · dernier bloc confirmé',
                  'Transactions with transfers · latest confirmed block',
                )
              : t(
                  'Appels inclus aux contrats reconnus · dernier bloc',
                  'Included calls to recognized contracts · latest block',
                )}
          </dt>
          <dd data-token-block-transactions="true">
            {report ? number(report.transactionCount, 0, locale) : '—'}
          </dd>
        </div>
        {tokenId && (
          <>
            <div>
              <dt>{t('Événements Transfer · même bloc', 'Transfer events · same block')}</dt>
              <dd data-token-block-events="true">
                {tokenReport ? number(tokenReport.transferCount, 0, locale) : '—'}
              </dd>
            </div>
            <div>
              <dt>{t('Quantité transférée · même bloc', 'Amount transferred · same block')}</dt>
              <dd data-token-block-amount="true">
                {tokenReport
                  ? `${formatTokenAmount(tokenReport.amount, locale, tokenId)} ${house.label}`
                  : '—'}
              </dd>
            </div>
          </>
        )}
      </dl>
      <p className="token-house-report-status">
        {report
          ? snapshot.mode === 'demo'
            ? t('Simulation explicite.', 'Explicit simulation.')
            : stale
              ? t('Observation ancienne.', 'Stale observation.')
              : tokenId
                ? t('Journaux du bloc observés.', 'Block logs observed.')
                : t(
                    'Appels du bloc observés, résultat non vérifié.',
                    'Block calls observed; execution result unverified.',
                  )
          : tokenId
            ? t('Transferts du dernier bloc indisponibles.', 'Latest block transfers unavailable.')
            : t('Appels du dernier bloc indisponibles.', 'Latest block calls unavailable.')}
        {report && (
          <>
            {' '}
            {t('Source', 'Source')} : {report.source} · #{number(report.blockHeight, 0, locale)} ·{' '}
            <time dateTime={date!.toISOString()}>{date!.toLocaleString(languageTag(locale))}</time>{' '}
            · {report.method}
          </>
        )}
      </p>
      <p>
        {tokenId
          ? t(
              'Une autorisation n’est pas un transfert. Un appel en attente exprime une intention ; seuls les journaux Transfer attestent un transfert exécuté. Les appels indirects en attente peuvent ne pas être reconnus.',
              'An approval is not a transfer. A pending call expresses intent; only Transfer logs evidence an executed transfer. Indirect pending calls may not be recognized.',
            )
          : t(
              'Le compteur du bloc porte sur les appels directs aux contrats reconnus, y compris ceux qui ont échoué. Une inclusion ne prouve pas un échange, un dépôt ou un emprunt réussi. Les appels indirects peuvent ne pas être reconnus ; les transferts du jeton UNI ou AAVE ne sont pas ces opérations.',
              'The block counter covers direct calls to recognized contracts, including failed calls. Inclusion does not prove a successful swap, supply or borrow. Indirect calls may not be recognized; UNI or AAVE token transfers are not these operations.',
            )}
      </p>
      {!tokenId && (
        <p>
          {houseId === 'uniswap'
            ? t(
                'Périmètre : versions reconnues du Universal Router sur Ethereum.',
                'Scope: recognized Universal Router versions on Ethereum.',
              )
            : t(
                'Périmètre : Pool principal Aave V3 Ethereum Core, hors autres marchés et versions.',
                'Scope: Aave V3 Ethereum Core Pool, excluding other markets and versions.',
              )}
        </p>
      )}
      <p>
        {t(
          'Une transaction peut concerner plusieurs maisons : un seul voyageur, plusieurs étiquettes. Ces compteurs ne s’additionnent pas.',
          'One transaction can involve several houses: one traveler, several labels. These counters must not be added together.',
        )}
      </p>
      <a href={href} target="_blank" rel="noreferrer">
        {tokenId
          ? t(
              `Contrat ${house.label} Ethereum vérifié`,
              `Verified Ethereum ${house.label} contract`,
            )
          : t('Contrats et périmètre reconnus', 'Recognized contracts and scope')}
      </a>
    </section>
  );
}
