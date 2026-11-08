// Advanced search: address → matching blocks (Etherscan V2 API, or RPC log scan fallback),
// tx hash → its block, block number → that block.
// Depends on app.js (web3, CURRENT_CHAIN, LAST_ETH_BLOCK, elem, elems, sleep, createBlockie,
// formatAddress, formatTimeAgo) and blockview.js (openBlockView, rpcRaw, esc, formatUnits, ...).

const ETHERSCAN_API = 'https://api.etherscan.io/v2/api'
const SETTINGS_KEY = 'search-settings'
const DEFAULT_RPC_RANGE = 1_000_000

const SEARCH = {
    settings: loadPrefs(SETTINGS_KEY, { apiKey: '', chunk: 100000, source: 'auto' }),
    abort: null,
    results: [],      // normalized + filtered records
    address: null,
}

const TOKEN_SHORTCUTS = {
    ARBITRUM: {
        USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        'USDC.e': '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
        USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
        WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
        ARB: '0x912CE59144191C1204E64559FE8253a0e49E6548',
    },
    ETHER: {
        USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    },
}

// ---------- query detection ----------

function detectQuery(raw) {
    const s = (raw || '').trim().replace(/,/g, '')
    if (/^0x[0-9a-fA-F]{40}$/.test(s)) return { kind: 'address', value: s.toLowerCase() }
    if (/^0x[0-9a-fA-F]{64}$/.test(s)) return { kind: 'tx', value: s.toLowerCase() }
    if (/^\d+$/.test(s)) return { kind: 'block', value: Number(s) }
    if (/^0x[0-9a-fA-F]{1,12}$/.test(s)) return { kind: 'block', value: parseInt(s, 16) }
    return { kind: 'unknown', value: s }
}

// ---------- filters ----------

function readFilters() {
    const v = id => elem(id).value.trim()
    const types = Array.from(elems('#searchTypes input:checked')).map(i => i.value)
    return {
        direction: v('#fDirection'),
        types: types.length ? types : ['normal', 'internal', 'erc20', 'nft'],
        token: v('#fToken'),
        minAmount: v('#fMin'),
        maxAmount: v('#fMax'),
        fromBlock: v('#fFromBlock'),
        toBlock: v('#fToBlock'),
        fromDate: v('#fFromDate'),
        toDate: v('#fToDate'),
        counterparty: v('#fCounterparty').toLowerCase(),
        status: v('#fStatus'),
        method: v('#fMethod'),
        sort: v('#fSort'),
        limit: Math.max(1, Math.min(10000, parseInt(v('#fLimit')) || 1000)),
    }
}

const FILTER_PARAM_MAP = {
    direction: 'dir', token: 'token', minAmount: 'min', maxAmount: 'max', fromBlock: 'fb', toBlock: 'tb',
    fromDate: 'fd', toDate: 'td', counterparty: 'cp', status: 'st', method: 'm', sort: 'sort', limit: 'lim',
}
const FILTER_INPUT_IDS = {
    direction: '#fDirection', token: '#fToken', minAmount: '#fMin', maxAmount: '#fMax', fromBlock: '#fFromBlock',
    toBlock: '#fToBlock', fromDate: '#fFromDate', toDate: '#fToDate', counterparty: '#fCounterparty',
    status: '#fStatus', method: '#fMethod', sort: '#fSort', limit: '#fLimit',
}

function writeUrlState(query, filters) {
    const url = new URL(window.location)
    for (const p of [...Object.values(FILTER_PARAM_MAP), 'q', 'types', 'block']) url.searchParams.delete(p)
    if (query) url.searchParams.set('q', query)
    if (filters) {
        for (const [k, p] of Object.entries(FILTER_PARAM_MAP)) {
            const val = String(filters[k] ?? '')
            const def = { direction: 'any', status: 'any', sort: 'desc', limit: '1000' }[k] ?? ''
            if (val && val !== def) url.searchParams.set(p, val)
        }
        if (filters.types.length !== 4) url.searchParams.set('types', filters.types.join(','))
    }
    window.history.replaceState({}, '', url.toString())
}

