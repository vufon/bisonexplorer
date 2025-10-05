// Copyright (c) 2018-2021, The Decred developers
// Copyright (c) 2017, The dcrdata developers
// See LICENSE for details.

package dcrpg

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/hex"
	"fmt"
	"math"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	btcchaincfg "github.com/btcsuite/btcd/chaincfg"
	btcClient "github.com/btcsuite/btcd/rpcclient"
	btcwire "github.com/btcsuite/btcd/wire"
	"github.com/decred/dcrdata/db/dcrpg/v8/internal"
	"github.com/decred/dcrdata/db/dcrpg/v8/internal/mutilchainquery"
	apitypes "github.com/decred/dcrdata/v8/api/types"
	"github.com/decred/dcrdata/v8/db/dbtypes"
	"github.com/decred/dcrdata/v8/mutilchain"
	"github.com/decred/dcrdata/v8/mutilchain/btcrpcutils"
	"github.com/decred/dcrdata/v8/mutilchain/ltcrpcutils"
	"github.com/decred/dcrdata/v8/txhelpers"
	"github.com/decred/dcrdata/v8/xmr/xmrclient"
	"github.com/decred/dcrdata/v8/xmr/xmrhelper"
	"github.com/ltcsuite/ltcd/chaincfg"
	ltcClient "github.com/ltcsuite/ltcd/rpcclient"
	"github.com/ltcsuite/ltcd/wire"
)

// SyncChainDBAsync is like SyncChainDB except it also takes a result channel on
// which the caller should wait to receive the result. As such, this method
// should be called as a goroutine or it will hang on send if the channel is
// unbuffered.
func (db *ChainDB) SyncLTCChainDBAsync(res chan dbtypes.SyncResult,
	client *ltcClient.Client, quit chan struct{}, updateAllAddresses, newIndexes bool) {
	if db == nil {
		res <- dbtypes.SyncResult{
			Height: -1,
			Error:  fmt.Errorf("ChainDB LTC (psql) disabled"),
		}
		return
	}
	height, err := db.SyncLTCChainDB(client, quit, newIndexes, updateAllAddresses)
	res <- dbtypes.SyncResult{
		Height: height,
		Error:  err,
	}
}

func (db *ChainDB) SyncBTCChainDBAsync(res chan dbtypes.SyncResult,
	client *btcClient.Client, quit chan struct{}, updateAllAddresses, newIndexes bool) {
	if db == nil {
		res <- dbtypes.SyncResult{
			Height: -1,
			Error:  fmt.Errorf("ChainDB BTC (psql) disabled"),
		}
		return
	}
	height, err := db.SyncBTCChainDB(client, quit, newIndexes, updateAllAddresses)
	res <- dbtypes.SyncResult{
		Height: height,
		Error:  err,
	}
}

func (db *ChainDB) SyncBTCChainDB(client *btcClient.Client, quit chan struct{},
	newIndexes, updateAllAddresses bool) (int64, error) {
	// Get chain servers's best block
	_, nodeHeight, err := client.GetBestBlock()
	if err != nil {
		return -1, fmt.Errorf("GetBestBlock BTC failed: %v", err)
	}
	// Total and rate statistics
	var totalTxs, totalVins, totalVouts int64
	var lastTxs, lastVins, lastVouts int64
	tickTime := 20 * time.Second
	ticker := time.NewTicker(tickTime)
	startTime := time.Now()
	o := sync.Once{}
	speedReporter := func() {
		ticker.Stop()
		totalElapsed := time.Since(startTime).Seconds()
		if int64(totalElapsed) == 0 {
			return
		}
		totalVoutPerSec := totalVouts / int64(totalElapsed)
		totalTxPerSec := totalTxs / int64(totalElapsed)
		log.Infof("Avg. speed: %d tx/s, %d vout/s", totalTxPerSec, totalVoutPerSec)
	}
	speedReport := func() { o.Do(speedReporter) }
	defer speedReport()

	startingHeight, err := db.MutilchainHeightDB(mutilchain.TYPEBTC)
	lastBlock := int64(startingHeight)
	if err != nil {
		if err == sql.ErrNoRows {
			lastBlock = -1
			log.Info("blocks table is empty, starting fresh.")
		} else {
			return -1, fmt.Errorf("RetrieveBestBlockHeight: %v", err)
		}
	}

	// Remove indexes/constraints before bulk import
	blocksToSync := int64(nodeHeight) - lastBlock
	reindexing := newIndexes || blocksToSync > int64(nodeHeight)/2
	if reindexing {
		log.Info("BTC Large bulk load: Removing indexes and disabling duplicate checks.")
		err = db.DeindexAllMutilchain(mutilchain.TYPEBTC)
		if err != nil && !strings.Contains(err.Error(), "does not exist") && !strings.Contains(err.Error(), "不存在") {
			return lastBlock, err
		}
		db.MutilchainEnableDuplicateCheckOnInsert(false, mutilchain.TYPEBTC)
	} else {
		db.MutilchainEnableDuplicateCheckOnInsert(true, mutilchain.TYPEBTC)
	}

	// Start rebuilding
	startHeight := lastBlock + 1
	for ib := startHeight; ib <= int64(nodeHeight); ib++ {
		// check for quit signal
		select {
		case <-quit:
			log.Infof("BTC: Rescan cancelled at height %d.", ib)
			return ib - 1, nil
		default:
		}

		if (ib-1)%btcRescanLogBlockChunk == 0 || ib == startHeight {
			if ib == 0 {
				log.Infof("BTC: Scanning genesis block.")
			} else {
				endRangeBlock := btcRescanLogBlockChunk * (1 + (ib-1)/btcRescanLogBlockChunk)
				if endRangeBlock > int64(nodeHeight) {
					endRangeBlock = int64(nodeHeight)
				}
				log.Infof("BTC: Processing blocks %d to %d...", ib, endRangeBlock)
			}
		}
		select {
		case <-ticker.C:
			blocksPerSec := float64(ib-lastBlock) / tickTime.Seconds()
			txPerSec := float64(totalTxs-lastTxs) / tickTime.Seconds()
			vinsPerSec := float64(totalVins-lastVins) / tickTime.Seconds()
			voutPerSec := float64(totalVouts-lastVouts) / tickTime.Seconds()
			log.Infof("(%3d blk/s,%5d tx/s,%5d vin/sec,%5d vout/s)", int64(blocksPerSec),
				int64(txPerSec), int64(vinsPerSec), int64(voutPerSec))
			lastBlock, lastTxs = ib, totalTxs
			lastVins, lastVouts = totalVins, totalVouts
		default:
		}

		block, blockHash, err := btcrpcutils.GetBlock(ib, client)
		if err != nil {
			return ib - 1, fmt.Errorf("BTC: GetBlock failed (%s): %v", blockHash, err)
		}
		var numVins, numVouts int64
		if numVins, numVouts, err = db.StoreBTCBlock(client, block.MsgBlock(), true, !updateAllAddresses); err != nil {
			return ib - 1, fmt.Errorf("BTC: StoreBlock failed: %v", err)
		}
		totalVins += numVins
		totalVouts += numVouts

		numRTx := int64(len(block.Transactions()))
		totalTxs += numRTx
		// totalRTxs += numRTx
		// totalSTxs += numSTx

		// update height, the end condition for the loop
		if _, nodeHeight, err = client.GetBestBlock(); err != nil {
			return ib, fmt.Errorf("BTC: GetBestBlock failed: %v", err)
		}
	}

	speedReport()

	if reindexing || newIndexes {
		if err = db.IndexAllMutilchain(mutilchain.TYPEBTC); err != nil {
			return int64(nodeHeight), fmt.Errorf("BTC: IndexAllMutilchain failed: %v", err)
		}
		if !updateAllAddresses {
			err = db.IndexMutilchainAddressesTable(mutilchain.TYPEBTC)
		}
	}

	if updateAllAddresses {
		// Remove existing indexes not on funding txns
		_ = db.DeindexMutilchainAddressesTable(mutilchain.TYPEBTC) // ignore errors for non-existent indexes
		log.Infof("BTC: Populating spending tx info in address table...")
		numAddresses, err := db.UpdateMutilchainSpendingInfoInAllAddresses(mutilchain.TYPEBTC)
		if err != nil {
			log.Errorf("BTC: UpdateSpendingInfoInAllAddresses for BTC FAILED: %v", err)
		}
		log.Infof("BTC: Updated %d rows of address table", numAddresses)
		if err = db.IndexMutilchainAddressesTable(mutilchain.TYPEBTC); err != nil {
			log.Errorf("BTC: IndexBTCAddressTable FAILED: %v", err)
		}
	}
	db.MutilchainEnableDuplicateCheckOnInsert(true, mutilchain.TYPEBTC)
	log.Infof("BTC: Sync finished at height %d. Delta: %d blocks, %d transactions, %d ins, %d outs",
		nodeHeight, int64(nodeHeight)-startHeight+1, totalTxs, totalVins, totalVouts)
	return int64(nodeHeight), err
}

func (pgb *ChainDB) SyncLast20BTCBlocks(nodeHeight int32) error {
	pgb.btc20BlocksSyncMtx.Lock()
	defer pgb.btc20BlocksSyncMtx.Unlock()
	//preprocessing, check from DB
	// Total and rate statistics
	var totalTxs, totalVins, totalVouts int64
	startHeight := nodeHeight - 25
	//Delete all blocks data and blocks related data older than start block
	//Delete vins, vouts
	err := DeleteVinsOfOlderThan20Blocks(pgb.ctx, pgb.db, mutilchain.TYPEBTC, int64(startHeight))
	if err != nil {
		return err
	}
	err = DeleteVoutsOfOlderThan20Blocks(pgb.ctx, pgb.db, mutilchain.TYPEBTC, int64(startHeight))
	if err != nil {
		return err
	}
	// Start rebuilding
	for ib := startHeight; ib <= nodeHeight; ib++ {
		block, blockHash, err := btcrpcutils.GetBlock(int64(ib), pgb.BtcClient)
		if err != nil {
			return fmt.Errorf("BTC: GetBlock failed (%s): %v", blockHash, err)
		}
		var numVins, numVouts int64
		//check exist on DB
		exist, err := CheckBlockExistOnDB(pgb.ctx, pgb.db, mutilchain.TYPEBTC, int64(ib))
		if err != nil {
			return fmt.Errorf("BTC: Check exist block (%d) on db failed: %v", ib, err)
		}
		if exist {
			// sync and update for block
			dbBlockInfo, err := RetrieveBlockInfo(pgb.ctx, pgb.db, mutilchain.TYPEBTC, int64(ib))
			if err != nil {
				return fmt.Errorf("BTC: Get block detail (%d) on db failed: %v", ib, err)
			}
			// if have summary info, ignore
			if dbBlockInfo.TxCount > 0 || dbBlockInfo.Inputs > 0 || dbBlockInfo.Outputs > 0 {
				continue
			}
			// if don't have any info, update summary info
			if numVins, numVouts, err = pgb.UpdateStoreBTCBlockInfo(pgb.BtcClient, block.MsgBlock(), int64(ib), false); err != nil {
				return fmt.Errorf("BTC UpdateStoreBlock failed: %v", err)
			}
		} else {
			if numVins, numVouts, err = pgb.StoreBTCBlockInfo(pgb.BtcClient, block.MsgBlock(), int64(ib), false); err != nil {
				return fmt.Errorf("BTC StoreBlock failed: %v", err)
			}
		}
		totalVins += numVins
		totalVouts += numVouts
		numRTx := int64(len(block.Transactions()))
		totalTxs += numRTx
		// update height, the end condition for the loop
		if _, nodeHeight, err = pgb.BtcClient.GetBestBlock(); err != nil {
			return fmt.Errorf("BTC: GetBestBlock failed: %v", err)
		}
	}

	log.Debugf("BTC: Sync last 20 Blocks of BTC finished at height %d. Delta: %d blocks, %d transactions, %d ins, %d outs",
		nodeHeight, int64(nodeHeight)-int64(startHeight)+1, totalTxs, totalVins, totalVouts)
	return err
}

func (pgb *ChainDB) SyncLast20LTCBlocks(nodeHeight int32) error {
	pgb.ltc20BlocksSyncMtx.Lock()
	defer pgb.ltc20BlocksSyncMtx.Unlock()
	// Total and rate statistics
	var totalTxs, totalVins, totalVouts int64
	startHeight := nodeHeight - 25
	//Delete all blocks data and blocks related data older than start block
	//Delete vins, vouts
	err := DeleteVinsOfOlderThan20Blocks(pgb.ctx, pgb.db, mutilchain.TYPELTC, int64(startHeight))
	if err != nil {
		return err
	}
	err = DeleteVoutsOfOlderThan20Blocks(pgb.ctx, pgb.db, mutilchain.TYPELTC, int64(startHeight))
	if err != nil {
		return err
	}
	// Start rebuilding
	for ib := startHeight; ib <= nodeHeight; ib++ {
		block, blockHash, err := ltcrpcutils.GetBlock(int64(ib), pgb.LtcClient)
		if err != nil {
			return fmt.Errorf("LTC: GetBlock failed (%s): %v", blockHash, err)
		}
		var numVins, numVouts int64
		//check exist on DB
		exist, err := CheckBlockExistOnDB(pgb.ctx, pgb.db, mutilchain.TYPELTC, int64(ib))
		if err != nil {
			return fmt.Errorf("LTC: Check exist block (%d) on db failed: %v", ib, err)
		}
		// if exist
		if exist {
			// sync and update for block
			dbBlockInfo, err := RetrieveBlockInfo(pgb.ctx, pgb.db, mutilchain.TYPELTC, int64(ib))
			if err != nil {
				return fmt.Errorf("LTC: Get block detail (%d) on db failed: %v", ib, err)
			}
			// if have summary info, ignore
			if dbBlockInfo.TxCount > 0 || dbBlockInfo.Inputs > 0 || dbBlockInfo.Outputs > 0 {
				continue
			}
			// if don't have any info, update summary info
			if numVins, numVouts, err = pgb.UpdateStoreLTCBlockInfo(pgb.LtcClient, block.MsgBlock(), int64(ib), false); err != nil {
				return fmt.Errorf("LTC UpdateStoreBlock failed: %v", err)
			}
		} else {
			if numVins, numVouts, err = pgb.StoreLTCBlockInfo(pgb.LtcClient, block.MsgBlock(), int64(ib), false); err != nil {
				return fmt.Errorf("LTC StoreBlock failed: %v", err)
			}
		}
		totalVins += numVins
		totalVouts += numVouts
		numRTx := int64(len(block.Transactions()))
		totalTxs += numRTx
		// update height, the end condition for the loop
		if _, nodeHeight, err = pgb.LtcClient.GetBestBlock(); err != nil {
			return fmt.Errorf("LTC: GetBestBlock failed: %v", err)
		}
	}
	log.Debugf("LTC: Sync last 20 Blocks of LTC finished at height %d. Delta: %d blocks, %d transactions, %d ins, %d outs",
		nodeHeight, int64(nodeHeight)-int64(startHeight)+1, totalTxs, totalVins, totalVouts)
	return err
}

