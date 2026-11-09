// "Block anatomy" tab: the block as raw data — every header field (raw + decoded) and every
// body entry, each with a hover/tap tooltip explaining what it is.
// Depends on blockview.js (BV, esc, lc, hexToNum, hexToBigInt, formatUnits, shortAddr, addrLink,
// renderTxs, filteredTxs, TX_PAGE_SIZE) and app.js (CURRENT_CHAIN, elem, elems, formatTimeAgo).

const EMPTY_UNCLES_HASH = '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347'

const TX_TYPES = {
    0: ['Legacy', 'Original Ethereum tx format: a single gasPrice, no separate tip.'],
    1: ['Access list (EIP-2930)', 'Legacy-style pricing plus a list of addresses/storage slots the tx will touch, pre-paid at a discount.'],
    2: ['EIP-1559', 'Modern fee format: maxFeePerGas + maxPriorityFeePerGas. Pays base fee + tip, capped at max fee.'],
    3: ['Blob (EIP-4844)', 'Carries "blobs" of data for rollups, priced on a separate blob-gas market.'],
    4: ['Set code (EIP-7702)', 'Lets a normal wallet temporarily act like a smart contract.'],
    100: ['Arbitrum deposit', 'ETH deposited from Ethereum (L1) into Arbitrum.'],
    101: ['Arbitrum unsigned', 'A tx submitted from L1 on behalf of an account, without an L2 signature.'],
    102: ['Arbitrum contract', 'A tx sent from an L1 contract to L2.'],
    104: ['Arbitrum retry', 'Automatic or manual execution of a retryable ticket (an L1→L2 message).'],
    105: ['Arbitrum submit retryable', 'Creates a retryable ticket: an L1→L2 message that can be retried if it fails.'],
    106: ['Arbitrum internal', 'System message from ArbOS itself. Not signed by anyone, costs no gas. Every Arbitrum block starts with one ("startBlock") that records the current Ethereum block and gas price.'],
    120: ['Arbitrum legacy', 'Pre-Nitro Arbitrum transaction format.'],
}

const KNOWN_SELECTORS = {
    '0xa9059cbb': 'transfer(address,uint256)',
    '0x23b872dd': 'transferFrom(address,address,uint256)',
    '0x095ea7b3': 'approve(address,uint256)',
    '0xd0e30db0': 'deposit()',
    '0x2e1a7d4d': 'withdraw(uint256)',
    '0x6bf6a42d': 'startBlock(l1BaseFee, l1BlockNumber, l2BlockNumber, timeSinceLastBlock)',
    '0xac9650d8': 'multicall(bytes[])',
    '0x5ae401dc': 'multicall(uint256,bytes[])',
    '0x3593564c': 'execute(bytes,bytes[],uint256)',
    '0x38ed1739': 'swapExactTokensForTokens(...)',
    '0x414bf389': 'exactInputSingle(...)',
}

const KNOWN_EVENTS = {
    '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef': 'Transfer',
    '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925': 'Approval',
    '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62': 'TransferSingle',
    '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb': 'TransferBatch',
    '0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c': 'Deposit (WETH)',
    '0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65': 'Withdrawal (WETH)',
    '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822': 'Swap (Uniswap V2-style)',
    '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67': 'Swap (Uniswap V3-style)',
    '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1': 'Sync (Uniswap V2-style)',
}

// ---------- header field definitions ----------
// Each: label, tip (what it is), decode(block) → html (optional), arb: overrides when on Arbitrum.

const fmtInt = h => hexToBigInt(h).toLocaleString('en-US')