function readUrlState() {
    const params = new URLSearchParams(window.location.search)
    for (const [k, p] of Object.entries(FILTER_PARAM_MAP)) {
        if (params.has(p)) elem(FILTER_INPUT_IDS[k]).value = params.get(p)
    }
    if (params.has('types')) {
        const t = params.get('types').split(',')
        elems('#searchTypes input').forEach(i => { i.checked = t.includes(i.value) })
    }
    if (params.has('dir') || params.has('token') || params.has('min') || params.has('max') || params.has('fb') ||
        params.has('tb') || params.has('fd') || params.has('td') || params.has('cp') || params.has('st') ||
        params.has('m') || params.has('types')) {
        elem('#advancedPanel').classList.add('open')
    }
    return { q: params.get('q'), block: params.get('block') }
}

// decimal string → integer units, e.g. ("3.5", 6) → 3500000n
function toUnits(str, decimals) {
    const [w, f = ''] = String(str).split('.')
    return BigInt(w || '0') * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0')
}

function tokenFilterAddress(token) {
    if (/^0x[0-9a-fA-F]{40}$/.test(token)) return token.toLowerCase()
    const shortcuts = TOKEN_SHORTCUTS[CHAIN_PARAM] || {}
    const key = Object.keys(shortcuts).find(k => k.toLowerCase() === token.toLowerCase())
    return key ? shortcuts[key].toLowerCase() : null
}

function applyFilters(records, address, f) {
    const tokenAddr = f.token ? tokenFilterAddress(f.token) : null
    const nativeSym = (CURRENT_CHAIN.nativeSymbol || 'ETH').toLowerCase()
    const fromBlock = f.fromBlock ? Number(f.fromBlock) : null
    const toBlock = f.toBlock ? Number(f.toBlock) : null
    const fromTs = f.fromDate ? Date.parse(f.fromDate + 'T00:00:00Z') / 1000 : null
    const toTs = f.toDate ? Date.parse(f.toDate + 'T23:59:59Z') / 1000 : null

    let out = records.filter(r => {
        if (!f.types.includes(r.type)) return false
        const isIn = r.to === address, isOut = r.from === address
        if (f.direction === 'in' && !isIn) return false
        if (f.direction === 'out' && !isOut) return false
        if (f.counterparty) {
            const other = isOut ? r.to : r.from
            if (!other || !other.includes(f.counterparty)) return false
        }
        if (f.token) {
            if (tokenAddr) {
                if (r.token !== tokenAddr) return false
            } else if (f.token.toLowerCase() === nativeSym) {
                if (r.token) return false
            } else if ((r.symbol || '').toLowerCase() !== f.token.toLowerCase()) {
                return false // exact ASCII match: lookalike (fake) symbols won't match
            }
        }
        if (f.minAmount && r.type !== 'nft' && BigInt(r.valueRaw) < toUnits(f.minAmount, r.decimals)) return false
        if (f.maxAmount && r.type !== 'nft' && BigInt(r.valueRaw) > toUnits(f.maxAmount, r.decimals)) return false
        if (f.status !== 'any' && r.status !== f.status) return false
        if (f.method) {
            const m = f.method.toLowerCase()
            const hit = m.startsWith('0x') ? (r.methodId || '').toLowerCase().startsWith(m) : (r.method || '').toLowerCase().includes(m)
            if (!hit) return false
        }
        if (fromBlock !== null && r.block < fromBlock) return false
        if (toBlock !== null && r.block > toBlock) return false
        if (fromTs !== null && r.time && r.time < fromTs) return false
        if (toTs !== null && r.time && r.time > toTs) return false
        return true
    })
    out.sort((a, b) => f.sort === 'asc' ? (a.block - b.block) || (a.logIndex - b.logIndex) : (b.block - a.block) || (b.logIndex - a.logIndex))
    return out.slice(0, f.limit)
}