func (db *ChainDB) SyncLTCChainDB(client *ltcClient.Client, quit chan struct{},
	newIndexes, updateAllAddresses bool) (int64, error) {
	// Get chain servers's best block
	_, nodeHeight, err := client.GetBestBlock()
	if err != nil {
		return -1, fmt.Errorf("GetBestBlock LTC failed: %v", err)
	}
	// Total and rate statistics
	var totalTxs, totalVins, totalVouts int64
	var lastTxs, lastVins, lastVouts int64
	tickTime := 20 * time.Second
	ticker := time.NewTicker(tickTime)
	startTime := time.Now()
	o := sync.Once{}
	speedReporter := func() {
		ticker.Stop()
		totalElapsed := time.Since(startTime).Seconds()
		if int64(totalElapsed) == 0 {
			return
		}
		totalVoutPerSec := totalVouts / int64(totalElapsed)
		totalTxPerSec := totalTxs / int64(totalElapsed)
		log.Infof("Avg. speed: %d tx/s, %d vout/s", totalTxPerSec, totalVoutPerSec)
	}
	speedReport := func() { o.Do(speedReporter) }
	defer speedReport()

	startingHeight, err := db.MutilchainHeightDB(mutilchain.TYPELTC)
	lastBlock := int64(startingHeight)
	if err != nil {
		if err == sql.ErrNoRows {
			lastBlock = -1
			log.Info("blocks table is empty, starting fresh.")
		} else {
			return -1, fmt.Errorf("RetrieveBestBlockHeight: %v", err)
		}
	}

	// Remove indexes/constraints before bulk import
	blocksToSync := int64(nodeHeight) - lastBlock
	reindexing := newIndexes || blocksToSync > int64(nodeHeight)/2
	if reindexing {
		log.Info("LTC: Large bulk load: Removing indexes and disabling duplicate checks.")
		err = db.DeindexAllMutilchain(mutilchain.TYPELTC)
		if err != nil && !strings.Contains(err.Error(), "does not exist") && !strings.Contains(err.Error(), "不存在") {
			return lastBlock, err
		}
		db.MutilchainEnableDuplicateCheckOnInsert(false, mutilchain.TYPELTC)
	} else {
		db.MutilchainEnableDuplicateCheckOnInsert(true, mutilchain.TYPELTC)
	}

	// Start rebuilding
	startHeight := lastBlock + 1
	for ib := startHeight; ib <= int64(nodeHeight); ib++ {
		// check for quit signal
		select {
		case <-quit:
			log.Infof("Rescan cancelled at height %d.", ib)
			return ib - 1, nil
		default:
		}

		if (ib-1)%ltcRescanLogBlockChunk == 0 || ib == startHeight {
			if ib == 0 {
				log.Infof("Scanning genesis block.")
			} else {
				endRangeBlock := ltcRescanLogBlockChunk * (1 + (ib-1)/ltcRescanLogBlockChunk)
				if endRangeBlock > int64(nodeHeight) {
					endRangeBlock = int64(nodeHeight)
				}
				log.Infof("Processing blocks %d to %d...", ib, endRangeBlock)
			}
		}
		select {
		case <-ticker.C:
			blocksPerSec := float64(ib-lastBlock) / tickTime.Seconds()
			txPerSec := float64(totalTxs-lastTxs) / tickTime.Seconds()
			vinsPerSec := float64(totalVins-lastVins) / tickTime.Seconds()
			voutPerSec := float64(totalVouts-lastVouts) / tickTime.Seconds()
			log.Infof("(%3d blk/s,%5d tx/s,%5d vin/sec,%5d vout/s)", int64(blocksPerSec),
				int64(txPerSec), int64(vinsPerSec), int64(voutPerSec))
			lastBlock, lastTxs = ib, totalTxs
			lastVins, lastVouts = totalVins, totalVouts
		default:
		}

		block, blockHash, err := ltcrpcutils.GetBlock(ib, client)
		if err != nil {
			return ib - 1, fmt.Errorf("GetBlock failed (%s): %v", blockHash, err)
		}
		var numVins, numVouts int64
		if numVins, numVouts, err = db.StoreLTCBlock(client, block.MsgBlock(), true, !updateAllAddresses); err != nil {
			return ib - 1, fmt.Errorf("LTC StoreBlock failed: %v", err)
		}
		totalVins += numVins
		totalVouts += numVouts

		numRTx := int64(len(block.Transactions()))
		totalTxs += numRTx
		// totalRTxs += numRTx
		// totalSTxs += numSTx

		// update height, the end condition for the loop
		if _, nodeHeight, err = client.GetBestBlock(); err != nil {
			return ib, fmt.Errorf("GetBestBlock failed: %v", err)
		}
	}

	speedReport()

	if reindexing || newIndexes {
		if err = db.IndexAllMutilchain(mutilchain.TYPELTC); err != nil {
			return int64(nodeHeight), fmt.Errorf("IndexAllMutilchain failed: %v", err)
		}
		if !updateAllAddresses {
			err = db.IndexMutilchainAddressesTable(mutilchain.TYPELTC)
		}
	}

	if updateAllAddresses {
		// Remove existing indexes not on funding txns
		_ = db.DeindexMutilchainAddressesTable(mutilchain.TYPELTC) // ignore errors for non-existent indexes
		log.Infof("Populating spending tx info in address table...")
		numAddresses, err := db.UpdateMutilchainSpendingInfoInAllAddresses(mutilchain.TYPELTC)
		if err != nil {
			log.Errorf("UpdateSpendingInfoInAllAddresses for LTC FAILED: %v", err)
		}
		log.Infof("Updated %d rows of address table", numAddresses)
		if err = db.IndexMutilchainAddressesTable(mutilchain.TYPELTC); err != nil {
			log.Errorf("IndexLTCAddressTable FAILED: %v", err)
		}
	}
	db.MutilchainEnableDuplicateCheckOnInsert(true, mutilchain.TYPELTC)
	log.Infof("Sync finished at height %d. Delta: %d blocks, %d transactions, %d ins, %d outs",
		nodeHeight, int64(nodeHeight)-startHeight+1, totalTxs, totalVins, totalVouts)

	return int64(nodeHeight), err
}

// StoreBlock processes the input wire.MsgBlock, and saves to the data tables.
// The number of vins, and vouts stored are also returned.
func (pgb *ChainDB) StoreBTCBlock(client *btcClient.Client, msgBlock *btcwire.MsgBlock,
	isValid, updateAddressesSpendingInfo bool) (numVins int64, numVouts int64, err error) {
	// Convert the wire.MsgBlock to a dbtypes.Block
	dbBlock := dbtypes.MsgBTCBlockToDBBlock(client, msgBlock, pgb.btcChainParams)
	// Extract transactions and their vouts, and insert vouts into their pg table,
	// returning their DB PKs, which are stored in the corresponding transaction
	// data struct. Insert each transaction once they are updated with their
	// vouts' IDs, returning the transaction PK ID, which are stored in the
	// containing block data struct.

	// regular transactions
	resChanReg := make(chan storeTxnsResult)
	go func() {
		resChanReg <- pgb.storeBTCTxns(client, dbBlock, msgBlock,
			pgb.btcChainParams, &dbBlock.TxDbIDs, updateAddressesSpendingInfo, true, true)
	}()
	errReg := <-resChanReg
	numVins = errReg.numVins
	numVouts = errReg.numVouts
	dbBlock.NumVins = uint32(numVins)
	dbBlock.NumVouts = uint32(numVouts)
	dbBlock.Fees = uint64(errReg.fees)
	dbBlock.TotalSent = uint64(errReg.totalSent)
	// Store the block now that it has all it's transaction PK IDs
	var blockDbID uint64
	blockDbID, err = InsertMutilchainBlock(pgb.db, dbBlock, isValid, pgb.btcDupChecks, mutilchain.TYPEBTC)
	if err != nil {
		log.Error("BTC: InsertBlock:", err)
		return
	}
	pgb.btcLastBlock[msgBlock.BlockHash()] = blockDbID

	pgb.BtcBestBlock = &MutilchainBestBlock{
		Height: int64(dbBlock.Height),
		Hash:   dbBlock.Hash,
	}
	err = InsertMutilchainBlockPrevNext(pgb.db, blockDbID, dbBlock.Hash,
		dbBlock.PreviousHash, "", mutilchain.TYPEBTC)
	if err != nil && err != sql.ErrNoRows {
		log.Error("BTC: InsertBlockPrevNext:", err)
		return
	}

	pgb.BtcBestBlock.Mtx.Lock()
	pgb.BtcBestBlock.Height = int64(dbBlock.Height)
	pgb.BtcBestBlock.Hash = dbBlock.Hash
	pgb.BtcBestBlock.Mtx.Unlock()

	// Update last block in db with this block's hash as it's next. Also update
	// isValid flag in last block if votes in this block invalidated it.
	lastBlockHash := msgBlock.Header.PrevBlock
	lastBlockDbID, ok := pgb.btcLastBlock[lastBlockHash]
	if ok {
		log.Infof("BTC: Setting last block %s. Height: %d", lastBlockHash, dbBlock.Height)
		err = UpdateMutilchainLastBlock(pgb.db, lastBlockDbID, false, mutilchain.TYPEBTC)
		if err != nil {
			log.Error("BTC: UpdateLastBlock:", err)
			return
		}
		err = UpdateMutilchainBlockNext(pgb.db, lastBlockDbID, dbBlock.Hash, mutilchain.TYPEBTC)
		if err != nil {
			log.Error("UpdateBlockNext:", err)
			return
		}
	}
	return
}

// StoreBTCBlockInfo. Store only blockinfo. For get summary info of block (Not use when sync blockchain data)
func (pgb *ChainDB) StoreBTCBlockInfo(client *btcClient.Client, msgBlock *btcwire.MsgBlock, height int64, allSync bool) (numVins int64, numVouts int64, err error) {
	log.Infof("BTC: Start sync block info. Height: %d", height)
	// Convert the wire.MsgBlock to a dbtypes.Block
	dbBlock := dbtypes.MsgBTCBlockToDBBlock(client, msgBlock, pgb.btcChainParams)
	// regular transactions
	resChanReg := make(chan storeTxnsResult)
	go func() {
		resChanReg <- pgb.getBTCTxnsInfo(client, dbBlock, msgBlock,
			pgb.btcChainParams)
	}()
	errReg := <-resChanReg
	dbBlock.NumVins = uint32(errReg.numVins)
	dbBlock.NumVouts = uint32(errReg.numVouts)
	dbBlock.Fees = uint64(errReg.fees)
	numVins = errReg.numVins
	numVouts = errReg.numVouts
	dbBlock.TotalSent = uint64(errReg.totalSent)
	// Store the block now that it has all it's transaction PK IDs
	_, err = InsertMutilchainBlock(pgb.db, dbBlock, true, pgb.btcDupChecks, mutilchain.TYPEBTC)
	if err != nil {
		log.Error("BTC: InsertBlock:", err)
		return
	}
	log.Infof("BTC: Finish sync block info. Height: %d", height)
	return
}

func (pgb *ChainDB) UpdateStoreBTCBlockInfo(client *btcClient.Client, msgBlock *btcwire.MsgBlock, height int64, allSync bool) (numVins int64, numVouts int64, err error) {
	log.Infof("BTC: Start update sync block info. Height: %d", height)
	// Convert the wire.MsgBlock to a dbtypes.Block
	dbBlock := dbtypes.MsgBTCBlockToDBBlock(client, msgBlock, pgb.btcChainParams)
	// regular transactions
	resChanReg := make(chan storeTxnsResult)
	go func() {
		resChanReg <- pgb.getBTCTxnsInfo(client, dbBlock, msgBlock,
			pgb.btcChainParams)
	}()

	errReg := <-resChanReg
	dbBlock.NumVins = uint32(errReg.numVins)
	dbBlock.NumVouts = uint32(errReg.numVouts)
	dbBlock.Fees = uint64(errReg.fees)
	numVins = errReg.numVins
	numVouts = errReg.numVouts
	dbBlock.TotalSent = uint64(errReg.totalSent)
	// Store the block now that it has all it's transaction PK IDs
	_, err = UpdateMutilchainBlock(pgb.db, dbBlock, true, mutilchain.TYPEBTC)
	if err != nil {
		log.Errorf("BTC: UpdateBlock failed: %v", err)
		return
	}
	log.Infof("BTC: Finish update sync block info. Height: %d", height)
	return
}

