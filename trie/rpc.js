import { bytes, hash, encodeTransaction, encodeReceipt } from './core.js'

export class RpcClient {
    constructor(urls, fetcher = fetch, onRequest = () => {}) {
        this.urls = [...new Set(urls)]
        this.fetcher = fetcher.bind(globalThis)
        this.onRequest = onRequest
        this.cache = new Map()
        this.pending = new Map()
        this.requests = 0
        this.hits = 0
    }

    call(method, params, signal) {
        const key = JSON.stringify([method, params])
        if (this.cache.has(key)) { this.hits++; return Promise.resolve(this.cache.get(key)) }
        if (this.pending.has(key)) return this.pending.get(key)
        const promise = this.request(method, params, signal).then(result => {
            // Null results (pruned/not yet available) are deliberately retryable.
            if (result !== null && result !== undefined) this.cache.set(key, result)
            return result
        }).finally(() => this.pending.delete(key))
        this.pending.set(key, promise)
        return promise
    }

    async request(method, params, signal) {
        let lastError
        for (const url of this.urls) {
            signal?.throwIfAborted()
            try {
                this.requests++
                this.onRequest(this)
                const timeout = AbortSignal.timeout(15000)
                const response = await this.fetcher(url, {
                    method: 'POST', headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ jsonrpc: '2.0', id: this.requests, method, params }),
                    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
                })
                if (!response.ok) throw new Error(`RPC returned HTTP ${response.status}`)
                const body = await response.json()
                if (body.error) throw new Error(body.error.message || 'RPC request failed')
                if (!('result' in body)) throw new Error('Invalid RPC response')
                return body.result
            } catch (error) { lastError = error }
        }
        signal?.throwIfAborted()
        throw new Error(`${method}: ${lastError?.message || 'No RPC configured'}`)
    }
}

function checkLocation(object, block, index) {
    if (!object || object.blockHash?.toLowerCase() !== block.hash.toLowerCase() || Number(object.transactionIndex) !== index || object.transactionHash && object.transactionHash.toLowerCase() !== block.transactions[index].toLowerCase()) {
        throw new Error('Payload does not belong to the selected block/index. Retry with another RPC.')
    }
}

export async function loadLeaf(rpc, block, type, index, signal) {
    const txHash = block.transactions[index]
    if (type === 'receipts') {
        const receipt = await rpc.call('eth_getTransactionReceipt', [txHash], signal)
        checkLocation(receipt, block, index)
        if (receipt.type == null) {
            const tx = await rpc.call('eth_getTransactionByHash', [txHash], signal)
            checkLocation(tx, block, index)
            receipt.type = tx.type
        }
        return { value: encodeReceipt(receipt), decoded: receipt }
    }
    const tx = await rpc.call('eth_getTransactionByHash', [txHash], signal)
    checkLocation(tx, block, index)
    if (tx.hash?.toLowerCase() !== txHash.toLowerCase()) throw new Error('Transaction hash does not match the block')
    let value
    try {
        value = encodeTransaction(tx)
        if (hash(value) !== txHash.toLowerCase()) throw new Error('Reconstructed transaction hash mismatch')
    } catch (encodingError) {
        try {
            const raw = await rpc.call('eth_getRawTransactionByHash', [txHash], signal)
            value = bytes(raw)
            if (hash(value) !== txHash.toLowerCase()) throw new Error('Raw transaction hash mismatch')
        } catch (rawError) {
            throw new Error(`${encodingError.message}. Canonical raw bytes also unavailable: ${rawError.message}`)
        }
    }
    return { value, decoded: tx }
}

export async function mapLimit(items, limit, callback, signal) {
    let cursor = 0
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            signal?.throwIfAborted()
            const index = cursor++
            await callback(items[index], index)
        }
    }))
}
