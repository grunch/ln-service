const {test} = require('tap');

const {createCluster} = require('./../macros');
const {createHodlInvoice} = require('./../../');
const {createInvoice} = require('./../../');
const {getChannels} = require('./../../');
const {getInvoice} = require('./../../');
const {getInvoices} = require('./../../');
const {getWalletInfo} = require('./../../');
const {pay} = require('./../../');
const {settleHodlInvoice} = require('./../../');
const {setupChannel} = require('./../macros');

const cltvDelta = 144;
const sweepBlockCount = 40;
const tokens = 100;

// Create a hodl invoice
test(`Pay a hodl invoice`, async ({deepIs, end, equal, rejects}) => {
  const cluster = await createCluster({});

  const {lnd} = cluster.control;

  await setupChannel({lnd, generate: cluster.generate, to: cluster.target});

  await setupChannel({
    lnd: cluster.target.lnd,
    generate: cluster.generate,
    generator: cluster.target,
    to: cluster.remote,
  });

  const {id, request, secret} = await createInvoice({lnd: cluster.remote.lnd});

  const invoice = await createHodlInvoice({
    id,
    tokens,
    cltv_delta: cltvDelta,
    lnd: cluster.target.lnd,
  });

  await rejects(
    settleHodlInvoice({secret, lnd: cluster.target.lnd}),
    [402, 'CannotSettleHtlcBeforeHtlcReceived'],
    'An HTLC cannot be settled before the accept stage'
  );

  await rejects(
    settleHodlInvoice({lnd: cluster.target.lnd, secret: id}),
    [404, 'SecretDoesNotMatchAnyExistingHodlInvoice'],
    'An HTLC cannot be settled if it does not exist'
  );

  setTimeout(async () => {
    const {lnd} = cluster.target;

    const [channel] = (await getChannels({lnd})).channels
      .filter(n => n.pending_payments.length);

    const [created] = (await getInvoices({lnd})).invoices;
    const wallet = await getWalletInfo({lnd});

    const invoice = await getInvoice({id, lnd});
    const [pending] = channel.pending_payments;

    const gotCltvDelay = pending.timeout - wallet.current_block_height;
    const timeout = pending.timeout - sweepBlockCount;

    const delay = gotCltvDelay === cltvDelta || gotCltvDelay === cltvDelta + 3;

    equal(delay, true, 'invoice cltv delay as expected');
    equal(created.is_confirmed, false, 'invoices shows not yet been settled');
    equal(created.is_held, true, 'invoices shows HTLC locked in place');
    equal(invoice.is_confirmed, false, 'HTLC has not yet been settled');
    equal(invoice.is_held, true, 'HTLC is locked in place');

    const [held] = (await getInvoices({lnd})).invoices;

    deepIs(invoice, held, 'Invoice is held');

    const {secret} = await pay({lnd, request, timeout, tokens});

    await settleHodlInvoice({secret, lnd: cluster.target.lnd});

    const [settled] = (await getInvoices({lnd})).invoices;

    equal(settled.is_confirmed, true, 'HTLC is settled back');

    return setTimeout(async () => {
      await cluster.kill({});

      return end();
    },
    1000);
  },
  1000);

  const paid = await pay({lnd, request: invoice.request});

  equal(paid.secret, secret, 'Paying reveals the HTLC secret');

  return;
});
