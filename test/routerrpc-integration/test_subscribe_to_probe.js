const {once} = require('events');

const {test} = require('tap');

const {addPeer} = require('./../../');
const {createCluster} = require('./../macros');
const {createInvoice} = require('./../../');
const {delay} = require('./../macros');
const {deleteForwardingReputations} = require('./../../');
const {getChannel} = require('./../../');
const {getChannels} = require('./../../');
const {getRoutes} = require('./../../');
const {openChannel} = require('./../../');
const {pay} = require('./../../');
const {subscribeToProbe} = require('./../../');
const {waitForChannel} = require('./../macros');
const {waitForPendingChannel} = require('./../macros');

const chain = '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206';
const channelCapacityTokens = 1e6;
const confirmationCount = 20;
const defaultFee = 1e3;
const tokens = 1e6 / 2;

// Subscribing to a a route probe should return route probe events
test('Subscribe to probe', async ({deepIs, end, equal}) => {
  const cluster = await createCluster({});

  const {lnd} = cluster.control;

  // Create a channel from the control to the target node
  const controlToTargetChannel = await openChannel({
    lnd,
    chain_fee_tokens_per_vbyte: defaultFee,
    local_tokens: channelCapacityTokens * 2,
    partner_public_key: cluster.target_node_public_key,
    socket: `${cluster.target.listen_ip}:${cluster.target.listen_port}`,
  });

  await waitForPendingChannel({
    lnd,
    id: controlToTargetChannel.transaction_id,
  });

  // Generate to confirm the channel
  await cluster.generate({count: confirmationCount, node: cluster.control});

  const controlToTargetChan = await waitForChannel({
    lnd,
    id: controlToTargetChannel.transaction_id,
  });

  const [controlChannel] = (await getChannels({lnd})).channels;

  const targetToRemoteChannel = await openChannel({
    chain_fee_tokens_per_vbyte: defaultFee,
    give_tokens: Math.round(channelCapacityTokens / 2),
    lnd: cluster.target.lnd,
    local_tokens: channelCapacityTokens,
    partner_public_key: cluster.remote_node_public_key,
    socket: `${cluster.remote.listen_ip}:${cluster.remote.listen_port}`,
  });

  await waitForPendingChannel({
    id: targetToRemoteChannel.transaction_id,
    lnd: cluster.target.lnd,
  });

  // Generate to confirm the channel
  await cluster.generate({count: confirmationCount, node: cluster.target});

  const targetToRemoteChan = await waitForChannel({
    id: targetToRemoteChannel.transaction_id,
    lnd: cluster.target.lnd,
  });

  await addPeer({
    lnd,
    public_key: cluster.remote_node_public_key,
    socket: `${cluster.remote.listen_ip}:${cluster.remote.listen_port}`,
  });

  const {channels} = await getChannels({lnd: cluster.remote.lnd});

  const invoice = await createInvoice({tokens, lnd: cluster.remote.lnd});

  await delay(1000);

  const sub = subscribeToProbe({
    lnd,
    destination: cluster.remote_node_public_key,
    tokens: invoice.tokens,
  });

  sub.on('error', () => {});

  const [{route}] = await once(sub, 'probing');

  // On 0.7.1 confidence is not supported
  delete route.confidence;

  // On 0.8.2 and below messages are not supported
  delete route.messages;

  deepIs(route, {
    fee: 1,
    fee_mtokens: '1500',
    hops: [
      {
        channel: controlToTargetChan.id,
        channel_capacity: controlToTargetChan.capacity,
        fee: 1,
        fee_mtokens: '1500',
        forward: tokens,
        forward_mtokens: `${tokens}000`,
        public_key: cluster.target_node_public_key,
        timeout: 528,
      },
      {
        channel: targetToRemoteChan.id,
        channel_capacity: targetToRemoteChan.capacity,
        fee: 0,
        fee_mtokens: '0',
        forward: tokens,
        forward_mtokens: `${tokens}000`,
        public_key: cluster.remote_node_public_key,
        timeout: 528,
      }
    ],
    mtokens: '500001500',
    safe_fee: 2,
    safe_tokens: 500002,
    timeout: 568,
    tokens: 500001,
  });

  const [tempChanFail] = await once(sub, 'routing_failure');

  const failChannel = await getChannel({lnd, id: tempChanFail.channel});

  equal(tempChanFail.channel, targetToRemoteChan.id, 'Fail at target chan');

  const failPolicy = failChannel.policies
    .find(n => n.public_key === cluster.target_node_public_key);

  equal(tempChanFail.policy.base_fee_mtokens, failPolicy.base_fee_mtokens);
  equal(tempChanFail.policy.cltv_delta, failPolicy.cltv_delta, 'Poilcy cltv');
  equal(tempChanFail.policy.fee_rate, failPolicy.fee_rate, 'Fail fee rate');
  equal(tempChanFail.policy.is_disabled, failPolicy.is_disabled, 'Disabled');
  equal(tempChanFail.policy.min_htlc_mtokens, failPolicy.min_htlc_mtokens);
  equal(!!tempChanFail.policy.updated_at, true, 'Updated');
  equal(tempChanFail.reason, 'TemporaryChannelFailure', 'Failure reason');
  deepIs(tempChanFail.route, route, 'Failure on route');
  equal(tempChanFail.update.chain, chain, 'Failure in chain');
  equal(tempChanFail.update.channel_flags !== undefined, true, 'Chan flags');
  equal(tempChanFail.update.extra_opaque_data, '', 'Extra opaque data');
  equal(tempChanFail.update.message_flags, 1, 'Has extra chan details');
  equal(tempChanFail.update.signature.length, 64 * 2, 'Has signature');

  // Create a new channel to increase total edge liquidity
  const newChannel = await openChannel({
    chain_fee_tokens_per_vbyte: defaultFee,
    lnd: cluster.target.lnd,
    local_tokens: channelCapacityTokens,
    partner_public_key: cluster.remote.public_key,
    socket: cluster.remote.socket,
  });

  await waitForPendingChannel({
    id: newChannel.transaction_id,
    lnd: cluster.target.lnd,
  });

  // Generate to confirm the channel
  await cluster.generate({count: confirmationCount, node: cluster.target});

  const bigChannel = await waitForChannel({
    id: newChannel.transaction_id,
    lnd: cluster.target.lnd,
  });

  await deleteForwardingReputations({lnd});

  const subSuccess = subscribeToProbe({
    lnd,
    destination: cluster.remote_node_public_key,
    tokens: invoice.tokens,
  });

  subSuccess.on('error', () => {});

  const [success] = await once(subSuccess, 'probe_success');

  equal(success.route.fee, 1, 'Successful route fee');
  equal(success.route.fee_mtokens, '1500', 'Successful route fee mtokens');
  equal(success.route.hops.length, 2, 'Successful route returned');
  equal(success.route.mtokens, '500001500', 'Successful route mtokens');
  equal(success.route.timeout, 588, 'Successful route timeout');
  equal(success.route.tokens, 500001, 'Successful route tokens');
  equal(success.update, undefined, 'Success extra update info');

  // Check that the probe failure timeout will apply
  const subTimeout = subscribeToProbe({
    lnd,
    destination: cluster.remote_node_public_key,
    probe_timeout_ms: 100,
    tokens: invoice.tokens,
  });

  const [[timeoutCode, timeoutMessage]] = await once(subTimeout, 'error');

  equal(timeoutCode, 503, 'Timeout code received');
  equal(timeoutMessage, 'ProbeTimeout', 'Timeout message received');

  await cluster.kill({});

  return end();
});
