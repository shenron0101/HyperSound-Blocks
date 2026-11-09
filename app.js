const MULTICALL_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11'

const urlParams = new URLSearchParams(window.location.search)
const VERSION = urlParams.get('v')
const CHAIN_PARAM = urlParams.get('chain')?.toUpperCase() || 'ARBITRUM'

let web3
let ETH_PRICE, UPDATE_INTERVAL, ETH_PRICE_INTERVAL
let LAST_ETH_BLOCK = null
let LAST_LOADED_BLOCK = null
let LAST_LOADED_BLOCK_TIME = null
let OLDEST_LOADED_BLOCK = null

const CHAINS = {
    ETHER: {
        etherscanChainId: 1,
        name: 'Ethereum',
        icon: 'https://icons.llamao.fi/icons/chains/rsz_ethereum.jpg',
        blockTime: 12,
        animationSpeed: '1s',
        explorer: 'https://etherscan.io',
        maxChangeRate: BigInt(1250), // 12.5%
        rpc: [
            // Working ones first (2026-11-09): publicnode + drpc serve eth_getBlockReceipts and eth_getProof.
            'https://ethereum-rpc.publicnode.com',
            'https://eth.drpc.org',
            'https://ethereum.publicnode.com',
            'https://eth.llamarpc.com'
        ]
    },
    ARBITRUM: {
         etherscanChainId: 42161,
         name: 'Arbitrum',
         icon: 'https://icons.llamao.fi/icons/chains/rsz_arbitrum.jpg',
         blockTime: 0.25,
         animationSpeed: '0.1s',
         explorer: 'https://arbiscan.io',
         maxChangeRate: BigInt(800), // 8%
         rpc: [
             'https://arb1.arbitrum.io/rpc',
             'https://arbitrum-one.public.blastapi.io',
             'https://arbitrum.llamarpc.com',
             'https://arbitrum.blockpi.network/v1/rpc/public'
         ]
     },
     BASE: {
         etherscanChainId: 8453,
         name: 'Base',
         icon: 'https://icons.llamao.fi/icons/chains/rsz_base.jpg',
         blockTime: 2,
         animationSpeed: '0.5s',
         explorer: 'https://basescan.org',
         maxChangeRate: BigInt(200), // 2%
         rpc: [
             'https://mainnet.base.org',
             'https://base.llamarpc.com',
             'https://base.blockpi.network/v1/rpc/public',
             'https://base.meowrpc.com'
         ]
     },
    OPTIMISM: {
        etherscanChainId: 10,
        name: 'Optimism',
        icon: 'https://icons.llamao.fi/icons/chains/rsz_optimism.jpg',
        blockTime: 2,
        animationSpeed: '0.5s',
        explorer: 'https://optimistic.etherscan.io',
        maxChangeRate: BigInt(200), // 2%
        rpc: [
            'https://mainnet.optimism.io',
            'https://optimism.llamarpc.com',
            'https://optimism.blockpi.network/v1/rpc/public',
            'https://optimism.meowrpc.com'
        ]
    },
    BLAST: {
        etherscanChainId: 81457,
        name: 'Blast',
        icon: 'https://icons.llamao.fi/icons/chains/rsz_blast.jpg',
        blockTime: 2,
        animationSpeed: '0.5s',
        explorer: 'https://blastscan.io',
        maxChangeRate: BigInt(200), // 2%
        rpc: [
            'https://rpc.blast.io',
            'https://rpc.ankr.com/blast',
            'https://blast.din.dev/rpc',
            'https://blastl2-mainnet.public.blastapi.io',
            'https://blast.blockpi.network/v1/rpc/public'
        ]
    },
    POLYGON: {
        etherscanChainId: 137,
        name: 'Polygon',
        icon: 'https://icons.llamao.fi/icons/chains/rsz_polygon.jpg',
        blockTime: 2,
        animationSpeed: '0.5s',
        explorer: 'https://polygonscan.com',
        maxChangeRate: BigInt(200), // 2%
        rpc: [
            'https://polygon-rpc.com',
            'https://polygon.llamarpc.com',
            'https://polygon.drpc.org'
        ]
    },
    POLYGON_ZKEVM: {
        etherscanChainId: 1101,
        name: 'Polygon zkEVM',
        icon: 'https://icons.llamao.fi/icons/chains/rsz_polygon-zkevm.jpg',
        blockTime: 2,
        animationSpeed: '0.5s',
        explorer: 'https://zkevm.polygonscan.com',
        maxChangeRate: BigInt(200), // 2%
        rpc: [
            'https://zkevm-rpc.com',
            'https://polygon-zkevm.drpc.org',
            'https://1rpc.io/polygon/zkevm'
        ]
    },
    ZKSYNC: {
        etherscanChainId: 324,
        name: 'zkSync Era',
        icon: 'https://icons.llamao.fi/icons/chains/rsz_zksync%20era.jpg',
        blockTime: 1,
        animationSpeed: '0.25s',
        explorer: 'https://explorer.zksync.io',
        maxChangeRate: BigInt(200), // 2%
        rpc: [
            'https://mainnet.era.zksync.io',
            'https://zksync.meowrpc.com',
            'https://zksync.drpc.org'
        ]
    },
    SCROLL: {
        etherscanChainId: 534352,
        name: 'Scroll',
        icon: 'https://icons.llamao.fi/icons/chains/rsz_scroll.jpg',
        blockTime: 3,
        animationSpeed: '0.5s',
        explorer: 'https://scrollscan.com',
        maxChangeRate: BigInt(200), // 2%
        rpc: [
            'https://rpc.scroll.io',
            'https://scroll.drpc.org',
            'https://scroll-mainnet.public.blastapi.io'
        ]
    },
    TAIKO: {
        etherscanChainId: 167000,
        name: 'Taiko',
        icon: 'https://icons.llamao.fi/icons/chains/rsz_taiko.jpg',
        blockTime: 20,
        animationSpeed: '0.5s',
        explorer: 'https://explorer.katla.taiko.xyz',
        maxChangeRate: BigInt(200), // 2%
        rpc: [
            'https://rpc.mainnet.taiko.xyz',
            'https://taiko-rpc.publicnode.com',
            'https://rpc.ankr.com/taiko',
            'https://taiko-mainnet.gateway.tenderly.co',
            'https://taiko.drpc.org'
        ]
    },
    BOB: {
        name: 'Bob',
        icon: 'https://icons.llamao.fi/icons/chains/rsz_bob.jpg',
        blockTime: 3,
        animationSpeed: '1s',
        explorer: 'https://bobscan.io',
        maxChangeRate: BigInt(2000), // 20%
        rpc: [
            'https://rpc.gobob.xyz',
            'https://bob.gateway.tenderly.co',
            'https://bob.drpc.org'
        ]
    },
    ZIRCUIT: {
        name: 'Zircuit',
        icon: 'https://icons.llamao.fi/icons/chains/rsz_zircuit.jpg',
        blockTime: 2,
        animationSpeed: '0.5s',
        explorer: 'https://explorer.zircuit.com/',
        maxChangeRate: BigInt(200), // 2%
        rpc: [
            'https://zircuit1-mainnet.liquify.com',
            'https://zircuit-mainnet.drpc.org',
            'https://node.histori.xyz/zircuit-mainnet/8ry9f6t9dct1se2hlagxnd9n2a'
        ]
    },
    LINEA: {
        etherscanChainId: 59144,
        name: 'Linea',
        icon: 'https://icons.llamao.fi/icons/chains/rsz_linea.jpg',
        blockTime: 2,
        animationSpeed: '0.5s',
        explorer: 'https://lineascan.build',
        maxChangeRate: BigInt(200), // 2%
        rpc: [
            'https://rpc.linea.build',
            'https://linea.drpc.org',
            'https://1rpc.io/linea'
        ]
    },
    BSC: {
        etherscanChainId: 56,
        name: 'BSC',
        icon: 'https://icons.llamao.fi/icons/chains/rsz_bsc.jpg',
        blockTime: 3,
        animationSpeed: '0.5s',
        explorer: 'https://bscscan.com',
        maxChangeRate: BigInt(2000), // 20%
        rpc: [
            'https://bscrpc.com',
            'https://binance.llamarpc.com',
            'https://bsc-pokt.nodies.app'
        ]
    },
    MANTA: {
        name: 'Manta',
        icon: 'https://icons.llamao.fi/icons/chains/rsz_manta.jpg',
        blockTime: 10,
        animationSpeed: '0.5s',
        explorer: 'https://pacific-explorer.manta.network',
        maxChangeRate: BigInt(200), // 2%
        rpc: [
            'https://pacific-rpc.manta.network/http',
            'https://manta-pacific.drpc.org'
        ]
    },
/*     STARKNET: {
        name: 'StarkNet',
        icon: 'https://icons.llamao.fi/icons/chains/rsz_starknet.jpg',
        blockTime: 1,
        animationSpeed: '0.25s',
        explorer: 'https://starkscan.co',
        maxChangeRate: BigInt(200), // 2%
        rpc: [
            'https://free-rpc.nethermind.io/mainnet-juno',
            'https://rpc.starknet.lava.build:443'
        ]
    }, */
    MODE: {
        name: 'Mode',
        icon: 'https://icons.llamao.fi/icons/chains/rsz_mode.jpg',
        blockTime: 2,
        animationSpeed: '0.5s',
        explorer: 'https://explorer.mode.network',
        maxChangeRate: BigInt(2000), // 20%
        rpc: [
            'https://mainnet.mode.network',
            'https://1rpc.io/mode'
        ]
    },
    LISK: {
        name: 'Lisk',
        icon: 'https://icons.llamao.fi/icons/chains/rsz_lisk.jpg',
        blockTime: 2,
        animationSpeed: '0.5s',
        explorer: 'https://blockscout.lisk.com/',
        maxChangeRate: BigInt(2000), // 20%
        rpc: [
            'https://lisk.gateway.tenderly.co',
            'https://lisk.drpc.org',
            'https://rpc.api.lisk.com'
        ]
    },
    AVAX: {
        etherscanChainId: 43114,
        name: 'Avalanche',
        icon: 'https://icons.llamao.fi/icons/chains/rsz_avalanche.jpg',
        blockTime: 3,
        animationSpeed: '0.5s',
        explorer: 'https://snowtrace.io/',
        maxChangeRate: BigInt(2000), // 20%
        rpc: [
            'https://rpc.ankr.com/avalanche'
        ]
    },
    ZORA: {
        name: 'Zora',
        icon: 'https://icons.llamao.fi/icons/chains/rsz_zora.jpg',
        blockTime: 2,
        animationSpeed: '0.5s',
        explorer: 'https://explorer.zora.energy',
        maxChangeRate: BigInt(2000), // 20%
        rpc: [
            'https://rpc.zora.energy',
            'https://zora.drpc.org',
            'https://node.histori.xyz/zora-mainnet/8ry9f6t9dct1se2hlagxnd9n2a',
        ]
    },
    FANTOM: {
        etherscanChainId: 250,
        name: 'Fantom',
        icon: 'https://icons.llamao.fi/icons/chains/rsz_fantom.jpg',
        blockTime: 1,
        animationSpeed: '0.5s',
        explorer: 'https://ftmscan.com',
        maxChangeRate: BigInt(2000), // 20%
        rpc: [
            'https://rpcapi.fantom.network',
            'https://rpc.ftm.tools',
            'https://rpc.ankr.com/fantom'
        ]
    },
    CORE: {
        name: 'Core',
        icon: 'https://icons.llamao.fi/icons/chains/rsz_core.jpg',
        blockTime: 3,
        animationSpeed: '1s',
        explorer: 'https://scan.coredao.org/',
        maxChangeRate: BigInt(2000), // 20%
        rpc: [
            'https://rpc.coredao.org',
            'https://core.drpc.org',
            'https://rpc.ankr.com/core'
        ]
    },
    CRONOS: {
        etherscanChainId: 25,
        name: 'Cronos',
        icon: 'https://icons.llamao.fi/icons/chains/rsz_cronos.jpg',
        blockTime: 3,
        animationSpeed: '1s',
        explorer: 'https://cronoscan.com',
        maxChangeRate: BigInt(2000), // 20%
        rpc: [
            'https://evm.cronos.org',
            'https://rpc.ankr.com/cronos',
            'https://cronos.drpc.org',
            'https://cronos.blockpi.network/v1/rpc/private'
        ]
    },
    BITLAYER: {
        name: 'BitLayer',
        icon: 'https://icons.llamao.fi/icons/chains/rsz_bitlayer.jpg',
        blockTime: 3,
        animationSpeed: '1s',
        explorer: 'https://explorer.bitlayer.io',
        maxChangeRate: BigInt(2000), // 20%
        rpc: [
            'https://rpc.bitlayer.io',
            'https://rpc.bitlayer-rpc.com',
            'https://rpc.ankr.com/bitlayer'
        ]
    },
    GNOSIS: {
        etherscanChainId: 100,
        name: 'Gnosis',
        icon: 'https://icons.llamao.fi/icons/chains/rsz_gnosis.jpg',
        blockTime: 5,
        animationSpeed: '1s',
        explorer: 'https://gnosisscan.io',
        maxChangeRate: BigInt(2000), // 20%
        rpc: [
            'https://rpc.gnosischain.com',
            'https://1rpc.io/gnosis',
            'https://rpc.ankr.com/gnosis'
        ]
    },
    ROOTSTOCK: {
        name: 'Rootstock',
        icon: 'https://icons.llamao.fi/icons/chains/rsz_rootstock.jpg',
        blockTime: 30,
        animationSpeed: '1s',
        explorer: 'https://explorer.rsk.co',
        maxChangeRate: BigInt(2000), // 20%
        rpc: [
            'https://public-node.rsk.co',
            'https://rootstock-mainnet.public.blastapi.io',
            'https://rootstock.drpc.org',
            'https://mycrypto.rsk.co'
        ]
    },
    APECHAIN: {
        etherscanChainId: 33139,
        name: 'ApeChain',
        icon: 'https://icons.llamao.fi/icons/chains/rsz_apechain.jpg',
        blockTime: 1,
        animationSpeed: '0.5s',
        explorer: 'https://explorer.apechain.network/',
        maxChangeRate: BigInt(2000), // 20%
        rpc: [
            'https://rpc.apechain.com',
            'https://apechain.drpc.org',
            'https://node.histori.xyz/apechain-mainnet/8ry9f6t9dct1se2hlagxnd9n2a'
        ]
    },
    REYA: {
        name: 'Reya',
        icon: 'https://icons.llamao.fi/icons/chains/rsz_reya.jpg',
        blockTime: 2,
        animationSpeed: '0.5s',
        explorer: 'https://explorer.reya.network/',
        maxChangeRate: BigInt(2000), // 20%
        rpc: [
            'https://rpc.reya.network'
        ]
    },
    FUSE: {
        name: 'Fuse',
        icon: 'https://icons.llamao.fi/icons/chains/rsz_fuse.jpg',
        blockTime: 5,
        animationSpeed: '1s',
        explorer: 'https://explorer.fuse.io/',
        maxChangeRate: BigInt(2000), // 20%
        rpc: [
            'https://rpc.fuse.io',
            'https://fuse.drpc.org',
            'hhttps://fuse.liquify.com'
        ]
    }
}

