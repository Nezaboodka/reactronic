// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { undef, F } from '../util/Utils'
import { Dbg, misuse } from '../util/Dbg'
import { Record, Member, Handle, Observable, Meta } from './Data'
import { Snapshot, Hints, NIL } from './Snapshot'
import { Options, Kind, Reentrance, Sensitivity } from '../Options'
import { Monitor } from '../Monitor'
import { Cache } from '../Cache'
import { LoggingOptions, ProfilingOptions } from '../Logging'

// Stateful

export abstract class Stateful {
  constructor() {
    const proto = new.target.prototype
    const blank = Meta.from<any>(proto, Meta.Blank)
    const h = Hooks.createHandle(this, blank, new.target.name)
    if (!Hooks.triggersAutoStartDisabled) {
      const triggers = Meta.from<any>(proto, Meta.Triggers)
      for (const member in triggers)
        (h.proxy[member][Meta.Method] as Cache<any>).invalidate()
    }
    return h.proxy
  }

  /* istanbul ignore next */
  [Symbol.toStringTag](): string {
    const h = Meta.get<Handle>(this, Meta.Handle)
    return Hints.obj(h)
  }
}

export function options(options: Partial<Options>): F<any> {
  return function(proto: object, prop: PropertyKey, pd: TypedPropertyDescriptor<F<any>>): any {
    return Hooks.decorateMethod(false, options, proto, prop, pd) /* istanbul ignore next */
  }
}

// Options

const DEFAULT_STATELESS_OPTIONS: Options = Object.freeze({
  kind: Kind.Field,
  priority: 0,
  noSideEffects: false,
  sensitiveArgs: false,
  throttling: Number.MAX_SAFE_INTEGER, // never revalidate
  reentrance: Reentrance.PreventWithError,
  monitor: null,
  logging: undefined,
})

export class OptionsImpl implements Options {
  readonly body: Function
  readonly kind: Kind
  readonly priority: number
  readonly noSideEffects: boolean
  readonly sensitiveArgs: boolean
  readonly throttling: number
  readonly reentrance: Reentrance
  readonly monitor: Monitor | null
  readonly logging?: Partial<LoggingOptions>
  static readonly INITIAL = Object.freeze(new OptionsImpl(undef, {body: undef, ...DEFAULT_STATELESS_OPTIONS}, {}, false))

  constructor(body: Function | undefined, existing: OptionsImpl, patch: Partial<OptionsImpl>, implicit: boolean) {
    this.body = body !== undefined ? body : existing.body
    this.kind = merge(DEFAULT_STATELESS_OPTIONS.kind, existing.kind, patch.kind, implicit)
    this.priority = merge(DEFAULT_STATELESS_OPTIONS.priority, existing.priority, patch.priority, implicit)
    this.noSideEffects = merge(DEFAULT_STATELESS_OPTIONS.noSideEffects, existing.noSideEffects, patch.noSideEffects, implicit)
    this.sensitiveArgs = merge(DEFAULT_STATELESS_OPTIONS.sensitiveArgs, existing.sensitiveArgs, patch.sensitiveArgs, implicit)
    this.throttling = merge(DEFAULT_STATELESS_OPTIONS.throttling, existing.throttling, patch.throttling, implicit)
    this.reentrance = merge(DEFAULT_STATELESS_OPTIONS.reentrance, existing.reentrance, patch.reentrance, implicit)
    this.monitor = merge(DEFAULT_STATELESS_OPTIONS.monitor, existing.monitor, patch.monitor, implicit)
    this.logging = merge(DEFAULT_STATELESS_OPTIONS.logging, existing.logging, patch.logging, implicit)
    if (Dbg.isOn)
      Object.freeze(this)
  }
}

function merge<T>(def: T | undefined, existing: T, patch: T | undefined, implicit: boolean): T {
  return patch !== undefined && (existing === def || !implicit) ? patch : existing
}

// Hooks

