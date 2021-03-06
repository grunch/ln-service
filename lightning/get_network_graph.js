const asyncAuto = require('async/auto');
const {chanFormat} = require('bolt07');
const {featureFlagDetails} = require('bolt09');
const {returnResult} = require('asyncjs-util');

const {channelEdgeAsChannel} = require('./../graph');

const countGroupingFactor = 3;
const decBase = 10;
const {isArray} = Array;
const msPerSec = 1e3
const outpointSeparatorChar = ':';

/** Get the network graph

  Requires `info:read` permission

  LND 0.8.2 and below do not return `features`

  {
    lnd: <Authenticated LND API Object>
  }

  @returns via cbk or Promise
  {
    channels: [{
      capacity: <Channel Capacity Tokens Number>
      id: <Standard Format Channel Id String>
      policies: [{
        [base_fee_mtokens]: <Bae Fee Millitokens String>
        [cltv_delta]: <CLTV Height Delta Number>
        [fee_rate]: <Fee Rate In Millitokens Per Million Number>
        [is_disabled]: <Edge is Disabled Bool>
        [max_htlc_mtokens]: <Maximum HTLC Millitokens String>
        [min_htlc_mtokens]: <Minimum HTLC Millitokens String>
        public_key: <Public Key String>
        [updated_at]: <Last Update Epoch ISO 8601 Date String>
      }]
      transaction_id: <Funding Transaction Id String>
      transaction_vout: <Funding Transaction Output Index Number>
      [updated_at]: <Last Update Epoch ISO 8601 Date String>
    }]
    nodes: [{
      alias: <Name String>
      color: <Hex Encoded Color String>
      features: [{
        bit: <BOLT 09 Feature Bit Number>
        is_known: <Feature is Known Bool>
        is_required: <Feature Support is Required Bool>
        type: <Feature Type String>
      }]
      public_key: <Node Public Key String>
      sockets: [<Network Host:Port String>]
      updated_at: <Last Updated ISO 8601 Date String>
    }]
  }
*/
module.exports = ({lnd}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnd || !lnd.default || !lnd.default.describeGraph) {
          return cbk([400, 'ExpectedLndForGetNetworkGraphRequest']);
        }

        return cbk();
      },

      // Get network graph
      getGraph: ['validate', ({}, cbk) => {
        return lnd.default.describeGraph({}, (err, networkGraph) => {
          if (!!err) {
            return cbk([503, 'GetNetworkGraphError', {err}]);
          }

          if (!networkGraph) {
            return cbk([503, 'ExpectedNetworkGraph']);
          }

          if (!isArray(networkGraph.edges)) {
            return cbk([503, 'ExpectedNetworkGraphEdges']);
          }

          if (!isArray(networkGraph.nodes)) {
            return cbk([503, 'ExpectedNetworkGraphNodes']);
          }

          return cbk(null, networkGraph);
        });
      }],

      // Network graph
      graph: ['getGraph', ({getGraph}, cbk) => {
        let channels;
        const hasChannel = {};

        try {
          channels = getGraph.edges.map(n => {
            hasChannel[n.node1_pub] = true;
            hasChannel[n.node2_pub] = true;

            return channelEdgeAsChannel({
              capacity: n.capacity,
              chan_point: n.chan_point,
              channel_id: n.channel_id,
              node1_policy: n.node1_policy,
              node1_pub: n.node1_pub,
              node2_policy: n.node2_policy,
              node2_pub: n.node2_pub,
            });
          });
        } catch (err) {
          return cbk([503, 'UnexpectedErrorParsingChannelsInGraph', {err}]);
        }

        const nodes = getGraph.nodes.filter(n => !!n.last_update).map(n => {
          return {
            alias: n.alias,
            color: n.color,
            features: Object.keys(n.features).map(bit => ({
              bit,
              is_known: n.features[bit].is_known,
              is_required: n.features[bit].is_required,
              type: featureFlagDetails({bit}).type,
            })),
            public_key: n.pub_key,
            sockets: n.addresses.map(({addr}) => addr),
            updated_at: new Date(n.last_update * msPerSec).toISOString(),
          };
        });

        return cbk(null, {
          channels,
          nodes: nodes.filter(n => !!hasChannel[n.public_key]),
        });
      }],
    },
    returnResult({reject, resolve, of: 'graph'}, cbk));
  });
};