let CURRENT_CHAIN = CHAINS[CHAIN_PARAM] || CHAINS.ARBITRUM
document.documentElement.style.setProperty('--animation-speed', CURRENT_CHAIN.animationSpeed)

function updatePageTitles() {
    // Update the page title (shown in browser tab)
    document.title = `${CURRENT_CHAIN.name} Block Explorer`
    
    // Update the h1 title if it exists
    const h1 = document.querySelector('h1')
    if (h1) {
        h1.textContent = `${CURRENT_CHAIN.name} Block Explorer`
    }

    // Update the etherscan logo link
    const etherscanLink = document.querySelector('#etherscan-link')
    if (etherscanLink) {
        etherscanLink.href = CURRENT_CHAIN.explorer
        etherscanLink.title = `Open ${CURRENT_CHAIN.name} Explorer`
    }
}

async function findWorkingRPC() {
    for (const rpc of CURRENT_CHAIN.rpc) {
        try {
            const web3Test = new Web3(rpc)
            await web3Test.eth.getBlockNumber()
            console.log(`Using RPC: ${rpc}`)
            return rpc
        } catch (error) {
            console.warn(`RPC ${rpc} failed, trying next...`)
            continue
        }
    }
    throw new Error('No working RPC endpoint found')
}

// Price Functions
async function updateEthPrice() {
    try {
        // Try CoinGecko first
        const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd')
        const data = await response.json()
        if (data?.ethereum?.usd) {
            ETH_PRICE = data.ethereum.usd
        } else {
            throw new Error('Invalid CoinGecko response')
        }
    } catch (error) {
        console.warn('CoinGecko API failed, falling back to CryptoCompare:', error)
        try {
            // Fallback to CryptoCompare
            const response = await fetch('https://min-api.cryptocompare.com/data/price?fsym=ETH&tsyms=USD')
            const data = await response.json()
            if (data?.USD) {
                ETH_PRICE = data.USD
            } else {
                throw new Error('Invalid CryptoCompare response')
            }
        } catch (fallbackError) {
            console.error('Both price APIs failed:', fallbackError)
            ETH_PRICE = null
        }
    }
}