export class Hooks implements ProxyHandler<Handle> {
  static triggersAutoStartDisabled: boolean = false
  static repetitiveReadWarningThreshold: number = Number.MAX_SAFE_INTEGER // disabled
  static mainThreadBlockingWarningThreshold: number = Number.MAX_SAFE_INTEGER // disabled
  static asyncActionDurationWarningThreshold: number = Number.MAX_SAFE_INTEGER // disabled
  static sensitivity: Sensitivity = Sensitivity.TriggerOnFinalDifferenceOnly
  static readonly proxy: Hooks = new Hooks()

  getPrototypeOf(h: Handle): object | null {
    return Reflect.getPrototypeOf(h.stateless)
  }

  get(h: Handle, m: Member, receiver: any): any {
    let result: any
    const r: Record = Snapshot.reader().readable(h)
    result = r.data[m]
    if (result instanceof Observable && result.isField) {
      Snapshot.markViewed(r, m, result, Kind.Field, false)
      result = result.value
    }
    else if (m === Meta.Handle) {
      // do nothing, just return instance
    }
    else // result === STATELESS
      result = Reflect.get(h.stateless, m, receiver)
    return result
  }

  set(h: Handle, m: Member, value: any, receiver: any): boolean {
    const r: Record = Snapshot.writer().writable(h, m, value)
    if (r !== NIL) {
      const curr = r.data[m] as Observable
      if (curr !== undefined || (
        r.prev.record.snapshot === NIL.snapshot && m in h.stateless === false)) {
        const prev = r.prev.record.data[m] as Observable
        let changed = prev === undefined || prev.value !== value ||
          Hooks.sensitivity === Sensitivity.TriggerEvenOnSameValueAssignment
        if (changed) {
          if (prev === curr)
            r.data[m] = new Observable(value)
          else
            curr.value = value
        }
        else if (prev !== curr) { // if there was an assignment before
          if (Hooks.sensitivity === Sensitivity.TriggerOnFinalDifferenceOnly)
            r.data[m] = prev // restore previous value
          else
            changed = true // Sensitivity.TriggerOnFinalAndIntermediateDifference
        }
        Snapshot.markChanged(r, m, value, changed)
      }
      else
        Reflect.set(h.stateless, m, value, receiver)
    }
    else if (m in Object.getPrototypeOf(h.stateless))
      Reflect.set(h.stateless, m, value, receiver)
    else
      h.stateless[m] = value
    return true
  }

  has(h: Handle, m: Member): boolean {
    const r: Record = Snapshot.reader().readable(h)
    return m in r.data || m in h.stateless
  }

  getOwnPropertyDescriptor(h: Handle, m: Member): PropertyDescriptor | undefined {
    const r: Record = Snapshot.reader().readable(h)
    const pd = Reflect.getOwnPropertyDescriptor(r.data, m) ??
      Reflect.getOwnPropertyDescriptor(h.stateless, m)
    if (pd)
      pd.configurable = pd.writable = true
    return pd
  }

  ownKeys(h: Handle): Member[] {
    // TODO: Better implementation to avoid filtering
    const r: Record = Snapshot.reader().readable(h)
    const result = []
    for (const m of Object.getOwnPropertyNames(h.stateless)) {
      const value = h.stateless[m]
      if (!Meta.get(value, Meta.Method))
        result.push(m)
    }
    for (const m of Object.getOwnPropertyNames(r.data)) {
      const value = r.data[m]
      if (!(value instanceof Observable) || value.isField)
        result.push(m)
    }
    return result
  }

  static decorateField(stateful: boolean, proto: any, m: Member): any {
    if (stateful) {
      const get = function(this: any): any {
        const h = Hooks.acquireHandle(this)
        return Hooks.proxy.get(h, m, this)
      }
      const set = function(this: any, value: any): boolean {
        const h = Hooks.acquireHandle(this)
        return Hooks.proxy.set(h, m, value, this)
      }
      const enumerable = true
      const configurable = false
      return Object.defineProperty(proto, m, { get, set, enumerable, configurable })
    }
    else
      Meta.acquire(proto, Meta.Stateless)[m] = Meta.Stateless
  }

