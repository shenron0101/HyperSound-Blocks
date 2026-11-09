// Optional integration check; not part of the offline unit suite.
import { RpcClient, loadLeaf, mapLimit } from '../trie/rpc.js'
import { bytes, hex, hash, indexKey, skeleton, commitNode, verifyProof, decodeAccount, RLP, quantity } from '../trie/core.js'

const rpc = new RpcClient([process.env.TRIE_RPC || 'https://arb1.arbitrum.io/rpc'])
const block = await rpc.call('eth_getBlockByNumber', [process.env.TRIE_BLOCK || 'latest', false])
console.log(`Arbitrum block ${Number(block.number)} · ${block.hash} · ${block.transactions.length} leaves`)
for (const type of ['transactions', 'receipts']) {
    const entries = block.transactions.map((_, index) => ({ key: indexKey(index), index }))
    await mapLimit(entries, 4, async entry => Object.assign(entry, await loadLeaf(rpc, block, type, entry.index)))
    const computed = hex(commitNode(skeleton(entries)))
    if (computed !== block[type + 'Root']) throw new Error(`${type} root mismatch: ${computed} != ${block[type + 'Root']}`)
    console.log(`✓ ${type} root matches header: ${computed}`)
}
const address = '0x0000000000000000000000000000000000000064'
const proof = await rpc.call('eth_getProof', [address, ['0x0'], block.number])
const account = verifyProof(block.stateRoot, hash(bytes(address)).slice(2), proof.accountProof)
const decoded = decodeAccount(account.value)
if (decoded.storageRoot !== proof.storageHash) throw new Error('Account storage root mismatch')
console.log(`✓ account proof verified · ${proof.accountProof.length} nodes`)
const slot = proof.storageProof[0]
const result = verifyProof(decoded.storageRoot, hash(bytes('0x' + '00'.repeat(32))).slice(2), slot.proof)
const value = result.value ? RLP.decode(result.value) : null
if ((value?.length ? quantity(hex(value)) : 0n) !== quantity(slot.value)) throw new Error('Storage value mismatch')
console.log(`✓ storage slot proof verified · ${slot.proof.length} nodes · value ${slot.value}`)
console.log(`${rpc.requests} RPC requests · ${rpc.hits} cache hits`)