function formatTimeUntil(hours) {
    const days = Math.floor(hours / 24)
    const remainingHours = hours % 24
    const minutes = Math.floor((remainingHours % 1) * 60)

    let result = ''
    if (days > 0) result += `${days}d `
    if (remainingHours > 0) result += `${Math.floor(remainingHours)}h `
    if (minutes > 0) result += `${minutes}m`
    
    return result.trim() || '0m'
}

function formatSeconds(seconds) {
    if (!seconds) return 'Unknown'
    if (seconds < 300) {
        return `${seconds}s`
    } else if (seconds < 7200) {
        return `${Math.floor(seconds / 60)} minutes`
    } else if (seconds < 86400) {
        return `${Math.floor(seconds / 3600)} hours`
    } else {
        return `${Math.floor(seconds / 86400)} days`
    }
}

let loadedBlocks = new Set()

async function loadBlock(blockNumber) {
    if (loadedBlocks.has(blockNumber)) return
    
    const block = await web3.eth.getBlock(blockNumber)
    try {
        loadedBlocks.add(block.number)
        if (LAST_LOADED_BLOCK_TIME === null || block.number > LAST_LOADED_BLOCK) {
            LAST_LOADED_BLOCK_TIME = block.timestamp
            LAST_LOADED_BLOCK = block.number
        }
        if (OLDEST_LOADED_BLOCK === null || block.number < OLDEST_LOADED_BLOCK) {
            OLDEST_LOADED_BLOCK = block.number
        }

        const blockElement = createBlockElement(block)
        await insertBlockIntoDOM(blockElement, block.number)
        return block
    } catch (error) {
        console.error(`Error loading block ${block.number}:`, error)
        return null
    }
}