// Flag fake tokens (non-ASCII symbols) and address-poisoning lookalikes:
// a counterparty sharing the first 4 and last 4 hex chars with a different counterparty.
function flagSuspicious(records, address) {
    const others = new Set()
    records.forEach(r => { const o = r.from === address ? r.to : r.from; if (o) others.add(o) })
    const sig = a => a.slice(2, 6) + a.slice(-4)
    const bySig = new Map()
    others.forEach(a => bySig.set(sig(a), [...(bySig.get(sig(a)) || []), a]))
    const other = r => r.from === address ? r.to : r.from
    const isFake = r => r.type !== 'normal' && r.type !== 'internal' && isSuspiciousSymbol(r.symbol)
    // Addresses that sent/received fake-symbol tokens are the likely poisoners within a lookalike group.
    const poisoners = new Set(records.filter(isFake).map(other).filter(Boolean))
    records.forEach(r => {
        r.flags = []
        if (isFake(r)) r.flags.push('fake-symbol')
        const o = other(r)
        const group = o ? bySig.get(sig(o)) : null
        if (group && group.length > 1) {
            const groupHasPoisoner = group.some(a => poisoners.has(a))
            if (!groupHasPoisoner || poisoners.has(o)) r.flags.push('lookalike-address')
        }
    })
}

// ---------- Etherscan V2 back-end ----------

let lastEsCall = 0
async function esCall(params, signal) {
    const wait = lastEsCall + 260 - Date.now() // stay under 4 req/s (free tier allows 5)
    if (wait > 0) await sleep(wait)
    lastEsCall = Date.now()
    const url = new URL(ETHERSCAN_API)
    url.searchParams.set('chainid', CURRENT_CHAIN.etherscanChainId)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    url.searchParams.set('apikey', SEARCH.settings.apiKey)
    const res = await fetch(url, { signal })
    const json = await res.json()
    if (json.status === '1') return json.result
    if (/no (transactions|records) found/i.test(json.message) || (Array.isArray(json.result) && json.result.length === 0)) return []
    if (/rate limit/i.test(String(json.result))) { await sleep(1100); return esCall(params, signal) }
    throw new Error(`Etherscan: ${json.message} — ${typeof json.result === 'string' ? json.result : ''}`)
}

async function esBlockByTime(ts, closest, signal) {
    return Number(await esCall({ module: 'block', action: 'getblocknobytime', timestamp: Math.floor(ts), closest }, signal))
}

function esNormalize(type, r) {
    const nativeSym = CURRENT_CHAIN.nativeSymbol || 'ETH'
    const base = {
        type, block: Number(r.blockNumber), time: Number(r.timeStamp), hash: (r.hash || r.transactionHash || '').toLowerCase(),
        from: (r.from || '').toLowerCase(), to: (r.to || r.contractAddress || '').toLowerCase(),
        methodId: r.methodId && r.methodId !== '0x' ? r.methodId : null,
        method: r.functionName ? r.functionName.split('(')[0] : null,
        logIndex: Number(r.logIndex || r.transactionIndex || 0),
    }
    if (type === 'normal' || type === 'internal') {
        return { ...base, valueRaw: r.value || '0', decimals: 18, symbol: nativeSym, token: null, status: r.isError === '1' ? 'failed' : 'success' }
    }
    if (type === 'erc20') {
        return { ...base, to: (r.to || '').toLowerCase(), valueRaw: r.value || '0', decimals: Number(r.tokenDecimal || 0), symbol: r.tokenSymbol, tokenName: r.tokenName, token: r.contractAddress.toLowerCase(), status: 'success' }
    }
    return { ...base, to: (r.to || '').toLowerCase(), valueRaw: r.tokenValue || '1', decimals: 0, symbol: r.tokenSymbol, tokenName: r.tokenName, token: r.contractAddress.toLowerCase(), tokenId: r.tokenID, status: 'success' }
}

