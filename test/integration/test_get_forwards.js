const {test} = require('tap');

const {addPeer} = require('./../../');
const {createCluster} = require('./../macros');
const {createInvoice} = require('./../../');
const {delay} = require('./../macros');
const {getForwards} = require('./../../');
const {openChannel} = require('./../../');
const {pay} = require('./../../');
const {waitForChannel} = require('./../macros');
const {waitForPendingChannel} = require('./../macros');

const channelCapacityTokens = 1e6;
const confirmationCount = 20;
const defaultFee = 1e3;
const limit = 1;
const tokens = 100;

// Getting forwarded payments should return all forwarded payments
test('Get forwards', async ({deepIs, end, equal}) => {
  const cluster = await createCluster({});

  const controlToTargetChannel = await openChannel({
    chain_fee_tokens_per_vbyte: defaultFee,
    lnd: cluster.control.lnd,
    local_tokens: channelCapacityTokens,
    partner_public_key: cluster.target.public_key,
    socket: cluster.target.socket,
  });

  await waitForPendingChannel({
    id: controlToTargetChannel.transaction_id,
    lnd: cluster.control.lnd,
  });

  await cluster.generate({count: confirmationCount, node: cluster.control});

  await waitForChannel({
    id: controlToTargetChannel.transaction_id,
    lnd: cluster.control.lnd,
  });

  const targetToRemoteChannel = await openChannel({
    chain_fee_tokens_per_vbyte: defaultFee,
    lnd: cluster.target.lnd,
    local_tokens: channelCapacityTokens,
    partner_public_key: cluster.remote.public_key,
    socket: cluster.remote.socket,
  });

  await waitForPendingChannel({
    id: targetToRemoteChannel.transaction_id,
    lnd: cluster.target.lnd,
  });

  await cluster.generate({count: confirmationCount, node: cluster.target});

  await waitForChannel({
    id: targetToRemoteChannel.transaction_id,
    lnd: cluster.target.lnd,
  });

  await addPeer({
    lnd: cluster.control.lnd,
    public_key: cluster.remote.public_key,
    socket: cluster.remote.socket,
  });

  await delay(2000);

  for (let i = 0, lnd = cluster.remote.lnd; i < 3; i++) {
    await pay({
      lnd: cluster.control.lnd,
      request: (await createInvoice({lnd, tokens: tokens + i})).request,
    });

    await delay(1000);
  }

  const {lnd} = cluster.target;

  const page1 = await getForwards({limit, lnd});

  equal(!!page1.next, true, 'Page 1 leads to page 2');

  {
    const [forward] = page1.forwards;

    equal(!!forward.created_at, true, 'Forward created at');
    equal(forward.fee, 1, 'Forward fee charged');
    equal(forward.fee_mtokens, '1000', 'Forward fee charged');
    equal(!!forward.incoming_channel, true, 'Forward incoming channel');
    equal(forward.tokens, 100, 'Forwarded tokens count');
    equal(!!forward.outgoing_channel, true, 'Forward outgoing channel');
  }

  const page2 = await getForwards({lnd, token: page1.next});

  equal(!!page2.next, true, 'Page 2 leads to page 3');

  {
    const [forward] = page2.forwards;

    equal(forward.tokens, 101, 'Second forward tokens count');
  }

  const page3 = await getForwards({lnd, token: page2.next});

  equal(!!page3.next, true, 'Page 3 leads to page 4');

  {
    const [forward] = page3.forwards;

    equal(forward.tokens, 102, 'Third forward tokens count');

    // Check "before" based paging
    const prev0 = await getForwards({limit, lnd, before: forward.created_at});

    const [firstForward] = prev0.forwards;

    equal(firstForward.tokens, 100, 'Previous row #1');

    const prev1 = await getForwards({lnd, token: prev0.next});

    const [secondForward] = prev1.forwards;

    equal(secondForward.tokens, 101, 'Previous row #2');

    const prev2 = await getForwards({lnd, token: prev1.next});

    equal(prev2.next, undefined, 'Ended paging of previous rows');

    // Check "after" based paging
    const after0 = await getForwards({
      limit,
      lnd,
      before: forward.created_at,
      after: firstForward.created_at,
    });

    deepIs(after0.forwards, prev0.forwards, 'After is inclusive of start');

    const after1 = await getForwards({lnd, token: after0.next});

    deepIs(after1.forwards, prev1.forwards, 'Iterating between before, after');

    const after2 = await getForwards({lnd, token: after1.next});

    equal(after2.next, undefined, 'Before is non-inclusive');
  }

  const page4 = await getForwards({lnd, token: page3.next});

  equal(page4.forwards.length, [].length, 'Page 4 has no results');
  equal(page4.next, undefined, 'Page 4 leads to nowhere');

  await cluster.kill({});

  return end();
});
