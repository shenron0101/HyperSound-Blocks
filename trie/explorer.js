import { select, hierarchy, tree, linkVertical, zoom, zoomIdentity } from 'd3'
import chains from './chains.json'
import { bytes, hex, hash, quantity, indexKey, skeleton, expandNode, commitNode, verifyProof, proofNode, expandProofNode, decodeAccount, jsonBytes, RLP, EMPTY_ROOT } from './core.js'
import { RpcClient, loadLeaf, mapLimit } from './rpc.js'

const $ = selector => document.querySelector(selector)
const params = new URLSearchParams(location.search)
const chainKey = (params.get('chain') || 'ARBITRUM').toUpperCase()
const chain = chains[chainKey]
const type = params.get('type') || 'transactions'
const isState = type === 'state' || type === 'storage'
const titles = { transactions: 'Transaction', receipts: 'Receipt', state: 'State', storage: 'Storage' }
const rootFields = { transactions: 'transactionsRoot', receipts: 'receiptsRoot', state: 'stateRoot' }
const expanded = new Set()
const database = new Map()
let rpc, block, root, expectedRoot, entries = [], selected, activeKey = '', verifyController, lookupBusy = false
let currentAccount = null, proofCount = 0, visibleNodes = [], graphTransform = zoomIdentity
let jsonMode = false, viewVersion = 0

// USDC (Circle FiatToken v2.2) keeps balances in mapping slot 9 on these chains; the storage key for
// balances[holder] is keccak256(pad32(holder) ‖ pad32(9)). Checked against balanceOf() on 2026-11-09.
const USDC = { ARBITRUM: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', ETHER: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' }
const USDC_BALANCE_SLOT = 9
const BALANCE_MASK = (1n << 255n) - 1n // v2.2 packs a blacklist flag into the top bit of the balance word
const pad32 = h => h.replace(/^0x/, '').toLowerCase().padStart(64, '0')
const usdcBalanceSlot = holder => hash(bytes('0x' + pad32(holder) + pad32(USDC_BALANCE_SLOT.toString(16))))
const formatUsdc = raw => { const s = raw.toString().padStart(7, '0'); return (s.slice(0, -6) + '.' + s.slice(-6)).replace(/\.?0+$/, '').replace(/^(\d+)$/, '$1') }

const short = text => text && text.length > 22 ? text.slice(0, 12) + '…' + text.slice(-6) : text || 'not loaded'
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c])
const titleCase = s => s.charAt(0).toUpperCase() + s.slice(1)
const idOf = n => n.prefix + ':' + n.type
const onPath = n => !!activeKey && activeKey.startsWith(n.prefix) && n.type !== 'siblings'

function notice(message, error = false) {
    $('#notice').hidden = !message
    $('#notice').textContent = message
    $('#notice').className = error ? 'error' : ''
}

function stats() {
    const loaded = isState ? proofCount : entries.filter(e => e.value).length
    $('#load-count').textContent = isState ? `${loaded} proof${loaded === 1 ? '' : 's'} loaded` : `${loaded} / ${entries.length} payloads loaded`
    $('#request-count').textContent = `${rpc?.requests || 0} RPC requests`
}

function badge(text, state = '') {
    $('#verification').textContent = text
    $('#verification').className = 'badge ' + state
}

function updateVerification() {
    if (isState) return
    if (!entries.every(e => e.value)) { badge('Partial · root not verified'); return }
    const computed = hex(commitNode(root))
    if (computed === expectedRoot) badge('✓ Root matches header', 'verified')
    else {
        badge('Root mismatch', 'failed')
        notice(`Computed root ${computed} does not match the selected block header. These payloads are not verified.`, true)
    }
}

function urlFor(trieType, extra = {}) {
    const url = new URL('trie.html', location.href)
    url.search = new URLSearchParams({ chain: chainKey, block: block.hash, type: trieType, ...extra })
    return url.href
}