async function searchEtherscan(address, f, progress, signal) {
    let startblock = f.fromBlock || 0
    let endblock = f.toBlock || 999999999999
    if (f.fromDate) startblock = Math.max(Number(startblock), await esBlockByTime(Date.parse(f.fromDate + 'T00:00:00Z') / 1000, 'after', signal))
    if (f.toDate) endblock = Math.min(Number(endblock), await esBlockByTime(Math.min(Date.now() / 1000 - 1, Date.parse(f.toDate + 'T23:59:59Z') / 1000), 'before', signal))

    const tokenAddr = f.token ? tokenFilterAddress(f.token) : null
    const jobs = []
    if (f.types.includes('normal')) jobs.push(['normal', 'txlist'])
    if (f.types.includes('internal')) jobs.push(['internal', 'txlistinternal'])
    if (f.types.includes('erc20')) jobs.push(['erc20', 'tokentx'])
    if (f.types.includes('nft')) jobs.push(['nft', 'tokennfttx'], ['nft', 'token1155tx'])

    const out = []
    for (const [type, action] of jobs) {
        const pageSize = Math.min(1000, f.limit)
        for (let page = 1; page * pageSize <= 10000; page++) {
            progress(`Etherscan: ${action} page ${page}…`)
            const params = { module: 'account', action, address, startblock, endblock, page, offset: pageSize, sort: f.sort }
            if (tokenAddr && (type === 'erc20' || type === 'nft')) params.contractaddress = tokenAddr
            const rows = await esCall(params, signal)
            out.push(...rows.map(r => esNormalize(type, r)))
            if (rows.length < pageSize || out.filter(r => r.type === type).length >= f.limit * 2) break
        }
    }
    return out
}

// ---------- RPC log-scan back-end (no API key) ----------

const pad32 = a => '0x' + '0'.repeat(24) + a.slice(2).toLowerCase()

async function rpcBlockByTime(ts, head) {
    let lo = 0, hi = head
    while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2)
        const b = await rpcRaw('eth_getBlockByNumber', ['0x' + mid.toString(16), false])
        if (hexToNum(b.timestamp) < ts) lo = mid + 1; else hi = mid
    }
    return lo
}

