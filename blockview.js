// Block detail view: block parameters, all transactions (paginated), decoded
// token transfers, highlighting of a searched address / tx.
// Depends on globals from app.js: web3, CURRENT_CHAIN, LAST_ETH_BLOCK, elem, elems,
// createBlockie, formatAddress, formatTimeAgo, formatGasPrice.

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const TRANSFER_SINGLE_TOPIC = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62'
const TX_PAGE_SIZE = 25

// All block fields we know how to show, in display order. `def` = shown by default.
const BLOCK_FIELDS = [
    { key: 'number', label: 'Number', def: true },
    { key: 'hash', label: 'Hash', def: true },
    { key: 'parentHash', label: 'Parent hash', def: true },
    { key: 'timestamp', label: 'Timestamp', def: true },
    { key: 'txCount', label: 'Transactions', def: true },
    { key: 'miner', label: 'Miner / coinbase', def: true },
    { key: 'gasUsed', label: 'Gas used', def: true },
    { key: 'gasLimit', label: 'Gas limit', def: false },
    { key: 'baseFeePerGas', label: 'Base fee', def: true },
    { key: 'size', label: 'Size (bytes)', def: true },
    { key: 'l1BlockNumber', label: 'L1 block number', def: true },
    { key: 'sendCount', label: 'Send count (L2→L1)', def: false },
    { key: 'sendRoot', label: 'Send root', def: false },
    { key: 'stateRoot', label: 'State root', def: false },
    { key: 'receiptsRoot', label: 'Receipts root', def: false },
    { key: 'transactionsRoot', label: 'Transactions root', def: false },
    { key: 'extraData', label: 'Extra data', def: false },
    { key: 'mixHash', label: 'Mix hash', def: false },
    { key: 'nonce', label: 'Nonce', def: false },
    { key: 'difficulty', label: 'Difficulty', def: false },
    { key: 'sha3Uncles', label: 'Uncles hash', def: false },
    { key: 'logsBloom', label: 'Logs bloom', def: false },
]

// ---------- small helpers ----------

function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function rpcRaw(method, params) {
    return new Promise((resolve, reject) => {
        web3.currentProvider.send(
            { jsonrpc: '2.0', id: Math.floor(Math.random() * 1e9), method, params },
            (err, res) => {
                if (err) return reject(err)
                if (res?.error) return reject(new Error(res.error.message || JSON.stringify(res.error)))
                resolve(res.result)
            }
        )
    })
}

const hexToBigInt = h => (h === undefined || h === null || h === '0x') ? 0n : BigInt(h)
const hexToNum = h => Number(hexToBigInt(h))
const topicToAddress = t => '0x' + t.slice(-40)
const lc = s => (s || '').toLowerCase()

// Format a raw integer amount with `decimals` decimals, trimmed.
function formatUnits(raw, decimals, maxFrac = 6) {
    let v = BigInt(raw)
    const neg = v < 0n
    if (neg) v = -v
    const d = BigInt(decimals)
    const base = 10n ** d
    const whole = v / base
    let frac = (v % base).toString().padStart(Number(d), '0').slice(0, maxFrac).replace(/0+$/, '')
    const wholeStr = whole.toLocaleString('en-US')
    return (neg ? '-' : '') + wholeStr + (frac ? '.' + frac : '')
}

// Characters that make a token symbol suspicious (non-ASCII lookalikes, zero-width chars).
function isSuspiciousSymbol(sym) {
    return /[^\x20-\x7E]/.test(sym || '')
}

function loadPrefs(key, fallback) {
    try {
        const v = localStorage.getItem(key)
        return v ? JSON.parse(v) : fallback
    } catch { return fallback }
}

function savePrefs(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage unavailable */ }
}

// Long enough (8+6 hex) that address-poisoning lookalikes (which copy only the first/last ~4 chars) look different.
function shortAddr(address) {
    const known = formatAddress(address)
    if (!/^[0-9a-fA-F]{4}\.\.\.[0-9a-fA-F]{4}$/.test(known)) return known
    return address.slice(0, 10) + '…' + address.slice(-6)
}

