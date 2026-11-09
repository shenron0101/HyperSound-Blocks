import { describe, test, expect } from 'bun:test'
import { Trie } from '@ethereumjs/trie'
import { RLP } from '@ethereumjs/rlp'
import { bytes, hex, hash, indexKey, skeleton, expandNode, commitNode, verifyProof, encodeTransaction, encodeReceipt, EMPTY_ROOT } from '../trie/core.js'

describe('canonical indexed trie and lazy expansion', () => {
    test('index keys use RLP, including index zero and byte boundaries', () => {
        expect([0, 1, 127, 128, 256].map(indexKey)).toEqual(['80', '01', '7f', '8180', '820100'])
    })
    test('only creates immediate children when explicitly expanded', () => {
        const root = skeleton(Array.from({ length: 300 }, (_, index) => ({ key: indexKey(index), index })))
        expect(root.children).toBeUndefined()
        expandNode(root)
        expect(root.children.length).toBeLessThanOrEqual(16)
        expect(root.children.every(c => !c.children)).toBe(true)
    })
    for (const count of [0, 1, 2, 18, 130]) {
        test(`root matches independent EthereumJS trie with ${count} leaves`, async () => {
            const trie = new Trie()
            const entries = Array.from({ length: count }, (_, index) => ({ key: indexKey(index), index, value: bytes(index % 2 ? '0x123456' : '0x' + 'ab'.repeat(60)) }))
            for (const e of entries) await trie.put(bytes('0x' + e.key), e.value)
            const root = skeleton(entries)
            expect(hex(commitNode(root))).toBe(hex(trie.root()))
        })
    }
    test('incomplete trie cannot produce a verified root', () => {
        expect(() => commitNode(skeleton([{ key: '80', index: 0 }]))).toThrow('not loaded')
        expect(EMPTY_ROOT).toBe('0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421')
    })
})

describe('proof verification', () => {
    test('verifies inclusion, exclusion and rejects corrupt and incomplete paths', async () => {
        const trie = new Trie()
        for (const key of ['1234', '1235', 'aabb']) await trie.put(bytes('0x' + key), bytes('0x' + 'ab'.repeat(40)))
        const root = hex(trie.root())
        const proof = (await trie.createProof(bytes('0x1234'))).map(hex)
        expect(hex(verifyProof(root, '1234', proof).value)).toBe('0x' + 'ab'.repeat(40))
        const exclusion = (await trie.createProof(bytes('0x1236'))).map(hex)
        expect(verifyProof(root, '1236', exclusion).value).toBeNull()
        expect(() => verifyProof('0x' + 'ff'.repeat(32), '1234', proof)).toThrow()
        expect(() => verifyProof(root, '1234', proof.slice(0, 1))).toThrow()
        const altered = proof.map((p, i) => i === proof.length - 1 ? p.slice(0, -2) + '00' : p)
        expect(() => verifyProof(root, '1234', altered)).toThrow()
    })
    test('recognizes an empty trie exclusion', () => {
        expect(verifyProof(EMPTY_ROOT, '1234', []).value).toBeNull()
    })
})

describe('consensus payloads', () => {
    test('Nitro internal transaction matches a real block transaction hash', () => {
        const tx = { type: '0x6a', chainId: '0xa4b1', input: '0x6bf6a42d' + '0'.repeat(64) + '192772c'.padStart(64, '0') + '1f267544'.padStart(64, '0') + '0'.repeat(64) }
        expect(hash(encodeTransaction(tx))).toBe('0xbe3ce77a74d61a9d606a86d8869b48644ff4426258da757e408b30e49baafae6')
    })
    test('does not silently encode missing fields or unknown transaction types', () => {
        expect(() => encodeTransaction({ type: '0x2' })).toThrow()
        expect(() => encodeTransaction({ type: '0x7e' })).toThrow('Unsupported')
    })
    test('receipt excludes RPC-only fields and preserves typed envelope', () => {
        const r = { type: '0x6a', status: '0x1', cumulativeGasUsed: '0x0', logsBloom: '0x' + '00'.repeat(256), logs: [], gasUsedForL1: '0x123' }
        expect(hex(encodeReceipt(r))).toBe('0x6a' + hex(RLP.encode([1, 0, bytes(r.logsBloom), []])).slice(2))
    })
})
