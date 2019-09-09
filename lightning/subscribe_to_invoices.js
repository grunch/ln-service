const EventEmitter = require('events');

const {htlcAsPayment} = require('./../invoices');

const decBase = 10;
const msPerSec = 1e3;

/** Subscribe to invoices

  The `payments` array of HTLCs is only populated on LND versions after 0.7.1

  {
    lnd: <Authenticated LND gRPC API Object>
  }

  @throws
  <Error>

  @returns
  <EventEmitter Object>

  @event 'invoice_updated'
  {
    [chain_address]: <Fallback Chain Address String>
    cltv_delta: <Final CLTV Delta Number>
    [confirmed_at]: <Confirmed At ISO 8601 Date String>
    created_at: <Created At ISO 8601 Date String>
    description: <Description String>
    description_hash: <Description Hash Hex String>
    expires_at: <Expires At ISO 8601 Date String>
    id: <Invoice Payment Hash Hex String>
    is_confirmed: <Invoice is Confirmed Bool>
    is_outgoing: <Invoice is Outgoing Bool>
    payments: [{
      [confirmed_at]: <Payment Settled At ISO 8601 Date String>
      created_at: <Payment Held Since ISO 860 Date String>
      created_height: <Payment Held Since Block Height Number>
      in_channel: <Incoming Payment Through Channel Id String>
      is_canceled: <Payment is Canceled Bool>
      is_confirmed: <Payment is Confirmed Bool>
      is_held: <Payment is Held Bool>
      mtokens: <Incoming Payment Millitokens String>
      [pending_index]: <Pending Payment Channel HTLC Index Number>
      tokens: <Payment TOkens Number>
    }]
    received: <Received Tokens Number>
    received_mtokens: <Received Millitokens String>
    request: <BOLT 11 Payment Request String>
    secret: <Payment Secret Hex String>
    tokens: <Invoiced Tokens Number>
  }
*/
module.exports = ({lnd}) => {
  if (!lnd || !lnd.default || !lnd.default.subscribeInvoices) {
    throw new Error('ExpectedAuthenticatedLndToSubscribeInvoices');
  }

  const eventEmitter = new EventEmitter();
  const subscription = lnd.default.subscribeInvoices({});

  subscription.on('data', invoice => {
    if (!invoice) {
      return eventEmitter.emit('error', new Error('ExpectedInvoice'));
    }

    if (!invoice.amt_paid_msat) {
      return eventEmitter.emit('error', new Error('ExpectedInvoicePaidMsat'));
    }

    if (!invoice.amt_paid_sat) {
      return eventEmitter.emit('error', new Error('ExpectedInvoicePaidSat'));
    }

    if (!invoice.creation_date) {
      return eventEmitter.emit('error', new Error('ExpectedCreationDate'));
    }

    if (!invoice.description_hash) {
      return eventEmitter.emit('error', new Error('ExpectedDescriptionHash'));
    }

    const descriptionHash = invoice.description_hash;

    if (!!descriptionHash.length && !Buffer.isBuffer(descriptionHash)) {
      return eventEmitter.emit('error', new Error('ExpectedDescriptionHash'));
    }

    try {
      invoice.htlcs.forEach(htlc => htlcAsPayment(htlc));
    } catch (err) {
      return eventEmitter.emit('error', err);
    }

    if (invoice.settled !== true && invoice.settled !== false) {
      return eventEmitter.emit('error', new Error('ExpectedInvoiceSettled'));
    }

    if (!Buffer.isBuffer(invoice.r_hash)) {
      return eventEmitter.emit('error', new Error('ExpectedInvoiceHash'));
    }

    if (!Buffer.isBuffer(invoice.r_preimage)) {
      return eventEmitter.emit('error', new Error('ExpectedInvoicePreimage'));
    }

    if (!!invoice.receipt.length && !Buffer.isBuffer(invoice.receipt)) {
      return eventEmitter.emit('error', new Error('ExpectedInvoiceReceipt'));
    }

    if (!invoice.value) {
      return eventEmitter.emit('error', new Error('ExpectedInvoiceValue'));
    }

    const confirmedAt = parseInt(invoice.settle_date, decBase) * msPerSec;
    const createdAt = parseInt(invoice.creation_date, decBase);

    const confirmed = new Date(confirmedAt).toISOString();
    const expiresAt = createdAt + parseInt(invoice.expiry);

    return eventEmitter.emit('invoice_updated', {
      chain_address: invoice.fallback_addr || undefined,
      cltv_delta: parseInt(invoice.cltv_expiry, decBase),
      confirmed_at: !invoice.settled ? undefined : confirmed,
      created_at: new Date(createdAt * msPerSec).toISOString(),
      description: invoice.memo || '',
      description_hash: descriptionHash.toString('hex') || undefined,
      expires_at: new Date(expiresAt * msPerSec).toISOString(),
      id: invoice.r_hash.toString('hex'),
      is_confirmed: invoice.settled,
      is_outgoing: false,
      payments: invoice.htlcs.map(htlcAsPayment),
      received: parseInt(invoice.amt_paid_sat, decBase),
      received_mtokens: invoice.amt_paid_msat,
      request: invoice.payment_request,
      secret: invoice.r_preimage.toString('hex'),
      tokens: parseInt(invoice.value, decBase),
    });
  });

  subscription.on('end', () => eventEmitter.emit('end'));
  subscription.on('error', err => eventEmitter.emit('error', err));
  subscription.on('status', status => eventEmitter.emit('status', status));

  return eventEmitter;
};
