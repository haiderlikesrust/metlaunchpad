// Tests use LiteSVM exclusively. Fail if a dependency attempts a network call.
const deny = () => { throw new Error('Hook probe is offline: network access is disabled.'); };
require('node:net').Socket.prototype.connect = deny;
require('node:http').request = deny;
require('node:http').get = deny;
require('node:https').request = deny;
require('node:https').get = deny;
globalThis.fetch = deny;
globalThis.WebSocket = class { constructor() { deny(); } };
