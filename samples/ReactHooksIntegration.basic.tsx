// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import * as React from 'react';
import { stateful, stateless, trigger, cached, statusof, offstage, Transaction, Status } from 'reactronic';

type ReactState = { rx: Rx; };

export function reactiveRender(render: () => JSX.Element): JSX.Element {
  const [state, refresh] = React.useState<ReactState>(createReactState);
  const rx = state.rx;
  rx.refresh = refresh; // just in case React will change refresh on each rendering
  React.useEffect(rx.unmountEffect, []);
  return rx.jsx(render);
}

@stateful
class Rx {
  @cached
  jsx(render: () => JSX.Element): JSX.Element {
    return render();
  }

  @trigger
  keepfresh(): void {
    if (statusof(this.jsx).isInvalid && this.refresh)
      offstage(this.refresh, {rx: this});
  }

  @stateless refresh?: (next: ReactState) => void = undefined;
  @stateless readonly unmountEffect = (): (() => void) => { // React.EffectCallback
    /* did mount */
    return () => { /* will unmount */ Status.unmount(this); };
  }
}

function createRx(): Rx {
  return new Rx();
}

function createReactState(): ReactState {
  return {rx: Transaction.run<Rx>("Rx.create", createRx)};
}