const HEADER_GROUPS = [
    {
        title: 'Identity & chain link',
        tip: 'What block this is, and the link to the block before it.',
        fields: {
            number: { label: 'number', tip: 'Block height: how many blocks came before this one.', decode: b => fmtInt(b.number) },
            hash: { label: 'hash', tip: 'This block\'s fingerprint: keccak-256 of all header fields. Change any field (or any tx, via the roots) and this hash changes completely.' },
            parentHash: {
                label: 'parentHash',
                tip: 'Hash of the previous block. Every block points to its parent — this is the "chain" in blockchain. Rewriting an old block would break every link after it.',
                decode: b => `→ <a href="#" class="an-open-block" data-block="${hexToNum(b.number) - 1}">block #${(hexToNum(b.number) - 1).toLocaleString('en-US')}</a>`,
            },
            timestamp: {
                label: 'timestamp',
                tip: 'When the block was produced, in seconds since 1970-01-01 UTC (Unix time).',
                decode: b => { const t = hexToNum(b.timestamp); return `${t} s → ${new Date(t * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC')} (${formatTimeAgo(t)})` },
            },
        },
    },
    {
        title: 'Gas & fees',
        tip: 'How much work the block contained and what it cost per unit.',
        fields: {
            gasUsed: {
                label: 'gasUsed',
                tip: 'Total gas consumed by all transactions in the block (sum of each receipt\'s gasUsed).',
                decode: b => {
                    const parts = (BV.txs || []).map(t => t.receipt ? hexToNum(t.receipt.gasUsed) : null)
                    const ok = parts.every(p => p !== null)
                    const sum = ok ? parts.reduce((a, c) => a + c, 0) : null
                    return `${fmtInt(b.gasUsed)}${ok && parts.length <= 12 ? ` = ${parts.map(p => p.toLocaleString('en-US')).join(' + ')}` : ''}${ok && sum !== hexToNum(b.gasUsed) ? ' <span class="neg">(≠ sum of receipts)</span>' : ''}`
                },
            },
            gasLimit: {
                label: 'gasLimit',
                tip: 'Maximum gas the block may contain.',
                arbTip: 'On Arbitrum this is a placeholder (2⁵⁰). Arbitrum limits throughput with its gas pricing instead of a per-block cap.',
                decode: b => { const v = hexToBigInt(b.gasLimit); return `${v.toLocaleString('en-US')}${v === 2n ** 50n ? ' (= 2⁵⁰, placeholder)' : ''}` },
            },
            baseFeePerGas: {
                label: 'baseFeePerGas',
                tip: 'Minimum price per gas unit for every tx in this block (EIP-1559). Set by the protocol from recent demand, not by senders. Effective price = base fee + tip, capped at the tx\'s max fee.',
                arbTip: 'Price per gas unit for this block. Arbitrum has a floor price and raises it only when demand exceeds its throughput target (a "backlog"). Effective price = base fee + tip, capped at the tx\'s max fee.',
                decode: b => `${fmtInt(b.baseFeePerGas)} wei = ${formatUnits(hexToBigInt(b.baseFeePerGas), 9, 9)} gwei`,
            },
            blobGasUsed: { label: 'blobGasUsed', tip: 'Blob gas used by blob (EIP-4844) transactions in this block.', decode: b => fmtInt(b.blobGasUsed) },
            excessBlobGas: { label: 'excessBlobGas', tip: 'Running excess of blob demand over target; sets the blob gas price.', decode: b => fmtInt(b.excessBlobGas) },
        },
    },
    {
        title: 'Content fingerprints (Merkle roots)',
        tip: 'Single 32-byte hashes that lock in large amounts of data. They are inside the header, so the block hash commits to all of it.',
        fields: {
            transactionsRoot: { label: 'transactionsRoot', tip: 'Merkle-Patricia root of the transaction list in the body. Proves exactly which txs are in the block, in which order.', decode: b => `commits to ${b.transactions.length} transaction${b.transactions.length === 1 ? '' : 's'}` },
            receiptsRoot: {
                label: 'receiptsRoot',
                tip: 'Root of all receipts: success/fail, gas used and logs (events like token Transfers) for each tx. Receipts are not stored in the block, but this hash proves what they are.',
                decode: () => { const logs = (BV.txs || []).reduce((a, t) => a + (t.receipt?.logs?.length || 0), 0); return `commits to ${BV.txs.length} receipts with ${logs} log${logs === 1 ? '' : 's'}` },
            },
            stateRoot: { label: 'stateRoot', tip: 'Root of the entire world state AFTER this block: every account\'s balance, nonce, contract code and storage (including token balances).', decode: () => 'all accounts & balances after this block' },
            logsBloom: {
                label: 'logsBloom',
                tip: '256-byte Bloom filter of every log address and topic in the block. Lets nodes quickly answer "could this block contain an event from X?" without reading every receipt (false positives possible, no false negatives).',
                decode: b => { const hex = b.logsBloom.slice(2); let set = 0; for (let i = 0; i < hex.length; i += 2) set += hex.slice(i, i + 2) !== '00' ? 1 : 0; return `${set} of 256 bytes non-zero` },
                short: true,
            },
            withdrawalsRoot: { label: 'withdrawalsRoot', tip: 'Root of validator withdrawals (staking payouts) processed in this block.' },
            parentBeaconBlockRoot: { label: 'parentBeaconBlockRoot', tip: 'Root of the parent consensus-layer (beacon chain) block, exposed to the EVM (EIP-4788).' },
            requestsHash: { label: 'requestsHash', tip: 'Commitment to consensus-layer requests (deposits, withdrawals, consolidations) triggered by this block (EIP-7685).' },
        },
    },
    {
        title: 'Producer & legacy fields',
        arbTitle: 'Legacy Ethereum fields (reused by Arbitrum)',
        tip: 'Fields inherited from Ethereum\'s header format.',
        arbTip: 'Arbitrum keeps Ethereum\'s header layout for compatibility, but has no mining, so some fields are constants and others are repurposed to carry Arbitrum data.',
        fields: {
            miner: {
                label: 'miner',
                tip: 'Fee recipient (coinbase) — the address that collects tips for producing this block.',
                arbTip: 'Not a miner. A fixed label whose last bytes spell "sequencer" in ASCII — Arbitrum\'s single sequencer orders all transactions.',
                decode: b => { const ascii = asciiTail(b.miner); return ascii ? `ends in ASCII "${esc(ascii)}"` : addrLink(b.miner) },
            },
            difficulty: { label: 'difficulty', tip: 'Proof-of-work difficulty. 0 on Ethereum since the Merge (proof-of-stake).', arbTip: 'Always 1 on Arbitrum (no mining).', decode: b => fmtInt(b.difficulty) },
            totalDifficulty: { label: 'totalDifficulty', tip: 'Cumulative difficulty of the chain up to this block (legacy).', decode: b => fmtInt(b.totalDifficulty) },
            nonce: {
                label: 'nonce',
                tip: 'Proof-of-work nonce. Always 0 on Ethereum since the Merge.',
                arbTip: 'Repurposed: number of messages from Ethereum\'s "delayed inbox" that Arbitrum has processed so far (deposits and L1→L2 messages that bypass the sequencer).',
                decode: b => `${fmtInt(b.nonce)}${isArb() ? ' delayed messages read' : ''}`,
            },
            mixHash: {
                label: 'mixHash',
                tip: 'On proof-of-stake Ethereum this is prevRandao: randomness from the beacon chain.',
                arbTip: 'Repurposed: packs Arbitrum data into 8-byte slots — send count, the Ethereum (L1) block number, and the ArbOS version.',
                decode: b => {
                    if (!isArb()) return 'prevRandao (beacon-chain randomness)'
                    const m = b.mixHash.slice(2)
                    const w = i => BigInt('0x' + m.slice(i * 16, i * 16 + 16))
                    return `sendCount <b>${w(0).toLocaleString('en-US')}</b> · L1 block <b>${w(1).toLocaleString('en-US')}</b> · ArbOS version <b>${w(2)}</b>`
                },
            },
            extraData: {
                label: 'extraData',
                tip: 'Up to 32 bytes of arbitrary data chosen by the block producer (often a builder name).',
                arbTip: 'Repurposed: holds the send root (same as sendRoot below).',
                decode: b => {
                    if (isArb()) return b.sendRoot && lc(b.sendRoot) === lc(b.extraData) ? '= sendRoot' : ''
                    const ascii = hexToAscii(b.extraData)
                    return ascii ? `ASCII: "${esc(ascii)}"` : ''
                },
            },
            sha3Uncles: { label: 'sha3Uncles', tip: 'Hash of the list of "uncle" blocks (orphaned proof-of-work blocks).', decode: b => lc(b.sha3Uncles) === EMPTY_UNCLES_HASH ? 'hash of an empty list — no uncles' : '' },
            size: { label: 'size', tip: 'Size of the whole block (header + body) in bytes, RLP-encoded.', decode: b => `${fmtInt(b.size)} bytes` },
        },
    },
    {
        title: 'Arbitrum fields',
        tip: 'Extra fields Arbitrum\'s RPC returns, decoded from the header.',
        arbOnly: true,
        fields: {
            l1BlockNumber: { label: 'l1BlockNumber', tip: 'The Ethereum (L1) block number the sequencer saw when producing this block. Contracts on Arbitrum see this as block.number.', decode: b => fmtInt(b.l1BlockNumber) },
            sendCount: { label: 'sendCount', tip: 'Total number of L2→L1 messages (e.g. withdrawals to Ethereum) sent so far.', decode: b => fmtInt(b.sendCount) },
            sendRoot: { label: 'sendRoot', tip: 'Merkle root of all L2→L1 messages so far. Used to prove withdrawals on Ethereum.' },
        },
    },
]

