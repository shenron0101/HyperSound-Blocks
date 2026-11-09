import { test, expect } from 'bun:test'
import { RpcClient, loadLeaf } from '../trie/rpc.js'

test('fetch is invoked with the browser global as receiver, not the RPC client', async () => {
    const client = new RpcClient(['https://example.test'], function () {
        if (this !== globalThis) throw new TypeError('Illegal invocation')
        return Promise.resolve(new Response(JSON.stringify({ result: '0x1' })))
    })
    expect(await client.call('eth_chainId', [])).toBe('0x1')
})

test('RPC coalesces requests, caches successes, and retries failures', async () => {
    let calls = 0
    const client = new RpcClient(['https://example.test'], async (_, init) => {
        calls++
        const request = JSON.parse(init.body)
        if (calls === 1) return new Response(JSON.stringify({ error: { message: 'temporary failure' } }))
        return new Response(JSON.stringify({ id: request.id, result: '0x1' }))
    })
    await expect(client.call('eth_test', [])).rejects.toThrow('temporary failure')
    expect(await Promise.all([client.call('eth_test', []), client.call('eth_test', [])])).toEqual(['0x1', '0x1'])
    expect(await client.call('eth_test', [])).toBe('0x1')
    expect(calls).toBe(2)
})

test('loading one receipt does not request the other leaves and rejects a different block', async () => {
    const methods = []
    const block = { hash: '0xabc', transactions: ['0x111', '0x222'] }
    const receipt = { blockHash: '0xabc', transactionHash: '0x222', transactionIndex: '0x1', type: '0x0', status: '0x1', cumulativeGasUsed: '0x100', logsBloom: '0x' + '00'.repeat(256), logs: [] }
    const rpc = { call: async (method, params) => { methods.push([method, params]); return receipt } }
    expect((await loadLeaf(rpc, block, 'receipts', 1)).value.length).toBeGreaterThan(0)
    expect(methods).toEqual([['eth_getTransactionReceipt', ['0x222']]])
    receipt.blockHash = '0xother'
    await expect(loadLeaf(rpc, block, 'receipts', 1)).rejects.toThrow('selected block')
})