function nativeJson(label, value, options = {}) {
    // Native details construct only the next level, and at most 48 items per page.
    const details = document.createElement('details')
    details.className = 'json-entry'
    const summary = document.createElement('summary')
    const isObject = value !== null && typeof value === 'object'
    let preview = ': ' + String(value)
    if (isObject) preview = Array.isArray(value) ? ` [${value.length}]` : ' {…}'
    summary.textContent = label + preview
    details.append(summary)
    if (!isObject) {
        summary.className = 'json-value'
        // Long scalars remain folded until clicked.
        if (String(value).length > 100) {
            summary.textContent = `${label}: ${short(String(value))}`
            details.addEventListener('toggle', () => {
                if (details.open && details.children.length === 1) {
                    const full = document.createElement('code'); full.className = 'json-value'; full.textContent = String(value); details.append(full)
                }
            })
        }
        return details
    }
    details.addEventListener('toggle', () => {
        if (!details.open || details.children.length > 1) return
        const content = document.createElement('div'); content.className = 'json-children'; details.append(content)
        const pairs = Object.entries(value)
        let cursor = 0
        const more = document.createElement('button'); more.type = 'button'; more.textContent = 'Show next 48 entries'
        const page = () => {
            more.remove()
            const end = Math.min(cursor + 48, pairs.length)
            for (; cursor < end; cursor++) content.append(nativeJson(pairs[cursor][0], pairs[cursor][1]))
            if (cursor < pairs.length) content.append(more)
        }
        more.onclick = page; page()
    })
    if (options.open) details.open = true
    return details
}

function childrenOf(node) {
    if (node.type === 'siblings') return node.members
    if (!isState) return expandNode(node)
    const children = expandProofNode(node, database)
    // Proof focus keeps a 16-way state trie readable: siblings are one expandable group.
    if (node.type === 'branch' && activeKey.startsWith(node.prefix) && activeKey.length > node.prefix.length) {
        const next = activeKey[node.prefix.length]
        const siblings = children.filter(c => c.edge !== next)
        const pathChild = children.filter(c => c.edge === next)
        if (siblings.length) pathChild.push({ type: 'siblings', prefix: node.prefix + '~', edge: 'other', members: siblings, count: siblings.length })
        return pathChild
    }
    return children
}

function canExpand(node) { return ['branch', 'extension', 'siblings'].includes(node.type) }

function nodeJson(node) {
    const payload = node.entries?.[0]
    return {
        type: node.type, path: node.prefix + (node.path || ''),
        hash: node.hash || 'Not computed: child payloads are not loaded',
        ...(node.index != null ? { transactionIndex: node.index, transactionHash: block.transactions[node.index] } : {}),
        ...(node.encoded ? { rlp: node.encoded } : {}),
        ...(node.value ? { value: hex(node.value) } : {}),
        ...(node.type === 'leaf' && payload?.decoded ? { payload: payload.decoded } : {}),
    }
}

function jsonNode(node, label = 'root') {
    const el = document.createElement('details'); el.className = 'json-entry'
    const summary = document.createElement('summary'); summary.textContent = `${label}: ${node.type}${node.index != null ? ` · #${node.index}` : ''} ${short(node.hash)}`
    el.append(summary)
    el.addEventListener('toggle', () => {
        if (!el.open || el.children.length > 1) return
        const content = document.createElement('div'); content.className = 'json-children'; el.append(content)
        content.append(nativeJson('node', nodeJson(node)))
        const inspect = document.createElement('button'); inspect.textContent = node.type === 'leaf' && !isState ? 'Load / inspect payload' : 'Inspect node'
        inspect.onclick = () => inspectNode(node); content.append(inspect)
        if (canExpand(node)) for (const child of childrenOf(node)) content.append(jsonNode(child, child.edge))
    })
    return el
}

const svg = select('#trie-svg')
const layer = svg.append('g')
const zoomer = zoom().scaleExtent([0.12, 2.2]).on('zoom', event => {
    graphTransform = event.transform
    layer.attr('transform', graphTransform)
})
svg.call(zoomer).on('dblclick.zoom', null)