async function insertBlockIntoDOM(blockElement, blockNumber) {
    const blocksScroll = elem('#blocksScroll')
    const existingBlocks = Array.from(blocksScroll.children)
    if (isNewBlock(blockNumber, existingBlocks)) {
        insertNewBlock(blockElement, existingBlocks, blocksScroll)
    } else {
        insertHistoricalBlock(blockElement, existingBlocks, blocksScroll)
    }
}

function isNewBlock(blockNumber, existingBlocks) {
    return existingBlocks.length > 1 && 
        blockNumber > parseInt(existingBlocks[1].querySelector('.block-number').textContent.slice(1))
}

function insertNewBlock(blockElement, existingBlocks, blocksScroll) {
    // Reset any existing animations
    existingBlocks.forEach(block => {
        block.classList.remove('slide-in')
        block.classList.remove('fade-in')
        void(block.offsetWidth); // Trigger CSS reflow
    })
    
    // Add new block with animations
    blockElement.classList.add('fade-in')
    blocksScroll.insertBefore(blockElement, existingBlocks[1])
    
    // Animate existing blocks
    existingBlocks.slice(1).forEach(block => {
        block.classList.add('slide-in')
    })
}

function insertHistoricalBlock(blockElement, existingBlocks, blocksScroll) {
    const insertIndex = findInsertPosition(blockElement, existingBlocks)
    
    if (insertIndex > 0) {
        blocksScroll.insertBefore(blockElement, existingBlocks[insertIndex])
    } else {
        blocksScroll.appendChild(blockElement)
    }
}

