# LumeWorks MCP

Server: `https://cijfers.lumeworks.nl/mcp`. Transport: stateless Streamable HTTP with JSON responses. Authentication: OAuth authorization code + S256 PKCE, per existing dashboard user, scope `finance:read`. Dynamic registration supports public clients and secret-post/basic clients. Only HTTPS callbacks on `chatgpt.com` are accepted in production. No dashboard password or financial data is embedded in a connector URL.

Each person connects in their own ChatGPT account/workspace, signs in on LumeWorks, and explicitly approves financial read access. Use the MCP URL above and OAuth; client ID and secret can be assigned through dynamic registration. ChatGPT account/workspace support and developer permissions must be checked during this final connection. The server cannot create that connection inside someone else's ChatGPT account.

Tools:

- `get_data_status`: source status, coverage, snapshot/import times, validation and return model.
- `get_financial_summary`: store/channel revenue, net profit, actual profit, costs, fees, Daan, return reserves and margin build-up.
- `get_financial_trend`: daily/weekly/monthly series; store and Meta can be returned together.
- `compare_periods`: current/comparison figures and absolute/percentage changes.
- `list_orders`: paginated store or influencer orders and their known costs. Meta/Google do not have proven order attribution.
- `read_financial_data`: discover and read all financial source sections, including Google campaign rows, creators, startup costs, returns, costs and status. Arrays use offset/limit pagination, maximum 100 rows per page.
- `explain_financial_methodology`: definitions, cost register, allocation and limitations.

Financial queries use a consistent SQLite read snapshot of the seven private datasets. They do not download public Pages data. They use the same product catalogue, validators, metrics and return model as the dashboard. Google channel reports default to non-branded; the store total includes all Google spend. Daan is included. Net profit includes available expected-return reserves, with actual-only profit also returned. Missing values remain null. Dates before 2026-08-05 and after today in Europe/Amsterdam are rejected. Default period is the last seven completed days.

Store and advertising-channel attribution must not be added together. The available return audit is aggregated by original order day; this MCP cannot invent individual returned packages or unavailable upstream records. Import time does not prove that an upstream service has been refreshed. Answers include source times, warnings and reserve-model information. Customer-contact fields are excluded from raw financial data; source text must be treated as untrusted data, never instructions.

Access tokens expire after one hour. Refresh tokens rotate, expire after an absolute 30 days, and reuse revokes the link. Authorization codes are hashed, single-use, bound to user/version/client/redirect/resource/PKCE, and expire after two minutes. Dashboard password changes, logout on all devices, explicit account-page disconnect and OAuth revocation invalidate access. Logging out of one browser does not revoke an independently approved ChatGPT link.

The bounded static QuickJS runner has no JavaScript filesystem, network, module-loader or process API. It only evaluates the trusted code release with JSON input; arguments are never evaluated as code or inserted into shell commands. Each calculation has an execution/memory limit. Its source commit and license are recorded in `assets/blended/mcp-license.js`; the maintenance build is `siteground/scripts/build_mcp_engine.py`. Never change financial formulas separately for MCP. `build_mcp_model.py` assembles the shared source modules during packaging.

Validation covers real PHP/SQLite OAuth and MCP calls, Pim/Floris identities, S256, resource binding, single-use codes, expiry, refresh rotation/replay, disconnect, origins, date/write rejection, the official MCP SDK client, confidential clients and numerical equivalence with Node. CI also runs the existing dashboard/security/deployment tests. Publication atomically switches code while retaining configuration, accounts and datasets. Live checks verify deployed revision, login, anonymous data protection, OAuth metadata and execution of the actual shared JavaScript model using synthetic input. Failed verification restores the previous code revision. Live synthetic verification is not a claim that an individual user's ChatGPT connection or current upstream fetching was tested.