function draw(fit = false) {
    if (!root) return
    $('#canvas-empty').hidden = true
    const h = hierarchy(root, n => expanded.has(idOf(n)) && canExpand(n) ? childrenOf(n) : null)
    tree().nodeSize([238, 155])(h)
    visibleNodes = h.descendants()
    const nodes = visibleNodes.slice(0, 240)
    const shown = new Set(nodes)
    if (visibleNodes.length > 240) notice('Showing the first 240 visible nodes. Collapse a branch or trace a specific key to keep the graph readable.')
    layer.selectAll('*').remove()
    const links = h.links().filter(l => shown.has(l.source) && shown.has(l.target))
    layer.selectAll('path').data(links).join('path').attr('class', l => 'trie-link' + (onPath(l.target.data) ? ' on-path' : ''))
        .attr('d', linkVertical().x(d => d.x).y(d => d.y + 45))
    layer.selectAll('.edge-label').data(links).join('text').attr('class', 'edge-label')
        .attr('x', l => (l.source.x + l.target.x) / 2 + 7).attr('y', l => (l.source.y + l.target.y) / 2 + 45)
        .text(l => l.target.data.edge.length > 14 ? short(l.target.data.edge) : l.target.data.edge)
    const groups = layer.selectAll('foreignObject').data(nodes).join('foreignObject')
        .attr('x', d => d.x - 105).attr('y', d => d.y).attr('width', 214).attr('height', 101)
    groups.each(function(d) {
        const n = d.data
        const element = document.createElement('div')
        element.className = `trie-node ${n.type}${selected && idOf(selected) === idOf(n) ? ' selected' : ''}${activeKey && !onPath(n) ? ' dim' : ''}`
        const name = n.type === 'siblings' ? `${n.count} other branches` : (d.depth === 0 ? 'ROOT · ' : '') + n.type.toUpperCase()
        const caption = n.index != null ? `TX #${n.index} · ${short(block.transactions[n.index])}` : n.type === 'unloaded' ? short(n.hash) : n.path ? `path ${n.path}` : short(n.hash || (d.depth === 0 ? expectedRoot : ''))
        const meta = n.type === 'unloaded' ? 'Hash reference · not downloaded' : n.type === 'leaf' ? (n.entries?.[0].value || n.value ? 'Payload loaded · click to inspect' : 'Click to load this payload') : n.type === 'empty' ? 'Empty trie' : expanded.has(idOf(n)) ? 'Expanded · click − to collapse' : n.count ? `${n.count} ${n.type === 'siblings' ? 'hash references' : 'leaves'} · expand to explore` : 'Expand to reveal children'
        element.innerHTML = `<div class="node-top"><button class="node-select">${escape(name)}</button>${canExpand(n) ? `<button class="node-toggle" aria-label="${expanded.has(idOf(n)) ? 'Collapse' : 'Expand'} ${escape(n.type)} ${escape(n.prefix || 'root')}" aria-expanded="${expanded.has(idOf(n))}">${expanded.has(idOf(n)) ? '−' : '+'}</button>` : ''}</div><div class="node-caption">${escape(caption)}</div><div class="node-meta">${escape(meta)}</div>`
        element.querySelector('.node-select').onclick = () => inspectNode(n)
        element.querySelector('.node-toggle')?.addEventListener('click', () => toggleNode(n))
        this.appendChild(element)
    })
    $('#visible-count').textContent = `${nodes.length} node${nodes.length === 1 ? '' : 's'} visible`
    if (jsonMode) { $('#json-tree').replaceChildren(jsonNode(root)); $('#json-tree details').open = true }
    if (fit) fitGraph()
    stats()
}

function fitGraph() {
    if (!visibleNodes.length) return
    const width = $('#graph').clientWidth, height = $('#graph').clientHeight
    const nodes = visibleNodes.slice(0, 240)
    const minX = Math.min(...nodes.map(n => n.x)) - 125, maxX = Math.max(...nodes.map(n => n.x)) + 125
    const maxY = Math.max(...nodes.map(n => n.y)) + 125
    const scale = Math.min(1, (width - 50) / (maxX - minX), (height - 75) / maxY)
    svg.call(zoomer.transform, zoomIdentity.translate(width / 2 - (minX + maxX) / 2 * scale, 40).scale(scale))
}