func (pgb *ChainDB) UpdateStoreLTCBlockInfo(client *ltcClient.Client, msgBlock *wire.MsgBlock, height int64, allSync bool) (numVins int64, numVouts int64, err error) {
	log.Infof("LTC: Start update sync block info. Height: %d", height)
	// Convert the wire.MsgBlock to a dbtypes.Block
	dbBlock := dbtypes.MsgLTCBlockToDBBlock(client, msgBlock, pgb.ltcChainParams)
	// regular transactions
	resChanReg := make(chan storeTxnsResult)
	go func() {
		resChanReg <- pgb.getLTCTxnsInfo(client, dbBlock, msgBlock,
			pgb.ltcChainParams)
	}()

	errReg := <-resChanReg
	dbBlock.NumVins = uint32(errReg.numVins)
	dbBlock.NumVouts = uint32(errReg.numVouts)
	dbBlock.Fees = uint64(errReg.fees)
	numVins = errReg.numVins
	numVouts = errReg.numVouts
	dbBlock.TotalSent = uint64(errReg.totalSent)
	// Store the block now that it has all it's transaction PK IDs
	_, err = UpdateMutilchainBlock(pgb.db, dbBlock, true, mutilchain.TYPELTC)
	if err != nil {
		log.Errorf("LTC: UpdateBlock failed: %v", err)
		return
	}
	log.Infof("LTC: Finish update sync block info. Height: %d", height)
	return
}

// StoreLTCBlockInfo. Store only blockinfo. For get summary info of block (Not use when sync blockchain data)
func (pgb *ChainDB) StoreLTCBlockInfo(client *ltcClient.Client, msgBlock *wire.MsgBlock, height int64, allSync bool) (numVins int64, numVouts int64, err error) {
	log.Infof("LTC: Start sync block info. Height: %d", height)
	// Convert the wire.MsgBlock to a dbtypes.Block
	dbBlock := dbtypes.MsgLTCBlockToDBBlock(client, msgBlock, pgb.ltcChainParams)
	// regular transactions
	resChanReg := make(chan storeTxnsResult)
	go func() {
		resChanReg <- pgb.getLTCTxnsInfo(client, dbBlock, msgBlock,
			pgb.ltcChainParams)
	}()

	errReg := <-resChanReg
	dbBlock.NumVins = uint32(errReg.numVins)
	dbBlock.NumVouts = uint32(errReg.numVouts)
	dbBlock.Fees = uint64(errReg.fees)
	numVins = errReg.numVins
	numVouts = errReg.numVouts
	dbBlock.TotalSent = uint64(errReg.totalSent)
	// Store the block now that it has all it's transaction PK IDs
	_, err = InsertMutilchainBlock(pgb.db, dbBlock, true, pgb.ltcDupChecks, mutilchain.TYPELTC)
	if err != nil {
		log.Error("LTC: InsertBlock:", err)
		return
	}
	log.Infof("LTC: Finish sync block info. Height: %d", height)
	return
}

// StoreBlock processes the input wire.MsgBlock, and saves to the data tables.
// The number of vins, and vouts stored are also returned.
func (pgb *ChainDB) StoreLTCBlock(client *ltcClient.Client, msgBlock *wire.MsgBlock,
	isValid, updateAddressesSpendingInfo bool) (numVins int64, numVouts int64, err error) {
	// Convert the wire.MsgBlock to a dbtypes.Block
	dbBlock := dbtypes.MsgLTCBlockToDBBlock(client, msgBlock, pgb.ltcChainParams)
	// Extract transactions and their vouts, and insert vouts into their pg table,
	// returning their DB PKs, which are stored in the corresponding transaction
	// data struct. Insert each transaction once they are updated with their
	// vouts' IDs, returning the transaction PK ID, which are stored in the
	// containing block data struct.

	// regular transactions
	resChanReg := make(chan storeTxnsResult)
	go func() {
		resChanReg <- pgb.storeLTCTxns(client, dbBlock, msgBlock,
			pgb.ltcChainParams, &dbBlock.TxDbIDs, updateAddressesSpendingInfo, true, true)
	}()

	errReg := <-resChanReg
	numVins = errReg.numVins
	numVouts = errReg.numVouts
	dbBlock.NumVins = uint32(numVins)
	dbBlock.NumVouts = uint32(numVouts)
	dbBlock.Fees = uint64(errReg.fees)
	dbBlock.TotalSent = uint64(errReg.totalSent)
	// Store the block now that it has all it's transaction PK IDs
	var blockDbID uint64
	blockDbID, err = InsertMutilchainBlock(pgb.db, dbBlock, isValid, pgb.ltcDupChecks, mutilchain.TYPELTC)
	if err != nil {
		log.Error("InsertBlock:", err)
		return
	}
	pgb.ltcLastBlock[msgBlock.BlockHash()] = blockDbID

	// pgb.LtcBestBlock = &MutilchainBestBlock{
	// 	Height: int64(dbBlock.Height),
	// 	Hash:   dbBlock.Hash,
	// }

	err = InsertMutilchainBlockPrevNext(pgb.db, blockDbID, dbBlock.Hash,
		dbBlock.PreviousHash, "", mutilchain.TYPELTC)
	if err != nil && err != sql.ErrNoRows {
		log.Error("InsertBlockPrevNext:", err)
		return
	}

	pgb.LtcBestBlock.Mtx.Lock()
	pgb.LtcBestBlock.Height = int64(dbBlock.Height)
	pgb.LtcBestBlock.Hash = dbBlock.Hash
	pgb.LtcBestBlock.Mtx.Unlock()

	// Update last block in db with this block's hash as it's next. Also update
	// isValid flag in last block if votes in this block invalidated it.
	lastBlockHash := msgBlock.Header.PrevBlock
	lastBlockDbID, ok := pgb.ltcLastBlock[lastBlockHash]
	if ok {
		log.Infof("LTC: Setting last block %s. Height: %d", lastBlockHash, dbBlock.Height)
		err = UpdateMutilchainLastBlock(pgb.db, lastBlockDbID, false, mutilchain.TYPELTC)
		if err != nil {
			log.Error("UpdateLastBlock:", err)
			return
		}
		err = UpdateMutilchainBlockNext(pgb.db, lastBlockDbID, dbBlock.Hash, mutilchain.TYPELTC)
		if err != nil {
			log.Error("UpdateBlockNext:", err)
			return
		}
	}
	return
}

func (pgb *ChainDB) StoreBTCWholeBlock(client *btcClient.Client, msgBlock *btcwire.MsgBlock, conflictCheck, updateAddressSpendInfo bool) (numVins int64, numVouts int64, err error) {
	// Convert the wire.MsgBlock to a dbtypes.Block
	dbBlock := dbtypes.MsgBTCBlockToDBBlock(client, msgBlock, pgb.btcChainParams)
	// regular transactions
	resChanReg := make(chan storeTxnsResult)
	go func() {
		resChanReg <- pgb.storeBTCWholeTxns(client, dbBlock, msgBlock, conflictCheck, updateAddressSpendInfo,
			pgb.btcChainParams)
	}()

	errReg := <-resChanReg
	numVins = errReg.numVins
	numVouts = errReg.numVouts
	dbBlock.NumVins = uint32(numVins)
	dbBlock.NumVouts = uint32(numVouts)
	dbBlock.Fees = uint64(errReg.fees)
	dbBlock.TotalSent = uint64(errReg.totalSent)
	// Store the block now that it has all it's transaction PK IDs
	_, err = InsertMutilchainWholeBlock(pgb.db, dbBlock, true, true, mutilchain.TYPEBTC)
	if err != nil {
		log.Error("BTC: InsertBlock:", err)
		return
	}

	// update synced flag for block
	// log.Infof("BTC: Set synced flag for height: %d", dbBlock.Height)
	err = UpdateMutilchainSyncedStatus(pgb.db, uint64(dbBlock.Height), mutilchain.TYPEBTC)
	if err != nil {
		log.Error("BTC: UpdateLastBlock:", err)
		return
	}
	return
}

func (pgb *ChainDB) storeLTCTxns(client *ltcClient.Client, block *dbtypes.Block, msgBlock *wire.MsgBlock,
	chainParams *chaincfg.Params, TxDbIDs *[]uint64,
	updateAddressesSpendingInfo, onlyTxInsert, allSync bool) storeTxnsResult {
	dbTransactions, dbTxVouts, dbTxVins := dbtypes.ExtractLTCBlockTransactions(client, block,
		msgBlock, chainParams)
	var txRes storeTxnsResult
	dbAddressRows := make([][]dbtypes.MutilchainAddressRow, len(dbTransactions))
	var totalAddressRows int
	var err error
	for it, dbtx := range dbTransactions {
		dbtx.VoutDbIds, dbAddressRows[it], err = InsertMutilchainVouts(pgb.db, dbTxVouts[it], pgb.ltcDupChecks, mutilchain.TYPELTC)
		if err != nil && err != sql.ErrNoRows {
			log.Error("InsertVouts:", err)
			txRes.err = err
			return txRes
		}
		totalAddressRows += len(dbAddressRows[it])
		txRes.numVouts += int64(len(dbtx.VoutDbIds))
		if err == sql.ErrNoRows || len(dbTxVouts[it]) != len(dbtx.VoutDbIds) {
			log.Warnf("Incomplete Vout insert.")
		}

		dbtx.VinDbIds, err = InsertMutilchainVins(pgb.db, dbTxVins[it], mutilchain.TYPELTC, pgb.ltcDupChecks)
		if err != nil && err != sql.ErrNoRows {
			log.Error("InsertVins:", err)
			txRes.err = err
			return txRes
		}
		for _, dbTxVout := range dbTxVouts[it] {
			txRes.totalSent += int64(dbTxVout.Value)
		}
		txRes.numVins += int64(len(dbtx.VinDbIds))
		txRes.fees += dbtx.Fees
	}

	if allSync {
		// Get the tx PK IDs for storage in the blocks table
		*TxDbIDs, err = InsertMutilchainTxns(pgb.db, dbTransactions, pgb.ltcDupChecks, mutilchain.TYPELTC)
		if err != nil && err != sql.ErrNoRows {
			log.Error("InsertTxns:", err)
			txRes.err = err
			return txRes
		}
		if !onlyTxInsert {
			return txRes
		}
		// Store tx Db IDs as funding tx in AddressRows and rearrange
		dbAddressRowsFlat := make([]*dbtypes.MutilchainAddressRow, 0, totalAddressRows)
		for it, txDbID := range *TxDbIDs {
			// Set the tx ID of the funding transactions
			for iv := range dbAddressRows[it] {
				// Transaction that pays to the address
				dba := &dbAddressRows[it][iv]
				dba.FundingTxDbID = txDbID
				// Funding tx hash, vout id, value, and address are already assigned
				// by InsertVouts. Only the funding tx DB ID was needed.
				dbAddressRowsFlat = append(dbAddressRowsFlat, dba)
			}
		}

		// Insert each new AddressRow, absent spending fields
		_, err = InsertMutilchainAddressOuts(pgb.db, dbAddressRowsFlat, mutilchain.TYPELTC, pgb.ltcDupChecks)
		if err != nil {
			log.Error("InsertAddressOuts:", err)
			txRes.err = err
			return txRes
		}
		if !updateAddressesSpendingInfo {
			return txRes
		}

		// Check the new vins and update sending tx data in Addresses table
		for it, txDbID := range *TxDbIDs {
			for iv := range dbTxVins[it] {
				// Transaction that spends an outpoint paying to >=0 addresses
				vin := &dbTxVins[it][iv]
				// Get the tx hash and vout index (previous output) from vins table
				// vinDbID, txHash, txIndex, _, err := RetrieveFundingOutpointByTxIn(
				// 	pgb.db, vin.TxID, vin.TxIndex)
				vinDbID := dbTransactions[it].VinDbIds[iv]
				// skip coinbase inputs
				if bytes.Equal(zeroHashStringBytes, []byte(vin.PrevTxHash)) {
					continue
				}

				var numAddressRowsSet int64
				numAddressRowsSet, err = SetMutilchainSpendingForFundingOP(pgb.db,
					vin.PrevTxHash, vin.PrevTxIndex, // funding
					txDbID, vin.TxID, vin.TxIndex, vinDbID, mutilchain.TYPELTC) // spending
				if err != nil {
					log.Errorf("SetSpendingForFundingOP: %v", err)
				}
				txRes.numAddresses += numAddressRowsSet
			}
		}
	}
	return txRes
}

func (pgb *ChainDB) SaveXMRBlockSummaryData(height int64) error {
	// get all tx with height
	txRes, err := pgb.retrieveXmrTxsWithHeight(height)
	if err != nil {
		log.Errorf("XMR: retrieveXmrTxsWithHeight failed: Height: %d, %v", height, err)
		return err
	}
	err = pgb.updateXMRBlockSummary(height, txRes)
	if err != nil {
		log.Errorf("XMR: updateXMRBlockSummary failed: Height: %d, %v", height, err)
		return err
	}
	return nil
}

func (pgb *ChainDB) updateXMRBlockSummary(height int64, txsParseRes storeTxnsResult) error {
	_, err := pgb.db.Exec(mutilchainquery.UpdateXMRBlockSummaryWithHeight, txsParseRes.ringSize,
		txsParseRes.avgRingSize, txsParseRes.feePerKb, txsParseRes.avgTxSize,
		txsParseRes.decoy03, txsParseRes.decoy47, txsParseRes.decoy811,
		txsParseRes.decoy1214, txsParseRes.decoyGe15, true, height)
	if err != nil {
		log.Errorf("XMR: Update xmr block summary failed: %v", err)
		return err
	}
	return nil
}