  static decorateMethod(implicit: boolean, options: Partial<Options>, proto: any, method: Member, pd: TypedPropertyDescriptor<F<any>>): any {
    const enumerable: boolean = pd ? pd.enumerable === true : /* istanbul ignore next */ true
    const configurable: boolean = true
    // Setup method trap
    const opts = Hooks.applyOptions(proto, method, pd.value, true, configurable, options, implicit)
    const trap = function(this: any): any {
      const h = Hooks.acquireHandle(this)
      const value = Hooks.createMethodTrap(h, method, opts)
      Object.defineProperty(h.stateless, method, { value, enumerable, configurable })
      return value
    }
    return Object.defineProperty(proto, method, { get: trap, enumerable, configurable })
  }

  static acquireHandle(obj: any): Handle {
    let h = obj[Meta.Handle]
    if (!h) {
      if (obj !== Object(obj) || Array.isArray(obj)) /* istanbul ignore next */
        throw misuse('only objects can be reactive')
      const blank = Meta.from<any>(Object.getPrototypeOf(obj), Meta.Blank)
      const initial = new Record(NIL.snapshot, NIL, {...blank})
      Meta.set(initial.data, Meta.Handle, h)
      if (Dbg.isOn)
        Snapshot.freezeRecord(initial)
      h = new Handle(obj, obj, Hooks.proxy, initial, obj.constructor.name)
      Meta.set(obj, Meta.Handle, h)
    }
    return h
  }

  static createHandle(stateless: any, blank: any, hint: string): Handle {
    const ctx = Snapshot.writer()
    const h = new Handle(stateless, undefined, Hooks.proxy, NIL, hint)
    ctx.writable(h, Meta.Handle, blank)
    return h
  }

  static setProfilingMode(enabled: boolean, options?: Partial<ProfilingOptions>): void {
    if (enabled) {
      Hooks.repetitiveReadWarningThreshold = options && options.repetitiveReadWarningThreshold !== undefined ? options.repetitiveReadWarningThreshold : 10
      Hooks.mainThreadBlockingWarningThreshold = options && options.mainThreadBlockingWarningThreshold !== undefined ? options.mainThreadBlockingWarningThreshold : 16.6
      Hooks.asyncActionDurationWarningThreshold = options && options.asyncActionDurationWarningThreshold !== undefined ? options.asyncActionDurationWarningThreshold : 150
      Snapshot.garbageCollectionSummaryInterval = options && options.garbageCollectionSummaryInterval !== undefined ? options.garbageCollectionSummaryInterval : 100
    }
    else {
      Hooks.repetitiveReadWarningThreshold = Number.MAX_SAFE_INTEGER
      Hooks.mainThreadBlockingWarningThreshold = Number.MAX_SAFE_INTEGER
      Hooks.asyncActionDurationWarningThreshold = Number.MAX_SAFE_INTEGER
      Snapshot.garbageCollectionSummaryInterval = Number.MAX_SAFE_INTEGER
    }
  }

  static sensitive<T>(sensitivity: Sensitivity, func: F<T>, ...args: any[]): T {
    const restore = Hooks.sensitivity
    Hooks.sensitivity = sensitivity
    try {
      return func(...args)
    }
    finally {
      Hooks.sensitivity = restore
    }
  }

  static setHint<T>(obj: T, hint: string | undefined): T {
    if (hint) {
      const h = Hooks.acquireHandle(obj)
      h.hint = hint
    }
    return obj
  }

  /* istanbul ignore next */
  static createMethodTrap = function(h: Handle, m: Member, options: OptionsImpl): F<any> {
    throw misuse('createMethodTrap should never be called')
  }

  /* istanbul ignore next */
  static applyOptions = function(proto: any, m: Member, body: Function | undefined, enumerable: boolean, configurable: boolean, options: Partial<Options>, implicit: boolean): OptionsImpl {
    throw misuse('alterBlank should never be called')
  }
}