const isArb = () => !!(BV?.block && BV.block.l1BlockNumber !== undefined)

function hexToAscii(hex) {
    const s = (hex || '').slice(2)
    let out = ''
    for (let i = 0; i < s.length; i += 2) out += String.fromCharCode(parseInt(s.slice(i, i + 2), 16))
    const clean = out.replace(/\0/g, '')
    return /^[\x20-\x7E]{3,}$/.test(clean) ? clean : ''
}

function asciiTail(address) {
    const s = address.slice(2)
    let out = ''
    for (let i = s.length - 2; i >= 0; i -= 2) {
        const c = parseInt(s.slice(i, i + 2), 16)
        if (c < 0x20 || c > 0x7e) break
        out = String.fromCharCode(c) + out
    }
    return out.length >= 4 ? out : ''
}

// ---------- rendering ----------

function anatomyTrieLink(field) {
    const type = { transactionsRoot: 'transactions', receiptsRoot: 'receipts', stateRoot: 'state' }[field]
    if (!type) return ''
    const chain = Object.keys(CHAINS).find(key => CHAINS[key] === CURRENT_CHAIN) || CHAIN_PARAM
    const query = new URLSearchParams({ chain, block: BV.block.hash, type })
    return `<a class="an-trie-link" href="trie.html?${esc(query.toString())}" aria-label="Explore ${esc(type)} trie for this block">Explore trie <span aria-hidden="true">↗</span></a>`
}