async function searchRpcLogs(address, f, progress, signal) {
    const head = await web3.eth.getBlockNumber()
    let from = f.fromBlock !== '' ? Number(f.fromBlock) : null
    let to = f.toBlock !== '' ? Number(f.toBlock) : head
    if (f.fromDate) { progress('Finding start block for date…'); from = Math.max(from ?? 0, await rpcBlockByTime(Date.parse(f.fromDate + 'T00:00:00Z') / 1000, head)) }
    if (f.toDate) { progress('Finding end block for date…'); to = Math.min(to, await rpcBlockByTime(Date.parse(f.toDate + 'T23:59:59Z') / 1000, head)) }
    if (from === null) from = Math.max(0, to - DEFAULT_RPC_RANGE)

    const me = pad32(address)
    const filters = [] // [topics] sets; each topic set queried separately
    const wantTokens = f.types.includes('erc20') || f.types.includes('nft')
    if (wantTokens) {
        if (f.direction !== 'in') filters.push([TRANSFER_TOPIC, me])
        if (f.direction !== 'out') filters.push([TRANSFER_TOPIC, null, me])
    }
    if (f.types.includes('nft')) {
        if (f.direction !== 'in') filters.push([TRANSFER_SINGLE_TOPIC, null, me])
        if (f.direction !== 'out') filters.push([TRANSFER_SINGLE_TOPIC, null, null, me])
    }
    if (!filters.length) throw new Error('RPC mode can only find token transfers (ERC-20 / NFT). Enable one of those types, or add an Etherscan API key in ⚙ settings.')

    const tokenAddr = f.token ? tokenFilterAddress(f.token) : null
    let chunk = Math.max(1, Number(SEARCH.settings.chunk) || 100000)
    const ranges = []
    for (let a = from; a <= to; a += chunk) ranges.push([a, Math.min(a + chunk - 1, to)])
    const total = ranges.length * filters.length
    let done = 0
    const logs = []

    async function getLogsRange(a, b, topics) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
        const q = { fromBlock: '0x' + a.toString(16), toBlock: '0x' + b.toString(16), topics }
        if (tokenAddr) q.address = tokenAddr
        for (let attempt = 0; ; attempt++) {
            try {
                return await rpcRaw('eth_getLogs', [q])
            } catch (e) {
                if (/range|limit|too many|exceed|spans|10000 results/i.test(e.message) && b > a) {
                    const mid = Math.floor((a + b) / 2) // split the range in half and retry
                    return [...await getLogsRange(a, mid, topics), ...await getLogsRange(mid + 1, b, topics)]
                }
                if (attempt >= 4) throw e
                await sleep(500 * (attempt + 1))
            }
        }
    }

    const queue = filters.flatMap(t => ranges.map(r => [r, t]))
    async function worker() {
        while (queue.length) {
            const [[a, b], topics] = queue.shift()
            logs.push(...await getLogsRange(a, b, topics))
            done++
            progress(`RPC scan: ${done}/${total} chunks · blocks ${from.toLocaleString('en-US')}–${to.toLocaleString('en-US')} · ${logs.length} hits`, done / total)
        }
    }
    await Promise.all(Array.from({ length: 4 }, worker))

    // Deduplicate (a self-transfer appears in both the from- and to- queries)
    const seen = new Set()
    const unique = logs.filter(l => { const k = l.transactionHash + ':' + l.logIndex; if (seen.has(k)) return false; seen.add(k); return true })

    const records = []
    for (const l of unique) {
        const isSingle = l.topics[0] === TRANSFER_SINGLE_TOPIC
        const isNft = isSingle || l.topics.length === 4
        if (isNft && !f.types.includes('nft')) continue
        if (!isNft && !f.types.includes('erc20')) continue
        const d = l.data.slice(2)
        records.push({
            type: isNft ? 'nft' : 'erc20',
            block: hexToNum(l.blockNumber), time: null, hash: l.transactionHash.toLowerCase(), logIndex: hexToNum(l.logIndex),
            from: topicToAddress(isSingle ? l.topics[2] : l.topics[1]), to: topicToAddress(isSingle ? l.topics[3] : l.topics[2]),
            token: l.address.toLowerCase(),
            valueRaw: isSingle ? BigInt('0x' + d.slice(64, 128)).toString() : isNft ? '1' : hexToBigInt(l.data).toString(),
            tokenId: isSingle ? BigInt('0x' + d.slice(0, 64)).toString() : isNft ? hexToBigInt(l.topics[3]).toString() : null,
            decimals: 0, symbol: null, status: 'success', methodId: null, method: null,
        })
    }

    // Token metadata + block timestamps (bounded concurrency)
    progress(`Resolving ${new Set(records.map(r => r.token)).size} tokens and ${new Set(records.map(r => r.block)).size} block timestamps…`)
    for (const r of records) {
        const m = await getTokenMeta(r.token)
        r.symbol = m.symbol
        if (r.type === 'erc20') r.decimals = m.decimals
    }
    const blocks = [...new Set(records.map(r => r.block))].slice(0, 500)
    const times = new Map()
    for (let i = 0; i < blocks.length; i += 8) {
        await Promise.all(blocks.slice(i, i + 8).map(async n => {
            const b = await rpcRaw('eth_getBlockByNumber', ['0x' + n.toString(16), false])
            times.set(n, hexToNum(b.timestamp))
        }))
    }
    records.forEach(r => { r.time = times.get(r.block) ?? null })

    // Method filter needs the tx input
    if (f.method) {
        progress('Fetching tx inputs for method filter…')
        const hashes = [...new Set(records.map(r => r.hash))]
        const inputs = new Map()
        for (let i = 0; i < hashes.length; i += 8) {
            await Promise.all(hashes.slice(i, i + 8).map(async h => {
                const tx = await rpcRaw('eth_getTransactionByHash', [h])
                inputs.set(h, tx?.input || '0x')
            }))
        }
        records.forEach(r => { const inp = inputs.get(r.hash); r.methodId = inp && inp.length >= 10 ? inp.slice(0, 10) : null })
    }
    records.scanned = { from, to }
    return records
}

// ---------- rendering ----------

function setStatus(text, fraction = null, isError = false) {
    elem('#searchStatus').innerHTML = text ? `<span class="${isError ? 'err' : ''}">${text}</span>` : ''
    const bar = elem('#searchProgress')
    bar.style.display = fraction === null ? 'none' : 'block'
    if (fraction !== null) bar.firstElementChild.style.width = `${Math.round(fraction * 100)}%`
}

function amountStr(r) {
    if (r.type === 'nft') return `NFT #${(r.tokenId || '').length > 10 ? r.tokenId.slice(0, 8) + '…' : r.tokenId}${r.valueRaw !== '1' ? ' ×' + r.valueRaw : ''}`
    return formatUnits(r.valueRaw, r.decimals)
}

