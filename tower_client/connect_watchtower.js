const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const {isLnd} = require('./../grpc');
const {unimplementedError} = require('./constants');

const method = 'addTower';
const type = 'tower_client';

/** Connect to a watchtower

  This method requires LND built with `wtclientrpc` build tag

  Requires `offchain:write` permission

  {
    lnd: <Authenticated LND API Object>
    public_key: <Watchtower Public Key Hex String>
    socket: <Network Socket Address IP:PORT String>
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return new asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isLnd({method, type, lnd: args.lnd})) {
          return cbk([400, 'ExpectedLndToConnectToWatchtower']);
        }

        if (!args.public_key) {
          return cbk([400, 'ExpectedPublicKeyOfWatchtowerToConnectTo']);
        }

        if (!args.socket) {
          return cbk([400, 'ExpectedSocketOfWatchtowerToConnectTo']);
        }

        return cbk();
      },

      // Add watchtower
      add: ['validate', ({}, cbk) => {
        return args.lnd[type][method]({
          address: args.socket,
          pubkey: Buffer.from(args.public_key, 'hex'),
        },
        err => {
          if (!!err && err.message === unimplementedError) {
            return cbk([503, 'ExpectedLndCompiledWithWtclientrpcBuildTag']);
          }

          if (!!err) {
            return cbk([503, 'UnexpectedErrorConnectingWatchtower', {err}]);
          }

          return cbk();
        });
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
