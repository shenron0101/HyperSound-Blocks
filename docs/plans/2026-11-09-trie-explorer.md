# Lazy Trie Explorer Implementation Plan

**Goal:** Dedicated transaction, receipt, state, and storage trie views using real data, progressive disclosure, and explicit verification.

**Architecture:** Static pages served by the existing Docker container. A small bundled browser module uses audited RLP/Keccak primitives. Indexed trie shape comes from RLP(index) keys; children are constructed only when expanded and payloads fetched only when a leaf is opened. Full root verification is a separate bounded-concurrency action. State/storage graphs use verified EIP-1186 proof nodes and never invent missing subtrees.

**Tech Stack:** Plain JavaScript, SVG, D3 hierarchy/zoom, EthereumJS RLP, noble Keccak; Bun builds and runs tests.

## Approved design
- Separate shareable trie.html links from root cards and header fields.
- Reuse the original dashboard stylesheet, system typography, grayscale panels and header. Blue branches, amber extensions and green leaves use its existing semantic colors; label hex edges.
- Expand/collapse controls, search/path highlighting, node inspector, expandable JSON, fit/zoom, keyboard operation, mobile stacked layout.
- Verify against the selected immutable block hash. Show partial/unverified status until all indexed leaves are available. State proofs anchor to the selected header, not latest state.
- Cache successful requests and coalesce concurrent requests. Failures are retryable. Never fetch the world state or bulk receipts on page load.

## Task 1 — Canonical engine and meaningful tests
Create trie/core.js, trie/rpc.js and tests/trie.test.js. Verify empty root, RLP index 0/127/128, embedded child references, extension paths, and roots against an independent EthereumJS Trie. Verify inclusion/exclusion and reject tampered/wrong-root proofs. Implement Ethereum and Nitro transaction serialization; verify transaction hashes before accepting reconstructed bytes. Receipt encoding uses only consensus fields.

## Task 2 — Dedicated explorer
Create trie.html, trie/explorer.js and trie/explorer.css. Reuse chain definitions through a generated chain config from app.js at build time. Build only immediate children on expand, fetch only selected leaf, and run full verification with four concurrent requests and a cancellation control. State/address proofs load on submit; verified proof nodes merge by hash. Storage slot proofs use the account's verified storage root.

## Task 3 — Integration and documentation
Add links to anatomy.js and minimal styles to styles.css, preserving existing uncommitted anatomy work. Document dependency installation, bundling, tests, limitations and lazy-loading semantics in README.md. Check in the browser bundle so Docker serving needs no build step.

## Task 4 — Verification
Run bun test and bun run build:trie. Verify live Nitro transaction and receipt roots and account/storage proofs. Browser-test expand/collapse, leaf fetch counts, cache reuse, dedicated navigation, JSON, search, cancellation/error states, and mobile overflow. Run git diff --check and review only intended changes. No commits requested.