function toggleNode(node) {
    if (expanded.has(idOf(node))) expanded.delete(idOf(node))
    else expanded.add(idOf(node))
    selected = node
    draw(true); renderInspector(node)
}

async function fetchEntry(entry, signal) {
    if (entry.value) return
    if (entry.pending) return entry.pending
    entry.pending = loadLeaf(rpc, block, type, entry.index, signal).then(result => {
        Object.assign(entry, result)
    }).finally(() => { delete entry.pending; stats() })
    return entry.pending
}

async function inspectNode(node) {
    selected = node
    draw(); renderInspector(node)
    if (node.type !== 'leaf' || isState || node.entries[0].value) return
    const entry = node.entries[0]
    const version = ++viewVersion
    try {
        $('#inspector-load').textContent = 'Loading this payload…'
        await fetchEntry(entry)
        commitNode(node)
        updateVerification()
        draw()
        if (version === viewVersion && selected === node) renderInspector(node)
    } catch (error) {
        notice(error.message, true)
        if (selected === node) renderInspector(node, error.message)
    }
}

function renderInspector(node, error = '') {
    const data = nodeJson(node)
    const explanations = {
        branch: 'A junction with 16 child slots, one for each hexadecimal digit (0–f). Follow the next digit of the key to choose a branch.',
        extension: `A compressed run of ${node.path?.length || 0} hexadecimal digits. This node skips a shared prefix without adding a junction for every digit.`,
        leaf: isState ? 'The end of a verified account or storage path. The leaf carries the value committed to by the root.' : 'The end of an RLP(transactionIndex) path. Its value is the canonical encoded transaction or receipt, not the transaction hash.',
        unloaded: 'This subtree is represented by its real hash. Its contents have not been downloaded. Load a proof for an address or storage slot that passes through it to reveal more.',
        siblings: 'These are real sibling references from the proof. Expand this group to inspect them, or use the parent’s hexadecimal slot grid.',
        empty: 'This is the canonical empty Merkle–Patricia trie. There are no leaves to fetch.',
    }
    const hashText = node.hash || (node === root ? `${expectedRoot} (header commitment; reconstructed root not verified yet)` : 'Not computed — descendants are not all loaded')
    const key = node.prefix + (node.path || '')
    $('#inspector').innerHTML = `<p class="eyebrow">Node inspector ${node.index != null ? '/ #' + node.index : ''}</p><h2>${titleCase(node.type)} node</h2><p class="inspector-intro">${escape(explanations[node.type] || '')}</p><div class="field"><label>${node.hash ? 'Node hash · Keccak-256' : node === root ? 'Expected root from header' : 'Node hash'}</label><code>${escape(hashText)}</code></div><div class="field"><label>Consumed key / hex nibbles</label><div class="path-chips">${key ? [...key].map(c => `<span>${escape(c)}</span>`).join('') : '<code>root · no digits consumed</code>'}</div></div><div id="node-extra"></div><div id="node-data"></div>`
    const extra = $('#node-extra'), container = $('#node-data')
    if (canExpand(node)) {
        const button = document.createElement('button'); button.textContent = expanded.has(idOf(node)) ? '− Collapse children' : '+ Expand children'
        button.onclick = () => toggleNode(node); extra.append(button)
    }
    if (node.type === 'branch') {
        const all = isState ? expandProofNode(node, database) : expandNode(node)
        const slots = document.createElement('div'); slots.className = 'field'; slots.innerHTML = '<label>Hexadecimal child slots</label><div class="slots"></div>'
        for (const digit of '0123456789abcdef') {
            const child = all.find(n => n.edge === digit)
            const button = document.createElement('button'); button.textContent = digit; button.disabled = !child
            button.title = child ? `${digit} → ${child.type}` : `${digit}: empty slot`
            button.onclick = () => { expanded.add(idOf(node)); inspectNode(child) }
            slots.querySelector('.slots').append(button)
        }
        extra.append(slots)
    }
    if (node.type === 'leaf' && !isState) {
        const entry = node.entries[0]
        const status = document.createElement('p'); status.id = 'inspector-load'; status.className = 'inspector-intro'
        status.textContent = entry.value ? `${entry.value.length.toLocaleString()} encoded bytes loaded. ${type === 'transactions' ? 'Transaction hash checked against the block list.' : 'Receipt root verification requires all receipts.'}` : error || 'Select this leaf to fetch its payload.'
        extra.append(status)
        if (!entry.value) {
            const button = document.createElement('button'); button.textContent = 'Load / retry payload'; button.onclick = () => inspectNode(node); extra.append(button)
        } else container.append(nativeJson('Decoded payload', entry.decoded))
    }
    if (node.value && type === 'state') {
        const account = decodeAccount(node.value)
        container.append(nativeJson('Account · decoded', account, { open: true }))
        if (currentAccount && activeKey === key) {
            const link = document.createElement('a'); link.href = urlFor('storage', { address: currentAccount.address }); link.textContent = 'Explore this account’s storage trie ↗'; extra.append(link)
        }
    }
    if (node.value && type === 'storage') {
        const value = RLP.decode(node.value)
        container.append(nativeJson('Storage value', { hex: hex(value), decimal: quantity(value.length ? hex(value) : 0).toString() }, { open: true }))
    }
    container.append(nativeJson('Node JSON', data))
    if (node.encoded) container.append(nativeJson('Raw RLP bytes', node.encoded))
}

