// Copyright (c) 2019-2021, The Decred developers
// See LICENSE for details.

package mempoolbtc

import (
	"time"

	"github.com/btcsuite/btcd/chaincfg/chainhash"
)

// MempoolInfo models basic data about the node's mempool
type MempoolInfo struct {
	CurrentHeight   uint32
	LastCollectTime time.Time
}

// BlockID provides basic identifying information about a block.
type BlockID struct {
	Hash   chainhash.Hash
	Height int64
	Time   int64
}

// NewTx models data for a new transaction.
type NewTx struct {
	Hash *chainhash.Hash
	T    time.Time
}

type ScriptSig struct {
	Asm string `json:"asm"`
	Hex string `json:"hex"`
}

type Vin struct {
	Coinbase    string     `json:"coinbase"`
	Stakebase   string     `json:"stakebase"`
	Txid        string     `json:"txid"`
	Vout        uint32     `json:"vout"`
	Tree        int8       `json:"tree"`
	Sequence    uint32     `json:"sequence"`
	AmountIn    float64    `json:"amountin"`
	BlockHeight uint32     `json:"blockheight"`
	BlockIndex  uint32     `json:"blockindex"`
	ScriptSig   *ScriptSig `json:"scriptSig"`
}

type ScriptPubKeyResult struct {
	Asm       string   `json:"asm"`
	Hex       string   `json:"hex,omitempty"`
	ReqSigs   int32    `json:"reqSigs,omitempty"`
	Type      string   `json:"type"`
	Addresses []string `json:"addresses,omitempty"`
	CommitAmt *float64 `json:"commitamt,omitempty"`
}

// Vout models parts of the tx data.  It is defined separately since both
// getrawtransaction and decoderawtransaction use the same structure.
type Vout struct {
	Value        float64            `json:"value"`
	N            uint32             `json:"n"`
	Version      uint16             `json:"version"`
	ScriptPubKey ScriptPubKeyResult `json:"scriptPubKey"`
}

type Tx struct {
	Hex      string `json:"hex"`
	Txid     string `json:"txid"`
	Version  int32  `json:"version"`
	LockTime uint32 `json:"locktime"`
	Expiry   uint32 `json:"expiry"`
	Vin      []Vin  `json:"vin"`
	Vout     []Vout `json:"vout"`
}
