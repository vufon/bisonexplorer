// Copyright (c) 2018-2021, The Decred developers
// Copyright (c) 2017, Jonathan Chappelow
// See LICENSE for details.

package mempoolltc

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"time"

	exptypes "github.com/decred/dcrdata/v8/explorer/types"
	"github.com/decred/dcrdata/v8/txhelpers"
	"github.com/ltcsuite/ltcd/btcjson"
	"github.com/ltcsuite/ltcd/chaincfg"
	"github.com/ltcsuite/ltcd/chaincfg/chainhash"
)

// MempoolDataSaver is an interface for storing mempool data.
type MempoolDataSaver interface {
	StoreLTCMPData([]exptypes.MempoolTx, *exptypes.MutilchainMempoolInfo)
}

// MempoolAddressStore wraps txhelpers.MempoolAddressStore with a Mutex.
type MempoolAddressStore struct {
	mtx   sync.Mutex
	store txhelpers.LTCMempoolAddressStore
}

// MempoolMonitor processes new transactions as they are added to mempool, and
// forwards the processed data on channels assigned during construction. An
// inventory of transactions in the current mempool is maintained to prevent
// repetitive data processing and signaling. Periodically, such as after a new
// block is mined, the mempool info and the transaction inventory are rebuilt
// fresh via the CollectAndStore method. A DataCollector is required to
// perform the collection and parsing, and an optional []MempoolDataSaver is
// used to to forward the data to arbitrary destinations. The last block's
// height, hash, and time are kept in memory in order to properly process votes
// in mempool.
type MempoolMonitor struct {
	mtx        sync.RWMutex
	ctx        context.Context
	mpoolInfo  MempoolInfo
	inventory  *exptypes.MutilchainMempoolInfo
	addrMap    MempoolAddressStore
	txnsStore  txhelpers.LTCTxnsStore
	lastBlock  BlockID
	params     *chaincfg.Params
	collector  *DataCollector
	dataSavers []MempoolDataSaver
}

// NewMempoolMonitor creates a new MempoolMonitor. The MempoolMonitor receives
// notifications of new transactions on newTxInChan, and of new blocks on the
// same channel using a nil transaction message. Once TxHandler is started, the
// MempoolMonitor will process incoming transactions, and forward new ones on
// via the newTxOutChan following an appropriate signal on hubRelay.
func NewMempoolMonitor(ctx context.Context, collector *DataCollector,
	savers []MempoolDataSaver, params *chaincfg.Params, initialStore bool) (*MempoolMonitor, error) {

	// Make the skeleton MempoolMonitor.
	p := &MempoolMonitor{
		ctx:        ctx,
		params:     params,
		collector:  collector,
		dataSavers: savers,
	}

	if initialStore {
		return p, p.CollectAndStore()
	}
	_, _, err := p.Refresh()
	return p, err
}

// LastBlockHash returns the hash of the most recently stored block.
func (p *MempoolMonitor) LastBlockHash() chainhash.Hash {
	p.mtx.RLock()
	defer p.mtx.RUnlock()
	return p.lastBlock.Hash
}

// LastBlockHeight returns the height of the most recently stored block.
func (p *MempoolMonitor) LastBlockHeight() int64 {
	p.mtx.RLock()
	defer p.mtx.RUnlock()
	return p.lastBlock.Height
}

// LastBlockTime returns the time of the most recently stored block.
func (p *MempoolMonitor) LastBlockTime() int64 {
	p.mtx.RLock()
	defer p.mtx.RUnlock()
	return p.lastBlock.Time
}