func (pgb *ChainDB) StoreXMRWholeBlock(client *xmrclient.XMRClient, checked, updateAddressesSpendingInfo bool, height int64) (numVins int64, numVouts int64, numTxs int64, err error) {
	br, berr := client.GetBlock(uint64(height))
	if berr != nil {
		err = berr
		log.Errorf("XMR: GetBlock(%d) failed: %v", height, err)
		return
	}
	// Convert the wire.MsgBlock to a dbtypes.Block
	dbBlock, blerr := xmrhelper.MsgXMRBlockToDBBlock(client, br, uint64(height))
	if blerr != nil {
		err = blerr
		log.Errorf("XMR: Get block data failed: Height: %d. Error: %v", height, err)
		return
	}
	dbtx, err := pgb.db.Begin()
	if err != nil {
		err = fmt.Errorf("XMR: Begin sql tx: %v", err)
		log.Error(err)
		return
	}
	committed := false
	defer func() {
		if !committed {
			_ = dbtx.Rollback()
		}
	}()

	txRes := pgb.storeXMRWholeTxns(dbtx, client, dbBlock, checked, updateAddressesSpendingInfo)
	if txRes.err != nil {
		err = txRes.err
		log.Errorf("XMR: storeXMRWholeTxns failed: %v", err)
		return
	}

	numVins = txRes.numVins
	numVouts = txRes.numVouts
	numTxs = int64(dbBlock.NumTx)
	dbBlock.NumVins = uint32(numVins)
	dbBlock.NumVouts = uint32(numVouts)
	dbBlock.Fees = uint64(txRes.fees)
	dbBlock.TotalSent = uint64(txRes.totalSent)
	var blobBytes []byte
	if br.Blob != "" {
		b, err := hex.DecodeString(br.Blob)
		if err == nil {
			blobBytes = b
		}
	}

	// Store the block now that it has all it's transaction PK IDs
	_, err = InsertXMRWholeBlock(dbtx, dbBlock, blobBytes, true, checked, txRes)
	if err != nil {
		log.Error("XMR: InsertBlock:", err)
		return
	}

	// update synced flag for block
	// log.Infof("LTC: Set synced flag for height: %d", dbBlock.Height)
	err = UpdateXMRBlockSyncedStatus(dbtx, uint64(dbBlock.Height), mutilchain.TYPEXMR)
	if err != nil {
		log.Error("XMR: UpdateLastBlock:", err)
		return
	}

	// 7) Commit the tx
	if cerr := dbtx.Commit(); cerr != nil {
		err = fmt.Errorf("commit tx: %v", cerr)
		log.Error(err)
		return
	}
	committed = true
	return
}

func (pgb *ChainDB) StoreLTCWholeBlock(client *ltcClient.Client, msgBlock *wire.MsgBlock, conflictCheck, updateAddressSpendInfo bool) (numVins int64, numVouts int64, err error) {
	// Convert the wire.MsgBlock to a dbtypes.Block
	dbBlock := dbtypes.MsgLTCBlockToDBBlock(client, msgBlock, pgb.ltcChainParams)
	// regular transactions
	resChanReg := make(chan storeTxnsResult)
	go func() {
		resChanReg <- pgb.storeLTCWholeTxns(client, dbBlock, msgBlock, conflictCheck, updateAddressSpendInfo,
			pgb.ltcChainParams)
	}()

	errReg := <-resChanReg
	numVins = errReg.numVins
	numVouts = errReg.numVouts
	dbBlock.NumVins = uint32(numVins)
	dbBlock.NumVouts = uint32(numVouts)
	dbBlock.Fees = uint64(errReg.fees)
	dbBlock.TotalSent = uint64(errReg.totalSent)
	// Store the block now that it has all it's transaction PK IDs
	_, err = InsertMutilchainWholeBlock(pgb.db, dbBlock, true, true, mutilchain.TYPELTC)
	if err != nil {
		log.Error("LTC: InsertBlock:", err)
		return
	}

	// update synced flag for block
	// log.Infof("LTC: Set synced flag for height: %d", dbBlock.Height)
	err = UpdateMutilchainSyncedStatus(pgb.db, uint64(dbBlock.Height), mutilchain.TYPELTC)
	if err != nil {
		log.Error("LTC: UpdateLastBlock:", err)
		return
	}
	return
}

func (pgb *ChainDB) storeBTCTxns(client *btcClient.Client, block *dbtypes.Block, msgBlock *btcwire.MsgBlock,
	chainParams *btcchaincfg.Params, TxDbIDs *[]uint64,
	updateAddressesSpendingInfo, onlyTxInsert, allSync bool) storeTxnsResult {
	dbTransactions, dbTxVouts, dbTxVins := dbtypes.ExtractBTCBlockTransactions(client, block,
		msgBlock, chainParams)
	var txRes storeTxnsResult
	dbAddressRows := make([][]dbtypes.MutilchainAddressRow, len(dbTransactions))
	var totalAddressRows int
	var err error
	for it, dbtx := range dbTransactions {
		dbtx.VoutDbIds, dbAddressRows[it], err = InsertMutilchainVouts(pgb.db, dbTxVouts[it], pgb.btcDupChecks, mutilchain.TYPEBTC)
		if err != nil && err != sql.ErrNoRows {
			log.Error("BTC: InsertVouts:", err)
			txRes.err = err
			return txRes
		}
		totalAddressRows += len(dbAddressRows[it])
		txRes.numVouts += int64(len(dbtx.VoutDbIds))
		if err == sql.ErrNoRows || len(dbTxVouts[it]) != len(dbtx.VoutDbIds) {
			log.Warnf("BTC: Incomplete Vout insert.")
		}
		dbtx.VinDbIds, err = InsertMutilchainVins(pgb.db, dbTxVins[it], mutilchain.TYPEBTC, pgb.btcDupChecks)
		if err != nil && err != sql.ErrNoRows {
			log.Error("BTC: InsertVins:", err)
			txRes.err = err
			return txRes
		}
		for _, dbTxVout := range dbTxVouts[it] {
			txRes.totalSent += int64(dbTxVout.Value)
		}
		txRes.numVins += int64(len(dbtx.VinDbIds))
		txRes.fees += dbtx.Fees
	}
	if allSync {
		// Get the tx PK IDs for storage in the blocks table
		*TxDbIDs, err = InsertMutilchainTxns(pgb.db, dbTransactions, pgb.btcDupChecks, mutilchain.TYPEBTC)
		if err != nil && err != sql.ErrNoRows {
			log.Error("InsertTxns:", err)
			txRes.err = err
			return txRes
		}
		if !onlyTxInsert {
			return txRes
		}
		// Store tx Db IDs as funding tx in AddressRows and rearrange
		dbAddressRowsFlat := make([]*dbtypes.MutilchainAddressRow, 0, totalAddressRows)
		for it, txDbID := range *TxDbIDs {
			// Set the tx ID of the funding transactions
			for iv := range dbAddressRows[it] {
				// Transaction that pays to the address
				dba := &dbAddressRows[it][iv]
				dba.FundingTxDbID = txDbID
				// Funding tx hash, vout id, value, and address are already assigned
				// by InsertVouts. Only the funding tx DB ID was needed.
				dbAddressRowsFlat = append(dbAddressRowsFlat, dba)
			}
		}
		// Insert each new AddressRow, absent spending fields
		_, err = InsertMutilchainAddressOuts(pgb.db, dbAddressRowsFlat, mutilchain.TYPEBTC, pgb.btcDupChecks)
		if err != nil {
			log.Error("BTC: InsertAddressOuts:", err)
			txRes.err = err
			return txRes
		}
		if !updateAddressesSpendingInfo {
			return txRes
		}
		// Check the new vins and update sending tx data in Addresses table
		for it, txDbID := range *TxDbIDs {
			for iv := range dbTxVins[it] {
				// Transaction that spends an outpoint paying to >=0 addresses
				vin := &dbTxVins[it][iv]
				vinDbID := dbTransactions[it].VinDbIds[iv]
				// skip coinbase inputs
				if bytes.Equal(zeroHashStringBytes, []byte(vin.PrevTxHash)) {
					continue
				}
				var numAddressRowsSet int64
				numAddressRowsSet, err = SetMutilchainSpendingForFundingOP(pgb.db,
					vin.PrevTxHash, vin.PrevTxIndex, // funding
					txDbID, vin.TxID, vin.TxIndex, vinDbID, mutilchain.TYPEBTC) // spending
				if err != nil {
					log.Errorf("BTC: SetSpendingForFundingOP: %v", err)
				}
				txRes.numAddresses += numAddressRowsSet
			}
		}
	}
	return txRes
}

func (pgb *ChainDB) getBTCTxnsInfo(client *btcClient.Client, block *dbtypes.Block, msgBlock *btcwire.MsgBlock,
	chainParams *btcchaincfg.Params) storeTxnsResult {
	dbTransactions := dbtypes.ExtractBTCBlockTransactionsSimpleInfo(client, block,
		msgBlock, chainParams)
	var txRes storeTxnsResult
	for _, dbtx := range dbTransactions {
		txRes.numVouts += int64(dbtx.NumVout)
		txRes.totalSent += dbtx.Sent
		txRes.numVins += int64(dbtx.NumVin)
		txRes.fees += dbtx.Fees
	}
	return txRes
}

func (pgb *ChainDB) getLTCTxnsInfo(client *ltcClient.Client, block *dbtypes.Block, msgBlock *wire.MsgBlock,
	chainParams *chaincfg.Params) storeTxnsResult {
	dbTransactions := dbtypes.ExtractLTCBlockTransactionsSimpleInfo(client, block,
		msgBlock, chainParams)
	var txRes storeTxnsResult
	for _, dbtx := range dbTransactions {
		txRes.numVouts += int64(dbtx.NumVout)
		txRes.totalSent += dbtx.Sent
		txRes.numVins += int64(dbtx.NumVin)
		txRes.fees += dbtx.Fees
	}
	return txRes
}

func (pgb *ChainDB) storeBTCWholeTxns(client *btcClient.Client, block *dbtypes.Block, msgBlock *btcwire.MsgBlock, conflictCheck, addressSpendingUpdateInfo bool,
	chainParams *btcchaincfg.Params) storeTxnsResult {
	dbTransactions, dbTxVouts, dbTxVins := dbtypes.ExtractBTCBlockTransactions(client, block,
		msgBlock, chainParams)
	var txRes storeTxnsResult
	dbAddressRows := make([][]dbtypes.MutilchainAddressRow, len(dbTransactions))
	var totalAddressRows int
	var err error
	for it, dbtx := range dbTransactions {
		dbtx.VoutDbIds, dbAddressRows[it], err = InsertMutilchainWholeVouts(pgb.db, dbTxVouts[it], conflictCheck, mutilchain.TYPEBTC)
		if err != nil && err != sql.ErrNoRows {
			log.Error("BTC: InsertVouts:", err)
			txRes.err = err
			return txRes
		}
		totalAddressRows += len(dbAddressRows[it])
		txRes.numVouts += int64(len(dbtx.VoutDbIds))
		if err == sql.ErrNoRows || len(dbTxVouts[it]) != len(dbtx.VoutDbIds) {
			log.Warnf("BTC: Incomplete Vout insert.")
		}
		dbtx.VinDbIds, err = InsertMutilchainWholeVins(pgb.db, dbTxVins[it], mutilchain.TYPEBTC, conflictCheck)
		if err != nil && err != sql.ErrNoRows {
			log.Error("BTC: InsertVins:", err)
			txRes.err = err
			return txRes
		}
		for _, dbTxVout := range dbTxVouts[it] {
			txRes.totalSent += int64(dbTxVout.Value)
		}
		txRes.numVins += int64(len(dbtx.VinDbIds))
		txRes.fees += dbtx.Fees
	}
	// Get the tx PK IDs for storage in the blocks table
	TxDbIDs, err := InsertMutilchainTxns(pgb.db, dbTransactions, conflictCheck, mutilchain.TYPEBTC)
	if err != nil && err != sql.ErrNoRows {
		log.Error("InsertTxns:", err)
		txRes.err = err
		return txRes
	}
	// Store tx Db IDs as funding tx in AddressRows and rearrange
	dbAddressRowsFlat := make([]*dbtypes.MutilchainAddressRow, 0, totalAddressRows)
	for it, txDbID := range TxDbIDs {
		// Set the tx ID of the funding transactions
		for iv := range dbAddressRows[it] {
			// Transaction that pays to the address
			dba := &dbAddressRows[it][iv]
			dba.FundingTxDbID = txDbID
			// Funding tx hash, vout id, value, and address are already assigned
			// by InsertVouts. Only the funding tx DB ID was needed.
			dbAddressRowsFlat = append(dbAddressRowsFlat, dba)
		}
	}
	// Insert each new AddressRow, absent spending fields
	_, err = InsertMutilchainAddressOuts(pgb.db, dbAddressRowsFlat, mutilchain.TYPEBTC, conflictCheck)
	if err != nil {
		log.Error("BTC: InsertAddressOuts:", err)
		txRes.err = err
		return txRes
	}
	if !addressSpendingUpdateInfo {
		return txRes
	}
	// Check the new vins and update sending tx data in Addresses table
	for it, txDbID := range TxDbIDs {
		for iv := range dbTxVins[it] {
			// Transaction that spends an outpoint paying to >=0 addresses
			vin := &dbTxVins[it][iv]
			vinDbID := dbTransactions[it].VinDbIds[iv]
			// skip coinbase inputs
			if bytes.Equal(zeroHashStringBytes, []byte(vin.PrevTxHash)) {
				continue
			}
			var numAddressRowsSet int64
			numAddressRowsSet, err = SetMutilchainSpendingForFundingOP(pgb.db,
				vin.PrevTxHash, vin.PrevTxIndex, // funding
				txDbID, vin.TxID, vin.TxIndex, vinDbID, mutilchain.TYPEBTC) // spending
			if err != nil {
				log.Errorf("BTC: SetSpendingForFundingOP: %v", err)
			}
			txRes.numAddresses += numAddressRowsSet
		}
	}
	// set address synced flag
	txRes.addressesSynced = true
	return txRes
}