function findInsertPosition(blockElement, existingBlocks) {
    return existingBlocks.findIndex(block => {
        const existingBlockNumber = parseInt(block.querySelector('.block-number').textContent.slice(1))
        const newBlockNumber = parseInt(blockElement.querySelector('.block-number').textContent.slice(1))
        return newBlockNumber > existingBlockNumber
    })
}

function createBlockie(address, size = 8, scale = 2, isIcon = false) {
    if (address === 'pending' || address === 'unknown' || typeof address === 'undefined') {
        return ''
    }
    
    const canvas = blockies.create({
        seed: address.toLowerCase(),
        size: size,
        scale: scale
    })
    
    if (isIcon) {
        // Return a div that uses the blockie as background with MDI icon mask
        return `<span class="blockie-icon mdi mdi-party-popper" style="background-image: url('${canvas.toDataURL()}');"></span>`
    }
    
    return `<img src="${canvas.toDataURL()}" class="blockie-img" style="width: ${size * scale}px; height: ${size * scale}px;" />`
}

function formatAddress(address) {
    if (!address) return 'Contract Creation'
    if (address === 'pending') return 'Pending...'
    
    // We respect the privacy of our users, so please only add addresses that have been PUBLICLY associated with it's owner.
    const knownAddresses = {
        '0x0000000000000000000000000000000000000000': 'Zero Address',
        '0x95222290DD7278Aa3Ddd389Cc1E1d165CC4BAfe5': 'beaverbuild',
        '0x4838B106FCe9647Bdf1E7877BF73cE8B0BAD5f97': 'Titan Builder',
        '0x7e2a2FA2a064F693f0a55C5639476d913Ff12D05': 'MEV Builder',
        '0x388C818CA8B9251b393131C08a736A67ccB19297': 'Lido',
        '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326': 'rsync-builder.eth',
        '0x4675C7e5BaAFBFFbca748158bEcBA61ef3b0a263': 'Coinbase',
        
    }
    
    return knownAddresses[address] || address.substring(2, 6) + '...' + address.substring(38)
}

// Add this helper function for relative time formatting
function formatTimeAgo(timestamp, showSeconds = true) {
    const seconds = Math.floor((Date.now() / 1000) - timestamp);
    
    if (seconds < CURRENT_CHAIN.blockTime && !showSeconds) {
        return 'just now';
    } else if (seconds < 60) {
        return `${seconds} seconds ago`;
    } else if (seconds < 3600) {
        const minutes = Math.floor(seconds / 60);
        return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
    } else if (seconds < 86400) {
        const hours = Math.floor(seconds / 3600);
        return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
    } else {
        const days = Math.floor(seconds / 86400);
        return `${days} ${days === 1 ? 'day' : 'days'} ago`;
    }
}