function addrLink(address, highlight) {
    if (!address) return '<span class="contract-creation">Contract creation</span>'
    const isHl = highlight && lc(address) === highlight
    return `<a class="addr ${isHl ? 'addr-hl' : ''}" href="${esc(CURRENT_CHAIN.explorer)}/address/${esc(address)}" target="_blank" title="${esc(address)}">${createBlockie(address)} ${esc(shortAddr(address))}</a>`
}

// ---------- token metadata (symbol/decimals via eth_call, cached) ----------

const tokenMetaCache = new Map()

function decodeAbiString(hex) {
    if (!hex || hex === '0x') return ''
    try {
        const data = hex.slice(2)
        if (data.length === 64) { // bytes32-style symbol
            return web3.utils.hexToUtf8('0x' + data).replace(/\0/g, '')
        }
        const len = parseInt(data.slice(64, 128), 16)
        return web3.utils.hexToUtf8('0x' + data.slice(128, 128 + len * 2))
    } catch { return '' }
}

async function getTokenMeta(address) {
    const key = lc(address)
    if (tokenMetaCache.has(key)) return tokenMetaCache.get(key)
    const p = (async () => {
        const [sym, dec] = await Promise.all([
            rpcRaw('eth_call', [{ to: address, data: '0x95d89b41' }, 'latest']).catch(() => '0x'),
            rpcRaw('eth_call', [{ to: address, data: '0x313ce567' }, 'latest']).catch(() => '0x'),
        ])
        const decimals = dec && dec !== '0x' ? hexToNum(dec) : null
        return { symbol: decodeAbiString(sym) || '???', decimals: decimals !== null && decimals <= 36 ? decimals : 0 }
    })()
    tokenMetaCache.set(key, p)
    return p
}

// ---------- receipts & transfer decoding ----------

async function getReceipts(blockHex, txs) {
    try {
        const receipts = await rpcRaw('eth_getBlockReceipts', [blockHex])
        if (Array.isArray(receipts)) return receipts
    } catch (e) {
        console.warn('eth_getBlockReceipts unsupported, falling back to per-tx receipts', e)
    }
    const out = []
    for (let i = 0; i < txs.length; i += 10) {
        out.push(...await Promise.all(txs.slice(i, i + 10).map(tx => rpcRaw('eth_getTransactionReceipt', [tx.hash]))))
    }
    return out
}

// Turn receipt logs into transfer records (ERC-20, ERC-721, ERC-1155 single).
function decodeTransfers(receipt) {
    const transfers = []
    for (const log of receipt?.logs || []) {
        const t0 = log.topics?.[0]
        if (t0 === TRANSFER_TOPIC && log.topics.length === 3) {
            transfers.push({ kind: 'erc20', token: log.address, from: topicToAddress(log.topics[1]), to: topicToAddress(log.topics[2]), raw: hexToBigInt(log.data) })
        } else if (t0 === TRANSFER_TOPIC && log.topics.length === 4) {
            transfers.push({ kind: 'nft', token: log.address, from: topicToAddress(log.topics[1]), to: topicToAddress(log.topics[2]), tokenId: hexToBigInt(log.topics[3]).toString() })
        } else if (t0 === TRANSFER_SINGLE_TOPIC && log.topics.length === 4) {
            const d = log.data.slice(2)
            transfers.push({ kind: 'nft', token: log.address, from: topicToAddress(log.topics[2]), to: topicToAddress(log.topics[3]), tokenId: BigInt('0x' + d.slice(0, 64)).toString(), raw: BigInt('0x' + d.slice(64, 128)) })
        }
    }
    return transfers
}

function txInvolves(tx, address) {
    if (!address) return false
    if (lc(tx.from) === address || lc(tx.to) === address) return true
    return tx.transfers.some(t => lc(t.from) === address || lc(t.to) === address)
}

// ---------- rendering ----------

let BV = null // state of the currently displayed block

