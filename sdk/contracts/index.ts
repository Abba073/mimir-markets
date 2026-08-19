/**
 * Barrel for the generated Soroban contract bindings.
 *
 * `mimir-market/` and `mimir-squad/` are produced verbatim by
 *
 *   stellar contract bindings typescript \
 *     --contract-id <deployed id> --output-dir sdk/contracts/<name> \
 *     --network testnet --overwrite
 *
 * (see `npm run stellar:bindings`). Do not hand-edit them — regenerate instead.
 * Each generated package embeds the deployed testnet contract id in its
 * `networks.testnet` export, so `Client` can be constructed without repeating it.
 *
 * The two packages each re-export the whole of `@stellar/stellar-sdk`, so they
 * are namespaced here rather than flattened. Generated `package.json` files pin
 * `@stellar/stellar-sdk@^14`; this repo consumes the TypeScript sources directly
 * against the hoisted `^16` instead of running a nested `npm install`, which
 * keeps exactly one copy of the SDK in the tree.
 */
export * as MimirMarket from "./mimir-market/src/index";
export * as MimirSquad from "./mimir-squad/src/index";