function renderHeaderGroups(block) {
    const arb = isArb()
    const used = new Set(['transactions', 'uncles'])
    let html = ''
    for (const g of HEADER_GROUPS) {
        if (g.arbOnly && !arb) continue
        const rows = Object.entries(g.fields).filter(([k]) => block[k] !== undefined).map(([k, f]) => {
            used.add(k)
            const raw = String(block[k])
            const rawShown = f.short && raw.length > 74 ? raw.slice(0, 74) + '…' : raw
            const decoded = f.decode ? f.decode(block) : ''
            const tip = (arb && f.arbTip) ? f.arbTip : f.tip
            return `<div class="an-row">
                <div class="an-key" data-tip="${esc(tip)}" tabindex="0">${esc(f.label)} <span class="mdi mdi-information-outline"></span></div>
                <div class="an-raw"><code title="${esc(raw)}">${esc(rawShown)}</code></div>
                <div class="an-dec">${decoded}${anatomyTrieLink(k)}</div>
            </div>`
        }).join('')
        if (!rows) continue
        html += `<div class="an-group">
            <div class="an-group-title" data-tip="${esc(arb && g.arbTip ? g.arbTip : g.tip)}" tabindex="0">${esc(arb && g.arbTitle ? g.arbTitle : g.title)} <span class="mdi mdi-information-outline"></span></div>
            ${rows}
        </div>`
    }
    const extra = Object.keys(block).filter(k => !used.has(k))
    if (extra.length) {
        html += `<div class="an-group"><div class="an-group-title" data-tip="Fields this node returned that the explorer has no description for." tabindex="0">Other fields <span class="mdi mdi-information-outline"></span></div>
            ${extra.map(k => `<div class="an-row"><div class="an-key">${esc(k)}</div><div class="an-raw"><code>${esc(typeof block[k] === 'object' ? JSON.stringify(block[k]) : block[k])}</code></div><div class="an-dec"></div></div>`).join('')}
        </div>`
    }
    return html
}

