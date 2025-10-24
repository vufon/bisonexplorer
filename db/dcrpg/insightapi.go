// Copyright (c) 2018-2021, The Decred developers
// Copyright (c) 2017, The dcrdata developers
// See LICENSE for details.

package dcrpg

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/btcsuite/btcd/btcjson"
	"github.com/btcsuite/btcd/btcutil"
	btcchainhash "github.com/btcsuite/btcd/chaincfg/chainhash"
	"github.com/decred/dcrd/chaincfg/chainhash"
	chainjson "github.com/decred/dcrd/rpc/jsonrpc/types/v4"
	"github.com/decred/dcrd/txscript/v4/stdaddr"
	"github.com/decred/dcrd/wire"
	ltcjson "github.com/ltcsuite/ltcd/btcjson"
	ltcchainhash "github.com/ltcsuite/ltcd/chaincfg/chainhash"
	"github.com/ltcsuite/ltcd/ltcutil"

	apitypes "github.com/decred/dcrdata/v8/api/types"
	"github.com/decred/dcrdata/v8/db/cache"
	"github.com/decred/dcrdata/v8/db/dbtypes"
	"github.com/decred/dcrdata/v8/mutilchain"
	"github.com/decred/dcrdata/v8/mutilchain/btcrpcutils"
	"github.com/decred/dcrdata/v8/mutilchain/ltcrpcutils"
	"github.com/decred/dcrdata/v8/txhelpers"
	"github.com/decred/dcrdata/v8/xmr/xmrclient"
)

// GetLTCTransactionByHash gets a wire.MsgTx for the specified transaction hash.
func (pgb *ChainDB) GetLTCTransactionByHash(txid string) (*ltcutil.Tx, error) {
	txhash, err := ltcchainhash.NewHashFromStr(txid)
	if err != nil {
		return nil, err
	}
	tx, err := pgb.LtcClient.GetRawTransaction(txhash)
	if err != nil {
		return nil, err
	}
	return tx, nil
}

// GetBTCTransactionByHash gets a wire.MsgTx for the specified transaction hash.
func (pgb *ChainDB) GetBTCTransactionByHash(txid string) (*btcutil.Tx, error) {
	txhash, err := btcchainhash.NewHashFromStr(txid)
	if err != nil {
		return nil, err
	}
	tx, err := pgb.BtcClient.GetRawTransaction(txhash)
	if err != nil {
		return nil, err
	}
	return tx, nil
}

// GetTransactionByHash gets a btc_wire.MsgTx for the specified transaction hash.
func (pgb *ChainDB) GetTransactionByHash(txid string) (*wire.MsgTx, error) {
	txhash, err := chainhash.NewHashFromStr(txid)
	if err != nil {
		return nil, err
	}
	tx, err := pgb.Client.GetRawTransaction(pgb.ctx, txhash)
	if err != nil {
		return nil, err
	}
	return tx.MsgTx(), nil
}

// GetRawTransactionVerbose gets a chainjson.TxRawResult for the specified
// transaction hash.
func (pgb *ChainDB) GetRawTransactionVerbose(txid *chainhash.Hash) (*chainjson.TxRawResult, error) {
	txraw, err := pgb.Client.GetRawTransactionVerbose(pgb.ctx, txid)
	if err != nil {
		log.Errorf("GetRawTransactionVerbose failed for: %s", txid)
		return nil, err
	}
	return txraw, nil
}

// SendRawTransaction attempts to decode the input serialized transaction,
// passed as hex encoded string, and broadcast it, returning the tx hash.
func (pgb *ChainDB) SendRawTransaction(txhex string) (string, error) {
	msg, err := txhelpers.MsgTxFromHex(txhex)
	if err != nil {
		log.Errorf("SendRawTransaction failed: could not decode hex")
		return "", err
	}
	ctx, cancel := context.WithTimeout(pgb.ctx, 5*time.Second)
	defer cancel()
	hash, err := pgb.Client.SendRawTransaction(ctx, msg, true)
	if err != nil {
		log.Errorf("SendRawTransaction failed: %v", err)
		return "", err
	}
	return hash.String(), err
}

type txSortable struct {
	Hash chainhash.Hash
	Time int64
}

func sortTxsByTimeAndHash(txns []txSortable) {
	sort.Slice(txns, func(i, j int) bool {
		if txns[i].Time == txns[j].Time {
			return txns[i].Hash.String() < txns[j].Hash.String()
		}
		return txns[i].Time > txns[j].Time
	})
}

