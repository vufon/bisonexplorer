// Copyright (c) 2019-2021, The Decred developers
// Copyright (c) 2017, Jonathan Chappelow
// See LICENSE for details.

package mempoolbtc

import (
	"sync"
	"time"

	exptypes "github.com/decred/dcrdata/v8/explorer/types"
)

// DataCache models the basic data for the mempool cache.
type DataCache struct {
	mtx sync.RWMutex

	// Height and hash of best block at time of data collection
	height uint32
	hash   string

	// Time of mempool data collection
	timestamp time.Time
	totalFee  float64
	totalSize int32
	totalOut  float64
	// All transactions
	txns []exptypes.MempoolTx
}

// StoreMPData stores info from data in the mempool cache. It is advisable to
// pass a copy of the []types.MempoolTx so that it may be modified (e.g. sorted)
// without affecting other MempoolDataSavers.
func (c *DataCache) StoreBTCMPData(txsCopy []exptypes.MempoolTx, info *exptypes.MutilchainMempoolInfo) {
	c.mtx.Lock()
	defer c.mtx.Unlock()

	c.height = uint32(info.LastBlockHeight)
	c.hash = info.LastBlockHash
	c.totalFee = info.TotalFee
	c.totalOut = info.TotalOut
	c.totalSize = info.TotalSize
	c.timestamp = time.Unix(info.Time, 0)

	c.txns = txsCopy
}

// GetHeight returns the mempool height
func (c *DataCache) GetHeight() uint32 {
	c.mtx.RLock()
	defer c.mtx.RUnlock()
	return c.height
}

// GetFees returns the mempool height number of fees and an array of the fields
func (c *DataCache) GetFees(N int) (uint32, float64) {
	c.mtx.RLock()
	defer c.mtx.RUnlock()
	return c.height, c.totalFee
}