function txTypeInfo(tx) {
    const n = hexToNum(tx.type ?? '0x0')
    const [name, tip] = TX_TYPES[n] || [`Type ${n}`, 'Unknown transaction type.']
    return { n, name, tip }
}

function renderBodyTable() {
    const sym = CURRENT_CHAIN.nativeSymbol || 'ETH'
    const th = (label, tip, cls = '') => `<th class="${cls}"><span data-tip="${esc(tip)}" tabindex="0">${label} <span class="mdi mdi-information-outline"></span></span></th>`
    const rows = BV.txs.map(tx => {
        const t = txTypeInfo(tx)
        const r = tx.receipt || {}
        const sel = tx.input && tx.input.length >= 10 ? tx.input.slice(0, 10) : null
        const method = sel ? KNOWN_SELECTORS[sel] : null
        const inputBytes = Math.max(0, (tx.input.length - 2) / 2)
        const logs = r.logs || []
        const counts = {} // event name → { count, known }
        for (const l of logs) {
            const t0 = l.topics?.[0]
            const name = KNOWN_EVENTS[t0] || (t0 ? t0.slice(0, 10) : 'anonymous')
            counts[name] = { count: (counts[name]?.count || 0) + 1, known: !!KNOWN_EVENTS[t0] }
        }
        const isTarget = BV.txHash && lc(tx.hash) === BV.txHash
        const gasUsed = r.gasUsed ? hexToNum(r.gasUsed) : null
        const l1 = r.gasUsedForL1 ? hexToNum(r.gasUsedForL1) : null
        return `<tr class="${tx.matches ? 'an-match' : ''} ${isTarget ? 'an-target' : ''}">
            <td class="num" data-tip="Position in the block (0-based). Txs execute in this order; each sees the state left by the previous one." tabindex="0">${tx.index}</td>
            <td><span class="an-type" data-tip="${esc(t.tip)}" tabindex="0">${esc(t.name)} <span class="muted">(${t.n})</span></span></td>
            <td><code title="${esc(tx.hash)}">${esc(tx.hash.slice(0, 10))}…</code>${tx.matches ? ' <span class="tag tag-match">your search</span>' : ''}</td>
            <td class="an-addrs">${addrLink(tx.from, BV.highlight)}<br>→ ${tx.to ? addrLink(tx.to, BV.highlight) : (r.contractAddress ? 'new contract ' + addrLink(r.contractAddress) : '<span class="contract-creation">contract creation</span>')}</td>
            <td>${sel ? `<span data-tip="${esc(method ? `Function selector ${sel} = first 4 bytes of keccak-256("${method}"). Input is ${inputBytes} bytes: selector + ABI-encoded arguments.` : `Function selector: first 4 bytes of the input, identifying which contract function is called. Input is ${inputBytes} bytes.`)}" tabindex="0"><code>${esc(sel)}</code>${method ? `<br><span class="muted small">${esc(method.split('(')[0])}</span>` : ''}</span>` : `<span class="muted" data-tip="No input data: a plain ${esc(sym)} transfer with no contract call." tabindex="0">— plain send</span>`}</td>
            <td class="num">${hexToBigInt(tx.value) > 0n ? `${esc(formatUnits(hexToBigInt(tx.value), 18))} ${esc(sym)}` : '<span class="muted">0</span>'}</td>
            <td class="num">${gasUsed !== null ? gasUsed.toLocaleString('en-US') : '?'}${l1 ? `<br><span class="muted small" data-tip="Part of gasUsed that paid for posting this tx's compressed data to Ethereum (L1)." tabindex="0">incl. ${l1} L1</span>` : ''}</td>
            <td>${r.status ? (r.status === '0x1' ? '<span class="tx-status success">OK</span>' : '<span class="tx-status failed">Failed</span>') : '?'}</td>
            <td class="an-logs">${logs.length ? Object.entries(counts).map(([n, c]) => `<span class="chip" data-tip="${esc(c.known ? `Event "${n}", identified by topic0 (keccak-256 of the event signature).` : `Unrecognised event: ${n}… is the start of its topic0 (keccak-256 of the event signature).`)}" tabindex="0">${esc(n)}${c.count > 1 ? ' ×' + c.count : ''}</span>`).join(' ') : '<span class="muted">none</span>'}</td>
            <td><button class="an-view-tx" data-hash="${esc(tx.hash)}" data-tip="Open this tx in the Overview tab with full details: transfers, input data and raw logs." >Details</button></td>
        </tr>`
    }).join('')
    return `<div class="an-table-wrap"><table class="an-table">
        <thead><tr>
            ${th('#', 'transactionIndex: position in the block, starting at 0.', 'num')}
            ${th('Type', 'Transaction envelope type: decides the fee fields and how it is signed.')}
            ${th('Hash', 'Transaction hash: keccak-256 of the signed transaction. Its unique ID.')}
            ${th('From → To', 'From: the signer who pays the fee. To: the account or contract called. For token transfers "To" is the token contract; the real recipient is inside the input/logs.')}
            ${th('Method', 'First 4 bytes of the input data (the function selector).')}
            ${th('Value', `Native ${sym} sent along with the tx (not tokens).`, 'num')}
            ${th('Gas used', 'Gas this tx consumed, from its receipt. Fee = gas used × effective gas price.', 'num')}
            ${th('Status', 'From the receipt: 1 = success, 0 = reverted. A reverted tx is still in the block and still pays gas.')}
            ${th('Logs', 'Events emitted by contracts during execution, from the receipt (e.g. token Transfer). Committed via receiptsRoot.')}
            <th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
    </table></div>`
}

