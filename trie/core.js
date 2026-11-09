import { RLP } from '@ethereumjs/rlp'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

export const hex = b => '0x' + bytesToHex(b)
export function bytes(value) {
    if (value instanceof Uint8Array) return value
    if (!/^0x(?:[0-9a-f]{2})*$/i.test(value)) throw new Error('Expected even-length hex bytes')
    return hexToBytes(value.slice(2))
}
export const hash = b => hex(keccak_256(b))
export const EMPTY_ROOT = hash(RLP.encode(new Uint8Array()))
export const quantity = v => BigInt(v ?? 0)
export const indexKey = index => bytesToHex(RLP.encode(BigInt(index)))
export const jsonBytes = value => Array.isArray(value) ? value.map(jsonBytes) : hex(value)

export function compact(path, leaf) {
    const flag = (leaf ? 2 : 0) + path.length % 2
    return bytes('0x' + flag.toString(16) + (path.length % 2 ? '' : '0') + path)
}

export function uncompact(encoded) {
    const s = bytesToHex(encoded), flag = parseInt(s[0], 16)
    if (!s.length || flag > 3 || (!(flag % 2) && s[1] !== '0')) throw new Error('Invalid compact trie path')
    return { path: s.slice(flag % 2 ? 1 : 2), leaf: flag >= 2 }
}

// Shape uses only keys, not payloads. Descendants are NOT allocated until expansion.
export function skeleton(entries, prefix = '', edge = '') {
    if (!entries.length) return { type: 'empty', prefix, edge, entries, count: 0, hash: EMPTY_ROOT }
    if (entries.length === 1) return { type: 'leaf', prefix, edge, path: entries[0].key.slice(prefix.length), entries, count: 1, index: entries[0].index }
    let length = prefix.length
    while (entries.every(e => e.key.length > length && e.key[length] === entries[0].key[length])) length++
    const path = entries[0].key.slice(prefix.length, length)
    return { type: path ? 'extension' : 'branch', prefix, edge, path, entries, count: entries.length }
}

export function expandNode(node) {
    if (node.children || !['branch', 'extension'].includes(node.type)) return node.children || []
    if (node.type === 'extension') {
        node.children = [skeleton(node.entries, node.prefix + node.path, node.path)]
    } else {
        node.children = []
        for (const digit of '0123456789abcdef') {
            const entries = node.entries.filter(e => e.key[node.prefix.length] === digit)
            if (entries.length) node.children.push(skeleton(entries, node.prefix + digit, digit))
        }
    }
    return node.children
}

function reference(node) {
    const encoded = encodeNode(node)
    return encoded.length < 32 ? RLP.decode(encoded) : bytes(node.hash)
}

export function encodeNode(node) {
    let data
    if (node.type === 'empty') data = new Uint8Array()
    else if (node.type === 'leaf') {
        const value = node.entries[0].value
        if (!value) throw new Error(`Leaf #${node.index} not loaded`)
        data = [compact(node.path, true), value]
    } else if (node.type === 'extension') data = [compact(node.path, false), reference(expandNode(node)[0])]
    else {
        data = Array.from({ length: 17 }, () => new Uint8Array())
        for (const child of expandNode(node)) data[parseInt(child.edge, 16)] = reference(child)
        const terminal = node.entries.find(e => e.key === node.prefix)
        if (terminal) {
            if (!terminal.value) throw new Error('Branch value not loaded')
            data[16] = terminal.value
        }
    }
    const encoded = RLP.encode(data)
    node.hash = hash(encoded)
    node.encoded = hex(encoded)
    return encoded
}

export function commitNode(node) {
    return keccak_256(encodeNode(node))
}

function encodedReference(ref, database) {
    if (Array.isArray(ref)) return RLP.encode(ref)
    if (!ref.length) return null
    if (ref.length !== 32) throw new Error('Invalid trie child reference')
    const encoded = database.get(hex(ref))
    if (!encoded) throw new Error('Incomplete proof: a required node is missing')
    if (hash(encoded) !== hex(ref)) throw new Error('Proof node hash mismatch')
    return encoded
}

// Every traversed reference is checked, including exclusion paths. Unavailable siblings
// remain hashes; a valid path never implies that the entire state was downloaded.
export function verifyProof(root, key, proof) {
    if (!/^[0-9a-f]*$/i.test(key)) throw new Error('Invalid proof key')
    if (root.toLowerCase() === EMPTY_ROOT && proof.length === 0) return { value: null, database: new Map() }
    const database = new Map(proof.map(p => { const b = bytes(p); return [hash(b), b] }))
    let ref = bytes(root), rest = key.toLowerCase()
    for (let depth = 0; depth <= key.length + 1; depth++) {
        const encoded = encodedReference(ref, database)
        if (!encoded) return { value: null, database }
        const node = RLP.decode(encoded)
        if (!Array.isArray(node)) throw new Error('Invalid proof node')
        if (node.length === 17) {
            if (!rest.length) return { value: node[16].length ? node[16] : null, database }
            ref = node[parseInt(rest[0], 16)]
            rest = rest.slice(1)
        } else if (node.length === 2) {
            const { path, leaf } = uncompact(node[0])
            if (!rest.startsWith(path)) return { value: null, database }
            rest = rest.slice(path.length)
            if (leaf) return { value: rest.length ? null : node[1], database }
            if (!path.length) throw new Error('Invalid empty extension')
            ref = node[1]
        } else throw new Error('Invalid proof node arity')
    }
    throw new Error('Proof exceeds key length')
}