func (pgb *ChainDB) retrieveXmrTxsWithHeight(blockHeight int64) (storeTxnsResult, error) {
	var txRes storeTxnsResult
	// rows, err := pgb.db.QueryContext(pgb.ctx, mutilchainquery.SelectXMRTxsByBlockHeight, blockHeight)
	// if err != nil {
	// 	return txRes, err
	// }
	// defer rows.Close()
	// txs := make([]*dbtypes.XmrTxSummaryInfo, 0)
	// for rows.Next() {
	// 	var txHash string
	// 	var fees, size int64
	// 	if err = rows.Scan(&txHash, &fees, &size); err != nil {
	// 		log.Errorf("retrieveXmrTxsWithHeight failed: %v", err)
	// 		return txRes, err
	// 	}
	// 	txs = append(txs, &dbtypes.XmrTxSummaryInfo{
	// 		Txid: txHash,
	// 		Fees: fees,
	// 		Size: size,
	// 	})
	// 	txids = append(txids, txHash)
	// }

	br, berr := pgb.XmrClient.GetBlock(uint64(blockHeight))
	if berr != nil {
		log.Errorf("XMR: GetBlock(%d) failed: %v", blockHeight, berr)
		return txRes, berr
	}

	txids := br.TxHashes
	var totalTxSize, totalRingSize, totalDecoy03, totalDecoy47, totalDecoy811, totalDecoy1214, totalDecoyGe15 int64
	if len(txids) > 0 {
		blTxsData, blTxserr := pgb.XmrClient.GetTransactions(txids, true)
		if blTxserr != nil {
			log.Errorf("XMR: GetTransactions failed: %v", blTxserr)
			return txRes, blTxserr
		}
		for i, _ := range txids {
			var txJSONStr string
			if i < len(blTxsData.TxsAsJSON) {
				txJSONStr = blTxsData.TxsAsJSON[i]
			}
			var txHex string
			if i < len(blTxsData.TxsAsHex) {
				txHex = blTxsData.TxsAsHex[i]
			}
			if txHex != "" {
				totalTxSize += int64(len(txHex) / 2)
			}
			// txRes.fees += tx.Fees
			// totalTxSize += tx.Size
			if txJSONStr != "" {
				parseResult, err := GetXmrTxParseJSONSimpleData(txJSONStr)
				if err != nil {
					log.Error("XMR: GetXmrTxParseJSONSimpleData failed: %v", err)
					return txRes, err
				}
				txRes.fees += parseResult.fees
				txRes.numVins += int64(parseResult.numVins)
				txRes.numVouts += int64(parseResult.numVouts)
				txRes.totalSent += parseResult.totalSent
				totalRingSize += int64(parseResult.ringSize)
				totalDecoy03 += int64(parseResult.decoy03Num)
				totalDecoy47 += int64(parseResult.decoy47Num)
				totalDecoy811 += int64(parseResult.decoy811Num)
				totalDecoy1214 += int64(parseResult.decoy1214Num)
				totalDecoyGe15 += int64(parseResult.decoyGe15Num)
			}
		}
	}
	// calculate for final
	txRes.ringSize = totalRingSize
	if txRes.numVins > 0 {
		txRes.avgRingSize = int64(math.Round(float64(totalRingSize) / float64(txRes.numVins)))
		txRes.decoy47 = 100 * (float64(totalDecoy47) / float64(txRes.numVins))
		txRes.decoy811 = 100 * (float64(totalDecoy811) / float64(txRes.numVins))
		txRes.decoy1214 = 100 * (float64(totalDecoy1214) / float64(txRes.numVins))
		txRes.decoyGe15 = 100 * (float64(totalDecoyGe15) / float64(txRes.numVins))
		txRes.decoy03 = 100 - txRes.decoy47 - txRes.decoy811 - txRes.decoy1214 - txRes.decoyGe15
	}
	txSizeKb := totalTxSize / 1024
	if txSizeKb > 0 {
		txRes.feePerKb = int64(math.Round(float64(txRes.fees) / float64(txSizeKb)))
	}
	if len(txids) > 0 {
		txRes.avgTxSize = totalTxSize / int64(len(txids))
	}
	return txRes, nil
}

func (pgb *ChainDB) storeXMRWholeTxns(dbtx *sql.Tx, client *xmrclient.XMRClient, block *dbtypes.Block, checked, addressSpendingUpdateInfo bool) storeTxnsResult {
	var txRes storeTxnsResult
	// insert to txs
	// fetch decoded txs JSON (batch)
	blTxsData, blTxserr := client.GetTransactions(block.Tx, true)
	if blTxserr != nil {
		log.Errorf("XMR: GetTransactions failed: %v", blTxserr)
		txRes.err = blTxserr
		return txRes
	}
	var totalTxSize, totalRingSize, totalDecoy03, totalDecoy47, totalDecoy811, totalDecoy1214, totalDecoyGe15 int64
	for i, txHash := range block.Tx {
		isCoinbaseTx := txHash == block.MinnerTxhash
		var txJSONStr string
		if i < len(blTxsData.TxsAsJSON) {
			txJSONStr = blTxsData.TxsAsJSON[i]
		}
		var txHex string
		if i < len(blTxsData.TxsAsHex) {
			txHex = blTxsData.TxsAsHex[i]
		}
		// insert transaction row
		// Get the tx PK IDs for storage in the blocks table
		_, fees, txSize, err := InsertXMRTxn(dbtx, block.Height, block.Hash, block.Time.T.Unix(), txHash, txHex, txJSONStr, checked)
		if err != nil && err != sql.ErrNoRows {
			log.Error("XMR: InsertTxn: %v", err)
			txRes.err = err
			return txRes
		}
		if !isCoinbaseTx {
			txRes.fees += fees
			totalTxSize += int64(txSize)
		}
		if txJSONStr != "" {
			parseResult, err := ParseAndStoreTxJSON(dbtx, txHash, uint64(block.Height), txJSONStr, checked, isCoinbaseTx)
			if err != nil {
				log.Error("XMR: ParseAndStoreTxJSON: %v", err)
				txRes.err = err
				return txRes
			}
			if !isCoinbaseTx {
				txRes.numVins += int64(parseResult.numVins)
				txRes.numVouts += int64(parseResult.numVouts)
				txRes.totalSent += parseResult.totalSent
				totalRingSize += int64(parseResult.ringSize)
				totalDecoy03 += int64(parseResult.decoy03Num)
				totalDecoy47 += int64(parseResult.decoy47Num)
				totalDecoy811 += int64(parseResult.decoy811Num)
				totalDecoy1214 += int64(parseResult.decoy1214Num)
				totalDecoyGe15 += int64(parseResult.decoyGe15Num)
			}
		}
	}
	// calculate for final
	txRes.ringSize = totalRingSize
	if txRes.numVins > 0 {
		txRes.avgRingSize = int64(math.Floor(float64(totalRingSize) / float64(txRes.numVins)))
		txRes.decoy47 = 100 * (float64(totalDecoy47) / float64(txRes.numVins))
		txRes.decoy811 = 100 * (float64(totalDecoy811) / float64(txRes.numVins))
		txRes.decoy1214 = 100 * (float64(totalDecoy1214) / float64(txRes.numVins))
		txRes.decoyGe15 = 100 * (float64(totalDecoyGe15) / float64(txRes.numVins))
		txRes.decoy03 = 100 - txRes.decoy47 - txRes.decoy811 - txRes.decoy1214 - txRes.decoyGe15
	}
	txSizeKb := totalTxSize / 1024
	if txSizeKb > 0 {
		txRes.feePerKb = int64(math.Round(float64(txRes.fees) / float64(txSizeKb)))
	}
	if len(block.Tx) > 0 {
		txsLength := len(block.Tx)
		if block.MinnerTxhash != "" {
			txsLength--
		}
		if txsLength > 0 {
			txRes.avgTxSize = totalTxSize / int64(txsLength)
		}
	}
	// set address synced flag
	// txRes.addressesSynced = true
	return txRes
}

func (pgb *ChainDB) storeLTCWholeTxns(client *ltcClient.Client, block *dbtypes.Block, msgBlock *wire.MsgBlock, conflictCheck, addressSpendingUpdateInfo bool,
	chainParams *chaincfg.Params) storeTxnsResult {
	dbTransactions, dbTxVouts, dbTxVins := dbtypes.ExtractLTCBlockTransactions(client, block,
		msgBlock, chainParams)
	var txRes storeTxnsResult
	dbAddressRows := make([][]dbtypes.MutilchainAddressRow, len(dbTransactions))
	var totalAddressRows int
	var err error
	for it, dbtx := range dbTransactions {
		dbtx.VoutDbIds, dbAddressRows[it], err = InsertMutilchainWholeVouts(pgb.db, dbTxVouts[it], conflictCheck, mutilchain.TYPELTC)
		if err != nil && err != sql.ErrNoRows {
			log.Error("LTC: InsertVouts:", err)
			txRes.err = err
			return txRes
		}
		totalAddressRows += len(dbAddressRows[it])
		txRes.numVouts += int64(len(dbtx.VoutDbIds))
		if err == sql.ErrNoRows || len(dbTxVouts[it]) != len(dbtx.VoutDbIds) {
			log.Warnf("LTC: Incomplete Vout insert.")
		}
		dbtx.VinDbIds, err = InsertMutilchainWholeVins(pgb.db, dbTxVins[it], mutilchain.TYPELTC, conflictCheck)
		if err != nil && err != sql.ErrNoRows {
			log.Error("LTC: InsertVins:", err)
			txRes.err = err
			return txRes
		}
		for _, dbTxVout := range dbTxVouts[it] {
			txRes.totalSent += int64(dbTxVout.Value)
		}
		txRes.numVins += int64(len(dbtx.VinDbIds))
		txRes.fees += dbtx.Fees
	}
	// Get the tx PK IDs for storage in the blocks table
	TxDbIDs, err := InsertMutilchainTxns(pgb.db, dbTransactions, conflictCheck, mutilchain.TYPELTC)
	if err != nil && err != sql.ErrNoRows {
		log.Error("LTC: InsertTxns:", err)
		txRes.err = err
		return txRes
	}
	// Store tx Db IDs as funding tx in AddressRows and rearrange
	dbAddressRowsFlat := make([]*dbtypes.MutilchainAddressRow, 0, totalAddressRows)
	for it, txDbID := range TxDbIDs {
		// Set the tx ID of the funding transactions
		for iv := range dbAddressRows[it] {
			// Transaction that pays to the address
			dba := &dbAddressRows[it][iv]
			dba.FundingTxDbID = txDbID
			// Funding tx hash, vout id, value, and address are already assigned
			// by InsertVouts. Only the funding tx DB ID was needed.
			dbAddressRowsFlat = append(dbAddressRowsFlat, dba)
		}
	}
	// Insert each new AddressRow, absent spending fields
	_, err = InsertMutilchainAddressOuts(pgb.db, dbAddressRowsFlat, mutilchain.TYPELTC, conflictCheck)
	if err != nil {
		log.Error("LTC: InsertAddressOuts:", err)
		txRes.err = err
		return txRes
	}

	if !addressSpendingUpdateInfo {
		return txRes
	}
	// Check the new vins and update sending tx data in Addresses table
	for it, txDbID := range TxDbIDs {
		for iv := range dbTxVins[it] {
			// Transaction that spends an outpoint paying to >=0 addresses
			vin := &dbTxVins[it][iv]
			vinDbID := dbTransactions[it].VinDbIds[iv]
			// skip coinbase inputs
			if bytes.Equal(zeroHashStringBytes, []byte(vin.PrevTxHash)) {
				continue
			}
			var numAddressRowsSet int64
			numAddressRowsSet, err = SetMutilchainSpendingForFundingOP(pgb.db,
				vin.PrevTxHash, vin.PrevTxIndex, // funding
				txDbID, vin.TxID, vin.TxIndex, vinDbID, mutilchain.TYPELTC) // spending
			if err != nil {
				log.Errorf("LTC: SetSpendingForFundingOP: %v", err)
			}
			txRes.numAddresses += numAddressRowsSet
		}
	}
	// set address synced flag
	txRes.addressesSynced = true
	return txRes
}

func (pgb *ChainDB) Sync24BlocksAsync() {
	//delete all invalid row
	numRow, delErr := DeleteInvalid24hBlocksRow(pgb.db)
	if delErr != nil {
		log.Errorf("failed to delete invalid block from DB: %v", delErr)
		return
	}

	if numRow > 0 {
		log.Debugf("Sync24BlocksAsync: Deleted %d rows on 24hblocks table", numRow)
	}
	chainList := []string{mutilchain.TYPEDCR}
	chainList = append(chainList, dbtypes.MutilchainList...)
	//Get valid blockchain
	for _, chain := range chainList {
		pgb.Sync24hMetricsByChainType(chain)
	}
}

func (pgb *ChainDB) Sync24hMetricsByChainType(chain string) {
	if pgb.ChainDisabledMap[chain] {
		return
	}
	if chain == mutilchain.TYPEDCR {
		log.Debugf("Start syncing for 24hblocks info. ChainType: %s", mutilchain.TYPEDCR)
		pgb.SyncDecred24hBlocks()
		log.Debugf("Finish syncing for 24hblocks info. ChainType: %s", mutilchain.TYPEDCR)
		return
	}
	bbheight, _ := pgb.GetMutilchainBestBlock(chain)
	if bbheight == 0 {
		return
	}
	pgb.SyncMutilchain24hBlocks(bbheight, chain)
}

