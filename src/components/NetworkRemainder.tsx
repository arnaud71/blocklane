import { memo } from 'react';
import { useI18n } from '../i18n';
import type { ChainId } from '../../shared/model';
import { NETWORK_BOX_RECT, networkBoxExit } from '../lib/streetGeometry';
import './NetworkRemainder.css';

/** A small collective gateway, without invented IDs or a worldwide pool total. */
export const NetworkRemainder = memo(function NetworkRemainder({
  chain,
  projectX,
  mirrored,
  doorProgress,
  active,
}: {
  chain: ChainId;
  projectX: (x: number) => number;
  mirrored: boolean;
  doorProgress: number;
  active: boolean;
}) {
  const { locale, t } = useI18n();
  const { x, y, width, height } = NETWORK_BOX_RECT;
  const exit = networkBoxExit();
  const center = projectX(exit.x);
  // Widen the platform, not this cabinet: it remains anchored to the outer network lane.
  const displayWidth = Math.min(110, projectX(x + width) - projectX(x));
  const left = center - displayWidth / 2;
  const titleSize = Math.min(16, Math.max(4, (displayWidth - 8) / (locale === 'en' ? 4.6 : 3.8)));
  const captionSize = Math.min(8.3, Math.max(2, (displayWidth - 6) / 8.2));
  const readable = mirrored ? `translate(${2 * center} 0) scale(-1 1)` : undefined;
  const chainName = chain === 'bitcoin' ? 'Bitcoin' : 'Ethereum';
  const progress = Number.isFinite(doorProgress) ? Math.max(0, Math.min(1, doorProgress)) : 0;
  const spread = Math.min(22, displayWidth * 0.26);
  const nodeRadius = Math.min(3.8, displayWidth / 12);
  const doorWidth = Math.min(34, displayWidth * 0.68);
  const doorLeft = center - doorWidth / 2;
  const doorTop = 66;
  const nodes = [
    { x: center, y: 38 },
    { x: center - spread, y: 47 },
    { x: center + spread, y: 47 },
    { x: center - spread * 0.68, y: 59 },
    { x: center + spread * 0.68, y: 59 },
  ];
  return (
    <g
      className={`network-remainder network-remainder--${chain}${active ? ' network-remainder--active' : ''}`}
      role="group"
      aria-label={t(
        `Reste du réseau — hors échantillon · ${chainName}`,
        `Rest of the network — outside the sample · ${chainName}`,
      )}
      data-network-remainder={chain}
      data-network-active={active}
      data-network-box-x={left}
      data-network-box-y={y}
      data-network-box-width={displayWidth}
      data-network-box-height={height}
      data-network-center-x={center}
      data-network-exit-y={exit.y}
    >
      <title>
        {t(
          `Transactions hors de notre échantillon de ${chainName}, représentées par un réseau de nœuds, sans total mondial ni identifiants inventés. Une inclusion identifiée après coup peut passer par la porte basse puis la voie haute dédiée jusqu’au wagon ; le reste du bloc est représenté collectivement. La borne n’atteste aucune présence actuelle dans le mempool.`,
          `Transactions outside our ${chainName} sample, represented by a network of nodes without a worldwide total or invented identifiers. A later identified inclusion can pass through the lower door and dedicated upper lane to the vehicle; the rest of the block is represented collectively. The gateway does not prove current presence in the mempool.`,
        )}
      </title>
      <g aria-hidden="true">
        <rect
          className="network-remainder-halo"
          x={left}
          y={y}
          width={displayWidth}
          height={height}
          rx="7"
        />
        <rect
          className="network-remainder-shadow"
          x={left + 2}
          y={y + 3}
          width={displayWidth}
          height={height}
          rx="7"
        />
        <rect
          className="network-remainder-body"
          x={left}
          y={y}
          width={displayWidth}
          height={height}
          rx="7"
        />
        <g transform={`translate(0 ${y}) scale(1 ${height / 104})`}>
          <text
            className="network-remainder-heading"
            x={center}
            y="17"
            textAnchor="middle"
            fontSize={titleSize}
            transform={readable}
          >
            {t('RÉSEAU', 'NETWORK')}
          </text>
          <text
            className="network-remainder-caption"
            x={center}
            y="29"
            textAnchor="middle"
            fontSize={captionSize}
            transform={readable}
          >
            {t('hors échantillon', 'outside sample')}
          </text>
          <g className="network-remainder-graph" data-network-nodes="true">
            <path
              d={`M${nodes[0]!.x} ${nodes[0]!.y} ${nodes[1]!.x} ${nodes[1]!.y} ${nodes[3]!.x} ${nodes[3]!.y} ${nodes[4]!.x} ${nodes[4]!.y} ${nodes[2]!.x} ${nodes[2]!.y}Z M${nodes[1]!.x} ${nodes[1]!.y} ${nodes[2]!.x} ${nodes[2]!.y} M${nodes[0]!.x} ${nodes[0]!.y} ${nodes[4]!.x} ${nodes[4]!.y}`}
            />
            {nodes.map((node, index) => (
              <circle
                key={index}
                cx={node.x}
                cy={node.y}
                r={nodeRadius}
                className={
                  index === 0
                    ? 'network-remainder-node network-remainder-node--hub'
                    : 'network-remainder-node'
                }
              />
            ))}
          </g>
          <g
            className="network-remainder-door"
            data-network-door="true"
            data-network-door-progress={progress}
            data-network-door-open={progress > 0}
          >
            <rect
              className="network-remainder-door-recess"
              x={doorLeft - 2}
              y={doorTop - 2}
              width={doorWidth + 4}
              height="40"
              rx="3"
            />
            <rect
              className="network-remainder-door-leaf"
              x={doorLeft}
              y={doorTop}
              width={doorWidth / 2}
              height="38"
              transform={`translate(${(-progress * doorWidth) / 2} 0)`}
            />
            <rect
              className="network-remainder-door-leaf"
              x={center}
              y={doorTop}
              width={doorWidth / 2}
              height="38"
              transform={`translate(${(progress * doorWidth) / 2} 0)`}
            />
            <path
              className="network-remainder-door-threshold"
              d={`M${doorLeft - 2} 104h${doorWidth + 4}`}
            />
          </g>
        </g>
      </g>
    </g>
  );
});