function traceKey(key) {
    activeKey = key
    let node = root
    for (let depth = 0; depth < key.length + 2 && canExpand(node); depth++) {
        expanded.add(idOf(node))
        const children = childrenOf(node)
        const next = children.find(c => c.type !== 'siblings' && key.startsWith(c.prefix))
        if (!next) break
        node = next
    }
    selected = node
    draw(true)
    return node
}

async function loadAccount(address, slots = []) {
    if (!/^0x[0-9a-f]{40}$/i.test(address)) throw new Error('Enter a 20-byte account address (0x + 40 hex digits).')
    // Use the selected number, never latest. Verification anchors the returned path
    // to the immutable block's stateRoot, so a reorg/wrong provider is detected.
    const proof = await rpc.call('eth_getProof', [address, slots, block.number])
    if (!proof?.accountProof) throw new Error('This RPC did not return an account proof. Use a proof-capable/archive RPC.')
    const key = hash(bytes(address)).slice(2)
    const verified = verifyProof(block.stateRoot, key, proof.accountProof)
    const account = verified.value ? decodeAccount(verified.value) : null
    if (account && (account.storageRoot !== proof.storageHash?.toLowerCase() || account.codeHash !== proof.codeHash?.toLowerCase() || BigInt(account.nonce) !== quantity(proof.nonce) || BigInt(account.balanceWei) !== quantity(proof.balance))) throw new Error('RPC account fields do not match the verified account leaf')
    return { proof, verified, key, account, address: address.toLowerCase() }
}

function showUsdcLink(address) {
    $('#usdc-link')?.remove()
    const usdc = USDC[chainKey]
    if (!usdc || address.toLowerCase() === usdc) return
    const link = document.createElement('a')
    link.id = 'usdc-link'; link.className = 'usdc-link'
    link.href = urlFor('storage', { address: usdc, slot: usdcBalanceSlot(address), holder: address.toLowerCase() })
    link.textContent = 'View this address’s USDC balance in USDC storage ↗'
    link.title = `Opens the USDC contract's storage trie at balances[${address}] = slot keccak256(address ‖ ${USDC_BALANCE_SLOT})`
    $('#lookup-help').after(link)
}

function mergeDatabase(map) { for (const [key, value] of map) database.set(key, value) }