func (pgb *ChainDB) SyncDecred24hBlocks() {
	blockList, err := Retrieve24hBlockData(pgb.ctx, pgb.db)
	if err != nil {
		log.Errorf("Sync Decred blocks in 24h failed: %v", err)
		return
	}
	dbTx, err := pgb.db.BeginTx(pgb.ctx, nil)
	if err != nil {
		log.Errorf("failed to start new DB transaction: %v", err)
		return
	}
	//prepare query
	stmt, err := dbTx.Prepare(internal.Insert24hBlocksRow)
	if err != nil {
		dbTx.Rollback()
		log.Errorf("insert block info to 24hblocks table failed: %v", err)
		return
	}
	for _, block := range blockList {
		var exist bool
		//check exist on DB
		err := pgb.db.QueryRowContext(pgb.ctx, internal.CheckExist24Blocks, mutilchain.TYPEDCR, block.BlockHeight).Scan(&exist)
		if err != nil || exist {
			continue
		}
		var txnum, spent, sent, numvin, numvout int64
		pgb.db.QueryRowContext(pgb.ctx, internal.Select24hBlockSummary, block.BlockHeight).Scan(&txnum, &spent, &sent, &numvin, &numvout)
		//handler for fees
		block.Fees, _ = pgb.GetDecredBlockFees(block.BlockHash)
		//insert to db
		var id uint64
		err = stmt.QueryRow(mutilchain.TYPEDCR, block.BlockHash, block.BlockHeight, block.BlockTime,
			spent, sent, block.Fees, txnum, numvin, numvout).Scan(&id)
		if err != nil {
			if err == sql.ErrNoRows {
				continue
			}
			_ = stmt.Close() // try, but we want the QueryRow error back
			if errRoll := dbTx.Rollback(); errRoll != nil {
				log.Errorf("Rollback failed: %v", errRoll)
			}
			return
		}
	}
	stmt.Close()
	dbTx.Commit()
}

func (pgb *ChainDB) GetDecredBlockFees(blockHash string) (int64, error) {
	data := pgb.GetBlockVerboseByHash(blockHash, true)
	if data == nil {
		return 0, fmt.Errorf("Unable to get block for block hash: %s", blockHash)
	}
	totalFees := int64(0)
	//Get fees from stake txs
	for i := range data.RawTx {
		stx := &data.RawTx[i]
		msgTx, err := txhelpers.MsgTxFromHex(stx.Hex)
		if err != nil {
			continue
		}
		fees, _ := txhelpers.TxFeeRate(msgTx)
		if int64(fees) < 0 {
			continue
		}
		totalFees += int64(fees)
	}
	return totalFees, nil
}

func (pgb *ChainDB) SyncXMR24hBlockInfo(height int64) {
	log.Infof("XMR: Start syncing for 24hblocks info.")
	dbTx, err := pgb.db.BeginTx(pgb.ctx, nil)
	if err != nil {
		log.Errorf("failed to start new DB transaction: %v", err)
		return
	}
	//prepare query
	stmt, err := dbTx.Prepare(internal.InsertXMR24hBlocksRow)
	if err != nil {
		log.Errorf("XMR: Prepare insert block info to 24hblocks table failed: %v", err)
		_ = dbTx.Rollback()
		return
	}
	yeserDayTimeInt := time.Now().Add(-24 * time.Hour).Unix()
	for {
		var exist bool
		//check exist on DB
		err := pgb.db.QueryRowContext(pgb.ctx, internal.CheckExist24Blocks, mutilchain.TYPEXMR, height).Scan(&exist)
		if err != nil {
			log.Errorf("XMR: Check block exist in 24hblocks table failed: %v", err)
			_ = stmt.Close()
			_ = dbTx.Rollback()
			return
		}

		if exist {
			height--
			continue
		}
		blockData := pgb.GetXMRExplorerBlock(height)
		if blockData == nil {
			height--
			continue
		}
		if blockData.BlockTimeUnix < yeserDayTimeInt {
			break
		}
		//insert to db
		var id uint64
		err = stmt.QueryRow(mutilchain.TYPEXMR, blockData.Hash, blockData.Height, dbtypes.NewTimeDef(blockData.BlockTime.T),
			0, 0, blockData.Fees, blockData.TxCount, blockData.TotalNumVins, blockData.TotalNumOutputs, blockData.BlockReward).Scan(&id)
		if err != nil {
			if err == sql.ErrNoRows {
				continue
			}
			log.Errorf("XMR: Insert to blocks24h failed: %v", err)
			_ = stmt.Close() // try, but we want the QueryRow error back
			if errRoll := dbTx.Rollback(); errRoll != nil {
				log.Errorf("Rollback failed: %v", errRoll)
			}
			return
		}
		height--
	}
	stmt.Close()
	dbTx.Commit()
	log.Infof("XMR: Finish syncing for 24hblocks info")
}

func (pgb *ChainDB) SyncMutilchain24hBlocks(height int64, chainType string) {
	if chainType == mutilchain.TYPEXMR {
		pgb.SyncXMR24hBlockInfo(height)
		return
	}
	log.Infof("Start syncing for 24hblocks info. ChainType: %s", chainType)
	dbTx, err := pgb.db.BeginTx(pgb.ctx, nil)
	if err != nil {
		log.Errorf("failed to start new DB transaction: %v", err)
		return
	}
	//prepare query
	stmt, err := dbTx.Prepare(internal.Insert24hBlocksRow)
	if err != nil {
		log.Errorf("%s: Prepare insert block info to 24hblocks table failed: %v", chainType, err)
		_ = dbTx.Rollback()
		return
	}
	for {
		var exist bool
		//check exist on DB
		err := pgb.db.QueryRowContext(pgb.ctx, internal.CheckExist24Blocks, chainType, height).Scan(&exist)
		if err != nil {
			log.Errorf("%s: Check block exist in 24hblocks table failed: %v", chainType, err)
			_ = stmt.Close()
			_ = dbTx.Rollback()
			return
		}

		if exist {
			height--
			continue
		}

		//Get block hash
		bHash, hashErr := pgb.GetDaemonMutilchainBlockHash(height, chainType)
		if hashErr != nil {
			log.Errorf("%s: Get block hash from height failed: %v", chainType, err)
			_ = stmt.Close()
			_ = dbTx.Rollback()
			return
		}

		var blockData *apitypes.Block24hData
		var isBreak bool
		switch chainType {
		case mutilchain.TYPELTC:
			blockData, isBreak = pgb.GetLTCBlockData(bHash, height)
		case mutilchain.TYPEBTC:
			blockData, isBreak = pgb.GetBTCBlockData(bHash, height)
		}

		if isBreak {
			break
		}

		log.Debugf("%s: Insert to 24h blocks metric: Height: %d, TxNum: %d", chainType, blockData.BlockHeight, blockData.NumTx)

		//insert to db
		var id uint64
		err = stmt.QueryRow(chainType, blockData.BlockHash, blockData.BlockHeight, blockData.BlockTime,
			blockData.Spent, blockData.Sent, blockData.Fees, blockData.NumTx, blockData.NumVin, blockData.NumVout).Scan(&id)
		if err != nil {
			if err == sql.ErrNoRows {
				continue
			}
			log.Errorf("%s: Insert to blocks24h failed: %v", chainType, err)
			_ = stmt.Close() // try, but we want the QueryRow error back
			if errRoll := dbTx.Rollback(); errRoll != nil {
				log.Errorf("Rollback failed: %v", errRoll)
			}
			return
		}
		height--
	}
	stmt.Close()
	dbTx.Commit()
	log.Infof("Finish syncing for 24hblocks info. ChainType: %s", chainType)
}

func (pgb *ChainDB) GetLTCBlockData(hash string, height int64) (*apitypes.Block24hData, bool) {
	yeserDayTimeInt := time.Now().Add(-24 * time.Hour).Unix()
	//Get block verbose
	blockData := pgb.GetLTCBlockVerboseTxByHash(hash)
	if blockData.Time < yeserDayTimeInt {
		return nil, true
	}

	block := &apitypes.Block24hData{
		BlockHash:   blockData.Hash,
		BlockHeight: blockData.Height,
		BlockTime:   dbtypes.NewTimeDef(time.Unix(blockData.Time, 0)),
		NumTx:       int64(len(blockData.RawTx)),
	}

	var totalSent, totalSpent, totalFees, numVin, numVout int64
	for _, tx := range blockData.RawTx {
		msgTx, err := txhelpers.MsgLTCTxFromHex(tx.Hex, int32(tx.Version))
		if err != nil {
			log.Errorf("LTC: Unknown transaction %s: %v", tx.Txid, err)
			break
		}
		var sent int64
		for _, txout := range msgTx.TxOut {
			sent += txout.Value
		}
		numVout += int64(len(msgTx.TxOut))
		numVin += int64(len(msgTx.TxIn))
		var isCoinbase = len(tx.Vin) > 0 && tx.Vin[0].IsCoinBase()
		spent := int64(0)
		if !isCoinbase {
			for _, txin := range msgTx.TxIn {
				//Txin
				unitAmount := int64(0)
				//Get transaction by txin
				txInResult, txinErr := ltcrpcutils.GetRawTransactionByTxidStr(pgb.LtcClient, txin.PreviousOutPoint.Hash.String())
				if txinErr == nil {
					unitAmount = dbtypes.GetLTCValueInFromRawTransction(txInResult, txin)
					spent += unitAmount
				}
			}
			totalFees += spent - sent
		}

		totalSent += sent
		totalSpent += spent
	}
	block.Fees = totalFees
	block.Spent = totalSpent
	block.Sent = totalSent
	block.NumVin = numVin
	block.NumVout = numVout
	return block, false
}

func (pgb *ChainDB) GetBTCBlockData(hash string, height int64) (*apitypes.Block24hData, bool) {
	yeserDayTimeInt := time.Now().Add(-24 * time.Hour).Unix()
	//Get block verbose
	blockData := pgb.GetBTCBlockVerboseTxByHash(hash)
	if blockData.Time < yeserDayTimeInt {
		return nil, true
	}

	block := &apitypes.Block24hData{
		BlockHash:   blockData.Hash,
		BlockHeight: blockData.Height,
		BlockTime:   dbtypes.NewTimeDef(time.Unix(blockData.Time, 0)),
		NumTx:       int64(len(blockData.RawTx)),
	}

	var totalSent, totalSpent, totalFees, numVin, numVout int64
	for _, tx := range blockData.RawTx {
		msgTx, err := txhelpers.MsgBTCTxFromHex(tx.Hex, int32(tx.Version))
		if err != nil {
			log.Errorf("BTC: Unknown transaction %s: %v", tx.Txid, err)
			break
		}
		var sent int64
		for _, txout := range msgTx.TxOut {
			sent += txout.Value
		}
		numVout += int64(len(msgTx.TxOut))
		numVin += int64(len(msgTx.TxIn))
		var isCoinbase = len(tx.Vin) > 0 && tx.Vin[0].IsCoinBase()
		spent := int64(0)
		if !isCoinbase {
			for _, txin := range msgTx.TxIn {
				//Txin
				unitAmount := int64(0)
				//Get transaction by txin
				txInResult, txinErr := btcrpcutils.GetRawTransactionByTxidStr(pgb.BtcClient, txin.PreviousOutPoint.Hash.String())
				if txinErr == nil {
					unitAmount = dbtypes.GetBTCValueInFromRawTransction(txInResult, txin)
					spent += unitAmount
				}
			}
			totalFees += spent - sent
		}

		totalSent += sent
		totalSpent += spent
	}
	block.Fees = totalFees
	block.Spent = totalSpent
	block.Sent = totalSent
	block.NumVin = numVin
	block.NumVout = numVout
	return block, false
}

func (pgb *ChainDB) SyncMultichainWholeChain(chainType string) {
	switch chainType {
	case mutilchain.TYPEBTC:
		pgb.SyncBTCWholeChain()
		return
	case mutilchain.TYPELTC:
		pgb.SyncLTCWholeChain()
		return
	default:
		return
	}
}

