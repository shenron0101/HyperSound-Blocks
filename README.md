# EVM Block Explorer

https://explorer.coolhd.hu

EVM Block Explorer is visualization tool for exploring EVM blockchains, inspired by [Mempool Space](https://mempool.space).

## Preview

![Preview](./img/preview.png)

## Prerequisites

- Docker
- Docker Compose

## Getting Started

1. Clone the repository:

``` bash
git clone https://github.com/DaWe35/HyperSound-Blocks.git Ethereum-Blocks
cd Ethereum-Blocks
git switch ethereum
```

2. Start the application using Docker Compose:

```bash
docker compose up -d
```

3. Access the application at `http://localhost:9997`

## Trie explorer

Open a block's **Block anatomy** tab and select **Explore trie ↗** on a transaction,
receipt, or state root. Each opens a dedicated, shareable `trie.html` page pinned to
that block's hash. The explorer is static and works with the same Docker setup.

- **Lazy graph:** only immediate children are materialized when expanded. Initial
  transaction/receipt loading fetches a header with transaction hashes, not all payloads.
- **Lazy payloads:** selecting a transaction/receipt leaf fetches only that payload.
  Repeated lookups reuse successful requests; concurrent requests are coalesced.
- **Verification:** `Verify full trie` loads remaining payloads with at most four
  concurrent requests, reconstructs canonical MPT nodes, and compares the result to
  the header root. It can be cancelled and resumed. Partial shapes are explicitly
  unverified. Transaction bytes are also checked against their transaction hash.
- **State:** submit an address to request and verify `eth_getProof` at the selected
  block. Only that path is loaded; sibling subtrees remain hash references. Additional
  proofs merge into the same explored tree. A verified account leaf links to its
  **storage trie**, where slots are loaded and verified individually.
- **JSON:** native collapsible sections construct children on demand and paginate
  large arrays/objects in groups of 48. Graph rendering is capped at 240 visible nodes.
- **RPC:** use the connection section for a custom HTTP(S) endpoint. The endpoint is
  kept in session storage, not copied into shareable links. Historical state proofs
  require a provider retaining the requested trie nodes. The viewer never silently
  substitutes latest state or fabricated nodes when data is unavailable.

### Developing the explorer

```bash
bun install
bun test
bun run build:trie
```

Sources are in `trie/`. `assets/trie-explorer.js` is the prebuilt browser bundle
(including D3, EthereumJS RLP, and noble Keccak), so production serving needs no
package manager. Rebuild after changing explorer sources. The build derives
`trie/chains.json` from `app.js` to keep network configuration synchronized.

Ethereum transaction types 0–4 and Nitro types 100, 101, 102, 104, 105, and 106
have canonical encoders. Unknown/legacy Arbitrum formats require canonical raw bytes
from the RPC; unsupported data is reported rather than represented as verified.
Receipt payloads contain only consensus fields, not RPC metadata such as L1 gas.
Root verification anchors data to the RPC-supplied block header, not an independently
verified rollup/L1 consensus chain.
