# BlockLane security

## Scope

BlockLane reads and visualizes public data. It does not manage wallets, signing keys, funds or transaction broadcasting. Blockchain endpoints are configured by the operator on the server. Visitors cannot supply a URL to query.

Provider data is untrusted: validate and bound it before passing it to the interface. The API shares its cache between visitors, limits samples and interrupts requests that take too long. HTTP provider URLs require HTTPS, with an HTTP exception for loopback addresses; event streams require WSS, with WS allowed only on loopback.

A public server must run behind an HTTPS reverse proxy with rate limits, connection limits and protection appropriate to its traffic. The Node server and in-memory cache do not protect against a distributed attack. For internal endpoints, also apply an outbound network policy at the hosting layer: URL syntax validation is not a substitute for that control.

The initial API limit is 120 requests per minute per client address. `TRUSTED_PROXY_IPS` is empty by default. When a proxy is declared by its exact IP, a single valid `X-Real-IP` can identify its client; the proxy must overwrite this header and direct backend access must remain restricted. `X-Forwarded-For` is always ignored. Do not declare an entire network or a guessed address: use the actual socket address, especially with Docker. Without a declared proxy, its visitors share the same limit.

## Secrets and privacy

- Store provider keys in the host's secret store or a local `.env` file ignored by Git.
- Never put them in a `VITE_*` variable, client file or visitor-supplied parameter.
- Do not log full RPC URLs, authentication headers or provider error responses.
- After exposure, revoke the key, check its use and replace it. Removing a key from the latest commit does not remove it from history.
- Transaction identifiers are public but can be correlated. Add addresses, named profiles or tracking tools only for an explicit educational purpose.

The initial version adds no analytics tool or advertising cookie. Providers see the server's outbound requests; hosts and reverse proxies may retain their own logs. The operator must document their retention policies before deployment.

## Vulnerabilities and incidents

Report vulnerabilities through [BlockLane's private GitHub reporting channel](https://github.com/arnaud71/blocklane/security/advisories/new), enabled on the public arnaud71/blocklane repository. Do not open a public issue containing a secret or an unpatched exploit procedure. Dependency alerts, secret scanning and push protection are enabled; they do not replace review or a history check before publication.

Provide the affected version, observed behavior, minimal reproduction steps and impact, without sensitive data. Maintainers assess exposure, prepare and verify a fix, then arrange release and communication. This initial version defines no contractual response time.

Maintenance targets the latest published version. There are no application LTS branches yet. The runtime CI audit blocks known npm vulnerabilities rated high or critical; it does not prove the absence of vulnerabilities. Periodically check the full dependency tree, Node runtime, system images and CI actions.

## Provenance guarantees

Stale data must remain labeled as such. An unavailable source must not be simulated under a live-data label. Illustrations do not guarantee transaction inclusion, confirmation or finality. Altering these behaviors is a data-integrity incident even if the server remains accessible.
