// Copyright (c) 2013-2015 The btcsuite developers
// Use of this source code is governed by an ISC
// license that can be found in the LICENSE file.

package mutilchain

import (
	"time"

	btcchainhash "github.com/btcsuite/btcd/chaincfg/chainhash"
	ltcchainhash "github.com/ltcsuite/ltcd/chaincfg/chainhash"
)

type BlockchainInfo struct {
	TotalTransactions int64
	BlockchainSize    int64
	CoinSupply        float64
	Difficulty        float64
}

const (
	LTCStartBlockReward = 50
	BTCStartBlockReward = 50
)

type BtcBlockHeader struct {
	Hash   btcchainhash.Hash
	Height int32
	Time   time.Time
}

type LtcBlockHeader struct {
	Hash   ltcchainhash.Hash
	Height int32
	Time   time.Time
}

type MultichainChainSizeChartData struct {
	Axis string  `json:"axis"`
	Bin  string  `json:"bin"`
	Size []int64 `json:"size"`
	T    []int64 `json:"t"`
}
