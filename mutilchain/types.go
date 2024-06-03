// Copyright (c) 2013-2015 The btcsuite developers
// Use of this source code is governed by an ISC
// license that can be found in the LICENSE file.

package mutilchain

type BlockchainInfo struct {
	TotalTransactions int64
	BlockchainSize    int64
	Difficulty        float64
}

const (
	LTCStartBlockReward = 50
	BTCStartBlockReward = 50
)