function fieldValue(key, block) {
    const v = block[key]
    switch (key) {
        case 'number': case 'l1BlockNumber': case 'sendCount': case 'size': case 'nonce': case 'difficulty':
            return v === undefined ? null : hexToBigInt(v).toLocaleString('en-US')
        case 'timestamp': {
            const ts = hexToNum(v)
            return `${new Date(ts * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC')} <span class="muted">(<span class="time-ago" data-timestamp="${ts}">${formatTimeAgo(ts)}</span>)</span>`
        }
        case 'txCount':
            return block.transactions.length.toLocaleString('en-US')
        case 'miner':
            return addrLink(v)
        case 'gasUsed': {
            const used = hexToBigInt(v), limit = hexToBigInt(block.gasLimit)
            const pct = limit > 0n ? Number(used * 10000n / limit) / 100 : 0
            return `${used.toLocaleString('en-US')} <span class="muted">(${pct}% of limit)</span>`
        }
        case 'gasLimit':
            return hexToBigInt(v).toLocaleString('en-US')
        case 'baseFeePerGas':
            return v === undefined ? null : `${esc(formatGasPrice(hexToBigInt(v).toString()))} <span class="muted">(${hexToBigInt(v).toLocaleString('en-US')} wei)</span>`
        default:
            return v === undefined ? null : `<code>${esc(v)}</code>`
    }
}

function renderParams() {
    const { block, fields } = BV
    const rows = BLOCK_FIELDS
        .filter(f => fields.includes(f.key))
        .map(f => ({ f, val: fieldValue(f.key, block) }))
        .filter(r => r.val !== null)
        .map(r => `<div class="param"><div class="param-label">${esc(r.f.label)}</div><div class="param-value">${r.val}</div></div>`)
        .join('')
    elem('#bvParams').innerHTML = rows
}

function renderFieldChooser() {
    const available = BLOCK_FIELDS.filter(f => f.key === 'txCount' || BV.block[f.key] !== undefined)
    elem('#bvFieldChooser').innerHTML = available.map(f => `
        <label><input type="checkbox" value="${f.key}" ${BV.fields.includes(f.key) ? 'checked' : ''}> ${esc(f.label)}</label>
    `).join('')
    elem('#bvFieldChooser').querySelectorAll('input').forEach(cb => cb.addEventListener('change', () => {
        BV.fields = Array.from(elem('#bvFieldChooser').querySelectorAll('input:checked')).map(i => i.value)
        savePrefs('bv-fields', BV.fields)
        renderParams()
    }))
}

function transferChip(t, highlight, meta) {
    const dir = highlight ? (lc(t.to) === highlight ? 'in' : lc(t.from) === highlight ? 'out' : '') : ''
    let amount
    if (t.kind === 'erc20') {
        amount = meta ? formatUnits(t.raw, meta.decimals) : t.raw.toString()
    } else {
        amount = `#${t.tokenId.length > 12 ? t.tokenId.slice(0, 10) + '…' : t.tokenId}${t.raw !== undefined ? ' ×' + t.raw : ''}`
    }
    const sym = meta?.symbol ?? '…'
    const suspicious = meta && isSuspiciousSymbol(meta.symbol)
    return `<span class="chip ${dir ? 'chip-' + dir : ''} ${suspicious ? 'chip-warn' : ''}" title="${esc(t.token)}${suspicious ? ' — symbol contains non-ASCII/hidden characters: likely a fake token' : ''}">
        ${dir === 'in' ? '+' : dir === 'out' ? '−' : ''}${esc(amount)} ${esc(sym)}${suspicious ? ' ⚠' : ''}
    </span>`
}

function filteredTxs() {
    const { txs, highlight, onlyMatching, text } = BV
    let list = txs
    if (highlight && onlyMatching) list = list.filter(tx => tx.matches)
    if (text) {
        const q = lc(text)
        list = list.filter(tx => lc(tx.hash).includes(q) || lc(tx.from).includes(q) || lc(tx.to).includes(q) ||
            tx.input.slice(0, 10) === q || tx.transfers.some(t => lc(t.token).includes(q) || lc(t.from).includes(q) || lc(t.to).includes(q)))
    }
    // Pin matching txs to the top, otherwise keep block order.
    return [...list].sort((a, b) => (b.matches - a.matches) || (a.index - b.index))
}