function createBlockElement(block) {
    const blockElem = document.createElement('div')
    blockElem.className = 'block'
    blockElem.id = `block-${block.number}`
    blockElem.dataset.block = block.number

    const fillPercentage = Math.min(block.gasUsed / block.gasLimit * 100, 100)
    blockElem.style.setProperty('--fill-percentage', `${fillPercentage}%`)
    
    blockElem.innerHTML = `
        <div class="progress-bar"></div>
        <div class="block-decoration"></div>
        <div class="block-number">#${block.number}</div>
        <div class="block-miner-count">
            ${block.transactions.length}
            <span class="mdi mdi-swap-horizontal"></span>
        </div>
        <div class="block-gas" title="Block miner">
            <i class="mdi mdi-gas-station"></i>
            ${formatGasPrice(block.baseFeePerGas)}
        </div>
        <div class="block-reward" title="Block timestamp: ${block.timestamp}">
            <span class="time-ago" data-timestamp="${block.timestamp}">
                ${formatTimeAgo(block.timestamp, false)}
            </span>
        </div>
        <div class="block-miner" title="Block issuer">
            ${createBlockie(block.miner)} ${formatAddress(block.miner)}
        </div>
    `
    
    blockElem.onclick = () => showBlockDetails(block.number)
    return blockElem
}

function createPendingBlockElement() {
    const block = document.createElement('div')
    block.className = 'block'
    block.id = 'pendingBlock'
    
    block.innerHTML = `
        <div class="progress-bar"></div>
        <div class="block-decoration"></div>
        <div class="block-number">Pending...</div>
        <div class="block-miner-count">
            <span id="pendingBlockMinerCount"> &nbsp; </span>
        </div>
        <div class="block-gas">
            <i class="mdi mdi-gas-station"></i>
            <span id="pendingBlockGas">...</span>
        </div>
        <div class="block-reward" id="pendingBlockWinner">...</div>
        <div class="block-miner">
            Pending...
        </div>
    `
    
    block.onclick = () => showBlockDetails(LAST_ETH_BLOCK + 1)
    return block
}

// Block details are rendered by openBlockView() in blockview.js
function showBlockDetails(blockNumber, opts = {}) {
    return openBlockView(blockNumber, { address: SEARCH?.address || null, ...opts })
}

function formatGasPrice(wei) {
    if (!wei) return '0 wei'
    const gwei = web3.utils.fromWei(wei, 'gwei')
    if (BigInt(wei) < BigInt(1000)) return `${parseInt(wei)} wei`
    if (BigInt(wei) < BigInt(10000000)) return `${parseFloat(gwei).toFixed(5)}`
    if (gwei < 999) return `${parseFloat(gwei).toFixed(2)} gwei`
    return `${parseFloat(gwei).toFixed(0)} gwei`
}

// Initialize
async function init() {
    try {
        if (UPDATE_INTERVAL) clearInterval(UPDATE_INTERVAL)
        if (ETH_PRICE_INTERVAL) clearInterval(ETH_PRICE_INTERVAL)

        updatePageTitles()

        await updateEthPrice()
        
        // Find working RPC
        const rpcUrl = await findWorkingRPC()
        web3 = new Web3(rpcUrl)
        
        const pendingBlock = createPendingBlockElement()
        elem('#blocksScroll').appendChild(pendingBlock)
        
        await checkNewBlock()
        initializeInfiniteScroll()
        
        UPDATE_INTERVAL = setInterval(() => {
            checkNewBlock()
            updateRelativeTimes()
        }, 1000)
        
        ETH_PRICE_INTERVAL = setInterval(updateEthPrice, 60000)

        newBlockLoaderQueue() // async loop to load new blocks
    } catch (error) {
        console.error('Initialization error:', error)
    }
}

function formatNumber(num) {
    num = parseFloat(num)
    if (num >= 1000000) {
        return (num / 1000000).toFixed(0) + 'M'
    } else if (num >= 1000) {
        return (num / 1000).toFixed(0) + 'k'
    }
    return new Intl.NumberFormat('en-US').format(num)
}

function calculateMinedTokens(burnedAmount, totalSupply) {
    let totalMined = burnedAmount + totalSupply
    
    const percentage = (totalMined / INIT_MAX_SUPPLY) * 100

    return {
        amount: totalMined,
        percentage: percentage
    }
}

// Fix the burned tokens calculation
function calculateBurnedTokens(maxSupply) {
    const burnedAmount = INIT_MAX_SUPPLY - maxSupply
    const burnedPercentage = (burnedAmount / INIT_MAX_SUPPLY) * 100
    
    return {
        amount: burnedAmount,
        percentage: burnedPercentage
    }
}

// Remove the load more button from HTML