async function lookup(value) {
    notice('')
    if (!isState) {
        let index
        if (/^0x[0-9a-f]{64}$/i.test(value)) index = block.transactions.findIndex(h => h.toLowerCase() === value.toLowerCase())
        else if (/^\d+$/.test(value)) index = Number(value)
        if (!Number.isSafeInteger(index) || index < 0 || index >= entries.length) throw new Error('Enter an index or transaction hash belonging to this block.')
        await inspectNode(traceKey(entries[index].key))
    } else if (type === 'state') {
        const result = await loadAccount(value)
        mergeDatabase(result.verified.database)
        currentAccount = result
        root = proofNode(bytes(expectedRoot), database)
        proofCount++
        badge(result.account ? '✓ Account proof verified' : '✓ Absence proof verified', 'verified')
        const node = traceKey(result.key)
        renderInspector(node)
        if (!result.account) notice('Verified absence: this address has no account at the selected block. The path ends at an empty slot or a different leaf.')
        const url = new URL(location.href); url.searchParams.set('address', value); history.replaceState(null, '', url)
        showUsdcLink(value)
    } else {
        if (!/^(?:0x[0-9a-f]{1,64}|\d+)$/i.test(value)) throw new Error('Enter a storage slot as a decimal integer or up to 32 hex bytes.')
        const slot = '0x' + BigInt(value).toString(16)
        const result = await loadAccount(currentAccount.address, [slot])
        if (result.account?.storageRoot !== expectedRoot) throw new Error('The account storage root changed or is unavailable')
        const proof = result.proof.storageProof?.[0]
        if (!proof || quantity(proof.key) !== BigInt(value)) throw new Error('RPC returned a proof for a different storage slot')
        const key = hash(bytes('0x' + BigInt(value).toString(16).padStart(64, '0'))).slice(2)
        const verified = verifyProof(expectedRoot, key, proof.proof)
        const decoded = verified.value ? RLP.decode(verified.value) : null
        const actual = decoded?.length ? quantity(hex(decoded)) : 0n
        if (actual !== quantity(proof.value)) throw new Error('Storage value does not match its proof')
        mergeDatabase(verified.database)
        root = proofNode(bytes(expectedRoot), database)
        proofCount++
        badge('✓ Storage proof verified', 'verified')
        renderInspector(traceKey(key))
        const holder = params.get('holder')
        if (holder && currentAccount.address === USDC[chainKey] && value.toLowerCase() === usdcBalanceSlot(holder)) {
            const amount = formatUsdc(actual & BALANCE_MASK)
            notice(verified.value
                ? `Verified: ${holder} holds ${amount} USDC at this block (balances[holder], value ${hex(decoded)}${actual >> 255n ? '; top bit set = USDC blacklist flag, this address is blacklisted' : ''}).`
                : `Verified absence: ${holder} holds 0 USDC at this block. Zero balances are not stored as trie leaves.`)
        } else if (!verified.value) notice('Verified absence: this slot has value zero. Zero storage slots are not stored as trie leaves.')
    }
    stats()
}

async function verifyAll() {
    if (verifyController) return
    verifyController = new AbortController()
    const controller = verifyController
    $('#verify-all').disabled = true; $('#cancel-verify').hidden = false
    notice('Loading all remaining payloads to verify the full root. At most four requests run concurrently. You can cancel without losing loaded data.')
    try {
        await mapLimit(entries.filter(e => !e.value), 4, async entry => {
            await fetchEntry(entry, controller.signal)
            $('#verify-all').textContent = `Verifying ${entries.filter(e => e.value).length} / ${entries.length}`
        }, controller.signal)
        updateVerification()
        if ($('#verification').classList.contains('verified')) notice('All payloads loaded. The reconstructed Merkle–Patricia root exactly matches the block header.')
    } catch (error) {
        controller.abort()
        notice(error.name === 'AbortError' ? 'Verification cancelled. Already loaded payloads are cached; expand any leaf to continue browsing.' : error.message, error.name !== 'AbortError')
    } finally {
        verifyController = null; $('#verify-all').disabled = false; $('#verify-all').textContent = 'Verify full trie'; $('#cancel-verify').hidden = true
        draw(); if (selected) renderInspector(selected)
    }
}

