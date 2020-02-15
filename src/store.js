import vuex from 'vuex'
import { get } from './helper'

class StoreProxy{
  constructor(path, store, proxyRoot) {
    this.$path = path
    this.$store = store
    if (!proxyRoot) {
      this.$root = this
    } else {
      this.$root = proxyRoot
    }
  }
  get $state() {
    return this.$path.split('.').reduce((s, k) => {
      if (k === 'root') {
        return s
      } else {
        return s[k]
      }
    }, this.$store.state)
  }
  $registerModule(name, rawModule) {
    this.$store.registerModule(name, rawModule)
    const path = this.$path + '.' + name
    const mod = path.split('.').reduce((s, key) => {
      if (!s) {
        return undefined
      }
      const m = s[key] || s._children[key]
      if (m) {
        return m
      }
      return undefined
    }, this.$store._modules)
    this[name] = new StoreProxy(this.$path + '.' + name, this.$store, this.$root)
    proxyModule(this[name], mod, this.$store)
  }
  $unregisterModule(name) {
    this.$store.unregisterModule(name)
    delete this[name]
  }
}

function createStore(data) {
  data.strict = false

  if (data._vm && data._modules) {
    return data
  }
  const store = new vuex.Store(data)
  return store
}

function proxyModule(px, mod, store) {
  // module
  const proxyMod = (modpx, parent) => {
    Object.keys(parent._children).forEach(key => {
      const storeMod = parent._children[key]
      const childrenPx = new StoreProxy(modpx.$path + '.' + key, store, px)
      if (modpx[key]) {
        throw new Error('module key has duplicate key [' + key + ']')
      }
      Object.defineProperty(modpx, key, {
        enumerable: true,
        get() {
          return childrenPx
        },
        set() {
          throw new Error('[vuexp] cannot set module state')
        }
      })
      proxyMod(childrenPx, storeMod)
    })
  }
  proxyMod(px, mod)

  // state
  const proxyState = (modpx, parent) => {
    Object.keys(parent.state).forEach(stateKey => {
      if (modpx[stateKey] instanceof StoreProxy) {
        proxyState(modpx[stateKey], parent._children[stateKey])
      } else {
        Object.defineProperty(modpx, stateKey, {
          enumerable: true,
          get() {
            return modpx.$state[stateKey]
          },
          set(v) {
            modpx.$store._withCommit(() => {
              modpx.$state[stateKey] = v
            })
            modpx.$store._subscribers.forEach(function (sub) { return sub({ type: 'VUEXP_CHANGE_STATE', payload: v}, modpx.$state)})
            return modpx.$state[stateKey]
          }
        })
      }
    })
  }
  proxyState(px, mod)

  // getters
  Object.keys(store.getters).forEach(key => {
    const p = key.split('/')
    const lastIndex = p.length - 1
    p.reduce((modpx, k, i) => {
      if (i < lastIndex) {
        return modpx[k]
      }
      if (i == lastIndex && typeof modpx[k] === 'undefined') {
        Object.defineProperty(modpx, k, {
          enumerable: true,
          get() {
            return store.getters[key]
          },
          set() {
            throw new Error('getters can not set value')
          }
        })
      }
    }, px.$root)
  })

  // actions
  const proxyAction = (modpx, parent) => {
    // parse action
    Object.keys(parent._rawModule.actions || {}).forEach(actionKey => {
      if (modpx[actionKey]) {
        throw new Error('action has duplicate key [' + actionKey + ']')
      } else {
        modpx[actionKey] = function wrapAction(...args) {
          return parent._rawModule.actions[actionKey].call(modpx, ...args)
        }
      }
    })
    // sub modules
    Object.keys(parent._children).forEach(modKey => {
      proxyAction(modpx[modKey], parent._children[modKey])
    })
  }
  proxyAction(px, mod)


  // mutations
  const proxyMutation = (modpx, parent) => {
    // parse mutation
    Object.keys(parent._rawModule.mutations || {}).forEach(mutationKey => {
      if (modpx[mutationKey]) {
        throw new Error('mutation has duplicate key [' + mutationKey + ']')
      } else {
        modpx[mutationKey] = function wrapMutation(...args) {
          return parent._rawModule.mutations[mutationKey].call(modpx, ...args)
        }
      }
    })
    // sub modules
    Object.keys(parent._children).forEach(modKey => {
      proxyMutation(modpx[modKey], parent._children[modKey])
    })
  }
  proxyMutation(px, mod)
}

function createProxy(store) {
  const px = new StoreProxy('root', store)

  proxyModule(px, store._modules.root, store)

  return px
}

export function injectStore(vm) {
  const options = vm.$options

  if (options.store) {
    options.store = createStore(options.store)
    vm.$store = options.store
    vm.$s = createProxy(vm.$store)
  }
  
  if (options.parent && options.parent.$s) {
    vm.$s = options.parent.$s
  }
}