// Remove the load more button event listener and add scroll detection
function initializeInfiniteScroll() {
    const container = elem('.blocks-container')
    let isDragging = false
    let startX
    let scrollLeft
    let hasMoved = false

    container.addEventListener('mousedown', (e) => {
        isDragging = true
        hasMoved = false
        container.classList.add('dragging')
        startX = e.pageX - container.offsetLeft
        scrollLeft = container.scrollLeft
    })

    container.addEventListener('mousemove', (e) => {
        if (!isDragging) return
        e.preventDefault()
        hasMoved = true
        const x = e.pageX - container.offsetLeft
        const walk = x - startX
        container.scrollLeft = scrollLeft - walk
    })

    // Handle scroll near edges for infinite loading
    container.addEventListener('scroll', debounce(async () => {
        const { scrollLeft, scrollWidth, clientWidth } = container
        if ((scrollWidth - (scrollLeft + clientWidth)) / clientWidth < 0.2) {
            const oldestBlock = Math.min(...Array.from(loadedBlocks))
            for (let i = 1; i <= 10; i++) {
                await sleep(100)
                await loadBlock(oldestBlock - i)
            }
        }
    }, 100))

    // Prevent click events if dragging occurred
    container.addEventListener('click', (e) => {
        if (hasMoved) {
            e.stopPropagation()
            e.preventDefault()
        }
    }, true)

    // Stop dragging
    window.addEventListener('mouseup', () => {
        isDragging = false
        container.classList.remove('dragging')
        // Reset hasMoved after a short delay to allow legitimate clicks
        setTimeout(() => {
            hasMoved = false
        }, 10)
    })

    window.addEventListener('mouseleave', () => {
        isDragging = false
        container.classList.remove('dragging')
    })
}

// Debounce helper
function debounce(func, wait) {
    let timeout
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout)
            func(...args)
        }
        clearTimeout(timeout)
        timeout = setTimeout(later, wait)
    }
}

function getSecondsAgo(timestamp) {
    return Math.floor(Date.now() / 1000) - timestamp
}

function animatePendingBlock(secondsAgo) {
    // Calculate fill percentage (100% at 0s, 0% at 15s for ETH's ~15s block time)
    const fillPercentage = Math.min(100, (secondsAgo / CURRENT_CHAIN.blockTime) * 100)
    document.documentElement.style.setProperty('--fill-percentage', `${fillPercentage}%`)
}

// call this after LAST_LOADED_BLOCK and LAST_ETH_BLOCK initialized
async function newBlockLoaderQueue() {
    while (true) {
        // load 10 blocks on load
        const blocksScroll = elem('#blocksScroll')
        const existingBlocks = Array.from(blocksScroll.children)
        if (existingBlocks.length < 10) {
            const block = await loadBlock(OLDEST_LOADED_BLOCK ? OLDEST_LOADED_BLOCK - 1 : LAST_ETH_BLOCK)
            if (existingBlocks.length === 1) {
                updateAllMetrics(block)
            }
        }

        // load new blocks if any
        if (LAST_LOADED_BLOCK < LAST_ETH_BLOCK) {
            const block = await loadBlock(LAST_LOADED_BLOCK + 1)
            updateAllMetrics(block)
        }

        await sleep(10)
    }
}

async function checkNewBlock() {
    const latestBlock = await web3.eth.getBlockNumber()
    elem('#blockNumber').textContent = latestBlock


    if (LAST_ETH_BLOCK) {
        updateAllMetrics(null)
    }
    LAST_ETH_BLOCK = latestBlock
    if (LAST_LOADED_BLOCK === null) { // load n-10 blocks when first loaded
        LAST_LOADED_BLOCK = latestBlock
    }
}

// Add new function to update metrics for ETH blocks
async function updateAllMetrics(block = null) {
    try {
        if (block !== null) { // if new block is loaded
            // Calculate next block's estimated base fee
            const estimatedBaseFee = calculateNextBaseFee(block)
            if (estimatedBaseFee) {
                const estimatedGasPriceStr = formatGasPrice(estimatedBaseFee?.toString())
                const estimatedGasPrice = web3.utils.fromWei(estimatedBaseFee?.toString(), 'gwei')
                elem('#pendingBlockGas').textContent = estimatedGasPriceStr

                // Update gas metrics
                const gasPriceUsd = (parseFloat(estimatedGasPrice) * ETH_PRICE * 0.000000001 * 21000).toFixed(3)
                elem('#gasPriceUsd').textContent = `$${gasPriceUsd} per transaction`
                elem('#gasPrice').textContent = estimatedGasPriceStr
            } else {
                elem('#pendingBlockGas').textContent = '-'
                elem('#gasPriceUsd').textContent = '-'
                elem('#gasPrice').textContent = '-'
            }

            
            // Updatce block metricsc
            elem('#gasUsed').textContent = formatNumber(block.gasUsed)
            elem('#gasLimit').textContent = formatNumber(block.gasLimit)
            elem('#gasUtilization').textContent = `${((block.gasUsed / block.gasLimit) * 100).toFixed(1)}%`
        }

        // Update pending block info
        const secondsAgo = getSecondsAgo(LAST_LOADED_BLOCK_TIME)
        animatePendingBlock(secondsAgo)
        
        // Update ETH price
        if (ETH_PRICE) {
            elem('#ethPrice').textContent = ETH_PRICE.toFixed(0)
        }
    } catch (error) {
        console.error('Error updating metrics:', error)
    }
}