// InsightAddressTransactions performs DB queries to get all transaction hashes
// for the specified addresses in descending order by time, then ascending order
// by hash. It also returns a list of recently (defined as greater than
// recentBlockHeight) confirmed transactions that can be used to validate
// mempool status.
func (pgb *ChainDB) InsightAddressTransactions(addr []string, recentBlockHeight int64) (txs, recentTxs []chainhash.Hash, err error) {
	// Time of a "recent" block
	recentBlocktime, err0 := pgb.BlockTimeByHeight(recentBlockHeight)
	if err0 != nil {
		return nil, nil, err0
	}

	// Retrieve all merged address rows for these addresses.
	var txns []chainhash.Hash // []txSortable
	var numRecent int
	for i := range addr {
		rows, err := pgb.AddressRowsMerged(addr[i])
		if err != nil {
			return nil, nil, err
		}
		for _, r := range rows {
			//txns = append(txns, txSortable{r.TxHash, r.TxBlockTime})
			txns = append(txns, r.TxHash)
			// Count the number of "recent" txns.
			if r.TxBlockTime > recentBlocktime {
				numRecent++
			}
		}
	}

	// Sort by block time (DESC) then hash (ASC).
	//sortTxsByTimeAndHash(txns)

	txs = make([]chainhash.Hash, 0, len(txns))
	recentTxs = make([]chainhash.Hash, 0, numRecent)

	for i := range txns {
		txs = append(txs, txns[i])
		if i < numRecent {
			recentTxs = append(recentTxs, txns[i])
		}
	}

	return
}

// AddressIDsByOutpoint fetches all address row IDs for a given outpoint
// (txHash:voutIndex).
func (pgb *ChainDB) AddressIDsByOutpoint(txHash string, voutIndex uint32) ([]uint64, []string, int64, error) {
	ctx, cancel := context.WithTimeout(pgb.ctx, pgb.queryTimeout)
	defer cancel()
	ids, addrs, val, err := RetrieveAddressIDsByOutpoint(ctx, pgb.db, txHash, voutIndex)
	return ids, addrs, val, pgb.replaceCancelError(err)
}

// GetTransactionHex returns the full serialized transaction for the specified
// transaction hash as a hex encode string.
func (pgb *ChainDB) GetTransactionHex(txid *chainhash.Hash) string {
	tx, err := pgb.Client.GetRawTransaction(pgb.ctx, txid)
	if err != nil {
		log.Errorf("GetRawTransaction(%v) failed: %v", txid, err)
		return ""
	}
	txHex, err := txhelpers.MsgTxToHex(tx.MsgTx())
	if err != nil {
		log.Errorf("MsgTxToHex for tx %v: %v", txid, err)
		return ""
	}
	return txHex
}

// GetMultichainTransactionHex returns the full serialized transaction for the specified
// transaction hash as a hex encode string.
func (pgb *ChainDB) GetMultichainTransactionHex(txid, chainType string) string {
	switch chainType {
	case mutilchain.TYPEBTC:
		return pgb.GetBTCTxHex(txid)
	case mutilchain.TYPELTC:
		return pgb.GetLTCTxHex(txid)
	}
	return ""
}

// GetBTCTxHex return btc transaction hex from txid
func (pgb *ChainDB) GetBTCTxHex(txid string) string {
	txhash, err := btcchainhash.NewHashFromStr(txid)
	if err != nil {
		log.Errorf("New BTC hash failed: %v", err)
		return ""
	}
	tx, err := pgb.BtcClient.GetRawTransactionVerbose(txhash)
	if err != nil {
		log.Errorf("Get BTC transaction verbose failed: %v", err)
		return ""
	}
	return tx.Hex
}

// GetLTCTxHex return ltc transaction hex from txid
func (pgb *ChainDB) GetLTCTxHex(txid string) string {
	txhash, err := ltcchainhash.NewHashFromStr(txid)
	if err != nil {
		log.Errorf("New LTC hash failed: %v", err)
		return ""
	}
	tx, err := pgb.LtcClient.GetRawTransactionVerbose(txhash)
	if err != nil {
		log.Errorf("Get LTC transaction verbose failed: %v", err)
		return ""
	}
	return tx.Hex
}

// GetBlockVerboseByHash returns a *chainjson.GetBlockVerboseResult for the
// specified block hash, optionally with transaction details.
func (pgb *ChainDB) GetBlockVerboseByHash(hash string, verboseTx bool) *chainjson.GetBlockVerboseResult {
	blockhash, err := chainhash.NewHashFromStr(hash)
	if err != nil {
		log.Errorf("Invalid block hash %s", hash)
		return nil
	}

	blockVerbose, err := pgb.Client.GetBlockVerbose(context.TODO(), blockhash, verboseTx)
	if err != nil {
		log.Errorf("GetBlockVerbose(%v) failed: %v", hash, err)
		return nil
	}
	return blockVerbose
}

