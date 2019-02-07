const {promisify} = require('util');

const chainSendTransaction = require('./chain_send_transaction');
const changePassword = promisify(require('./change_password'));
const connectChainNode = promisify(require('./connect_chain_node'));
const createCluster = promisify(require('./create_cluster'));
const delay = promisify(setTimeout);
const generateBlocks = promisify(require('./generate_blocks'));
const mineTransaction = promisify(require('./mine_transaction'));
const spawnLnd = promisify(require('./spawn_lnd'));

module.exports = {
  chainSendTransaction,
  changePassword,
  connectChainNode,
  createCluster,
  delay,
  generateBlocks,
  mineTransaction,
  spawnLnd,
};