// Add function to update all relative timestamps
function updateRelativeTimes() {
    elems('.time-ago').forEach(element => {
        const timestamp = element.dataset.timestamp
        if (timestamp) {
            // Check if this element is inside the latest block
            const isLatestBlock = element.closest('.block')?.id === `block-${LAST_ETH_BLOCK}`
            // Show seconds only for the latest block
            element.textContent = formatTimeAgo(timestamp, !isLatestBlock)
        }
    })
}

// Initialize
init()

// Add this to your existing init() function or create a new function
function initializeExternalLinks() {
    const modal = elem('#external-link-modal')
    const urlDisplay = modal.querySelector('.external-url')
    const modalTitle = elem('#modal-title')
    const modalContent = elem('#modal-content')
    let pendingUrl = ''

    // Handle button links
    elems('.button-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault()
            pendingUrl = link.dataset.externalUrl
            
            // Update modal with custom warning messages
            modalTitle.textContent = link.dataset.warningTitle
            modalContent.textContent = link.dataset.warningContent
            urlDisplay.textContent = pendingUrl
            
            modal.style.display = 'block'
        })
    })

    // Continue button
    modal.querySelector('.continue').addEventListener('click', () => {
        window.open(pendingUrl, '_blank')
        modal.style.display = 'none'
    })

    // Cancel button
    modal.querySelector('.cancel').addEventListener('click', () => {
        modal.style.display = 'none'
    })

    // Close modal when clicking outside
    window.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none'
        }
    })
}

// Helper function for sleeping
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

// Add function to calculate next block's base fee
function calculateNextBaseFee(lastBlock) {
    if (CURRENT_CHAIN.name !== 'Ethereum') {
        return null
    }
    const targetGasUsed = BigInt(lastBlock.gasLimit) / BigInt(2)
    const baseFeePerGas = BigInt(lastBlock.baseFeePerGas)
    const gasUsed = BigInt(lastBlock.gasUsed)
    
    if (gasUsed === targetGasUsed) return baseFeePerGas
    
    const gasUsedDelta = gasUsed > targetGasUsed ? 
        gasUsed - targetGasUsed : 
        targetGasUsed - gasUsed
    
    const baseFeeMaxChange = (baseFeePerGas * CURRENT_CHAIN.maxChangeRate) / BigInt(10000)
    const baseFeePerGasDelta = (baseFeeMaxChange * gasUsedDelta) / targetGasUsed
    
    return gasUsed > targetGasUsed ? 
        baseFeePerGas + BigInt(Math.max(Number(baseFeePerGasDelta), 1)) :
        baseFeePerGas - baseFeePerGasDelta
}

// Update the chain selector function
function createChainSelector() {
    const header = document.querySelector('header')
    const selector = document.createElement('div')
    selector.className = 'chain-dropdown'
    
    selector.innerHTML = `
        <div class="chain-selected">
            <img src="${CURRENT_CHAIN.icon}" alt="${CURRENT_CHAIN.name}" />
            <span>${CURRENT_CHAIN.name}</span>
            <i class="mdi mdi-chevron-down"></i>
        </div>
        <div class="chain-dropdown-content">
            <div class="chain-search">
                <input type="text" placeholder="Search chains..." />
                <i class="mdi mdi-magnify"></i>
            </div>
            <div class="chain-options">
                ${Object.entries(CHAINS).map(([key, chain]) => `
                    <div class="chain-option ${CURRENT_CHAIN.name === chain.name ? 'active' : ''}" 
                         data-chain="${key.toLowerCase()}">
                        <img src="${chain.icon}" alt="${chain.name}" />
                        <span>${chain.name}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `
    
    header.appendChild(selector)

    // Add click handlers
    const selected = selector.querySelector('.chain-selected')
    const dropdown = selector.querySelector('.chain-dropdown-content')
    const searchInput = selector.querySelector('input')
    const options = selector.querySelectorAll('.chain-option')

    // Toggle dropdown
    selected.addEventListener('click', () => {
        dropdown.classList.toggle('show')
        searchInput.focus()
    })

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!selector.contains(e.target)) {
            dropdown.classList.remove('show')
        }
    })

    // Search functionality
    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase()
        options.forEach(option => {
            const chainName = option.querySelector('span').textContent.toLowerCase()
            option.style.display = chainName.includes(searchTerm) ? 'flex' : 'none'
        })
    })

    // Chain selection
    options.forEach(option => {
        option.addEventListener('click', () => {
            const chainKey = option.dataset.chain
            // Update URL and reload page
            const newUrl = new URL(window.location)
            newUrl.searchParams.set('chain', chainKey)
            window.location.href = newUrl.toString()
        })
    })
}

// Update the URL when directly accessing a chain
if (CURRENT_CHAIN && !CHAIN_PARAM) {
    const newUrl = new URL(window.location)
    newUrl.searchParams.set('chain', Object.keys(CHAINS).find(key => CHAINS[key] === CURRENT_CHAIN).toLowerCase())
    window.history.replaceState({}, '', newUrl.toString())
}

// Call this in init()
createChainSelector()