func (pgb *ChainDB) MutilchainValidBlockhash(hash string, chainType string) bool {
	switch chainType {
	case mutilchain.TYPEBTC:
		return btcrpcutils.IsValidBlockHash(pgb.BtcClient, hash)
	case mutilchain.TYPELTC:
		return ltcrpcutils.IsValidBlockHash(pgb.LtcClient, hash)
	case mutilchain.TYPEXMR:
		bh, err := pgb.XmrClient.GetBlockHeaderByHash(hash)
		if err != nil || bh.Hash == "" {
			return false
		}
		return true
	default:
		return false
	}
}

func (pgb *ChainDB) MutilchainValidTxhash(hash string, chainType string) bool {
	switch chainType {
	case mutilchain.TYPEBTC:
		return btcrpcutils.IsValidTxHash(pgb.BtcClient, hash)
	case mutilchain.TYPELTC:
		return ltcrpcutils.IsValidTxHash(pgb.LtcClient, hash)
	case mutilchain.TYPEXMR:
		txsData, err := pgb.XmrClient.GetTransactions([]string{hash}, true)
		if err != nil || len(txsData.Txs) <= 0 {
			return false
		}
		return true
	default:
		return false
	}
}

func (pgb *ChainDB) GetBTCBlockVerboseTxByHash(hash string) *btcjson.GetBlockVerboseTxResult {
	block := btcrpcutils.GetBlockVerboseTxByHash(pgb.BtcClient, hash)
	return block
}

func (pgb *ChainDB) GetLTCBlockVerboseTxByHash(hash string) *ltcjson.GetBlockVerboseTxResult {
	block := ltcrpcutils.GetBlockVerboseTxByHash(pgb.LtcClient, hash)
	return block
}

// GetBlockVerboseByHash returns a *chainjson.GetBlockVerboseResult for the
// specified block hash, optionally with transaction details.
func (pgb *ChainDB) GetBTCBlockVerboseByHash(hash string) *btcjson.GetBlockVerboseResult {
	blockhash, err := btcchainhash.NewHashFromStr(hash)
	if err != nil {
		log.Errorf("Invalid block hash %s", hash)
		return nil
	}

	blockVerbose, err := pgb.BtcClient.GetBlockVerbose(blockhash)
	if err != nil {
		log.Errorf("GetBlockVerbose(%v) failed: %v", hash, err)
		return nil
	}
	return blockVerbose
}

// GetTransactionsForBlockByHash returns a *apitypes.BlockTransactions for the
// block with the specified hash.
func (pgb *ChainDB) GetTransactionsForBlockByHash(hash string) *apitypes.BlockTransactions {
	blockVerbose := pgb.GetBlockVerboseByHash(hash, false)
	return makeBlockTransactions(blockVerbose)
}

func makeBlockTransactions(blockVerbose *chainjson.GetBlockVerboseResult) *apitypes.BlockTransactions {
	blockTransactions := new(apitypes.BlockTransactions)

	blockTransactions.Tx = make([]string, len(blockVerbose.Tx))
	copy(blockTransactions.Tx, blockVerbose.Tx)

	blockTransactions.STx = make([]string, len(blockVerbose.STx))
	copy(blockTransactions.STx, blockVerbose.STx)

	return blockTransactions
}

// GetBlockHash returns the hash of the block at the specified height. TODO:
// create GetBlockHashes to return all blocks at a given height.
func (pgb *ChainDB) GetBlockHash(idx int64) (string, error) {
	ctx, cancel := context.WithTimeout(pgb.ctx, pgb.queryTimeout)
	defer cancel()
	hash, err := RetrieveBlockHash(ctx, pgb.db, idx)
	if err != nil {
		log.Errorf("Unable to get block hash for block number %d: %v", idx, err)
		return "", pgb.replaceCancelError(err)
	}
	return hash, nil
}

func (pgb *ChainDB) GetMutilchainBlockHash(idx int64, chainType string) (string, error) {
	ctx, cancel := context.WithTimeout(pgb.ctx, pgb.queryTimeout)
	defer cancel()
	hash, err := RetrieveMutilchainBlockHash(ctx, pgb.db, idx, chainType)
	if err != nil {
		log.Errorf("Unable to get block hash for block number %d: %v", idx, err)
		return "", pgb.replaceCancelError(err)
	}
	return hash, nil
}

// BlockSummaryTimeRange returns the blocks created within a specified time
// range (min, max time), up to limit transactions.
func (pgb *ChainDB) BlockSummaryTimeRange(min, max int64, limit int) ([]dbtypes.BlockDataBasic, error) {
	ctx, cancel := context.WithTimeout(pgb.ctx, pgb.queryTimeout)
	defer cancel()
	blockSummary, err := RetrieveBlockSummaryByTimeRange(ctx, pgb.db, min, max, limit)
	return blockSummary, pgb.replaceCancelError(err)
}