async function renderTxs() {
    const tok = BV.token
    const list = filteredTxs()
    const pages = Math.max(1, Math.ceil(list.length / TX_PAGE_SIZE))
    BV.page = Math.min(BV.page, pages - 1)
    const slice = list.slice(BV.page * TX_PAGE_SIZE, (BV.page + 1) * TX_PAGE_SIZE)

    // Resolve token metadata for transfers on this page
    const tokens = [...new Set(slice.flatMap(tx => tx.transfers.map(t => lc(t.token))))]
    const metas = Object.fromEntries(await Promise.all(tokens.map(async t => [t, await getTokenMeta(t)])))
    if (BV.token !== tok) return // a newer block was opened meanwhile

    const sym = CURRENT_CHAIN.nativeSymbol || 'ETH'
    elem('#bvTxInfo').textContent = `${list.length.toLocaleString('en-US')} of ${BV.txs.length.toLocaleString('en-US')} transactions` +
        (BV.highlight ? ` · ${BV.txs.filter(t => t.matches).length} involve the searched address` : '')
    elem('#bvPage').textContent = `page ${BV.page + 1} / ${pages}`
    elem('#bvPrevPage').disabled = BV.page === 0
    elem('#bvNextPage').disabled = BV.page >= pages - 1

    elem('#bvTxList').innerHTML = slice.map(tx => {
        const value = hexToBigInt(tx.value)
        const method = tx.input && tx.input !== '0x' ? tx.input.slice(0, 10) : null
        const fee = tx.receipt ? hexToBigInt(tx.receipt.gasUsed) * hexToBigInt(tx.receipt.effectiveGasPrice || tx.gasPrice) : null
        const isTarget = BV.txHash && lc(tx.hash) === BV.txHash
        const open = BV.expanded.has(tx.hash)
        return `
        <div class="transaction-item ${tx.ok ? 'success' : 'failed'} ${tx.matches ? 'tx-match' : ''} ${isTarget ? 'tx-target' : ''}" data-hash="${esc(tx.hash)}">
            <div class="tx-hash">
                <span>
                    <span class="muted">#${tx.index}</span>
                    <a href="${esc(CURRENT_CHAIN.explorer)}/tx/${esc(tx.hash)}" target="_blank" title="${esc(tx.hash)}">${esc(tx.hash.slice(0, 12))}…${esc(tx.hash.slice(-8))}</a>
                    ${tx.matches ? '<span class="tag tag-match">matches search</span>' : ''}
                    ${method ? `<span class="contract-interaction" title="Method selector">${esc(method)}</span>` : ''}
                </span>
                <span>
                    <span class="tx-status ${tx.ok ? 'success' : 'failed'}">${tx.ok ? 'Success' : 'Failed'}</span>
                    <button class="tx-toggle" data-hash="${esc(tx.hash)}">${open ? 'Hide' : 'Details'}</button>
                </span>
            </div>
            <div class="tx-addresses">
                <span>From: ${addrLink(tx.from, BV.highlight)}</span>
                <span>To: ${addrLink(tx.to || tx.receipt?.contractAddress, BV.highlight)}</span>
            </div>
            <div class="tx-value">
                <span>Value: ${esc(formatUnits(value, 18))} ${esc(sym)}${fee !== null ? ` <span class="muted">· fee ${esc(formatUnits(fee, 18, 8))} ${esc(sym)}</span>` : ''}</span>
                <span class="chips">${tx.transfers.slice(0, 6).map(t => transferChip(t, BV.highlight, metas[lc(t.token)])).join('')}${tx.transfers.length > 6 ? `<span class="chip">+${tx.transfers.length - 6} more</span>` : ''}</span>
            </div>
            ${open ? renderTxExpanded(tx, metas) : ''}
        </div>`
    }).join('') || '<p class="muted">No transactions match.</p>'

    elem('#bvTxList').querySelectorAll('.tx-toggle').forEach(btn => btn.addEventListener('click', () => {
        const h = btn.dataset.hash
        BV.expanded.has(h) ? BV.expanded.delete(h) : BV.expanded.add(h)
        renderTxs()
    }))
}