// TxHandler receives signals from OnTxAccepted via the newTxIn, indicating that
// a new transaction has entered mempool. This function should be launched as a
// goroutine, and stopped by closing the quit channel, the broadcasting
// mechanism used by main. The newTxIn contains a chain hash for the transaction
// from the notification, or a zero value hash indicating it was from a Ticker
// or manually triggered.
func (p *MempoolMonitor) TxHandler(rawTx *btcjson.TxRawResult) error {
	log.Tracef("TxHandler: new transaction: %v.", rawTx.Txid)

	// Ignore this tx if it was received before the last block.
	if rawTx.Time < p.LastBlockTime() {
		log.Debugf("Old: %d < %d", rawTx.Time, p.LastBlockTime())
		return nil
	}

	msgTx, err := txhelpers.LTCMsgTxFromHex(rawTx.Hex, int32(rawTx.Version))
	if err != nil {
		log.Errorf("Failed to decode transaction: %v", err)
		return err
	}

	hash := msgTx.TxHash().String()

	// Maintain the list of unique stake and regular txns encountered.
	p.mtx.RLock()      // do not allow p.inventory to be reset
	p.inventory.Lock() // do not allow *p.inventory to be accessed
	// Set Outpoints in the addrMap.
	p.addrMap.mtx.Lock()
	if p.addrMap.store == nil {
		p.addrMap.store = make(txhelpers.LTCMempoolAddressStore)
	}
	txAddresses := make(map[string]struct{})
	newOuts, addressesOut := txhelpers.LTCTxOutpointsByAddr(p.addrMap.store, msgTx,
		p.params)
	var newOutAddrs int
	for addr, isNew := range addressesOut {
		txAddresses[addr] = struct{}{}
		if isNew {
			newOutAddrs++
		}
	}

	// Set PrevOuts in the addrMap, and related txns data in txnsStore.
	if p.txnsStore == nil {
		p.txnsStore = make(txhelpers.LTCTxnsStore)
	}
	newPrevOuts, addressesIn, _ := txhelpers.LTCTxPrevOutsByAddr(
		p.addrMap.store, p.txnsStore, msgTx, p.collector.ltcdChainSvr, p.params)
	var newInAddrs int
	for addr, isNew := range addressesIn {
		txAddresses[addr] = struct{}{}
		if isNew {
			newInAddrs++
		}
	}
	p.addrMap.mtx.Unlock()

	// Store the current mempool transaction, block info zeroed.
	p.txnsStore[msgTx.TxHash()] = &txhelpers.LTCTxWithBlockData{
		Tx:          msgTx,
		MemPoolTime: rawTx.Time,
	}

	log.Tracef("New transaction (%s) added %d new and %d previous outpoints, "+
		"%d out addrs (%d new), %d prev out addrs (%d new).", hash, newOuts, newPrevOuts,
		len(addressesOut), newOutAddrs, len(addressesIn), newInAddrs)

	fee, feeRate := txhelpers.LTCTxFeeRate(msgTx, p.collector.ltcdChainSvr)

	tx := exptypes.MempoolTx{
		TxID:      hash,
		Version:   int32(rawTx.Version),
		Fees:      fee.ToBTC(),
		FeeRate:   feeRate.ToBTC(),
		VinCount:  len(msgTx.TxIn),
		VoutCount: len(msgTx.TxOut),
		Vin:       exptypes.LTCMsgTxMempoolInputs(msgTx),
		// Coinbase is not in mempool
		Hash:     hash,
		Time:     rawTx.Time,
		Size:     int32(len(rawTx.Hex) / 2),
		TotalOut: txhelpers.LTCTotalOutFromMsgTx(msgTx).ToBTC(),
	}

	p.inventory.Transactions = append([]exptypes.MempoolTx{tx}, p.inventory.Transactions...)
	p.inventory.TotalTransactions = int64(len(p.inventory.Transactions))
	p.inventory.OutputsCount += 1
	// Update latest transactions, popping the oldest transaction off
	p.inventory.FormattedTotalSize = exptypes.BytesString(uint64(p.inventory.TotalSize))
	p.inventory.Unlock()
	p.mtx.RUnlock()
	return nil
}

// Refresh collects mempool data, resets counters ticket counters and the timer,
// but does not dispatch the MempoolDataSavers.
func (p *MempoolMonitor) Refresh() ([]exptypes.MempoolTx, *exptypes.MutilchainMempoolInfo, error) {
	// Collect mempool data (currently ticket fees)
	log.Trace("Gathering new mempool data.")
	blockId, txs, addrOuts, txnsStore, err := p.collector.Collect()
	if err != nil {
		log.Errorf("mempool data collection failed: %v", err.Error())
		// stakeData is nil when err != nil
		return nil, nil, err
	}

	log.Debugf("%d addresses in mempool pertaining to %d transactions",
		len(addrOuts), len(txnsStore))
	// Pre-sort the txs so other consumers will not have to do it.
	sort.Sort(exptypes.MPTxsByTime(txs))
	inventory := ParseTxns(txs, p.params, blockId)

	// Reset the counter for tickets since last report.
	p.mtx.Lock()
	// Reset the timer and ticket counter.
	p.mpoolInfo.CurrentHeight = uint32(blockId.Height)
	p.mpoolInfo.LastCollectTime = time.Unix(blockId.Time, 0)

	// Store the current best block info.
	p.lastBlock = *blockId
	p.inventory = inventory
	p.txnsStore = txnsStore
	p.mtx.Unlock()

	p.addrMap.mtx.Lock()
	p.addrMap.store = addrOuts
	p.addrMap.mtx.Unlock()

	return txs, inventory, err
}

