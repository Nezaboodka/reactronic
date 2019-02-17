﻿import test from "ava";
import { Reactronic, Transaction, Log } from "../src/z.index";
import { Person } from "./common";
import { DemoModel, DemoView, actual } from "./basic";

let etalon: string[] = [
  "Filter: Jo",
  "John's children: Billy, Barry, Steve",
  "Filter: ",
  "John Smith's children: Barry, William Smith, Steven Smith",
  "Kevin's children: Britney",
  "Filter: Jo",
  "John's children: Billy, Barry, Steve",
];

test("basic", t => {
  Log.verbosity = process.env.AVA_DEBUG === undefined ? 0 : 3;
  // Simple actions
  let app = Transaction.run(() => new DemoView(new DemoModel()));
  try {
    app.model.loadUsers();
    let daddy: Person = app.model.users[0];
    t.is(daddy.name, "John");
    t.is(daddy.age, 38);
    app.print(); // trigger first run
    // Multi-part action
    let tran1 = new Transaction("tran1");
    tran1.run(() => {
      daddy.age += 2; // causes no execution of DemoApp.render
      daddy.name = "John Smith"; // causes execution of DemoApp.render upon action commit
      daddy.children[0].name = "Barry"; // Barry
      daddy.children[1].name = "William Smith"; // Billy
      daddy.children[2].name = "Steven Smith"; // Steve
      t.is(daddy.name, "John Smith");
      t.is(daddy.age, 40);
      t.is(daddy.children.length, 3);
    });
    t.is(daddy.name, "John");
    t.is(daddy.age, 38);
    t.is(daddy.children.length, 3);
    tran1.run(() => {
      t.is(daddy.age, 40);
      daddy.age += 5;
      app.userFilter = "";
      if (daddy.emails) {
        daddy.emails[0] = "daddy@mail.com";
        daddy.emails.push("someone@mail.io");
      }
      let x = daddy.children[1];
      x.parent = null;
      x.parent = daddy;
      t.is(daddy.name, "John Smith");
      t.is(daddy.age, 45);
      t.is(daddy.children.length, 3);
    });
    t.is(daddy.name, "John");
    t.is(daddy.age, 38);
    tran1.commit(); // changes are applied, reactions are invalidated/recomputed
    t.is(daddy.name, "John Smith");
    t.is(daddy.age, 45);
    // Protection from modification outside of action
    t.throws(() => {
      if (daddy.emails)
        daddy.emails.push("dad@mail.com");
      else
        daddy.children[1].name = "Billy Smithy";
    });
    t.throws(() => tran1.run(() => { /* nope */ }));
    // Undo action
    tran1.undo();
    t.is(daddy.name, "John");
    t.is(daddy.age, 38);
    // Check protection
    t.throws(() => { daddy.setParent.reactronic.configure({latency: 0}); });
    t.throws(() => { console.log(daddy.setParent.reactronic.config.indicator); });
    t.throws(() => { console.log(daddy.setParent.reactronic.invalidator); });
  }
  finally { // cleanup
    Reactronic.unmount(app, app.model);
  }
  let n: number = Math.max(actual.length, etalon.length);
  for (let i = 0; i < n; i++)
    t.is(actual[i], etalon[i]);
});