function renderResults(records, address, meta) {
    const section = elem('#resultsSection')
    section.style.display = 'block'
    const groups = new Map()
    records.forEach(r => { if (!groups.has(r.block)) groups.set(r.block, []); groups.get(r.block).push(r) })
    const flagged = records.filter(r => r.flags.length).length

    elem('#resultsSummary').innerHTML = `
        <b>${records.length.toLocaleString('en-US')}</b> matching ${records.length === 1 ? 'transfer/tx' : 'transfers/txs'} in
        <b>${groups.size.toLocaleString('en-US')}</b> ${groups.size === 1 ? 'block' : 'blocks'} for
        <a href="${esc(CURRENT_CHAIN.explorer)}/address/${esc(address)}" target="_blank">${createBlockie(address)} ${esc(address)}</a>
        <span class="muted">· source: ${esc(meta.source)}</span>
        ${flagged ? `<div class="warn-box">⚠ ${flagged} result(s) flagged as suspicious: fake token symbols (lookalike/hidden characters) or lookalike addresses — typical of address-poisoning scams. Never copy an address from transaction history.</div>` : ''}
        ${meta.note ? `<div class="muted small">${meta.note}</div>` : ''}`

    const strip = elem('#resultsScroll')
    strip.innerHTML = ''
    for (const [block, rs] of groups) {
        const cube = document.createElement('div')
        cube.className = 'block result-block' + (rs.some(r => r.flags.length) ? ' result-warn' : '')
        cube.dataset.block = block
        // net amount for the first token in this block
        const t = rs[0]
        const sameToken = rs.filter(r => r.token === t.token && r.type === t.type)
        let net = 0n
        sameToken.forEach(r => { const v = BigInt(r.valueRaw); net += r.to === address ? v : -v })
        const netStr = t.type === 'nft' ? `${sameToken.length} NFT` : `${net >= 0n ? '+' : ''}${formatUnits(net, t.decimals, 4)}`
        const dirs = new Set(rs.map(r => r.to === address ? 'in' : 'out'))
        cube.style.setProperty('--fill-percentage', `${Math.min(100, 20 + rs.length * 20)}%`)
        cube.innerHTML = `
            <div class="progress-bar"></div>
            <div class="block-decoration"></div>
            <div class="block-number">#${block.toLocaleString('en-US')}</div>
            <div class="block-miner-count">${rs.length} <span class="mdi mdi-magnify"></span></div>
            <div class="block-gas ${net < 0n ? 'neg' : 'pos'}" title="${esc(t.symbol || '')}">${esc(netStr)} <small>${esc((t.symbol || '').slice(0, 10))}</small>${rs.some(r => r.flags.length) ? ' ⚠' : ''}</div>
            <div class="block-reward">${t.time ? `<span class="time-ago" data-timestamp="${t.time}">${formatTimeAgo(t.time)}</span>` : ''}</div>
            <div class="block-miner">${[...dirs].map(d => d === 'in' ? '⬇ in' : '⬆ out').join(' · ')}</div>`
        cube.onclick = () => openBlockView(block, { address, txHash: rs.length === 1 ? rs[0].hash : null })
        strip.appendChild(cube)
    }

    elem('#resultsTable').innerHTML = records.length ? `
        <table>
            <thead><tr><th>Time (UTC)</th><th>Block</th><th>Type</th><th>Dir</th><th class="num">Amount</th><th>Token</th><th>Counterparty</th><th>Status</th><th>Method</th><th>Tx</th></tr></thead>
            <tbody>${records.map(r => {
                const isIn = r.to === address
                const other = isIn ? r.from : r.to
                return `<tr class="${r.flags.length ? 'row-warn' : ''}">
                    <td>${r.time ? new Date(r.time * 1000).toISOString().slice(0, 19).replace('T', ' ') : '—'}</td>
                    <td><a href="#" class="open-block" data-block="${r.block}" data-hash="${esc(r.hash)}">${r.block.toLocaleString('en-US')}</a></td>
                    <td>${esc(r.type)}</td>
                    <td class="${isIn ? 'pos' : 'neg'}">${isIn ? 'IN' : 'OUT'}</td>
                    <td class="num">${esc(amountStr(r))}</td>
                    <td title="${esc(r.token || 'native')}${r.tokenName ? ' — ' + esc(r.tokenName) : ''}">${esc(r.symbol || '?')}${r.flags.includes('fake-symbol') ? ' <span class="tag tag-warn">fake symbol?</span>' : ''}</td>
                    <td title="${esc(other)}">${other ? createBlockie(other) + ' ' + esc(other.slice(0, 8) + '…' + other.slice(-6)) : '—'}${r.flags.includes('lookalike-address') ? ' <span class="tag tag-warn">lookalike</span>' : ''}</td>
                    <td>${r.status === 'failed' ? '<span class="tx-status failed">Failed</span>' : '<span class="tx-status success">OK</span>'}</td>
                    <td>${esc(r.method || r.methodId || '')}</td>
                    <td><a href="${esc(CURRENT_CHAIN.explorer)}/tx/${esc(r.hash)}" target="_blank">${esc(r.hash.slice(0, 10))}…</a></td>
                </tr>`
            }).join('')}</tbody>
        </table>` : '<p class="muted">No results. Try widening the filters or the block range.</p>'
    elem('#resultsTable').querySelectorAll('.open-block').forEach(a => a.addEventListener('click', e => {
        e.preventDefault()
        openBlockView(Number(a.dataset.block), { address, txHash: a.dataset.hash })
    }))
}

