import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = readFileSync(join(root, 'client.js'), 'utf8')

function loadClient() {
  let loaded = null
  const window = {
    __ModuleLoader__: {
      load(entry) {
        loaded = entry
      },
    },
  }
  const React = {
    createElement() {},
    useState() {},
    useEffect() {},
    useCallback() {},
  }
  const context = vm.createContext({
    window,
    URL,
    document: { baseURI: 'http://127.0.0.1/' },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    console,
    setTimeout,
    require(name) {
      if (name === 'react') return React
      throw new Error(`unexpected require: ${name}`)
    },
  })
  vm.runInContext(source, context, { filename: 'client.js' })
  assert.ok(loaded !== null)
  return loaded
}

test('client registers the bundle config page under the package key', () => {
  const loaded = loadClient()
  assert.equal(loaded.id, 'dsh-plugin-sync')
  const module = loaded.factory((name) => {
    if (name === 'react') return { createElement() {}, useState() {}, useEffect() {}, useCallback() {} }
    throw new Error(name)
  })
  assert.deepEqual([...module.inject], ['slots', 'locale'])
  let registration = null
  const dictionaries = []
  const ctx = {
    locale: {
      bind: () => (key) => key,
      register: (ns, value) => {
        dictionaries.push({ ns, value })
        return () => {}
      },
    },
    slots: {
      inject: (name, callback) => {
        assert.equal(name, 'plugins.bundle.config')
        callback()
      },
      register: (options, component) => {
        registration = { options, component }
        return () => {}
      },
    },
    effect: (callback) => callback(),
  }
  module.apply(ctx)
  assert.ok(registration !== null)
  assert.equal(registration.options.name, 'plugins.bundle.config')
  assert.equal(registration.options.key, 'dsh-plugin-sync')
  assert.equal(registration.options.locale, 'dsh-plugin-sync')
  assert.equal(dictionaries.length, 1)
  assert.ok(dictionaries[0].value.zh.manualTitle)
  assert.ok(dictionaries[0].value.zh.tokenHelp)
  assert.equal(dictionaries[0].value.en.tokenHelpOpen, 'Open GitHub token page')
  assert.match(source, /settings\/tokens\/new\?description=DSH%20Plugin%20Sync&scopes=gist/)
  assert.ok(dictionaries[0].value.en.manualTitle)
})