function renderTxExpanded(tx, metas) {
    const r = tx.receipt || {}
    const kv = (k, v) => v === undefined || v === null ? '' : `<div class="param"><div class="param-label">${esc(k)}</div><div class="param-value">${v}</div></div>`
    const transfers = tx.transfers.map(t => {
        const m = metas[lc(t.token)]
        return `<div class="transfer-row">
            ${transferChip(t, BV.highlight, m)}
            <span>${addrLink(t.from, BV.highlight)} → ${addrLink(t.to, BV.highlight)}</span>
            <span class="muted">token <a href="${esc(CURRENT_CHAIN.explorer)}/token/${esc(t.token)}" target="_blank">${esc(t.token)}</a></span>
        </div>`
    }).join('')
    const logs = (r.logs || []).map(l => `<div class="log-row"><div>#${hexToNum(l.logIndex)} <code>${esc(l.address)}</code></div>
        ${l.topics.map((t, i) => `<div class="muted">topic${i}: <code>${esc(t)}</code></div>`).join('')}
        <div class="muted">data: <code>${esc(l.data.length > 300 ? l.data.slice(0, 300) + '…' : l.data)}</code></div></div>`).join('')
    return `<div class="tx-expanded">
        <div class="param-grid">
            ${kv('Hash', `<code>${esc(tx.hash)}</code>`)}
            ${kv('Nonce', hexToNum(tx.nonce).toLocaleString('en-US'))}
            ${kv('Type', esc(hexToNum(tx.type)))}
            ${kv('Gas limit', hexToBigInt(tx.gas).toLocaleString('en-US'))}
            ${r.gasUsed ? kv('Gas used', hexToBigInt(r.gasUsed).toLocaleString('en-US')) : ''}
            ${r.gasUsedForL1 ? kv('Gas used for L1', hexToBigInt(r.gasUsedForL1).toLocaleString('en-US')) : ''}
            ${kv('Effective gas price', esc(formatGasPrice(hexToBigInt(r.effectiveGasPrice || tx.gasPrice).toString())))}
            ${r.contractAddress ? kv('Created contract', addrLink(r.contractAddress)) : ''}
            ${r.timeboosted !== undefined ? kv('Timeboosted', esc(r.timeboosted)) : ''}
        </div>
        ${transfers ? `<h4>Token transfers (${tx.transfers.length})</h4>${transfers}` : ''}
        <h4>Input data</h4><pre class="input-data">${esc(tx.input)}</pre>
        ${logs ? `<h4>Logs (${r.logs.length})</h4>${logs}` : ''}
    </div>`
}

// ---------- entry point ----------

/**
 * Open the detail view for a block.
 * opts.address: lowercased address to highlight; opts.txHash: tx to highlight & expand.
 */