// Called by blockview.js after a block is shown
function onBlockViewOpened(num) {
    const url = new URL(window.location)
    url.searchParams.set('block', num)
    window.history.replaceState({}, '', url.toString())
}

// ---------- main search flow ----------

async function runSearch(rawQuery, { openBlock = null } = {}) {
    const q = detectQuery(rawQuery)
    if (SEARCH.abort) SEARCH.abort.abort()
    const ctrl = new AbortController()
    SEARCH.abort = ctrl
    elem('#searchCancel').style.display = 'none'

    try {
        await waitForWeb3()
        if (q.kind === 'block') {
            writeUrlState(String(q.value), null)
            setStatus('')
            await openBlockView(q.value, {})
            return
        }
        if (q.kind === 'tx') {
            setStatus('Looking up transaction…')
            const tx = await rpcRaw('eth_getTransactionByHash', [q.value])
            if (!tx) return setStatus('Transaction not found on this chain.', null, true)
            if (!tx.blockNumber) return setStatus('Transaction is pending (not in a block yet).', null, true)
            writeUrlState(q.value, null)
            setStatus(`Transaction is in block #${hexToNum(tx.blockNumber).toLocaleString('en-US')}.`)
            await openBlockView(hexToNum(tx.blockNumber), { txHash: q.value, address: null })
            return
        }
        if (q.kind !== 'address') return setStatus('Enter an address (0x + 40 hex), a tx hash (0x + 64 hex) or a block number.', null, true)

        const f = readFilters()
        writeUrlState(q.value, f)
        SEARCH.address = q.value
        const useEs = SEARCH.settings.source !== 'rpc' && SEARCH.settings.apiKey && CURRENT_CHAIN.etherscanChainId
        elem('#searchCancel').style.display = 'inline-block'
        let records, meta
        if (useEs) {
            records = await searchEtherscan(q.value, f, msg => setStatus(msg), ctrl.signal)
            meta = { source: `Etherscan API (chain ${CURRENT_CHAIN.etherscanChainId})` }
        } else {
            records = await searchRpcLogs(q.value, f, (msg, frac = null) => setStatus(msg, frac), ctrl.signal)
            meta = {
                source: `RPC log scan, blocks ${records.scanned.from.toLocaleString('en-US')}–${records.scanned.to.toLocaleString('en-US')}`,
                note: `RPC mode only sees token transfers (ERC-20/NFT) — native ${esc(CURRENT_CHAIN.nativeSymbol || 'ETH')} sends and plain contract calls are not visible. ` +
                    (CURRENT_CHAIN.etherscanChainId ? 'Add an Etherscan API key in ⚙ settings for full history.' : ''),
            }
        }
        if (ctrl.signal.aborted) return
        const filtered = applyFilters(records, q.value, f)
        flagSuspicious(filtered, q.value)
        SEARCH.results = filtered
        setStatus('')
        elem('#searchCancel').style.display = 'none'
        renderResults(filtered, q.value, meta)
        if (openBlock) {
            await openBlockView(Number(openBlock), { address: q.value })
        } else if (filtered.length) {
            elem('#resultsSection').scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
    } catch (e) {
        elem('#searchCancel').style.display = 'none'
        if (e.name === 'AbortError') return setStatus('Search cancelled.')
        console.error(e)
        setStatus(esc(e.message || String(e)), null, true)
    }
}

function waitForWeb3() {
    return new Promise(resolve => {
        const check = () => (typeof web3 !== 'undefined' && web3) ? resolve() : setTimeout(check, 100)
        check()
    })
}

// ---------- settings modal ----------

function openSettings() {
    elem('#sApiKey').value = SEARCH.settings.apiKey || ''
    elem('#sChunk').value = SEARCH.settings.chunk || 100000
    elem('#sSource').value = SEARCH.settings.source || 'auto'
    elem('#settingsModal').style.display = 'block'
}

function saveSettings() {
    SEARCH.settings = {
        apiKey: elem('#sApiKey').value.trim(),
        chunk: Math.max(1, parseInt(elem('#sChunk').value) || 100000),
        source: elem('#sSource').value,
    }
    savePrefs(SETTINGS_KEY, SEARCH.settings)
    elem('#settingsModal').style.display = 'none'
    updateSourceBadge()
}

function updateSourceBadge() {
    const es = SEARCH.settings.source !== 'rpc' && SEARCH.settings.apiKey && CURRENT_CHAIN.etherscanChainId
    elem('#sourceBadge').textContent = es ? 'Etherscan API' : 'RPC scan (token transfers only)'
    elem('#sourceBadge').className = 'source-badge ' + (es ? 'ok' : 'limited')
}

// ---------- init ----------

function initSearch() {
    const shortcuts = TOKEN_SHORTCUTS[CHAIN_PARAM] || {}
    elem('#tokenShortcuts').innerHTML = Object.keys(shortcuts).map(s => `<button type="button" class="chip-btn" data-token="${esc(s)}">${esc(s)}</button>`).join('')
    elem('#tokenShortcuts').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { elem('#fToken').value = b.dataset.token }))

    elem('#searchForm').addEventListener('submit', e => { e.preventDefault(); runSearch(elem('#searchInput').value) })
    elem('#advancedToggle').addEventListener('click', () => elem('#advancedPanel').classList.toggle('open'))
    elem('#filtersReset').addEventListener('click', () => {
        elem('#advancedPanel').querySelectorAll('input[type=text], input[type=number], input[type=date]').forEach(i => { i.value = '' })
        elem('#fDirection').value = 'any'; elem('#fStatus').value = 'any'; elem('#fSort').value = 'desc'; elem('#fLimit').value = '1000'
        elems('#searchTypes input').forEach(i => { i.checked = true })
    })
    elem('#searchCancel').addEventListener('click', () => SEARCH.abort?.abort())
    elem('#settingsBtn').addEventListener('click', openSettings)
    elem('#sSave').addEventListener('click', saveSettings)
    elem('#sCancel').addEventListener('click', () => { elem('#settingsModal').style.display = 'none' })
    elem('#settingsModal').addEventListener('click', e => { if (e.target.id === 'settingsModal') e.target.style.display = 'none' })
    elem('#resultsListToggle').addEventListener('click', () => elem('#resultsTable').classList.toggle('open'))
    // horizontal wheel scrolling for the results strip
    elem('#resultsContainer').addEventListener('wheel', e => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.currentTarget.scrollLeft += e.deltaY; e.preventDefault() }
    }, { passive: false })
    updateSourceBadge()

    const { q, block } = readUrlState()
    if (q) {
        elem('#searchInput').value = q
        runSearch(q, { openBlock: block })
    } else if (block) {
        waitForWeb3().then(() => openBlockView(Number(block), {}))
    }
}

initSearch()