// CollectAndStore collects mempool data, resets counters ticket counters and
// the timer, and dispatches the storers.
func (p *MempoolMonitor) CollectAndStore() error {
	log.Trace("Gathering new mempool data.")
	txs, inv, err := p.Refresh()
	if err != nil {
		log.Errorf("mempool data collection failed: %v", err.Error())
		// stakeData is nil when err != nil
		return err
	}

	// Store mempool stakeData with each registered saver.
	for _, s := range p.dataSavers {
		if s != nil {
			log.Trace("Saving MP data.")
			// Save data to wherever the saver wants to put it.
			// Deep copy the txs slice so each saver can modify it.
			txsCopy := exptypes.CopyMempoolTxSlice(txs)
			go s.StoreLTCMPData(txsCopy, inv)
		}
	}

	return nil
}

// UnconfirmedTxnsForAddress indexes (1) outpoints in mempool that pay to the
// given address, (2) previous outpoint being consumed that paid to the address,
// and (3) all relevant transactions. See txhelpers.AddressOutpoints for more
// information. The number of unconfirmed transactions is also returned. This
// satisfies the rpcutils.MempoolAddressChecker interface for MempoolMonitor.
func (p *MempoolMonitor) UnconfirmedTxnsForAddress(address string) (*txhelpers.LTCAddressOutpoints, int64, error) {
	p.addrMap.mtx.Lock()
	defer p.addrMap.mtx.Unlock()
	addrStore := p.addrMap.store
	if addrStore == nil {
		return nil, 0, fmt.Errorf("uninitialized MempoolAddressStore")
	}

	// Retrieve the AddressOutpoints for this address.
	outs := addrStore[address]
	if outs == nil {
		return txhelpers.NewLTCAddressOutpoints(address), 0, nil
	}

	if outs.TxnsStore == nil {
		outs.TxnsStore = make(txhelpers.LTCTxnsStore)
	}

	// Fill out the TxnsStore and count unconfirmed transactions. Note that the
	// values stored in TxnsStore are pointers, and they are already allocated
	// and stored in MempoolMonitor.txnsStore. This code makes a similar
	// transaction map for just the transactions related to the address.

	// Process the transaction hashes for the new outpoints.
	for op := range outs.Outpoints {
		hash := outs.Outpoints[op].Hash
		// New transaction for this address?
		if _, found := outs.TxnsStore[hash]; found {
			// This is another (prev)out for an already seen transaction, so
			// there is no need to retrieve it from MempoolMonitor.txnsStore.
			continue
		}

		txData := p.txnsStore[hash]
		if txData == nil {
			log.Warnf("Unable to locate in TxnsStore: %v", hash)
			continue
		}
		outs.TxnsStore[hash] = txData
	}

	// Process the transaction hashes for the consumed previous outpoints.
	for ip := range outs.PrevOuts {
		// Store the previous outpoint's spending transaction first.
		spendingTx := outs.PrevOuts[ip].TxSpending
		if _, found := outs.TxnsStore[spendingTx]; !found {
			txData := p.txnsStore[spendingTx]
			if txData == nil {
				log.Warnf("Unable to locate in TxnsStore: %v", spendingTx)
			}
			outs.TxnsStore[spendingTx] = txData
		}

		// The funding transaction for the previous outpoint.
		hash := outs.PrevOuts[ip].PreviousOutpoint.Hash
		// New transaction for this address?
		if _, found := outs.TxnsStore[hash]; found {
			// This is another (prev)out for an already seen transaction, so
			// there is no need to retrieve it from MempoolMonitor.txnsStore.
			continue
		}

		txData := p.txnsStore[hash]
		if txData == nil {
			log.Warnf("Unable to locate in TxnsStore: %v", hash)
		}
		outs.TxnsStore[hash] = txData
	}

	return outs, int64(len(outs.TxnsStore)), nil
}
