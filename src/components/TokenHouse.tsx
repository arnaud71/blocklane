import { memo, type RefObject } from 'react';
import type { Snapshot } from '../../shared/model';
import { hasTokenActivity, TOKEN_CONTRACTS } from '../../shared/tokenContracts';
import { useI18n, languageTag } from '../i18n';
import { USDT_HOUSE_RECT } from '../lib/streetGeometry';
import { number } from '../lib/format';
import { formatTokenAmount } from '../lib/tokenDisplay';
import './TokenHouse.css';

/** One category gateway; its clock and passengers belong to the shared scene. */
export const TokenHouse = memo(function TokenHouse({
  projectX,
  mirrored,
  doorProgress,
  active,
  expanded,
  onBrowse,
  triggerRef,
}: {
  projectX: (x: number) => number;
  mirrored: boolean;
  doorProgress: number;
  active: boolean;
  expanded: boolean;
  onBrowse: () => void;
  triggerRef: RefObject<SVGGElement | null>;
}) {
  const { t } = useI18n();
  const { x, y, width, height } = USDT_HOUSE_RECT;
  const left = projectX(x);
  const right = projectX(x + width);
  const center = (left + right) / 2;
  const displayWidth = right - left;
  const doorWidth = displayWidth * 0.34;
  const progress = Number.isFinite(doorProgress) ? Math.min(1, Math.max(0, doorProgress)) : 0;
  const readable = mirrored ? `translate(${2 * center} 0) scale(-1 1)` : undefined;
  return (
    <g
      ref={triggerRef}
      className={`token-house${active ? ' token-house--active' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={t('Maison USDT : parcourir les transactions', 'USDT house: browse transactions')}
      aria-expanded={expanded}
      data-passenger-controls="true"
      data-token-house="usdt"
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
          'USDT sur Ethereum : transactions reconnues dans notre échantillon. Ouvrir la liste et les observations du dernier bloc.',
          'USDT on Ethereum: recognized transactions in our sample. Open the list and latest block observations.',
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
          d={`M${left} ${y + 5}L${center} ${y - 8}L${right} ${y + 5}Z`}
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
          fontSize={Math.min(13, (displayWidth - 7) / 3)}
          fontWeight="700"
          fill="#e4fff3"
        >
          USDT
        </text>
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

export function TokenHouseSummary({ snapshot }: { snapshot: Snapshot }) {
  const { locale, t } = useI18n();
  const report =
    snapshot.status === 'unavailable'
      ? undefined
      : snapshot.tokenTransfers?.find(
          (entry) =>
            entry.tokenId === 'usdt' &&
            entry.blockHash.toLowerCase() === snapshot.blocks[0]?.hash.toLowerCase() &&
            entry.blockHeight === snapshot.blocks[0]?.height &&
            entry.observedAt <= Date.now(),
        );
  // A successful report is immutable for this exact block, even during a long slot gap.
  const stale = snapshot.mode === 'live' && snapshot.status === 'stale';
  const pending =
    snapshot.status === 'unavailable'
      ? null
      : snapshot.transactions.filter((tx) => tx.status === 'pending' && hasTokenActivity(tx))
          .length;
  const date = report ? new Date(report.observedAt) : null;
  return (
    <section
      className="token-house-summary"
      aria-label={t('Observations USDT', 'USDT observations')}
      data-token-report={
        report ? (stale ? 'stale' : snapshot.mode === 'demo' ? 'demo' : 'ok') : 'unavailable'
      }
    >
      <strong>USDT · Ethereum</strong>
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
            {t(
              'Transactions avec transfert · dernier bloc confirmé',
              'Transactions with transfers · latest confirmed block',
            )}
          </dt>
          <dd data-token-block-transactions="true">
            {report ? number(report.transactionCount, 0, locale) : '—'}
          </dd>
        </div>
        <div>
          <dt>{t('Événements Transfer · même bloc', 'Transfer events · same block')}</dt>
          <dd data-token-block-events="true">
            {report ? number(report.transferCount, 0, locale) : '—'}
          </dd>
        </div>
        <div>
          <dt>{t('Quantité transférée · même bloc', 'Amount transferred · same block')}</dt>
          <dd data-token-block-amount="true">
            {report ? `${formatTokenAmount(report.amount, locale)} USDT` : '—'}
          </dd>
        </div>
      </dl>
      <p className="token-house-report-status">
        {report
          ? snapshot.mode === 'demo'
            ? t('Simulation explicite.', 'Explicit simulation.')
            : stale
              ? t('Observation ancienne.', 'Stale observation.')
              : t('Journaux du bloc observés.', 'Block logs observed.')
          : t('Transferts du dernier bloc indisponibles.', 'Latest block transfers unavailable.')}
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
        {t(
          'Une autorisation n’est pas un transfert. Un appel en attente exprime une intention ; seuls les journaux Transfer attestent un transfert exécuté. Les appels indirects en attente peuvent ne pas être reconnus.',
          'An approval is not a transfer. A pending call expresses intent; only Transfer logs evidence an executed transfer. Indirect pending calls may not be recognized.',
        )}
      </p>
      <a
        href={`https://etherscan.io/token/${TOKEN_CONTRACTS.usdt.address}`}
        target="_blank"
        rel="noreferrer"
      >
        {t('Contrat USDT Ethereum vérifié', 'Verified Ethereum USDT contract')}
      </a>
    </section>
  );
}
