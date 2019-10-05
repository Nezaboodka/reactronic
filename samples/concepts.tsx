// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import * as React from 'react';
import { Stateful, transaction, cached, trigger, cacheof } from 'reactronic';

class Model extends Stateful {
  // state
  url: string = "https://nezaboodka.com";
  content: string = "";
  timestamp: number = Date.now();

  @transaction
  async goto(url: string) {
    this.url = url;
    this.content = await (await fetch(url)).text();
    this.timestamp = Date.now();
  }
}

class View extends React.Component<Model> {
  @trigger
  keepFresh() {
    if (cacheof(this.render).isInvalid)
      this.setState({}); // ask React
  }

  @cached
  render() {
    return (
      <div>
        <div>{this.props.url}</div>
        <div>{this.props.content}</div>
      </div>);
  }
}

export const dummy = View;