export function proofNode(ref, database, prefix = '', edge = '') {
    const id = Array.isArray(ref) ? hash(RLP.encode(ref)) : hex(ref)
    if (!Array.isArray(ref) && !ref.length) return null
    if (id === EMPTY_ROOT) return { type: 'empty', hash: id, prefix, edge, count: 0 }
    if (!Array.isArray(ref) && !database.has(id)) return { type: 'unloaded', hash: id, ref, prefix, edge }
    const encoded = encodedReference(ref, database), data = RLP.decode(encoded)
    if (!Array.isArray(data)) throw new Error('Invalid trie node')
    const base = { hash: hash(encoded), encoded: hex(encoded), prefix, edge, data, ref }
    if (data.length === 17) return { ...base, type: 'branch' }
    if (data.length !== 2) throw new Error('Invalid trie node arity')
    const { path, leaf } = uncompact(data[0])
    return { ...base, type: leaf ? 'leaf' : 'extension', path, value: leaf ? data[1] : undefined }
}

export function expandProofNode(node, database) {
    if (node.type === 'extension') return [proofNode(node.data[1], database, node.prefix + node.path, node.path)].filter(Boolean)
    if (node.type !== 'branch') return []
    return node.data.slice(0, 16).map((ref, i) => proofNode(ref, database, node.prefix + i.toString(16), i.toString(16))).filter(Boolean)
}

export function encodeTransaction(tx) {
    const type = Number(tx.type || 0)
    const required = name => {
        if (tx[name] === undefined || tx[name] === null) throw new Error(`Missing transaction field: ${name}`)
        return tx[name]
    }
    const n = name => quantity(required(name))
    const b = name => bytes(required(name))
    const to = () => bytes(tx.to || '0x')
    const access = () => (tx.accessList || []).map(a => [bytes(a.address), a.storageKeys.map(bytes)])
    const sig = () => [quantity(tx.yParity ?? required('v')), n('r'), n('s')]
    const fee = () => quantity(tx.maxFeePerGas ?? required('gasPrice'))
    let fields
    if (type === 0) fields = [n('nonce'), n('gasPrice'), n('gas'), to(), n('value'), b('input'), n('v'), n('r'), n('s')]
    else if (type === 1) fields = [n('chainId'), n('nonce'), n('gasPrice'), n('gas'), to(), n('value'), b('input'), access(), ...sig()]
    else if ([2, 3, 4].includes(type)) {
        fields = [n('chainId'), n('nonce'), n('maxPriorityFeePerGas'), n('maxFeePerGas'), n('gas'), to(), n('value'), b('input'), access()]
        if (type === 3) fields.push(n('maxFeePerBlobGas'), required('blobVersionedHashes').map(bytes))
        if (type === 4) fields.push(required('authorizationList').map(a => [quantity(a.chainId), bytes(a.address), quantity(a.nonce), quantity(a.yParity ?? a.v), quantity(a.r), quantity(a.s)]))
        fields.push(...sig())
    } else if (type === 100) fields = [n('chainId'), b('requestId'), b('from'), to(), n('value')]
    else if (type === 101) fields = [n('chainId'), b('from'), n('nonce'), fee(), n('gas'), to(), n('value'), b('input')]
    else if (type === 102) fields = [n('chainId'), b('requestId'), b('from'), fee(), n('gas'), to(), n('value'), b('input')]
    else if (type === 104) fields = [n('chainId'), n('nonce'), b('from'), fee(), n('gas'), to(), n('value'), b('input'), b('ticketId'), b('refundTo'), n('maxRefund'), n('submissionFeeRefund')]
    else if (type === 105) fields = [n('chainId'), b('requestId'), b('from'), n('l1BaseFee'), n('depositValue'), fee(), n('gas'), bytes(tx.retryTo || '0x'), n('retryValue'), b('beneficiary'), n('maxSubmissionFee'), b('refundTo'), b('retryData')]
    else if (type === 106) fields = [n('chainId'), b('input')]
    else throw new Error(`Unsupported transaction type ${type}. A canonical raw transaction is required from this RPC.`)
    const encoded = RLP.encode(fields)
    return type === 0 ? encoded : new Uint8Array([type, ...encoded])
}

export function encodeReceipt(r) {
    if (r.cumulativeGasUsed == null || !r.logsBloom || !Array.isArray(r.logs) || (r.status == null && !r.root)) throw new Error('Incomplete receipt')
    const encoded = RLP.encode([
        r.root ? bytes(r.root) : quantity(r.status), quantity(r.cumulativeGasUsed), bytes(r.logsBloom),
        r.logs.map(l => [bytes(l.address), l.topics.map(bytes), bytes(l.data)]),
    ])
    const type = Number(r.type || 0)
    return type ? new Uint8Array([type, ...encoded]) : encoded
}

export function decodeAccount(value) {
    const a = RLP.decode(value)
    if (!Array.isArray(a) || a.length !== 4) throw new Error('Invalid account leaf')
    return { nonce: quantity(hex(a[0]) === '0x' ? 0 : hex(a[0])).toString(), balanceWei: quantity(hex(a[1]) === '0x' ? 0 : hex(a[1])).toString(), storageRoot: hex(a[2]), codeHash: hex(a[3]) }
}

export { RLP }
