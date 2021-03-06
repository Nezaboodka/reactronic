// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2021 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Dbg } from '../util/Dbg'
import { Meta } from './Meta'
export { Meta } from './Meta'

// AbstractSnapshot

export interface AbstractSnapshot {
  readonly id: number
  readonly hint: string
  readonly timestamp: number
  readonly sealed: boolean
}

// Observable & Observer

export class Observable {
  value: any
  observers?: Set<Observer>
  get isOperation(): boolean { return false }
  constructor(value: any) { this.value = value }
}

export interface Observer {
  readonly priority: number
  readonly observables: Map<Observable, MemberInfo> | undefined
  readonly obsoleteSince: number
  hint(nop?: boolean): string
  markObsoleteDueTo(observable: Observable, cause: MemberInfo, since: number, reactions: Observer[]): void
  runIfNotUpToDate(now: boolean, nothrow: boolean): void
}

export type MemberName = PropertyKey

export interface MemberInfo {
  readonly revision: ObjectRevision
  readonly memberName: MemberName
  readonly usageCount: number
}

// ObjectRevision

export class ObjectRevision {
  readonly snapshot: AbstractSnapshot
  readonly prev: { revision: ObjectRevision }
  readonly data: any
  readonly changes: Map<MemberName, Observer>
  readonly conflicts: Map<MemberName, ObjectRevision>

  constructor(snapshot: AbstractSnapshot, prev: ObjectRevision | undefined, data: object) {
    this.snapshot = snapshot
    this.prev = { revision: prev || this } // undefined prev means initialization of  ROOT_REV
    this.data = data
    this.changes = new Map<MemberName, Observer>()
    this.conflicts = new Map<MemberName, ObjectRevision>()
    if (Dbg.isOn)
      Object.freeze(this)
  }
}

// ObjectHolder

export class ObjectHolder {
  private static generator: number = 19

  readonly id: number
  readonly unobservable: any
  readonly proxy: any
  head: ObjectRevision
  editing?: ObjectRevision
  editors: number
  hint: string

  constructor(unobservable: any, proxy: any, handler: ProxyHandler<ObjectHolder>, head: ObjectRevision, hint: string) {
    this.id = ++ObjectHolder.generator
    this.unobservable = unobservable
    this.proxy = proxy || new Proxy<ObjectHolder>(this, handler)
    this.head = head
    this.editing = undefined
    this.editors = 0
    this.hint = hint
  }

  static getHint(obj: object, full: boolean): string | undefined {
    const h = Meta.get<ObjectHolder>(obj, Meta.Holder)
    return h ? (full ? `${h.hint}#${h.id}` : h.hint) : /* istanbul ignore next */ undefined
  }
}

// Patch

export interface Patch {
  hint: string
  objects: Map<object, ObjectPatch>
}

export interface ObjectPatch {
  current: any
  former: any
}

// DataRequest

export interface DataRequest {
  holder: ObjectHolder
  member: MemberName
  revision: ObjectRevision
}