// AddressUTXO returns the unspent transaction outputs (UTXOs) paying to the
// specified address in a []*dbtypes.AddressTxnOutput.
func (pgb *ChainDB) AddressUTXO(address string) ([]*dbtypes.AddressTxnOutput, bool, error) {
	_, err := stdaddr.DecodeAddress(address, pgb.chainParams)
	if err != nil {
		return nil, false, err
	}

	// Check the cache first.
	bestHash, height := pgb.BestBlock()
	utxos, validHeight := pgb.AddressCache.UTXOs(address)
	if utxos != nil && validHeight != nil /* validHeight.Hash == *bestHash */ {
		return utxos, false, nil
	}

	// Cache is empty or stale.

	// Make the pointed to AddressTxnOutput structs eligible for garbage
	// collection. pgb.AddressCache.StoreUTXOs sets a new slice retrieved from
	// the database, so we do not want to hang on to a copy of the old slice.
	var oldUTXOs bool
	if utxos != nil {
		//nolint:ineffassign
		utxos = nil
		oldUTXOs = true // flag to clear them from cache if we update them
	}

	busy, wait, done := pgb.CacheLocks.utxo.TryLock(address)
	if busy {
		// Let others get the wait channel while we wait.
		// To return stale cache data if it is available:
		// utxos, _ := pgb.AddressCache.UTXOs(address)
		// if utxos != nil {
		// 	return utxos, nil
		// }
		<-wait

		// Try again, starting with the cache.
		return pgb.AddressUTXO(address)
	}

	// We will run the DB query, so block others from doing the same. When query
	// and/or cache update is completed, broadcast to any waiters that the coast
	// is clear.
	defer done()

	// Prior to performing the query, clear the old UTXOs to save memory.
	if oldUTXOs {
		pgb.AddressCache.ClearUTXOs(address)
	}

	// Query the DB for the current UTXO set for this address.
	ctx, cancel := context.WithTimeout(pgb.ctx, pgb.queryTimeout)
	defer cancel()
	txnOutputs, err := RetrieveAddressDbUTXOs(ctx, pgb.db, address)
	if err != nil {
		return nil, false, pgb.replaceCancelError(err)
	}

	// Update the address cache.
	cacheUpdated := pgb.AddressCache.StoreUTXOs(address, txnOutputs,
		cache.NewBlockID(bestHash, height))
	return txnOutputs, cacheUpdated, nil
}

// SpendDetailsForFundingTx will return the details of any spending transactions
// (tx, index, block height) for a given funding transaction.
func (pgb *ChainDB) SpendDetailsForFundingTx(fundHash string) ([]*apitypes.SpendByFundingHash, error) {
	ctx, cancel := context.WithTimeout(pgb.ctx, pgb.queryTimeout)
	defer cancel()
	addrRow, err := RetrieveSpendingTxsByFundingTxWithBlockHeight(ctx, pgb.db, fundHash)
	if err != nil {
		return nil, pgb.replaceCancelError(err)
	}
	return addrRow, nil
}

func (pgb *ChainDB) MoneroDecodeOutputs(txid, address, viewkey string) (*xmrclient.DecodedTx, error) {
	pgb.xmrDecodeMutex.Lock()
	defer pgb.xmrDecodeMutex.Unlock()
	// get tx object
	txs, err := pgb.XmrClient.GetTransactions([]string{txid}, true)
	if err != nil {
		return nil, err
	}
	if len(txs.Txs) == 0 {
		return nil, fmt.Errorf("XMR: txs result is empty")
	}
	txData := txs.Txs[0]
	restoreBlock := txData.BlockHeight

	txJSONStr := txs.TxsAsJSON[0]
	// call decode outputs function
	return xmrclient.DecodeOutputs(pgb.ctx, pgb.xmrWalletCfg.xmrWalletRpc, pgb.xmrWalletCfg.xmrRpcAuth, pgb.xmrWalletCfg.xmrWalletDir,
		address, viewkey, txid, txJSONStr, uint64(restoreBlock), 10, 90*time.Second)
	// return xmrclient.DecodeOutputs2(address, viewkey, txid, txJSONStr)
}

func (pgb *ChainDB) MoneroProveOutputs(txid, address, txkey string) (*xmrclient.ProveByTxKeyResult, error) {
	pgb.xmrProveMutex.Lock()
	defer pgb.xmrProveMutex.Unlock()
	tempWalletName := "prove_wallet"
	return xmrclient.ProveByTxKey(pgb.ctx, pgb.xmrWalletCfg.xmrProveRpc, pgb.xmrWalletCfg.xmrProveAuth, pgb.xmrWalletCfg.xmrProveDir, tempWalletName, txid, txkey, address)
}
