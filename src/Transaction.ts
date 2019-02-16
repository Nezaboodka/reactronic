import { Log, undef, Record, ICache, F, Handle, Snapshot, Hint } from "./internal/z.index";

export class Transaction {
  static active: Transaction;
  private readonly snapshot: Snapshot; // assigned in constructor
  private busy: number = 0;
  private sealed: boolean = false;
  private error: Error | undefined = undefined;
  private resultPromise?: Promise<void> = undefined;
  private resultResolve: (value?: void) => void = undef;
  private resultReject: (reason: any) => void = undef;
  private conflicts?: Record[] = undefined;
  private reaction: { tran?: Transaction, effect: ICache[] } = { tran: undefined, effect: [] };

  constructor(hint: string) {
    this.snapshot = new Snapshot(hint);
  }

  get id(): number { return this.snapshot.id; }

  run<T>(func: F<T>, ...args: any[]): T {
    if (this.sealed && Transaction.active !== this)
      throw new Error("E601: cannot run sealed transaction");
    return this._run(func, ...args);
  }

  // wrap<T>(func: F<T>): F<T> {
  //   return Transaction._wrap<T>(this, Ctx.reaction, true, true, func);
  // }

  commit(): void {
    if (this.busy > 0)
      throw new Error("E602: cannot commit transaction having pending async operations");
    if (this.error)
      throw new Error(`E603: cannot commit discarded transaction: ${this.error}`);
    this.seal(); // commit immediately, because pending === 0
  }

  seal(): Transaction { // t.seal().waitForEnd().then(onfulfilled, onrejected)
    if (!this.sealed)
      this.run(Transaction.seal, this);
    return this;
  }

  discard(error?: Error): Transaction {
    if (!this.error)
      this.error = error || CANCELED;
    if (!this.sealed)
      this.run(Transaction.seal, this);
    return this;
  }

  finished(): boolean {
    return this.sealed && this.busy === 0;
  }

  async whenFinished(includingReactions: boolean): Promise<void> {
    if (!this.finished())
      await this.acquirePromise();
    if (includingReactions && this.reaction.tran)
      await this.reaction.tran.whenFinished(true);
  }

  undo(): void {
    Transaction.runAs<void>(`Tran#${this.snapshot.hint}.undo`, false, () => {
      this.snapshot.changeset.forEach((r: Record, h: Handle) => {
        r.edits.forEach((prop: PropertyKey) => {
          if (r.prev.backup) {
            let prevValue: any = r.prev.backup.data[prop];
            let t: Record | undefined = Snapshot.active().tryGetWritable(h, prop, prevValue);
            if (t)
              t.data[prop] = prevValue;
          }
        });
      });
    });
  }

  static run<T>(func: F<T>, ...args: any[]): T {
    return Transaction.runAs("noname", false, func, ...args);
  }

  static runAs<T>(hint: string, root: boolean, func: F<T>, ...args: any[]): T {
    let t: Transaction = (root || Transaction.active.finished()) ? new Transaction(hint) : Transaction.active;
    root = t !== Transaction.active;
    let result: any;
    try {
      result = t.run<T>(func, ...args);
      if (root) {
        if (result instanceof Promise)
          result = t.whenFinished(false);
        t.seal();
      }
    }
    catch (error) {
      t.discard(error);
      throw error;
    }
    if (t.error && t.error !== CANCELED)
      throw t.error;
    return result;
  }

  // Internal

  private _run<T>(func: F<T>, ...args: any[]): T {
    let outer = Transaction.active;
    let result: T;
    try {
      this.busy++;
      Transaction.active = this;
      Log.color = 31 + (this.snapshot.id) % 6;
      Log.prefix = `t${this.snapshot.id}`;
      result = func(...args);
      if (this.sealed && this.busy === 1 && !this.error)
        this.checkForConflicts();
    }
    catch (e) {
      this.error = this.error || e; // remember first error only
      throw e;
    }
    finally { // it's critical to have no exceptions in this block
      this.busy--;
      if (this.finished()) {
        !this.error ? this.performCommit() : this.performDiscard();
        Object.freeze(this);
      }
      Log.prefix = `t${outer.snapshot.id}`;
      Log.color = 31 + outer.snapshot.id % 6;
      Transaction.active = outer;
    }
    if (this.reaction.effect.length > 0) {
      try {
        Transaction.ensureAllUpToDate(this.snapshot.hint, this.reaction);
      }
      finally {
        if (!this.finished())
          this.reaction.effect = [];
      }
    }
    return result;
  }

  private static seal(t: Transaction): void {
    t.sealed = true;
  }

  private checkForConflicts(): void {
    this.conflicts = this.snapshot.rebase();
    if (this.conflicts)
      this.tryResolveConflicts(this.conflicts);
  }

  private tryResolveConflicts(conflicts: Record[]): void {
    this.error = this.error || new Error(`t${this.snapshot.id}'${this.snapshot.hint} conflicts with other transactions on: ${Hint.conflicts(conflicts)}`);
    // throw this._error;
  }

  private performCommit(): void {
    this.snapshot.checkin();
    Snapshot.applyDependencies(this.snapshot.changeset, this.reaction.effect);
    this.snapshot.archive();
    if (this.resultPromise)
      this.resultResolve();
  }

  private performDiscard(): void {
    this.snapshot.checkin(this.error);
    this.snapshot.archive();
    if (this.resultPromise)
      if (this.error !== CANCELED)
        this.resultReject(this.error);
      else
        this.resultResolve();
  }

  static ensureAllUpToDate(hint: string, reaction: { tran?: Transaction, effect: ICache[] }): void {
    Transaction.runAs<void>(`${hint} - REACTION(${reaction.effect.length})`, true, () => {
      reaction.tran = Transaction.active;
      reaction.effect.map(r => r.ensureUpToDate(false));
    });
  }

  private acquirePromise(): Promise<void> {
    if (!this.resultPromise) {
      this.resultPromise = new Promise((resolve, reject) => {
        this.resultResolve = resolve;
        this.resultReject = reject;
      });
    }
    return this.resultPromise;
  }

  static _wrap<T>(t: Transaction, c: ICache | undefined, inc: boolean, dec: boolean, func: F<T>): F<T> {
    let f = c ? c.wrap(func) : func; // caching context
    if (inc)
      t.run<void>(() => t.busy++);
    let tran: F<T> = (...args: any[]): T =>
      t._run<T>(() => { // transaction context
        if (dec)
          t.busy--;
        // if (t.sealed && t.error)
        //   throw t.error;
        return f(...args);
      });
    return tran;
  }

  static getActiveSnapshot(): Snapshot {
    return Transaction.active.snapshot;
  }
}

const CANCELED: Error = new Error("transaction is canceled");