func (pgb *ChainDB) SyncBTCWholeChain() {
	pgb.btcWholeSyncMtx.Lock()
	defer pgb.btcWholeSyncMtx.Unlock()

	// config concurrency
	const maxWorkers = 3

	var totalTxs int64
	var totalVins int64
	var totalVouts int64
	var processedBlocks int64

	tickTime := 20 * time.Second
	startTime := time.Now()

	// speed (use atomic reads)
	speedReporter := func() {
		totalElapsed := time.Since(startTime).Seconds()
		if totalElapsed < 1.0 {
			return
		}
		tTx := atomic.LoadInt64(&totalTxs)
		tVouts := atomic.LoadInt64(&totalVouts)
		totalVoutPerSec := tVouts / int64(totalElapsed)
		totalTxPerSec := tTx / int64(totalElapsed)
		log.Infof("BTC: Avg. speed: %d tx/s, %d vout/s", totalTxPerSec, totalVoutPerSec)
	}
	var once sync.Once
	defer once.Do(speedReporter)

	// Get remaining heights
	btcBestBlockHeight := pgb.BtcBestBlock.Height
	rows, err := pgb.db.QueryContext(pgb.ctx, mutilchainquery.CreateSelectRemainingNotSyncedHeights(mutilchain.TYPEBTC), btcBestBlockHeight)
	if err != nil {
		log.Errorf("BTC: Query remaining syncing blocks height list failed: %v", err)
		return
	}
	remaingHeights, err := getRemainingHeightsFromSqlRows(rows)
	if err != nil {
		log.Errorf("BTC: Get remaining blocks height list failed: %v", err)
		return
	}
	if len(remaingHeights) == 0 {
		log.Infof("BTC: No more blocks to synchronize with the whole daemon")
		return
	}
	log.Infof("BTC: Start sync for %d blocks. Minimum height: %d, Maximum height: %d", len(remaingHeights), remaingHeights[0], remaingHeights[len(remaingHeights)-1])

	reindexing := int64(len(remaingHeights)) > pgb.BtcBestBlock.Height/50
	checkConflict := true
	if reindexing {
		checkConflict = false
		log.Info("BTC: Large bulk load: Removing indexes")
		if err = pgb.DeindexMutilchainWholeTable(mutilchain.TYPEBTC); err != nil &&
			!strings.Contains(err.Error(), "does not exist") &&
			!strings.Contains(err.Error(), "不存在") {
			log.Errorf("BTC: Deindex for multichain whole table: %v", err)
			return
		}
	}

	// context to cancel on first error
	ctx, cancel := context.WithCancel(pgb.ctx)
	defer cancel()

	// worker semaphore & waitgroup
	sem := make(chan struct{}, maxWorkers)
	var wg sync.WaitGroup

	// first error storage (atomic.Value to avoid locking complexity)
	var firstErr atomic.Value // will store error

	// ticker goroutine to log speed with tickTime
	ticker := time.NewTicker(tickTime)
	defer ticker.Stop()

	// save local state for logs with tick
	var lastProcessed int64
	var lastTxs int64
	var lastVins int64
	var lastVouts int64

	// ticker logger goroutine
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				curProcessed := atomic.LoadInt64(&processedBlocks)
				curTxs := atomic.LoadInt64(&totalTxs)
				curVins := atomic.LoadInt64(&totalVins)
				curVouts := atomic.LoadInt64(&totalVouts)

				blocksPerSec := float64(curProcessed-lastProcessed) / tickTime.Seconds()
				txPerSec := float64(curTxs-lastTxs) / tickTime.Seconds()
				vinsPerSec := float64(curVins-lastVins) / tickTime.Seconds()
				voutPerSec := float64(curVouts-lastVouts) / tickTime.Seconds()

				log.Infof("BTC: (%.3f blk/s, %.3f tx/s, %.3f vin/s, %.3f vout/s)", blocksPerSec, txPerSec, vinsPerSec, voutPerSec)

				lastProcessed = curProcessed
				lastTxs = curTxs
				lastVins = curVins
				lastVouts = curVouts
			}
		}
	}()

	// optional: if GetBlock or StoreBTCWholeBlock is NOT thread-safe, uncomment these mutexes and wrap calls.
	// var getBlockMu sync.Mutex
	// var storeBlockMu sync.Mutex

	for idx, height := range remaingHeights {
		// early exit if cancelled
		if ctx.Err() != nil {
			break
		}

		// occasional info logs similar to original behavior
		if (idx-1)%btcRescanLogBlockChunk == 0 || idx == 0 {
			if remaingHeights[idx] == 0 {
				log.Infof("BTC: Scanning genesis block.")
			} else {
				curInd := (idx - 1) / btcRescanLogBlockChunk
				endRangeBlockIdx := (curInd + 1) * btcRescanLogBlockChunk
				if endRangeBlockIdx >= len(remaingHeights) {
					endRangeBlockIdx = len(remaingHeights) - 1
				}
				log.Infof("BTC: Processing blocks %d to %d...", height, remaingHeights[endRangeBlockIdx])
			}
		}

		// acquire worker slot
		select {
		case sem <- struct{}{}:
			// got slot
		case <-ctx.Done():
			break
		}

		wg.Add(1)
		go func(h int64) {
			defer wg.Done()
			defer func() { <-sem }()

			// Check cancellation once more
			if ctx.Err() != nil {
				return
			}

			// get block (if GetBlock is NOT thread-safe, guard with getBlockMu)
			// getBlockMu.Lock()
			block, _, err := btcrpcutils.GetBlock(h, pgb.BtcClient)
			// getBlockMu.Unlock()
			if err != nil {
				// store first error and cancel
				if firstErr.Load() == nil {
					firstErr.Store(err)
					cancel()
				}
				log.Errorf("BTC: GetBlock failed (%d): %v", h, err)
				return
			}

			// store block (if StoreBTCWholeBlock is NOT thread-safe, guard with storeBlockMu)
			// storeBlockMu.Lock()
			numVins, numVouts, err := pgb.StoreBTCWholeBlock(pgb.BtcClient, block.MsgBlock(), checkConflict, false)
			// storeBlockMu.Unlock()
			if err != nil {
				if firstErr.Load() == nil {
					firstErr.Store(err)
					cancel()
				}
				log.Errorf("BTC StoreBlock failed (height %d): %v", h, err)
				return
			}

			// update atomic counters
			atomic.AddInt64(&totalVins, numVins)
			atomic.AddInt64(&totalVouts, numVouts)
			atomic.AddInt64(&totalTxs, int64(len(block.Transactions())))
			atomic.AddInt64(&processedBlocks, 1)
		}(height)
	}

	// wait worker finish
	wg.Wait()

	if v := firstErr.Load(); v != nil {
		err = v.(error)
		log.Errorf("BTC: sync aborted due to error: %v", err)
		return
	}

	// final speed report
	once.Do(speedReporter)

	// rebuild index
	if reindexing {
		if err := pgb.IndexMutilchainWholeTable(mutilchain.TYPEBTC); err != nil {
			log.Errorf("BTC: Re-index failed: %v", err)
			return
		}
	}

	log.Infof("BTC: Finish sync for %d blocks. Minimum height: %d, Maximum height: %d (processed %d blocks, %d tx total, %d vin total, %d vout total)",
		len(remaingHeights), remaingHeights[0], remaingHeights[len(remaingHeights)-1],
		atomic.LoadInt64(&processedBlocks), atomic.LoadInt64(&totalTxs), atomic.LoadInt64(&totalVins), atomic.LoadInt64(&totalVouts))
}

func (pgb *ChainDB) SyncOneBTCWholeBlock(client *btcClient.Client, msgBlock *btcwire.MsgBlock) (err error) {
	pgb.btcWholeSyncMtx.Lock()
	defer pgb.btcWholeSyncMtx.Unlock()
	_, _, err = pgb.StoreBTCWholeBlock(client, msgBlock, true, true)
	return err
}

func (pgb *ChainDB) SyncOneLTCWholeBlock(client *ltcClient.Client, msgBlock *wire.MsgBlock) (err error) {
	pgb.ltcWholeSyncMtx.Lock()
	defer pgb.ltcWholeSyncMtx.Unlock()
	_, _, err = pgb.StoreLTCWholeBlock(client, msgBlock, true, true)
	return err
}

func (pgb *ChainDB) SyncLTCWholeChain() {
	pgb.ltcWholeSyncMtx.Lock()
	defer pgb.ltcWholeSyncMtx.Unlock()

	const maxWorkers = 2

	// atomic counters
	var totalTxs int64
	var totalVins int64
	var totalVouts int64
	var processedBlocks int64

	tickTime := 20 * time.Second
	startTime := time.Now()

	speedReporter := func() {
		totalElapsed := time.Since(startTime).Seconds()
		if totalElapsed < 1.0 {
			return
		}
		tTx := atomic.LoadInt64(&totalTxs)
		tVouts := atomic.LoadInt64(&totalVouts)
		totalVoutPerSec := tVouts / int64(totalElapsed)
		totalTxPerSec := tTx / int64(totalElapsed)
		log.Infof("LTC: Avg. speed: %d tx/s, %d vout/s", totalTxPerSec, totalVoutPerSec)
	}
	var once sync.Once
	defer once.Do(speedReporter)

	// get remaining heights
	ltcBestBlockHeight := pgb.LtcBestBlock.Height
	rows, err := pgb.db.QueryContext(pgb.ctx, mutilchainquery.CreateSelectRemainingNotSyncedHeights(mutilchain.TYPELTC), ltcBestBlockHeight)
	if err != nil {
		log.Errorf("LTC: Query remaining syncing blocks height list failed: %v", err)
		return
	}
	remaingHeights, err := getRemainingHeightsFromSqlRows(rows)
	if err != nil {
		log.Errorf("LTC: Get remaining blocks height list failed: %v", err)
		return
	}
	if len(remaingHeights) == 0 {
		log.Infof("LTC: No more blocks to synchronize with the whole daemon")
		return
	}
	log.Infof("LTC: Start sync for %d blocks. Minimum height: %d, Maximum height: %d", len(remaingHeights), remaingHeights[0], remaingHeights[len(remaingHeights)-1])

	reindexing := int64(len(remaingHeights)) > pgb.LtcBestBlock.Height/50
	conflictCheck := true
	if reindexing {
		conflictCheck = false
		log.Info("LTC: Large bulk load: Removing indexes")
		if err = pgb.DeindexMutilchainWholeTable(mutilchain.TYPELTC); err != nil &&
			!strings.Contains(err.Error(), "does not exist") &&
			!strings.Contains(err.Error(), "不存在") {
			log.Errorf("LTC: Deindex for multichain whole table: %v", err)
			return
		}
	}

	// context to cancel on first error
	ctx, cancel := context.WithCancel(pgb.ctx)
	defer cancel()

	// semaphore to limit concurrency
	sem := make(chan struct{}, maxWorkers)
	var wg sync.WaitGroup

	// store first error (atomic.Value)
	var firstErr atomic.Value

	// ticker for periodic speed logs
	ticker := time.NewTicker(tickTime)
	defer ticker.Stop()

	// local last stats for per-tick delta
	var lastProcessed int64
	var lastTxs int64
	var lastVins int64
	var lastVouts int64

	// ticker goroutine: log per tick
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				curProcessed := atomic.LoadInt64(&processedBlocks)
				curTxs := atomic.LoadInt64(&totalTxs)
				curVins := atomic.LoadInt64(&totalVins)
				curVouts := atomic.LoadInt64(&totalVouts)

				blocksPerSec := float64(curProcessed-lastProcessed) / tickTime.Seconds()
				txPerSec := float64(curTxs-lastTxs) / tickTime.Seconds()
				vinsPerSec := float64(curVins-lastVins) / tickTime.Seconds()
				voutPerSec := float64(curVouts-lastVouts) / tickTime.Seconds()

				log.Infof("LTC: (%.3f blk/s, %.3f tx/s, %.3f vin/s, %.3f vout/s)", blocksPerSec, txPerSec, vinsPerSec, voutPerSec)

				lastProcessed = curProcessed
				lastTxs = curTxs
				lastVins = curVins
				lastVouts = curVouts
			}
		}
	}()

	// If GetBlock or StoreLTCWholeBlock are NOT thread-safe, uncomment mutexes below:
	// var getBlockMu sync.Mutex
	// var storeBlockMu sync.Mutex

	// iterate heights and spawn workers
	for idx, height := range remaingHeights {
		// early exit if cancelled
		if ctx.Err() != nil {
			break
		}

		// periodic chunk logs to keep parity với code gốc
		if (idx-1)%ltcRescanLogBlockChunk == 0 || idx == 0 {
			if remaingHeights[idx] == 0 {
				log.Infof("LTC: Scanning genesis block.")
			} else {
				curInd := (idx - 1) / ltcRescanLogBlockChunk
				endRangeBlockIdx := (curInd + 1) * ltcRescanLogBlockChunk
				if endRangeBlockIdx >= len(remaingHeights) {
					endRangeBlockIdx = len(remaingHeights) - 1
				}
				log.Infof("LTC: Processing blocks %d to %d...", height, remaingHeights[endRangeBlockIdx])
			}
		}

		// acquire worker slot (or exit if cancelled)
		select {
		case sem <- struct{}{}:
			// acquired
		case <-ctx.Done():
			break
		}

		wg.Add(1)
		go func(h int64) {
			defer wg.Done()
			defer func() { <-sem }()

			if ctx.Err() != nil {
				return
			}

			// get block (wrap with mutex if needed)
			// getBlockMu.Lock()
			block, _, err := ltcrpcutils.GetBlock(h, pgb.LtcClient)
			// getBlockMu.Unlock()
			if err != nil {
				if firstErr.Load() == nil {
					firstErr.Store(err)
					cancel()
				}
				log.Errorf("LTC: GetBlock failed (%d): %v", h, err)
				return
			}

			// store block (wrap with mutex if needed)
			// storeBlockMu.Lock()
			numVins, numVouts, err := pgb.StoreLTCWholeBlock(pgb.LtcClient, block.MsgBlock(), conflictCheck, false)
			// storeBlockMu.Unlock()
			if err != nil {
				if firstErr.Load() == nil {
					firstErr.Store(err)
					cancel()
				}
				log.Errorf("LTC StoreBlock failed (height %d): %v", h, err)
				return
			}

			// update counters
			atomic.AddInt64(&totalVins, numVins)
			atomic.AddInt64(&totalVouts, numVouts)
			atomic.AddInt64(&totalTxs, int64(len(block.Transactions())))
			atomic.AddInt64(&processedBlocks, 1)
		}(height)
	}

	// wait for workers
	wg.Wait()

	// if any error occurred, log and return
	if v := firstErr.Load(); v != nil {
		if err, ok := v.(error); ok && err != nil {
			log.Errorf("LTC: sync aborted due to error: %v", err)
			return
		}
	}

	// final speed report
	once.Do(speedReporter)

	// reindex if needed
	if reindexing {
		if err := pgb.IndexMutilchainWholeTable(mutilchain.TYPELTC); err != nil {
			log.Errorf("LTC: Re-index failed: %v", err)
			return
		}
	}

	log.Infof("LTC: Finish sync for %d blocks. Minimum height: %d, Maximum height: %d (processed %d blocks, %d tx total, %d vin total, %d vout total)",
		len(remaingHeights), remaingHeights[0], remaingHeights[len(remaingHeights)-1],
		atomic.LoadInt64(&processedBlocks), atomic.LoadInt64(&totalTxs), atomic.LoadInt64(&totalVins), atomic.LoadInt64(&totalVouts))
}