async function openBlockView(blockNumber, opts = {}) {
    const details = elem('#blockDetails')
    elems('.block').forEach(b => b.classList.remove('active'))
    const pending = LAST_ETH_BLOCK !== null && blockNumber > LAST_ETH_BLOCK
    if (pending) {
        elem('#pendingBlock')?.classList.add('active')
    } else {
        elems(`.block[data-block="${blockNumber}"]`).forEach(b => b.classList.add('active'))
    }
    details.classList.add('active')
    details.innerHTML = `<p class="muted">Loading block #${Number(blockNumber).toLocaleString('en-US')}…</p>`

    const token = Symbol('bv')
    BV = { token }

    try {
        const hex = '0x' + Number(blockNumber).toString(16)
        const block = await rpcRaw('eth_getBlockByNumber', [hex, true])
        if (BV.token !== token) return
        if (!block) {
            details.innerHTML = `<p>Block #${esc(blockNumber)} is not available yet${pending ? ' (it has not been produced)' : ''}.</p>`
            return
        }
        details.innerHTML = `<p class="muted">Loading ${block.transactions.length} receipts…</p>`
        const receipts = await getReceipts(hex, block.transactions)
        if (BV.token !== token) return
        const byHash = new Map(receipts.filter(Boolean).map(r => [lc(r.transactionHash), r]))
        const highlight = opts.address ? lc(opts.address) : null
        const txs = block.transactions.map(tx => {
            const receipt = byHash.get(lc(tx.hash))
            const t = { ...tx, index: hexToNum(tx.transactionIndex), receipt, ok: receipt ? receipt.status === '0x1' : true, transfers: decodeTransfers(receipt) }
            t.matches = txInvolves(t, highlight)
            return t
        })

        Object.assign(BV, {
            block, txs, highlight,
            txHash: opts.txHash ? lc(opts.txHash) : null,
            fields: loadPrefs('bv-fields', BLOCK_FIELDS.filter(f => f.def).map(f => f.key)),
            onlyMatching: !!highlight && txs.some(t => t.matches),
            text: '', page: 0, expanded: new Set(),
        })
        if (BV.txHash) {
            const target = txs.find(t => lc(t.hash) === BV.txHash)
            if (target) BV.expanded.add(target.hash)
        }

        const num = hexToNum(block.number)
        details.innerHTML = `
            <div class="bv-head">
                <div class="bv-title"><span class="mdi mdi-cube"></span> Block #${num.toLocaleString('en-US')}</div>
                <div class="bv-nav">
                    <button id="bvPrevBlock" title="Previous block">‹ ${(num - 1).toLocaleString('en-US')}</button>
                    <button id="bvNextBlock" title="Next block" ${LAST_ETH_BLOCK !== null && num >= LAST_ETH_BLOCK ? 'disabled' : ''}>${(num + 1).toLocaleString('en-US')} ›</button>
                    <a class="bv-ext" href="${esc(CURRENT_CHAIN.explorer)}/block/${num}" target="_blank">Open in explorer <span class="mdi mdi-open-in-new"></span></a>
                </div>
            </div>
            <div class="bv-tabs" role="tablist">
                <button class="bv-tab" data-tab="overview" role="tab">Overview</button>
                <button class="bv-tab" data-tab="anatomy" role="tab">Block anatomy <span class="muted small">header + entries</span></button>
            </div>
            <div id="bvOverview">
            <details class="bv-fields-box">
                <summary>Choose block parameters</summary>
                <div id="bvFieldChooser" class="field-chooser"></div>
            </details>
            <div id="bvParams" class="param-grid"></div>
            <div class="bv-tx-toolbar">
                <span class="mdi mdi-swap-horizontal"></span> <b id="bvTxInfo"></b>
                <input id="bvTxFilter" type="text" placeholder="Filter txs in block: hash, address, token, 0xselector">
                ${highlight ? `<label class="inline"><input id="bvOnlyMatching" type="checkbox" ${BV.onlyMatching ? 'checked' : ''}> only txs involving ${esc(shortAddr(highlight))}</label>` : ''}
                <span class="pager"><button id="bvPrevPage">‹</button> <span id="bvPage"></span> <button id="bvNextPage">›</button></span>
            </div>
            <div class="transactions-list" id="bvTxList"></div>
            </div>
            <div id="bvAnatomy" hidden></div>
        `
        renderFieldChooser()
        renderParams()

        elem('#bvPrevBlock').onclick = () => openBlockView(num - 1, opts)
        elem('#bvNextBlock').onclick = () => openBlockView(num + 1, opts)
        elem('#bvPrevPage').onclick = () => { BV.page--; renderTxs() }
        elem('#bvNextPage').onclick = () => { BV.page++; renderTxs() }
        elem('#bvTxFilter').addEventListener('input', debounce(e => { BV.text = e.target.value.trim(); BV.page = 0; renderTxs() }, 200))
        const only = elem('#bvOnlyMatching')
        if (only) only.onchange = () => { BV.onlyMatching = only.checked; BV.page = 0; renderTxs() }

        elems('.bv-tab').forEach(b => { b.onclick = () => setBlockTab(b.dataset.tab) })
        setBlockTab(loadPrefs('bv-tab', 'overview') === 'anatomy' ? 'anatomy' : 'overview')

        await renderTxs()
        if (typeof onBlockViewOpened === 'function') onBlockViewOpened(num)
        const target = BV.tab === 'overview' && BV.txHash && Array.from(elems('#bvTxList .transaction-item')).find(e => lc(e.dataset.hash) === BV.txHash)
        ;(target || details).scrollIntoView({ behavior: 'smooth', block: target ? 'center' : 'start' })
    } catch (error) {
        console.error('Error showing block details:', error)
        if (BV.token === token) details.innerHTML = `<p>Error loading block details: ${esc(error.message)}</p>`
    }
}
