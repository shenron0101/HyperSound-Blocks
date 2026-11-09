// Keep the explorer's network list in sync with the existing dashboard.
const app = await Bun.file(new URL('../app.js', import.meta.url)).text()
const start = app.indexOf('const CHAINS = ') + 'const CHAINS = '.length
const end = app.indexOf('\n}', start) + 2
if (start < 14 || end < start) throw new Error('Cannot locate CHAINS in app.js')
const chains = Function(`return (${app.slice(start, end)})`)()
await Bun.write(new URL('../trie/chains.json', import.meta.url), JSON.stringify(chains, (_, v) => typeof v === 'bigint' ? String(v) : v, 2) + '\n')
const build = await Bun.build({
  entrypoints: [new URL('../trie/explorer.js', import.meta.url).pathname],
  outdir: new URL('../assets', import.meta.url).pathname,
  naming: 'trie-explorer.js', target: 'browser', minify: true,
})
if (!build.success) throw new AggregateError(build.logs, 'Trie bundle failed')
console.log(`Built trie explorer (${build.outputs[0].size.toLocaleString()} bytes)`)