function renderDiagram(block) {
    const num = hexToNum(block.number)
    const logs = BV.txs.reduce((a, t) => a + (t.receipt?.logs?.length || 0), 0)
    const mine = BV.txs.filter(t => t.matches || (BV.txHash && lc(t.hash) === BV.txHash))
    const box = (title, sub, tip, cls = '') => `<div class="an-box ${cls}" data-tip="${esc(tip)}" tabindex="0"><div class="an-box-title">${title}</div><div class="an-box-sub">${sub}</div>${anatomyTrieLink(title)}</div>`
    return `<div class="an-diagram">
        <div class="an-chain">
            ${box(`Block #${(num - 1).toLocaleString('en-US')}`, `<code>${esc(block.parentHash.slice(0, 12))}…</code>`, 'The previous block. This block\'s parentHash equals its hash.', 'an-box-dim')}
            <div class="an-arrow" data-tip="parentHash link: this block points back to its parent." tabindex="0">◄ parentHash</div>
            ${box(`Header #${num.toLocaleString('en-US')}`, `hash <code>${esc(block.hash.slice(0, 12))}…</code>`, 'The header: all fields listed below. Its keccak-256 hash is the block hash.', 'an-box-main')}
        </div>
        <div class="an-roots">
            ${box('transactionsRoot', `${block.transactions.length} txs (the body)`, 'Fingerprint of the ordered transaction list.')}
            ${box('receiptsRoot', `${BV.txs.length} receipts · ${logs} logs`, 'Fingerprint of every receipt: status, gas used, logs.')}
            ${box('stateRoot', 'all balances after', 'Fingerprint of the full world state after executing this block.')}
        </div>
        ${mine.length ? `<div class="an-proof" data-tip="How a block proves your transaction happened." tabindex="0">
            <b>Your ${mine.length === 1 ? 'tx' : mine.length + ' txs'} (#${mine.map(t => t.index).join(', #')})</b> ${mine.length === 1 ? 'is' : 'are'} committed three ways:
            in the body under <b>transactionsRoot</b>; ${mine.length === 1 ? 'its' : 'their'} success and logs under <b>receiptsRoot</b>; the resulting balances under <b>stateRoot</b>.
            All three are inside the header, so the block hash — and every later block's parentHash — depends on them.
        </div>` : ''}
    </div>`
}

function renderAnatomy() {
    const block = BV.block
    elem('#bvAnatomy').innerHTML = `
        <p class="muted small an-intro">The block exactly as the node returns it: a <b>header</b> (fields that summarise and seal the block) and a <b>body</b> (the ordered list of transactions). Hover or tap any <span class="mdi mdi-information-outline"></span> for an explanation.</p>
        ${renderDiagram(block)}
        <h3 class="an-h">Header</h3>
        <div class="an-header">${renderHeaderGroups(block)}</div>
        <h3 class="an-h">Body — ${block.transactions.length} transaction${block.transactions.length === 1 ? '' : 's'}</h3>
        ${renderBodyTable()}
    `
    elem('#bvAnatomy').querySelectorAll('.an-open-block').forEach(a => a.addEventListener('click', e => {
        e.preventDefault()
        openBlockView(Number(a.dataset.block), { address: BV.highlight })
    }))
    elem('#bvAnatomy').querySelectorAll('.an-view-tx').forEach(b => b.addEventListener('click', () => showTxInOverview(b.dataset.hash)))
}

function showTxInOverview(hash) {
    setBlockTab('overview')
    BV.text = ''
    const filter = elem('#bvTxFilter'); if (filter) filter.value = ''
    if (BV.onlyMatching && !BV.txs.find(t => t.hash === hash)?.matches) {
        BV.onlyMatching = false
        const only = elem('#bvOnlyMatching'); if (only) only.checked = false
    }
    BV.expanded.add(hash)
    const idx = filteredTxs().findIndex(t => t.hash === hash)
    BV.page = Math.max(0, Math.floor(idx / TX_PAGE_SIZE))
    renderTxs().then(() => {
        const row = Array.from(elems('#bvTxList .transaction-item')).find(e => e.dataset.hash === hash)
        row?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
}

function setBlockTab(tab) {
    if (!elem('#bvOverview')) return
    BV.tab = tab
    savePrefs('bv-tab', tab)
    elem('#bvOverview').hidden = tab !== 'overview'
    elem('#bvAnatomy').hidden = tab !== 'anatomy'
    elems('.bv-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab))
    if (tab === 'anatomy' && !BV.anatomyRendered) {
        renderAnatomy()
        BV.anatomyRendered = true
    }
}

// ---------- shared tooltip (hover, keyboard focus, tap) ----------

const tooltip = (() => {
    const el = document.createElement('div')
    el.id = 'tooltip'
    el.setAttribute('role', 'tooltip')
    document.body.appendChild(el)
    let current = null

    function show(target) {
        const text = target.getAttribute('data-tip')
        if (!text) return
        current = target
        el.textContent = text
        el.classList.add('show')
        const r = target.getBoundingClientRect()
        const tw = el.offsetWidth, thh = el.offsetHeight
        const vw = document.documentElement.clientWidth
        let left = Math.min(Math.max(8, r.left + r.width / 2 - tw / 2), vw - tw - 8)
        let top = r.bottom + 8
        if (top + thh > window.innerHeight - 8) top = r.top - thh - 8 // flip above when no room below
        el.style.left = `${left + window.scrollX}px`
        el.style.top = `${Math.max(8, top) + window.scrollY}px`
    }
    function hide() { current = null; el.classList.remove('show') }

    document.addEventListener('mouseover', e => { const t = e.target.closest('[data-tip]'); if (t && t !== current) show(t); else if (!t && current) hide() })
    document.addEventListener('focusin', e => { const t = e.target.closest('[data-tip]'); if (t) show(t) })
    document.addEventListener('focusout', hide)
    document.addEventListener('scroll', () => { if (current) show(current) }, { passive: true, capture: true }) // follow inner scrolling
    document.addEventListener('keydown', e => { if (e.key === 'Escape') hide() })
    return { show, hide }
})()