func (pgb *ChainDB) SyncBulkXMRBlockSummaryData() {
	// Check which blocks have not been updated with the summary data sync status
	rows, err := pgb.db.QueryContext(pgb.ctx, mutilchainquery.SelectRemainingNotSyncedChartSummary)
	if err != nil {
		log.Errorf("XMR: Query remaining not synced chart summary block height list failed: %v", err)
		return
	}
	remaingHeights, err := getRemainingHeightsFromSqlRows(rows)
	if err != nil {
		log.Errorf("XMR: Get remaining blocks height list for sync block summary failed: %v", err)
		return
	}
	currentHeight := remaingHeights[0]
	// handler for each block
	for _, syncHeight := range remaingHeights {
		err = pgb.SaveXMRBlockSummaryData(syncHeight)
		if err != nil {
			log.Errorf("XMR: SaveXMRBlockSummaryData failed. %v", err)
			return
		}
		if syncHeight%1000 == 0 || syncHeight == remaingHeights[len(remaingHeights)-1] {
			log.Infof("XMR: Sync bulk block summary from: %d to %d", currentHeight, syncHeight)
			currentHeight = syncHeight
		}
	}
}

func (pgb *ChainDB) SyncXMRWholeChain(newIndexes bool) {
	pgb.xmrWholeSyncMtx.Lock()
	defer pgb.xmrWholeSyncMtx.Unlock()

	const maxWorkers = 5

	// atomic counters
	var totalTxs int64
	var totalVins int64
	var totalVouts int64
	var processedBlocks int64

	tickTime := 20 * time.Second
	startTime := time.Now()

	speedReporter := func() {
		totalElapsed := time.Since(startTime).Seconds()
		if totalElapsed < 1.0 {
			return
		}
		tTx := atomic.LoadInt64(&totalTxs)
		tVouts := atomic.LoadInt64(&totalVouts)
		totalVoutPerSec := tVouts / int64(totalElapsed)
		totalTxPerSec := tTx / int64(totalElapsed)
		log.Infof("XMR: Avg. speed: %d tx/s, %d vout/s", totalTxPerSec, totalVoutPerSec)
	}
	var once sync.Once
	defer once.Do(speedReporter)

	// get remaining heights
	xmrBestBlockHeight := pgb.XmrBestBlock.Height
	rows, err := pgb.db.QueryContext(pgb.ctx, mutilchainquery.CreateSelectRemainingNotSyncedHeights(mutilchain.TYPEXMR), xmrBestBlockHeight)
	if err != nil {
		log.Errorf("XMR: Query remaining syncing blocks height list failed: %v", err)
		return
	}
	remaingHeights, err := getRemainingHeightsFromSqlRows(rows)
	if err != nil {
		log.Errorf("XMR: Get remaining blocks height list failed: %v", err)
		return
	}
	if len(remaingHeights) == 0 {
		log.Infof("XMR: No more blocks to synchronize with the whole daemon")
		return
	}
	log.Infof("XMR: Start sync for %d blocks. Minimum height: %d, Maximum height: %d", len(remaingHeights), remaingHeights[0], remaingHeights[len(remaingHeights)-1])

	// Check if reindexing is performed?
	reindexing := newIndexes || (int64(len(remaingHeights)) > pgb.XmrBestBlock.Height/20)
	checkDuplicate := true
	if reindexing {
		checkDuplicate = false
		log.Info("XMR: Large bulk load: Removing indexes")
		if err = pgb.DeindexMutilchainWholeTable(mutilchain.TYPEXMR); err != nil &&
			!strings.Contains(err.Error(), "does not exist") &&
			!strings.Contains(err.Error(), "不存在") {
			log.Errorf("XMR: Deindex for multichain whole table: %v", err)
			return
		}
	}

	// context to cancel on first error
	ctx, cancel := context.WithCancel(pgb.ctx)
	defer cancel()

	// semaphore to limit concurrency
	sem := make(chan struct{}, maxWorkers)
	var wg sync.WaitGroup

	// store first error (atomic.Value)
	var firstErr atomic.Value

	// ticker for periodic speed logs
	ticker := time.NewTicker(tickTime)
	defer ticker.Stop()

	// local last stats for per-tick delta
	var lastProcessed int64
	var lastTxs int64
	var lastVins int64
	var lastVouts int64

	// ticker goroutine: log per tick
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				curProcessed := atomic.LoadInt64(&processedBlocks)
				curTxs := atomic.LoadInt64(&totalTxs)
				curVins := atomic.LoadInt64(&totalVins)
				curVouts := atomic.LoadInt64(&totalVouts)

				blocksPerSec := float64(curProcessed-lastProcessed) / tickTime.Seconds()
				txPerSec := float64(curTxs-lastTxs) / tickTime.Seconds()
				vinsPerSec := float64(curVins-lastVins) / tickTime.Seconds()
				voutPerSec := float64(curVouts-lastVouts) / tickTime.Seconds()
				if blocksPerSec != 0 || txPerSec != 0 || vinsPerSec != 0 || voutPerSec != 0 {
					log.Infof("XMR: (%.3f blk/s, %.3f tx/s, %.3f vin/s, %.3f vout/s)", blocksPerSec, txPerSec, vinsPerSec, voutPerSec)
				}
				lastProcessed = curProcessed
				lastTxs = curTxs
				lastVins = curVins
				lastVouts = curVouts
			}
		}
	}()

	// If GetBlock or StoreLTCWholeBlock are NOT thread-safe, uncomment mutexes below:
	// var getBlockMu sync.Mutex
	// var storeBlockMu sync.Mutex

	// iterate heights and spawn workers
	for idx, height := range remaingHeights {
		// early exit if cancelled
		if ctx.Err() != nil {
			break
		}

		// periodic chunk logs to keep parity với code gốc
		if (idx-1)%xmrRescanLogBlockChunk == 0 || idx == 0 {
			if remaingHeights[idx] == 0 {
				log.Infof("XMR: Scanning genesis block.")
			} else {
				curInd := (idx - 1) / xmrRescanLogBlockChunk
				endRangeBlockIdx := (curInd + 1) * xmrRescanLogBlockChunk
				if endRangeBlockIdx >= len(remaingHeights) {
					endRangeBlockIdx = len(remaingHeights) - 1
				}
				log.Infof("XMR: Processing blocks %d to %d...", height, remaingHeights[endRangeBlockIdx])
			}
		}

		// acquire worker slot (or exit if cancelled)
		select {
		case sem <- struct{}{}:
			// acquired
		case <-ctx.Done():
			break
		}

		wg.Add(1)
		go func(h int64) {
			defer wg.Done()
			defer func() { <-sem }()

			if ctx.Err() != nil {
				return
			}

			retryCount := 0
			for retryCount < 50 {
				// store block (wrap with mutex if needed)
				// storeBlockMu.Lock()
				numVins, numVouts, totalTxs, err := pgb.StoreXMRWholeBlock(pgb.XmrClient, checkDuplicate, false, h)
				// storeBlockMu.Unlock()
				// if error, retry after 2 minute
				if err != nil {
					time.Sleep(2 * time.Minute)
					retryCount++
					log.Errorf("XMR StoreBlock failed (height %d): %v. Retry after 2 minutes", h, err)
					continue
				}
				atomic.AddInt64(&totalVins, numVins)
				atomic.AddInt64(&totalVouts, numVouts)
				atomic.AddInt64(&totalTxs, totalTxs)
				atomic.AddInt64(&processedBlocks, 1)
				break
			}
			// if err != nil {
			// 	if firstErr.Load() == nil {
			// 		firstErr.Store(err)
			// 		cancel()
			// 	}
			// 	log.Errorf("XMR StoreBlock failed (height %d): %v", h, err)
			// 	return
			// }
		}(height)
	}

	// wait for workers
	wg.Wait()

	// if any error occurred, log and return
	if v := firstErr.Load(); v != nil {
		if err, ok := v.(error); ok && err != nil {
			log.Errorf("XMR: sync aborted due to error: %v", err)
			return
		}
	}

	// final speed report
	once.Do(speedReporter)

	// recreate index
	if reindexing {
		// Check and remove duplicate rows if any before recreating index
		err = pgb.MultichainCheckAndRemoveDupplicate(mutilchain.TYPEXMR)
		if err != nil {
			log.Errorf("XMR: Check and remove dupplicate rows on all table failed: %v", err)
			return
		}
		if err = pgb.IndexMutilchainWholeTable(mutilchain.TYPEXMR); err != nil {
			log.Errorf("XMR: Re-index failed: %v", err)
			return
		}
	}
	log.Infof("XMR: Finish sync for %d blocks. Minimum height: %d, Maximum height: %d (processed %d blocks, %d tx total, %d vin total, %d vout total)",
		len(remaingHeights), remaingHeights[0], remaingHeights[len(remaingHeights)-1],
		atomic.LoadInt64(&processedBlocks), atomic.LoadInt64(&totalTxs), atomic.LoadInt64(&totalVins), atomic.LoadInt64(&totalVouts))
}

func (pgb *ChainDB) MultichainCheckAndRemoveDupplicate(chainType string) error {
	// check and remove dupplicate row on blocks table
	log.Infof("%s: Check and remove duplicate rows for %sblocks_all table", chainType, chainType)
	_, err := pgb.db.Exec(mutilchainquery.CreateCheckAndRemoveDuplicateRowQuery(chainType))
	if err != nil {
		log.Errorf("%s: Check and remove duplicate rows for %sblocks_all table error: %v", chainType, chainType, err)
		return err
	}
	log.Infof("%s: Finish check and remove duplicate rows for %sblocks_all table", chainType, chainType)
	// check and remove dupplicate row on transactions table
	log.Infof("%s: Check and remove duplicate rows for %stransactions table", chainType, chainType)
	_, err = pgb.db.Exec(mutilchainquery.CreateCheckAndRemoveDupplicateTxsRowQuery(chainType))
	if err != nil {
		log.Errorf("%s: Check and remove duplicate rows for %stransactions table error: %v", chainType, chainType, err)
		return err
	}
	log.Infof("%s: Finish check and remove duplicate rows for %stransactions table", chainType, chainType)
	if chainType == mutilchain.TYPEXMR {
		// check and remove dupplicate for monero_outputs table
		log.Infof("%s: Check and remove duplicate rows for monero_outputs table", chainType)
		_, err = pgb.db.Exec(mutilchainquery.CheckAndRemoveDuplicateMoneroOutputsRows)
		if err != nil {
			log.Errorf("%s: Check and remove duplicate rows for monero_outputs table error: %v", chainType, err)
			return err
		}
		log.Infof("%s: Finish check and remove duplicate rows for monero_outputs table", chainType)
		// check and remove dupplicate for monero_key_images table
		log.Infof("%s: Check and remove duplicate rows for monero_key_images table", chainType)
		_, err = pgb.db.Exec(mutilchainquery.CheckAndRemoveDuplicateMoneroKeyImageRows)
		if err != nil {
			log.Errorf("%s: Check and remove duplicate rows for monero_key_images table error: %v", chainType, err)
			return err
		}
		log.Infof("%s: Finish check and remove duplicate rows for monero_key_images table", chainType)
		// check and remove dupplicate for monero_ring_members table
		log.Infof("%s: Check and remove duplicate rows for monero_ring_members table", chainType)
		_, err = pgb.db.Exec(mutilchainquery.CheckAndRemoveDuplicateMoneroRingMembers)
		if err != nil {
			log.Errorf("%s: Check and remove duplicate rows for monero_ring_members table error: %v", chainType, err)
			return err
		}
		log.Infof("%s: Finish check and remove duplicate rows for monero_ring_members table", chainType)
		// check and remove dupplicate for monero_rct_data table
		log.Infof("%s: Check and remove duplicate rows for monero_rct_data table", chainType)
		_, err = pgb.db.Exec(mutilchainquery.CheckAndRemoveDuplicateMoneroRctDataRows)
		if err != nil {
			log.Errorf("%s: Check and remove duplicate rows for monero_rct_data table error: %v", chainType, err)
			return err
		}
		log.Infof("%s: Finish check and remove duplicate rows for monero_rct_data table", chainType)
	} else {
		// check and remove dupplicate for addresses table
		log.Infof("%s: Check and remove duplicate rows for %saddresses table", chainType, chainType)
		_, err = pgb.db.Exec(mutilchainquery.CreateCheckAndRemoveDuplicateAddressRowsQuery(chainType))
		if err != nil {
			log.Errorf("%s: Check and remove duplicate rows for %saddresses table error: %v", chainType, chainType, err)
			return err
		}
		log.Infof("%s: Finish check and remove duplicate rows for %saddresses table", chainType, chainType)
		// check and remove dupplicate for vins_all table
		log.Infof("%s: Check and remove duplicate rows for %svins_all table", chainType, chainType)
		_, err = pgb.db.Exec(mutilchainquery.CreateCheckAndRemoveDuplicateVinsRowsQuery(chainType))
		if err != nil {
			log.Errorf("%s: Check and remove duplicate rows for %svins_all table error: %v", chainType, chainType, err)
			return err
		}
		log.Infof("%s: Finish check and remove duplicate rows for %svins_all table", chainType, chainType)
		// check and remove dupplicate for vouts_all table
		log.Infof("%s: Check and remove duplicate rows for %svouts_all table", chainType, chainType)
		_, err = pgb.db.Exec(mutilchainquery.CreateCheckAndRemoveDuplicateVoutsRowsQuery(chainType))
		if err != nil {
			log.Errorf("%s: Check and remove duplicate rows for %svouts_all table error: %v", chainType, chainType, err)
			return err
		}
		log.Infof("%s: Finish check and remove duplicate rows for %svouts_all table", chainType, chainType)
	}
	return nil
}