async function initialize() {
    if (!chain || !titles[type]) throw new Error('Unknown chain or trie type. Open a trie from Block anatomy.')
    $('#title').textContent = `${titles[type]} trie`
    $('#network').textContent = chain.name
    $('#dashboard-title').textContent = `${chain.name} Blocks`
    $('#dashboard-title').href = `./?chain=${chainKey}`
    $('#chain-explorer').href = chain.explorer
    document.title = `${titles[type]} trie · ${chain.name} Blocks`
    $('#description').textContent = { transactions: 'Every transaction, in order. Follow its index from the root to its canonical bytes.', receipts: 'Execution, committed. Explore the status, gas and logs sealed into each receipt.', state: 'The world state, one proof at a time. Follow an account’s hashed address into the trie.', storage: 'Inside the account. Explore verified paths to individual contract storage slots.' }[type]
    if (isState) {
        $('#lookup-label').textContent = type === 'storage' ? 'STORAGE SLOT' : 'ACCOUNT ADDRESS'
        $('#lookup-input').placeholder = type === 'storage' ? 'Slot number, e.g. 0 or 0x1' : '0x… account or contract address'
        $('#lookup-submit').innerHTML = 'Load proof <span>↗</span>'
        $('#lookup-help').textContent = type === 'state' ? 'Only the requested account path is fetched. Other subtrees remain real hash references.' : 'Only the selected slot proof is fetched. Storage keys are Keccak-256(slot padded to 32 bytes).'
        $('#verify-all').hidden = true
    }
    let custom = params.get('rpc')
    try { custom ||= sessionStorage.getItem(`trie-rpc:${chainKey}`) } catch { /* storage unavailable */ }
    const urls = custom ? [new URL(custom).href] : chain.rpc
    if (urls.some(url => !/^https?:\/\//.test(url))) throw new Error('RPC must use HTTP or HTTPS')
    rpc = new RpcClient(urls, fetch, stats)
    const chainId = await rpc.call('eth_chainId', [])
    if (Number(chainId) !== chain.etherscanChainId) throw new Error(`Wrong RPC chain: expected ${chain.etherscanChainId}, received ${Number(chainId)}`)
    $('#connection-status').textContent = `Connected to chain ${Number(chainId)}. ${custom ? 'Custom endpoint' : 'Dashboard public endpoints'}. Requests time out after 15 seconds and failed requests can be retried.`
    const selector = params.get('block') || 'latest'
    if (!/^(?:latest|0x[0-9a-f]+|\d+)$/i.test(selector)) throw new Error('Invalid block identifier')
    const isHash = /^0x[0-9a-f]{64}$/i.test(selector)
    block = await rpc.call(isHash ? 'eth_getBlockByHash' : 'eth_getBlockByNumber', [isHash || selector === 'latest' ? selector : '0x' + BigInt(selector).toString(16), false])
    if (!block?.hash || !block.transactions || isHash && block.hash.toLowerCase() !== selector.toLowerCase()) throw new Error('Selected block is not available on this RPC')
    const pinned = new URL(location.href); pinned.searchParams.set('block', block.hash); pinned.searchParams.set('chain', chainKey); pinned.searchParams.set('type', type); pinned.searchParams.delete('rpc'); history.replaceState(null, '', pinned)
    if (custom) { try { sessionStorage.setItem(`trie-rpc:${chainKey}`, custom) } catch { /* optional */ } }
    $('#back').href = `./?${new URLSearchParams({ chain: chainKey, block: Number(block.number), tab: 'anatomy' })}`
    $('#block-label').textContent = `Block #${Number(block.number).toLocaleString('en-US')}`
    $('#trie-tabs').innerHTML = ['transactions', 'receipts', 'state'].map(t => `<a href="${escape(urlFor(t))}" class="${type === t || type === 'storage' && t === 'state' ? 'active' : ''}" ${type === t ? 'aria-current="page"' : ''}>${t === 'state' ? 'State / accounts' : titles[t] + 's'}</a>`).join('')
    expectedRoot = block[rootFields[type]]?.toLowerCase()
    if (type === 'storage') {
        const address = params.get('address')
        if (!address) throw new Error('A storage trie needs an account address. Open it from a verified state leaf.')
        currentAccount = await loadAccount(address)
        if (!currentAccount.account) throw new Error('This account does not exist at the selected block')
        expectedRoot = currentAccount.account.storageRoot
        $('#root-label').textContent = 'VERIFIED ACCOUNT STORAGE ROOT'
        $('#description').textContent += ` Account ${address}.`
        badge('✓ Account anchor verified', 'verified')
        const holder = params.get('holder')
        if (holder && currentAccount.address === USDC[chainKey]) $('#description').textContent += ` Looking up USDC balances[${holder}] at slot keccak256(holder ‖ ${USDC_BALANCE_SLOT}).`
    }
    if (!/^0x[0-9a-f]{64}$/.test(expectedRoot)) throw new Error('The RPC did not return a valid root commitment')
    $('#root-hash').textContent = expectedRoot; $('#copy-root').disabled = false
    if (isState) {
        root = proofNode(bytes(expectedRoot), database)
        if (type === 'state') badge('Select an account to verify')
    } else {
        entries = block.transactions.map((txHash, index) => ({ key: indexKey(index), index, txHash }))
        root = skeleton(entries)
        updateVerification()
        $('#verify-all').disabled = false
    }
    selected = root; draw(true); renderInspector(root)
    if (params.get('address') && type === 'state') { $('#lookup-input').value = params.get('address'); await lookup(params.get('address')) }
    if (params.get('slot') && type === 'storage') { $('#lookup-input').value = params.get('slot'); await lookup(params.get('slot')) }
}

$('#lookup').onsubmit = async event => {
    event.preventDefault()
    if (!root || lookupBusy) return
    lookupBusy = true; $('#lookup-submit').disabled = true
    try { await lookup($('#lookup-input').value.trim()) } catch (error) { notice(error.message, true) }
    finally { lookupBusy = false; $('#lookup-submit').disabled = false }
}
$('#verify-all').onclick = verifyAll
$('#cancel-verify').onclick = () => verifyController?.abort()
$('#fit').onclick = fitGraph
$('#zoom-in').onclick = () => svg.call(zoomer.scaleBy, 1.3)
$('#zoom-out').onclick = () => svg.call(zoomer.scaleBy, 1 / 1.3)
$('#collapse').onclick = () => { expanded.clear(); activeKey = ''; draw(true) }
$('#graph-view').onclick = () => switchView(false)
$('#json-view').onclick = () => switchView(true)
function switchView(json) {
    jsonMode = json
    $('#graph').hidden = json; $('#json-tree').hidden = !json
    $('#graph-view').classList.toggle('active', !json); $('#json-view').classList.toggle('active', json)
    $('#graph-view').setAttribute('aria-pressed', String(!json)); $('#json-view').setAttribute('aria-pressed', String(json))
    draw(!json)
}
$('#copy-root').onclick = async () => {
    try { await navigator.clipboard.writeText(expectedRoot); $('#copy-root').textContent = 'Copied'; setTimeout(() => { $('#copy-root').textContent = 'Copy' }, 1500) }
    catch { notice('Copy is unavailable in this browser. Select and copy the root hash above.') }
}
$('#rpc-form').onsubmit = event => {
    event.preventDefault()
    try {
        const url = new URL($('#rpc-url').value.trim())
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('RPC must use HTTP or HTTPS')
        sessionStorage.setItem(`trie-rpc:${chainKey}`, url.href)
        location.reload()
    } catch (error) { notice(error.message, true) }
}
new ResizeObserver(() => { if (!jsonMode && root) fitGraph() }).observe($('#graph'))
initialize().catch(error => {
    notice(error.message, true)
    $('#canvas-empty').textContent = 'Data unavailable. Check the RPC connection below, then try again.'
    $('#connection-status').textContent = error.message
    $('.connection').open = true
})
