import './SharedCampus.css';

function Tree({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cy="3" rx="19" ry="5" fill="#102e24" opacity=".5" />
      <path d="M-2 0v-28h4V0" fill="#a99771" />
      <ellipse cy="-32" rx="18" ry="21" fill="#407853" />
      <ellipse cx="-3" cy="-40" rx="13" ry="12" fill="#739467" />
    </g>
  );
}

/** One shared decorative campus sits between both roads; it carries no chain-specific data. */
export function SharedCampus({ theme }: { theme: 'heg' | 'neutral' }) {
  return (
    <aside className="shared-campus" aria-label="Maisons communes aux deux rues">
      <header className="shared-campus-header">
        <span className="shared-campus-identity">{theme === 'heg' ? 'HEG' : 'CAMPUS'}</span>
        <span className="shared-campus-title">
          MAISONS
          <br />
          COMMUNES
        </span>
        <span className="shared-campus-networks" aria-hidden="true">
          <i>₿</i>
          <b>◆</b>
        </span>
      </header>
      <div className="shared-campus-city">
        <svg
          viewBox="0 0 180 740"
          role="img"
          aria-label="Une rangée centrale de bâtiments partagée par Bitcoin et Ethereum"
        >
          <rect width="180" height="740" fill="#274b3c" />
          <path d="M9 0v740M171 0v740" stroke="#79947b" strokeWidth="3" opacity=".45" />
          <path d="M90 0v740" stroke="#b8c6a133" strokeWidth="2" strokeDasharray="3 14" />
          <Tree x={90} y={117} />
          <g transform="translate(28 188)">
            <ellipse cx="62" cy="102" rx="65" ry="10" fill="#102e24" opacity=".5" />
            <rect width="124" height="100" rx="6" fill="#91a88b" stroke="#183c30" strokeWidth="3" />
            <path d="m-5 0 67-40 67 40Z" fill="#c8d3aa" stroke="#183c30" strokeWidth="3" />
            <rect x="15" y="17" width="25" height="26" fill="#294f40" />
            <rect x="84" y="17" width="25" height="26" fill="#294f40" />
            <path d="M27.5 17v26M96.5 17v26" stroke="#adc39a" strokeWidth="2" />
            <text x="62" y="65" fill="#183f32" textAnchor="middle" fontSize="22" fontWeight="700">
              {theme === 'heg' ? 'HEG' : 'CAMPUS'}
            </text>
            <rect x="46" y="73" width="32" height="27" fill="#294f40" />
          </g>
          <g transform="translate(32 420)">
            <ellipse cx="58" cy="115" rx="64" ry="10" fill="#102e24" opacity=".5" />
            <rect width="116" height="113" rx="5" fill="#5d8976" stroke="#183c30" strokeWidth="3" />
            <rect
              x="-5"
              y="-12"
              width="126"
              height="15"
              rx="3"
              fill="#abc4a0"
              stroke="#183c30"
              strokeWidth="3"
            />
            <rect x="12" y="17" width="92" height="33" rx="2" fill="#1c4436" />
            <path d="M43 17v33M73 17v33" stroke="#9cba99" strokeWidth="2" />
            <text x="58" y="79" textAnchor="middle" fill="#e1e7ca" fontSize="21" fontWeight="600">
              LAB
            </text>
            <path d="M14 98h88" stroke="#c4d5ae" strokeWidth="3" />
          </g>
          <g transform="translate(36 627)">
            <ellipse cx="54" cy="78" rx="61" ry="8" fill="#102e24" opacity=".5" />
            <rect width="108" height="74" rx="5" fill="#a7b396" stroke="#183c30" strokeWidth="3" />
            <path d="m-5 0 59-30 59 30Z" fill="#d3d5b0" stroke="#183c30" strokeWidth="3" />
            <rect x="12" y="14" width="22" height="21" fill="#345d4b" />
            <rect x="74" y="14" width="22" height="21" fill="#345d4b" />
            <rect x="41" y="42" width="26" height="32" fill="#345d4b" />
            <text x="54" y="32" textAnchor="middle" fill="#244b3a" fontSize="14" fontWeight="700">
              FORUM
            </text>
          </g>
          <Tree x={44} y={380} />
          <Tree x={136} y={583} />
        </svg>
      </div>
      <p className="shared-campus-footer">SCÈNE COMMUNE</p>
    </aside>
  );
}
